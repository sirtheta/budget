"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { parseMoney } from "@/lib/money";
import { config } from "@/lib/config";
import { addMonths, isValidDateString, todayInZone } from "@/lib/date";
import { postDueRecurring, postOnce } from "@/lib/recurring";

export type ActionState = { error?: string; success?: boolean };

function revalidateAll() {
  revalidatePath("/recurring");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/budget");
}

const recurringSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(120),
  intervalMonths: z.coerce.number().int().min(1).max(120),
  startDate: z.string().refine(isValidDateString, "Ungültiges Startdatum."),
  endDate: z
    .string()
    .optional()
    .refine((value) => !value || isValidDateString(value), "Ungültiges Enddatum."),
  notes: z.string().trim().max(500).optional(),
});

export async function saveRecurringAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = recurringSchema.safeParse({
    name: formData.get("name") ?? "",
    intervalMonths: formData.get("intervalMonths") ?? 1,
    startDate: formData.get("startDate") ?? "",
    endDate: (formData.get("endDate") as string) || undefined,
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const accountId = parseInt(String(formData.get("accountId") ?? ""), 10);
  if (!Number.isInteger(accountId)) return { error: "Bitte ein Konto auswählen." };

  const isTransfer = formData.get("mode") === "transfer";
  const counterRaw = formData.get("counterAccountId");
  const counterAccountId =
    isTransfer && counterRaw && counterRaw !== "none"
      ? parseInt(String(counterRaw), 10)
      : null;

  if (isTransfer) {
    if (counterAccountId === null) return { error: "Bitte ein Zielkonto auswählen." };
    if (counterAccountId === accountId) {
      return { error: "Quell- und Zielkonto müssen unterschiedlich sein." };
    }
  }

  const categoryRaw = formData.get("categoryId");
  const categoryId =
    !isTransfer && categoryRaw && categoryRaw !== "none"
      ? parseInt(String(categoryRaw), 10)
      : null;

  const magnitude = parseMoney(String(formData.get("amount") ?? ""));
  if (magnitude === null) return { error: "Betrag ist keine gültige Zahl." };
  if (magnitude === 0) return { error: "Betrag darf nicht 0 sein." };

  // A transfer's amount is always taken as a magnitude — the direction comes
  // from which account is source and which is target.
  const direction = isTransfer || formData.get("direction") !== "income" ? -1 : 1;
  const amountCents = isTransfer ? Math.abs(magnitude) : direction * Math.abs(magnitude);

  if (parsed.data.endDate && parsed.data.endDate < parsed.data.startDate) {
    return { error: "Das Enddatum liegt vor dem Startdatum." };
  }

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  const data = {
    name: parsed.data.name,
    amountCents,
    accountId,
    counterAccountId,
    categoryId,
    intervalMonths: parsed.data.intervalMonths,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate || null,
    autoPost: formData.get("autoPost") === "on",
    notes: parsed.data.notes || null,
  };

  if (id) {
    // nextDate is left untouched on edit: it tracks how far the schedule has
    // already been posted, and resetting it would re-post past months.
    await prisma.recurringTransaction.update({ where: { id }, data });
    await logAudit(session, "UPDATE", "RecurringTransaction", id, { name: data.name });
  } else {
    const created = await prisma.recurringTransaction.create({
      data: { ...data, nextDate: parsed.data.startDate },
    });
    await logAudit(session, "CREATE", "RecurringTransaction", created.id, { name: data.name });
  }

  revalidateAll();
  return { success: true };
}

export async function toggleRecurringActiveAction(
  id: number,
  isActive: boolean
): Promise<ActionState> {
  const session = await requireEditor();
  const row = await prisma.recurringTransaction.update({ where: { id }, data: { isActive } });
  await logAudit(session, "UPDATE", "RecurringTransaction", id, { name: row.name, isActive });
  revalidateAll();
  return { success: true };
}

export async function deleteRecurringAction(id: number): Promise<ActionState> {
  const session = await requireEditor();
  const row = await prisma.recurringTransaction.delete({ where: { id } });
  await logAudit(session, "DELETE", "RecurringTransaction", id, { name: row.name });
  revalidateAll();
  return { success: true };
}

/**
 * Posts one occurrence of a `autoPost: false` entry that the user confirmed
 * from the dashboard, and advances its schedule.
 */
export async function postRecurringNowAction(id: number): Promise<ActionState> {
  const session = await requireEditor();

  const row = await prisma.recurringTransaction.findUnique({ where: { id } });
  if (!row) return { error: "Wiederkehrende Buchung nicht gefunden." };

  await postOnce(prisma, row);
  const nextDate = addMonths(row.nextDate, row.intervalMonths);
  const exhausted = row.endDate !== null && nextDate > row.endDate;
  await prisma.recurringTransaction.update({
    where: { id },
    data: { nextDate, ...(exhausted ? { isActive: false } : {}) },
  });

  await logAudit(session, "AUTOMATIC", "RecurringTransaction", id, {
    name: row.name,
    postedFor: row.nextDate,
  });

  revalidateAll();
  return { success: true };
}

/** Runs the scheduler on demand — useful after the container was off a while. */
export async function runRecurringNowAction(): Promise<ActionState & { posted?: number }> {
  const session = await requireEditor();
  const result = await postDueRecurring(prisma, todayInZone(config.recurring.timezone));
  await logAudit(session, "AUTOMATIC", "RecurringTransaction", undefined, {
    action: "runNow",
    posted: result.postedCount,
  });
  revalidateAll();
  return { success: true, posted: result.postedCount };
}
