"use server";

import { compare, hash } from "bcryptjs";
import QRCode from "qrcode";
import { z } from "zod";
import { signOut } from "@/lib/auth";
import { requireSession } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { bcryptRounds, passwordSchema } from "@/lib/password";
import { isRateLimited, recordFailedAttempt, resetRateLimit } from "@/lib/rate-limit";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import {
  generateTwoFactorSecret,
  twoFactorKeyUri,
  verifyTwoFactorToken,
  generateBackupCodes,
  hashBackupCodes,
} from "@/lib/two-factor";
import prisma from "@/lib/prisma";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

/**
 * Shared throttle for the two actions that verify the account's own password.
 * One budget for both, so guessing can't simply alternate between them.
 */
function passwordCheckKey(userId: number): string {
  return `password-check:${userId}`;
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

/**
 * A TOTP code is six digits, and a backup code is the format generateBackupCodes
 * emits. Bounding the field keeps an arbitrarily long string out of the
 * verification path — `otpauth` and the bcrypt compare over the backup codes
 * both do real work per call, and this action is reachable with a session.
 */
const twoFactorCodeSchema = z.string().trim().min(1).max(64);

const disableTwoFactorSchema = z.object({ password: z.string().min(1) });

export async function changeOwnPasswordAction(
  _prevState: { error?: string; success?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireSession();
  const userId = parseInt(session.user.id, 10);

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }
  const { currentPassword, newPassword } = parsed.data;

  // The current-password check is a password oracle, so it gets the same
  // throttling as login: without it a stolen session could sit here and guess
  // the password it needs to disable 2FA or change the address on the account.
  // Keyed per user and counting only failures, so an honest typo-then-retry
  // isn't punished and one account can't throttle another.
  const limitKey = passwordCheckKey(userId);
  if (isRateLimited(limitKey)) {
    return { error: "Zu viele Versuche. Bitte später erneut versuchen." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await compare(currentPassword, user.passwordHash))) {
    recordFailedAttempt(limitKey);
    return { error: "Aktuelles Passwort ist falsch." };
  }
  resetRateLimit(limitKey);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hash(newPassword, bcryptRounds),
      // Revokes older sessions (see User.sessionEpoch). This session goes with
      // them, so the user is asked to sign in again within the minute.
      sessionEpoch: { increment: 1 },
    },
  });
  // Any reset link still in an inbox was issued against the old password and
  // must not survive a voluntary change.
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await logAudit(session, "UPDATE", "User", userId, { action: "changeOwnPassword" });
  return { success: true };
}

/**
 * Starts 2FA setup: generates a fresh secret and stores it encrypted, but
 * `twoFactorEnabled` stays false until confirmTwoFactorSetupAction verifies
 * the user actually scanned it — an unconfirmed secret must never be enough
 * to gate login.
 *
 * Refuses to run while 2FA is already active: without this, a stolen session
 * could call this action directly (it isn't reachable from the UI once 2FA
 * is on, but is a plain server action underneath) and silently re-key or
 * disable 2FA without ever supplying the password disableTwoFactorAction
 * requires. Re-enabling has to go through disable first.
 */
export async function startTwoFactorSetupAction(): Promise<
  { error?: string; secret?: string; qrDataUrl?: string }
> {
  const session = await requireSession();
  const userId = parseInt(session.user.id, 10);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.twoFactorEnabled) {
    return { error: "Zwei-Faktor-Authentifizierung ist bereits aktiv. Bitte zuerst deaktivieren." };
  }

  const secret = generateTwoFactorSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: encryptSecret(secret), twoFactorEnabled: false },
  });

  const uri = twoFactorKeyUri(secret, session.user.email ?? "");
  const qrDataUrl = await QRCode.toDataURL(uri);
  return { secret, qrDataUrl };
}

export type ConfirmTwoFactorState = { error?: string; backupCodes?: string[] };

/** Verifies the first code from the authenticator app and turns 2FA on. */
export async function confirmTwoFactorSetupAction(
  _prevState: ConfirmTwoFactorState | undefined,
  formData: FormData
): Promise<ConfirmTwoFactorState> {
  const session = await requireSession();
  const userId = parseInt(session.user.id, 10);

  const parsedCode = twoFactorCodeSchema.safeParse(formData.get("code"));
  if (!parsedCode.success) return { error: "Code ist ungültig." };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFactorSecret) return { error: "Kein Setup gestartet." };

  const secret = decryptSecret(user.twoFactorSecret);
  if (!secret || !verifyTwoFactorToken(secret, parsedCode.data)) {
    return { error: "Code ist ungültig." };
  }

  const backupCodes = generateBackupCodes();
  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: true,
      twoFactorBackupCodes: await hashBackupCodes(backupCodes),
    },
  });
  await logAudit(session, "UPDATE", "User", userId, { action: "enableTwoFactor" });
  return { backupCodes };
}

/** Disables 2FA; requires the current password so a stolen session alone can't turn it off. */
export async function disableTwoFactorAction(
  _prevState: { error?: string; success?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireSession();
  const userId = parseInt(session.user.id, 10);

  const limitKey = passwordCheckKey(userId);
  if (isRateLimited(limitKey)) {
    return { error: "Zu viele Versuche. Bitte später erneut versuchen." };
  }

  const parsed = disableTwoFactorSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    recordFailedAttempt(limitKey);
    return { error: "Passwort ist falsch." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await compare(parsed.data.password, user.passwordHash))) {
    recordFailedAttempt(limitKey);
    return { error: "Passwort ist falsch." };
  }
  resetRateLimit(limitKey);

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      // Turning the second factor off weakens the account, so other sessions
      // don't get to keep the access they hold.
      sessionEpoch: { increment: 1 },
    },
  });
  await logAudit(session, "UPDATE", "User", userId, { action: "disableTwoFactor" });
  return { success: true };
}
