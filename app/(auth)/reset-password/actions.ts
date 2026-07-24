"use server";

import { headers } from "next/headers";
import { hash } from "bcryptjs";
import { z } from "zod";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { bcryptRounds } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
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

  // Throttle token guessing per IP; tokens are 32 random bytes, so this is
  // belt and braces.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`pwreset-consume:${ip}`, { maxAttempts: 10 })) {
    return { error: "Zu viele Versuche. Bitte später erneut versuchen." };
  }

  const userId = await consumePasswordResetToken(prisma, parsed.data.token);
  if (userId === null) {
    return { error: "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an." };
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hash(parsed.data.password, bcryptRounds) },
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
