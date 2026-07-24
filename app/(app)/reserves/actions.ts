"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { parseMoney } from "@/lib/money";
import { isValidDateString } from "@/lib/date";
import { settleReserve } from "@/lib/reserves";

export type ActionState = { error?: string; success?: boolean };

function revalidateAll() {
  revalidatePath("/reserves");
  revalidatePath("/dashboard");
  revalidatePath("/budget");
}

function optionalId(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "");
  if (!text || text === "none") return null;
  const parsed = parseInt(text, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

// ── Reserves ──────────────────────────────────────────────────────────────────

const reserveSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(80),
  intervalMonths: z.coerce.number().int().min(1).max(120),
  nextDueDate: z.string().refine(isValidDateString, "Ungültiges Fälligkeitsdatum."),
  notes: z.string().trim().max(500).optional(),
});

export async function saveReserveAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = reserveSchema.safeParse({
    name: formData.get("name") ?? "",
    intervalMonths: formData.get("intervalMonths") ?? 12,
    nextDueDate: formData.get("nextDueDate") ?? "",
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const targetAmountCents = parseMoney(String(formData.get("targetAmount") ?? ""));
  if (targetAmountCents === null) return { error: "Betrag ist keine gültige Zahl." };
  if (targetAmountCents <= 0) return { error: "Der Betrag muss grösser als 0 sein." };

  const savedCents = parseMoney(String(formData.get("saved") ?? "0")) ?? 0;
  if (savedCents < 0) return { error: "Der zurückgelegte Betrag kann nicht negativ sein." };

  const data = {
    name: parsed.data.name,
    targetAmountCents,
    savedCents,
    intervalMonths: parsed.data.intervalMonths,
    nextDueDate: parsed.data.nextDueDate,
    categoryId: optionalId(formData.get("categoryId")),
    accountId: optionalId(formData.get("accountId")),
    notes: parsed.data.notes || null,
  };

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  if (id) {
    await prisma.reserve.update({ where: { id }, data });
    await logAudit(session, "UPDATE", "Reserve", id, { name: data.name });
  } else {
    const created = await prisma.reserve.create({ data });
    await logAudit(session, "CREATE", "Reserve", created.id, { name: data.name });
  }

  revalidateAll();
  return { success: true };
}

/** Adds to (or subtracts from) the amount already set aside for a reserve. */
export async function addToReserveAction(id: number, amount: string): Promise<ActionState> {
  const session = await requireEditor();

  const delta = parseMoney(amount);
  if (delta === null) return { error: "Betrag ist keine gültige Zahl." };

  const reserve = await prisma.reserve.findUnique({ where: { id } });
  if (!reserve) return { error: "Rückstellung nicht gefunden." };

  const savedCents = Math.max(0, reserve.savedCents + delta);
  await prisma.reserve.update({ where: { id }, data: { savedCents } });
  await logAudit(session, "UPDATE", "Reserve", id, {
    name: reserve.name,
    action: "addToReserve",
    delta,
  });

  revalidateAll();
  return { success: true };
}

/**
 * Marks a reserve as paid: consumes the set-aside amount and moves the due
 * date on by one interval. Any surplus stays in the pot for the next period.
 */
export async function settleReserveAction(id: number): Promise<ActionState> {
  const session = await requireEditor();

  const reserve = await prisma.reserve.findUnique({ where: { id } });
  if (!reserve) return { error: "Rückstellung nicht gefunden." };

  await prisma.reserve.update({ where: { id }, data: settleReserve(reserve) });
  await logAudit(session, "UPDATE", "Reserve", id, { name: reserve.name, action: "settle" });

  revalidateAll();
  return { success: true };
}

export async function deleteReserveAction(id: number): Promise<ActionState> {
  const session = await requireEditor();
  const reserve = await prisma.reserve.delete({ where: { id } });
  await logAudit(session, "DELETE", "Reserve", id, { name: reserve.name });
  revalidateAll();
  return { success: true };
}

// ── Savings goals ─────────────────────────────────────────────────────────────

const goalSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(80),
  targetDate: z
    .string()
    .optional()
    .refine((value) => !value || isValidDateString(value), "Ungültiges Zieldatum."),
  color: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function saveGoalAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = goalSchema.safeParse({
    name: formData.get("name") ?? "",
    targetDate: (formData.get("targetDate") as string) || undefined,
    color: (formData.get("color") as string) || undefined,
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const targetAmountCents = parseMoney(String(formData.get("targetAmount") ?? ""));
  if (targetAmountCents === null) return { error: "Zielbetrag ist keine gültige Zahl." };
  if (targetAmountCents <= 0) return { error: "Der Zielbetrag muss grösser als 0 sein." };

  const savedCents = parseMoney(String(formData.get("saved") ?? "0")) ?? 0;

  const data = {
    name: parsed.data.name,
    targetAmountCents,
    savedCents: Math.max(0, savedCents),
    targetDate: parsed.data.targetDate || null,
    accountId: optionalId(formData.get("accountId")),
    color: parsed.data.color || null,
    notes: parsed.data.notes || null,
  };

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  if (id) {
    await prisma.savingsGoal.update({ where: { id }, data });
    await logAudit(session, "UPDATE", "SavingsGoal", id, { name: data.name });
  } else {
    const created = await prisma.savingsGoal.create({ data });
    await logAudit(session, "CREATE", "SavingsGoal", created.id, { name: data.name });
  }

  revalidateAll();
  return { success: true };
}

export async function addToGoalAction(id: number, amount: string): Promise<ActionState> {
  const session = await requireEditor();

  const delta = parseMoney(amount);
  if (delta === null) return { error: "Betrag ist keine gültige Zahl." };

  const goal = await prisma.savingsGoal.findUnique({ where: { id } });
  if (!goal) return { error: "Sparziel nicht gefunden." };

  await prisma.savingsGoal.update({
    where: { id },
    data: { savedCents: Math.max(0, goal.savedCents + delta) },
  });
  await logAudit(session, "UPDATE", "SavingsGoal", id, {
    name: goal.name,
    action: "addToGoal",
    delta,
  });

  revalidateAll();
  return { success: true };
}

export async function deleteGoalAction(id: number): Promise<ActionState> {
  const session = await requireEditor();
  const goal = await prisma.savingsGoal.delete({ where: { id } });
  await logAudit(session, "DELETE", "SavingsGoal", id, { name: goal.name });
  revalidateAll();
  return { success: true };
}
