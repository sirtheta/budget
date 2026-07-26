"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { sendMail } from "@/lib/email";
import { runBackup } from "@/lib/backup";
import logger from "@/lib/logger";

const log = logger.child({ module: "settings" });

export type ActionState = { error?: string; success?: boolean };

/**
 * Rejects CR and LF. These values are interpolated into SMTP data (notably the
 * `From` header), where a newline starts a new header — nodemailer encodes what
 * it is given, but the malformed value should never get that far.
 */
const singleLine = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/[\r\n]/.test(value), `${label} darf keine Zeilenumbrüche enthalten.`);

const settingsSchema = z.object({
  currency: z.string().trim().length(3, "Währungscode besteht aus drei Buchstaben.").toUpperCase(),
  smtpHost: singleLine(200, "SMTP-Server").optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpUser: singleLine(200, "SMTP-Benutzer").optional(),
  smtpFromName: singleLine(100, "Absendername").optional(),
  // Validated as an address, not just length: it goes into the From header, and
  // a malformed sender is rejected by the receiving server anyway.
  smtpFromAddress: z
    .string()
    .trim()
    .max(200)
    .email("Absenderadresse ist keine gültige E-Mail-Adresse.")
    .optional(),
});

export async function saveSettingsAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireAdmin();

  const parsed = settingsSchema.safeParse({
    currency: formData.get("currency") ?? "CHF",
    smtpHost: (formData.get("smtpHost") as string) || undefined,
    smtpPort: (formData.get("smtpPort") as string) || undefined,
    smtpUser: (formData.get("smtpUser") as string) || undefined,
    smtpFromName: (formData.get("smtpFromName") as string) || undefined,
    smtpFromAddress: (formData.get("smtpFromAddress") as string) || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const password = String(formData.get("smtpPassword") ?? "");

  const data = {
    currency: parsed.data.currency,
    smtpHost: parsed.data.smtpHost || null,
    smtpPort: parsed.data.smtpPort ?? null,
    smtpUser: parsed.data.smtpUser || null,
    smtpFromName: parsed.data.smtpFromName || null,
    smtpFromAddress: parsed.data.smtpFromAddress || null,
    // An empty field means "leave unchanged" — the stored password is never
    // sent to the browser, so it can't be echoed back on save.
    ...(password ? { smtpPassword: encryptSecret(password) } : {}),
  };

  await prisma.systemSettings.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });

  await logAudit(session, "SETTINGS", "Settings", 1, { currency: data.currency });
  revalidatePath("/settings");
  return { success: true };
}

/** Sends a test mail so SMTP can be verified without waiting for a real one. */
export async function sendTestMailAction(): Promise<ActionState> {
  const session = await requireAdmin();

  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  if (!settings) return { error: "Es sind noch keine Einstellungen gespeichert." };

  const recipient = session.user.email;
  if (!recipient) return { error: "Dein Benutzerkonto hat keine E-Mail-Adresse." };

  try {
    await sendMail(
      settings,
      recipient,
      "Haushaltsbudget: Test-E-Mail",
      `Hallo ${session.user.name ?? ""}\n\nDies ist eine Test-E-Mail des Haushaltsbudgets. ` +
        `Wenn du sie erhältst, funktioniert der SMTP-Versand.`
    );
  } catch (err) {
    log.error({ err }, "Test mail failed");
    return { error: err instanceof Error ? err.message : "Versand fehlgeschlagen." };
  }

  await logAudit(session, "SETTINGS", "Settings", 1, { action: "testMail" });
  return { success: true };
}

/** Writes a database snapshot on demand, in addition to the nightly job. */
export async function runBackupNowAction(): Promise<ActionState & { path?: string }> {
  const session = await requireAdmin();

  try {
    const path = await runBackup(prisma);
    await logAudit(session, "SETTINGS", "Settings", 1, { action: "manualBackup" });
    return { success: true, path };
  } catch (err) {
    log.error({ err }, "Manual backup failed");
    return { error: err instanceof Error ? err.message : "Backup fehlgeschlagen." };
  }
}
