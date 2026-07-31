"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { bcryptRounds, passwordSchema } from "@/lib/password";
import { createPasswordResetToken } from "@/lib/password-reset";
import { sendMail } from "@/lib/email";
import { appOrigin } from "@/lib/origin";
import logger from "@/lib/logger";

const log = logger.child({ module: "users-action" });

export type ActionState = { error?: string; success?: boolean };

/**
 * Sends the "set your password" link a freshly created (or re-invited) user
 * needs, since they have no password of their own yet. Reuses the same
 * reset-token/reset-password machinery as self-service forgot-password, so
 * there is only one place that issues and consumes these links.
 */
async function sendInviteEmail(userId: number, name: string, email: string): Promise<void> {
  const token = await createPasswordResetToken(prisma, userId);
  const link = `${await appOrigin()}/reset-password?token=${token}`;
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  if (!settings) throw new Error("SMTP nicht konfiguriert (keine SystemSettings).");
  await sendMail(
    settings,
    email,
    "Haushaltsbudget: Konto erstellt",
    `Hallo ${name}\n\n` +
      `Für dich wurde ein Konto im Haushaltsbudget angelegt. Über folgenden Link kannst du dein Passwort setzen (gültig für 1 Stunde):\n` +
      `${link}\n\n` +
      `Falls dir das nicht bekannt vorkommt, wende dich an den Administrator.`
  );
}

const userSchema = z.object({
  email: z.string().trim().toLowerCase().email("Ungültige E-Mail-Adresse."),
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(80),
  role: z.enum(UserRole),
});

export async function saveUserAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireAdmin();

  const parsed = userSchema.safeParse({
    email: formData.get("email") ?? "",
    name: formData.get("name") ?? "",
    role: formData.get("role") ?? "Viewer",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;
  const password = String(formData.get("password") ?? "");

  // An empty password means "leave it alone" when editing, and "send an
  // invite email so the user sets their own" when creating — either way it's
  // valid, so only a non-empty value needs to pass the strength check.
  if (password) {
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedPassword.success) {
      return { error: parsedPassword.error.issues[0]?.message ?? "Ungültiges Passwort." };
    }
  }

  // An account demoting itself would lock the admin out of user management
  // with no way back other than editing the database directly.
  if (id === parseInt(session.user.id, 10) && parsed.data.role !== "Admin") {
    return { error: "Du kannst dir die Admin-Rolle nicht selbst entziehen." };
  }

  try {
    if (id) {
      await prisma.user.update({
        where: { id },
        data: {
          ...parsed.data,
          // An admin-set password revokes that user's existing sessions and any
          // reset link still sitting in their inbox — same reasoning as a
          // self-service reset (see User.sessionEpoch).
          ...(password
            ? {
                passwordHash: await hash(password, bcryptRounds),
                sessionEpoch: { increment: 1 },
              }
            : {}),
        },
      });
      if (password) await prisma.passwordResetToken.deleteMany({ where: { userId: id } });
      await logAudit(session, "UPDATE", "User", id, { email: parsed.data.email });
    } else {
      // No password given: the user logs in via the invite link instead, so
      // the stored hash only needs to be unguessable, never entered by anyone.
      const plaintext = password ? password : randomBytes(32).toString("hex");
      const created = await prisma.user.create({
        data: { ...parsed.data, passwordHash: await hash(plaintext, bcryptRounds) },
      });
      await logAudit(session, "CREATE", "User", created.id, { email: parsed.data.email });
      if (!password) {
        try {
          await sendInviteEmail(created.id, created.name, created.email);
        } catch (err) {
          // The account exists either way; the admin can resend the invite
          // from the row menu, same as a broken audit write never blocks the
          // underlying mutation (see logAudit).
          log.error({ err, userId: created.id }, "Failed to send account invite email");
        }
      }
    }
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return { error: "Diese E-Mail-Adresse wird bereits verwendet." };
    }
    throw err;
  }

  revalidatePath("/users");
  return { success: true };
}

export async function toggleUserActiveAction(id: number, isActive: boolean): Promise<ActionState> {
  const session = await requireAdmin();

  if (id === parseInt(session.user.id, 10) && !isActive) {
    return { error: "Du kannst dich nicht selbst deaktivieren." };
  }
  if (!isActive) {
    const remainingAdmins = await prisma.user.count({
      where: { role: "Admin", isActive: true, id: { not: id } },
    });
    if (remainingAdmins === 0) {
      return { error: "Es muss mindestens ein aktiver Admin bestehen bleiben." };
    }
  }

  const user = await prisma.user.update({ where: { id }, data: { isActive } });
  await logAudit(session, "UPDATE", "User", id, { email: user.email, isActive });
  revalidatePath("/users");
  return { success: true };
}

/**
 * Deletes a user. Their transactions stay (the `createdById` relation is
 * `SetNull`) — removing a person must not remove the household's history.
 */
export async function deleteUserAction(id: number): Promise<ActionState> {
  const session = await requireAdmin();

  if (id === parseInt(session.user.id, 10)) {
    return { error: "Du kannst dich nicht selbst löschen." };
  }
  const remainingAdmins = await prisma.user.count({
    where: { role: "Admin", isActive: true, id: { not: id } },
  });
  if (remainingAdmins === 0) {
    return { error: "Es muss mindestens ein aktiver Admin bestehen bleiben." };
  }

  const user = await prisma.user.delete({ where: { id } });
  await logAudit(session, "DELETE", "User", id, { email: user.email });
  revalidatePath("/users");
  return { success: true };
}

/**
 * (Re-)sends the "set your password" link to a user — for an invite that
 * bounced, or any time an admin wants to hand password control back to the
 * user instead of typing one in themselves.
 */
export async function sendPasswordSetupEmailAction(id: number): Promise<ActionState> {
  const session = await requireAdmin();

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return { error: "Benutzer nicht gefunden." };

  try {
    await sendInviteEmail(user.id, user.name, user.email);
  } catch (err) {
    log.error({ err, userId: id }, "Failed to send password setup email");
    return { error: "E-Mail konnte nicht gesendet werden. Bitte SMTP-Einstellungen prüfen." };
  }

  await logAudit(session, "UPDATE", "User", id, { email: user.email, action: "passwordSetupEmailSent" });
  return { success: true };
}
