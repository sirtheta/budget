"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { CategoryKind } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireEditor, requireSession } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { parseMoney } from "@/lib/money";
import { isValidDateString } from "@/lib/date";
import {
  applyAutoTransfer,
  createTransfer,
  deleteTransfer,
  mergeSplit,
  splitTransaction,
  updateTransfer,
  type SplitPartInput,
} from "@/lib/transactions";
import { matchRule } from "@/lib/import/rules";
import logger from "@/lib/logger";

const log = logger.child({ module: "transactions" });

export type ActionState = { error?: string; success?: boolean; autoApplied?: number };

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

  let categoryKind: CategoryKind | null = null;
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
    categoryKind = category.kind;
  }
  const createRule = formData.get("createRule") === "on";

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

  let transactionId: number;
  if (id) {
    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) return { error: "Buchung nicht gefunden." };
    if (existing.transferGroupId) {
      return { error: "Umbuchungen müssen über das Umbuchungs-Formular bearbeitet werden." };
    }
    if (existing.splitGroupId) {
      return { error: "Aufgeteilte Buchungen müssen über das Aufteilen-Formular bearbeitet werden." };
    }
    await prisma.transaction.update({ where: { id }, data });
    await logAudit(session, "UPDATE", "Transaction", id, data);
    transactionId = id;
  } else {
    const created = await prisma.transaction.create({
      data: { ...data, source: "Manual", createdById: parseInt(session.user.id, 10) },
    });
    await logAudit(session, "CREATE", "Transaction", created.id, data);
    transactionId = created.id;
  }

  // Turns categorising one booking into a rule for the rest: a checked box
  // creates a Counterparty rule and immediately sweeps every other
  // uncategorised booking it now matches — the fast path out of a backlog
  // left by a large historical import.
  let autoApplied: number | undefined;
  if (createRule && categoryId !== null && data.counterparty) {
    const pattern = data.counterparty;
    const dupe = await prisma.importRule.findFirst({
      where: { field: "Counterparty", matchType: "Contains", pattern },
    });
    if (!dupe) {
      const rule = await prisma.importRule.create({
        data: {
          name: `Auto: ${pattern}`.slice(0, 80),
          field: "Counterparty",
          matchType: "Contains",
          pattern,
          categoryId,
          priority: 0,
        },
      });
      await logAudit(session, "CREATE", "ImportRule", rule.id, { name: rule.name, auto: true });

      const pending = await prisma.transaction.findMany({
        where: { categoryId: null, transferGroupId: null, id: { not: transactionId } },
        select: { id: true, description: true, counterparty: true, amountCents: true, date: true },
      });
      autoApplied = 0;
      for (const t of pending) {
        const matched = matchRule([rule], {
          date: t.date,
          amountCents: t.amountCents,
          description: t.description,
          counterparty: t.counterparty,
          bankReference: null,
        });
        if (matched === null) continue;
        if (categoryKind === "Income" && t.amountCents < 0) continue;
        if (categoryKind === "Expense" && t.amountCents > 0) continue;
        await prisma.transaction.update({
          where: { id: t.id },
          data: { categoryId: matched.categoryId },
        });
        autoApplied++;
      }
    }
  }

  revalidateAll();
  return { success: true, autoApplied };
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
    log.error({ err, groupId: groupId ? String(groupId) : undefined }, "Transfer failed");
    return { error: err instanceof Error ? err.message : "Umbuchung fehlgeschlagen." };
  }

  revalidateAll();
  return { success: true };
}

const convertToTransferSchema = z.object({
  id: z.coerce.number().int(),
  targetAccountId: z.coerce.number().int(),
});

/**
 * Turns an already-booked, non-transfer transaction into one leg of a
 * transfer — the manual counterpart to a transfer-rule match, for the
 * one-off case that isn't worth a rule of its own. Delegates to the same
 * applyAutoTransfer() used by import: it either links a matching booking
 * already sitting on the target account, or creates the counterpart leg.
 */
