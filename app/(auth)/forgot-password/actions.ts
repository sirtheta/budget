"use server";

import { headers } from "next/headers";
import { z } from "zod";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import { config } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { createPasswordResetToken } from "@/lib/password-reset";
import { sendMail } from "@/lib/email";
import { appOrigin } from "@/lib/origin";

const log = logger.child({ module: "password-reset" });

const emailSchema = z.string().email();

/**
 * Requests a password-reset email. Always answers with the same generic
 * success (even when the address is unknown, inactive, or rate-limited), so
 * the form can't be used to probe which accounts exist.
 */
export async function requestPasswordResetAction(
  _prevState: { error?: string; success?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Ungültige E-Mail-Adresse." };
  const email = parsed.data;

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const emailAllowed = checkRateLimit(`pwreset:${email.toLowerCase()}`, { maxAttempts: 3 });
  const ipAllowed = checkRateLimit(`pwreset-ip:${ip}`, {
    maxAttempts: config.rateLimit.maxAttempts * 10,
  });
  if (!emailAllowed || !ipAllowed) {
    log.warn({ email, ip }, "password reset blocked: rate limit exceeded");
    return { success: true };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    log.info({ email }, "password reset requested for unknown or inactive account");
    return { success: true };
  }

  try {
    const token = await createPasswordResetToken(prisma, user.id);
    const link = `${await appOrigin()}/reset-password?token=${token}`;
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    if (!settings) throw new Error("SMTP nicht konfiguriert (keine SystemSettings).");
    await sendMail(
      settings,
      user.email,
      "Haushaltsbudget: Passwort zurücksetzen",
      `Hallo ${user.name}\n\n` +
        `Über folgenden Link kannst du ein neues Passwort setzen (gültig für 1 Stunde):\n` +
        `${link}\n\n` +
        `Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren.`
    );
    log.info({ userId: user.id }, "password reset email sent");
  } catch (err) {
    // Still answer generically — the sender failure is an ops problem, not
    // something an anonymous visitor should learn about.
    log.error({ err, userId: user.id }, "Failed to send password reset email");
  }
  return { success: true };
}
