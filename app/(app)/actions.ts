"use server";

import { compare, hash } from "bcryptjs";
import { signOut } from "@/lib/auth";
import { requireSession } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { bcryptRounds } from "@/lib/password";
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
