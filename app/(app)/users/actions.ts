"use server";

import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { bcryptRounds, passwordSchema } from "@/lib/password";

export type ActionState = { error?: string; success?: boolean };

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

  // A password is required when creating a user, and optional when editing one
  // — an empty field there means "leave it alone" rather than "set it to empty".
  if (!id || password) {
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
      const created = await prisma.user.create({
        data: { ...parsed.data, passwordHash: await hash(password, bcryptRounds) },
      });
      await logAudit(session, "CREATE", "User", created.id, { email: parsed.data.email });
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
