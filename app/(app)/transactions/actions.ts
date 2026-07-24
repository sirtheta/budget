"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { parseMoney } from "@/lib/money";
import { isValidDateString } from "@/lib/date";
import { createTransfer, deleteTransfer, updateTransfer } from "@/lib/transactions";

export type ActionState = { error?: string; success?: boolean };

const baseSchema = z.object({
  date: z.string().refine(isValidDateString, "Ungültiges Datum."),
  description: z.string().trim().min(1, "Beschreibung darf nicht leer sein.").max(200),
  notes: z.string().trim().max(500).optional(),
  counterparty: z.string().trim().max(120).optional(),
});

function revalidateAll() {
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/budget");
  revalidatePath("/analytics");
  revalidatePath("/accounts");
}

/**
 * Creates or updates a single booking.
 *
 * The form supplies a positive amount plus a direction, rather than a signed
 * number: asking a user to type "−82.40" for a purchase is a reliable source
 * of sign errors, and the direction is what they actually think in.
 */
export async function saveTransactionAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = baseSchema.safeParse({
    date: formData.get("date") ?? "",
    description: formData.get("description") ?? "",
    notes: formData.get("notes") ?? undefined,
    counterparty: formData.get("counterparty") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const accountId = parseInt(String(formData.get("accountId") ?? ""), 10);
  if (!Number.isInteger(accountId)) return { error: "Bitte ein Konto auswählen." };

  const categoryRaw = formData.get("categoryId");
  const categoryId =
    categoryRaw && categoryRaw !== "" ? parseInt(String(categoryRaw), 10) : null;

  const magnitude = parseMoney(String(formData.get("amount") ?? ""));
  if (magnitude === null) return { error: "Betrag ist keine gültige Zahl." };
  if (magnitude === 0) return { error: "Betrag darf nicht 0 sein." };

  const direction = formData.get("direction") === "income" ? 1 : -1;
  const amountCents = direction * Math.abs(magnitude);

  if (categoryId !== null) {
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) return { error: "Kategorie nicht gefunden." };
    // A booking whose sign contradicts its category would be counted with the
    // wrong sign in every budget evaluation, so it is rejected up front.
    if (category.kind === "Income" && amountCents < 0) {
      return { error: `"${category.name}" ist eine Einnahmekategorie — bitte Einnahme wählen.` };
    }
    if (category.kind === "Expense" && amountCents > 0) {
      return { error: `"${category.name}" ist eine Ausgabekategorie — bitte Ausgabe wählen.` };
    }
  }

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  const data = {
    date: parsed.data.date,
    amountCents,
    accountId,
    categoryId,
    description: parsed.data.description,
    counterparty: parsed.data.counterparty || null,
    notes: parsed.data.notes || null,
  };

  if (id) {
    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) return { error: "Buchung nicht gefunden." };
    if (existing.transferGroupId) {
      return { error: "Umbuchungen müssen über das Umbuchungs-Formular bearbeitet werden." };
    }
    await prisma.transaction.update({ where: { id }, data });
    await logAudit(session, "UPDATE", "Transaction", id, data);
  } else {
    const created = await prisma.transaction.create({
      data: { ...data, source: "Manual", createdById: parseInt(session.user.id, 10) },
    });
    await logAudit(session, "CREATE", "Transaction", created.id, data);
  }

  revalidateAll();
  return { success: true };
}

/** Creates or updates a transfer between two of the household's own accounts. */
export async function saveTransferAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = baseSchema.safeParse({
    date: formData.get("date") ?? "",
    description: formData.get("description") ?? "Umbuchung",
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const fromAccountId = parseInt(String(formData.get("fromAccountId") ?? ""), 10);
  const toAccountId = parseInt(String(formData.get("toAccountId") ?? ""), 10);
  if (!Number.isInteger(fromAccountId) || !Number.isInteger(toAccountId)) {
    return { error: "Bitte Quell- und Zielkonto auswählen." };
  }

  const amountCents = parseMoney(String(formData.get("amount") ?? ""));
  if (amountCents === null) return { error: "Betrag ist keine gültige Zahl." };

  const input = {
    fromAccountId,
    toAccountId,
    date: parsed.data.date,
    amountCents,
    description: parsed.data.description,
    notes: parsed.data.notes ?? null,
  };

  const groupId = formData.get("transferGroupId");
  try {
    if (groupId) {
      await updateTransfer(prisma, String(groupId), input);
      await logAudit(session, "UPDATE", "Transaction", undefined, { transfer: true, ...input });
    } else {
      const [outgoing] = await createTransfer(prisma, {
        ...input,
        createdById: parseInt(session.user.id, 10),
      });
      await logAudit(session, "CREATE", "Transaction", outgoing.id, { transfer: true, ...input });
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Umbuchung fehlgeschlagen." };
  }

  revalidateAll();
  return { success: true };
}

export async function deleteTransactionAction(id: number): Promise<ActionState> {
  const session = await requireEditor();

  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing) return { error: "Buchung nicht gefunden." };

  // Deleting one leg of a transfer would leave the other side dangling and
  // both account balances wrong, so both legs always go together.
  if (existing.transferGroupId) {
    await deleteTransfer(prisma, existing.transferGroupId);
    await logAudit(session, "DELETE", "Transaction", id, {
      transfer: true,
      date: existing.date,
      amountCents: existing.amountCents,
      description: existing.description,
    });
  } else {
    await prisma.transaction.delete({ where: { id } });
    await logAudit(session, "DELETE", "Transaction", id, {
      date: existing.date,
      amountCents: existing.amountCents,
      description: existing.description,
    });
  }

  revalidateAll();
  return { success: true };
}

/**
 * Assigns a category to several bookings at once — the fast way to clean up
 * after an import that the rules didn't fully cover.
 */
export async function bulkCategorizeAction(
  ids: number[],
  categoryId: number
): Promise<ActionState & { updated?: number }> {
  const session = await requireEditor();
  if (ids.length === 0) return { error: "Keine Buchungen ausgewählt." };

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) return { error: "Kategorie nicht gefunden." };

  // Only rows whose sign matches the category, so a bulk action can't create
  // the contradiction that the single-booking form rejects.
  const { count } = await prisma.transaction.updateMany({
    where: {
      id: { in: ids },
      transferGroupId: null,
      ...(category.kind === "Income"
        ? { amountCents: { gt: 0 } }
        : { amountCents: { lt: 0 } }),
    },
    data: { categoryId },
  });

  await logAudit(session, "UPDATE", "Transaction", undefined, {
    action: "bulkCategorize",
    categoryName: category.name,
    count,
  });

  revalidateAll();
  if (count < ids.length) {
    return {
      success: true,
      updated: count,
      error: `${ids.length - count} Buchung(en) übersprungen: Vorzeichen passt nicht zur Kategorie "${category.name}".`,
    };
  }
  return { success: true, updated: count };
}
