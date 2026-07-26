"use server";

import { headers } from "next/headers";
import { hash } from "bcryptjs";
import { z } from "zod";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { bcryptRounds } from "@/lib/password";
import { isRateLimited, recordFailedAttempt } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { consumePasswordResetToken } from "@/lib/password-reset";

const log = logger.child({ module: "password-reset" });

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen lang sein."),
});

export async function resetPasswordAction(
  _prevState: { error?: string; success?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }
  if (parsed.data.password !== formData.get("passwordConfirm")) {
    return { error: "Die Passwörter stimmen nicht überein." };
  }

  // Throttle token guessing. Tokens are 32 random bytes, so this is belt and
  // braces either way. Per IP where the address is trustworthy; otherwise a
  // single generous bucket that only counts *failures*, so a flood of wrong
  // tokens can't lock out someone following a real link from their inbox.
  const ip = clientIp(await headers());
  const bucket = ip === null ? "pwreset-consume:global" : `pwreset-consume:${ip}`;
  const maxAttempts = ip === null ? 100 : 10;
  if (isRateLimited(bucket, { maxAttempts })) {
    return { error: "Zu viele Versuche. Bitte später erneut versuchen." };
  }

  const userId = await consumePasswordResetToken(prisma, parsed.data.token);
  if (userId === null) {
    recordFailedAttempt(bucket, { maxAttempts });
    return { error: "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an." };
  }

  // Bumping sessionEpoch revokes every JWT issued before this reset. Someone
  // resetting a password is usually doing it because another party has access;
  // leaving their sessions alive for the rest of SESSION_MAX_AGE_SEC would make
  // the reset pointless.
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hash(parsed.data.password, bcryptRounds),
      sessionEpoch: { increment: 1 },
    },
  });
  log.info({ userId }, "password reset completed");

  // No session exists here — write the audit row directly (same
  // never-throw contract as logAudit).
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        userName: user.name,
        action: "UPDATE",
        entityType: "User",
        entityId: userId,
        details: JSON.stringify({ action: "passwordReset" }),
      },
    });
  } catch (err) {
    log.error({ err, userId }, "Failed to write audit log for password reset");
  }

  return { success: true };
}
