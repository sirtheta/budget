"use server";

import { compare, hash } from "bcryptjs";
import QRCode from "qrcode";
import { signOut } from "@/lib/auth";
import { requireSession } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { bcryptRounds } from "@/lib/password";
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

export async function changeOwnPasswordAction(
  _prevState: { error?: string; success?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireSession();
  const userId = parseInt(session.user.id, 10);

  const currentPassword = formData.get("currentPassword");
  const newPassword = formData.get("newPassword");
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return { error: "Ungültige Eingabe." };
  }
  if (newPassword.length < 8) {
    return { error: "Neues Passwort muss mindestens 8 Zeichen lang sein." };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await compare(currentPassword, user.passwordHash))) {
    return { error: "Aktuelles Passwort ist falsch." };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hash(newPassword, bcryptRounds) },
  });
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

  const code = String(formData.get("code") ?? "").trim();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFactorSecret) return { error: "Kein Setup gestartet." };

  const secret = decryptSecret(user.twoFactorSecret);
  if (!secret || !verifyTwoFactorToken(secret, code)) {
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

  const password = String(formData.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await compare(password, user.passwordHash))) {
    return { error: "Passwort ist falsch." };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: null },
  });
  await logAudit(session, "UPDATE", "User", userId, { action: "disableTwoFactor" });
  return { success: true };
}