export async function convertToTransferAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = convertToTransferSchema.safeParse({
    id: formData.get("id"),
    targetAccountId: formData.get("targetAccountId"),
  });
  if (!parsed.success) return { error: "Bitte ein Gegenkonto wählen." };

  const existing = await prisma.transaction.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { error: "Buchung nicht gefunden." };
  if (existing.transferGroupId) return { error: "Buchung ist bereits eine Umbuchung." };
  if (existing.splitGroupId) {
    return { error: "Aufgeteilte Buchungen können nicht in eine Umbuchung umgewandelt werden." };
  }

  try {
    await applyAutoTransfer(prisma, {
      transactionId: parsed.data.id,
      targetAccountId: parsed.data.targetAccountId,
    });
  } catch (err) {
    log.error({ err, transactionId: parsed.data.id }, "Convert to transfer failed");
    return { error: err instanceof Error ? err.message : "Umwandlung fehlgeschlagen." };
  }

  await logAudit(session, "UPDATE", "Transaction", parsed.data.id, {
    action: "convertToTransfer",
    targetAccountId: parsed.data.targetAccountId,
  });

  // Same "turn one fix into a rule" pattern as saveTransactionAction: a
  // checked box creates a transfer-rule from the counterparty and sweeps
  // every other pending booking it now matches, so the next import of the
  // same counterparty never needs this manual step again.
  let autoApplied: number | undefined;
  const createRule = formData.get("createRule") === "on";
  if (createRule && existing.counterparty) {
    const pattern = existing.counterparty;
    const dupe = await prisma.importRule.findFirst({
      where: { field: "Counterparty", matchType: "Contains", pattern },
    });
    if (!dupe) {
      const rule = await prisma.importRule.create({
        data: {
          name: `Auto: ${pattern}`.slice(0, 80),
          field: "Counterparty",
          matchType: "Contains",
          pattern,
          transferAccountId: parsed.data.targetAccountId,
          priority: 0,
        },
      });
      await logAudit(session, "CREATE", "ImportRule", rule.id, { name: rule.name, auto: true });

      const pending = await prisma.transaction.findMany({
        where: { categoryId: null, transferGroupId: null, id: { not: parsed.data.id } },
        select: {
          id: true,
          accountId: true,
          description: true,
          counterparty: true,
          amountCents: true,
          date: true,
        },
      });
      autoApplied = 0;
      for (const t of pending) {
        const matched = matchRule([rule], {
          date: t.date,
          amountCents: t.amountCents,
          description: t.description,
          counterparty: t.counterparty,
          bankReference: null,
        });
        if (!matched || matched.transferAccountId === null) continue;
        if (matched.transferAccountId === t.accountId) continue;
        await applyAutoTransfer(prisma, {
          transactionId: t.id,
          targetAccountId: matched.transferAccountId,
        });
        autoApplied++;
      }
    }
  }

  revalidateAll();
  return { success: true, autoApplied };
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
  } else if (existing.splitGroupId) {
    // Same reasoning as a transfer: deleting a single part would leave the
    // remaining parts summing to less than what was actually booked.
    const { count } = await prisma.transaction.deleteMany({
      where: { splitGroupId: existing.splitGroupId },
    });
    await logAudit(session, "DELETE", "Transaction", id, {
      split: true,
      count,
      date: existing.date,
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

const splitPartSchema = z.object({
  categoryId: z.coerce.number().int(),
  amountCents: z.coerce.number().int().positive(),
});

/**
 * Splits (or re-splits) a booking across several categories — e.g. a 13th
 * salary that arrives as one CAMT.053 booking but needs to be spread over
 * two budget categories.
 */
export async function saveSplitAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isInteger(id)) return { error: "Buchung nicht gefunden." };

  let rawParts: unknown;
  try {
    rawParts = JSON.parse(String(formData.get("parts") ?? "[]"));
  } catch {
    return { error: "Ungültige Aufteilung." };
  }
  const parsed = z.array(splitPartSchema).min(2).safeParse(rawParts);
  if (!parsed.success) {
    return { error: "Bitte mindestens 2 Kategorien mit gültigem Betrag angeben." };
  }

  let parts: SplitPartInput[];
  try {
    parts = parsed.data;
    await splitTransaction(prisma, id, parts);
  } catch (err) {
    log.error({ err, id }, "Split failed");
    return { error: err instanceof Error ? err.message : "Aufteilen fehlgeschlagen." };
  }

  await logAudit(session, "UPDATE", "Transaction", id, { action: "split", parts });

  revalidateAll();
  return { success: true };
}

/** Collapses a split booking back into a single, uncategorised booking. */
export async function unsplitTransactionAction(splitGroupId: string): Promise<ActionState> {
  const session = await requireEditor();

  try {
    const merged = await mergeSplit(prisma, splitGroupId);
    await logAudit(session, "UPDATE", "Transaction", merged.id, { action: "unsplit" });
  } catch (err) {
    log.error({ err, splitGroupId }, "Unsplit failed");
    return { error: err instanceof Error ? err.message : "Aufteilung aufheben fehlgeschlagen." };
  }

  revalidateAll();
  return { success: true };
}

/** Loads both legs of a transfer, for prefilling the edit form. */
export async function getTransferLegsAction(
  transferGroupId: string
): Promise<{ accountId: number; amountCents: number }[]> {
  await requireSession();
  return prisma.transaction.findMany({
    where: { transferGroupId },
    orderBy: { amountCents: "asc" },
    select: { accountId: true, amountCents: true },
  });
}

/** Loads the parts of a split booking, for prefilling the edit form. */
export async function getSplitPartsAction(
  splitGroupId: string
): Promise<{ id: number; categoryId: number | null; amountCents: number }[]> {
  await requireSession();
  return prisma.transaction.findMany({
    where: { splitGroupId },
    orderBy: { id: "asc" },
    select: { id: true, categoryId: true, amountCents: true },
  });
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
