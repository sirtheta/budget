"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AccountType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { parseMoney } from "@/lib/money";
import { recordBtcPurchase } from "@/lib/transactions";
import { isValidDateString } from "@/lib/date";
import logger from "@/lib/logger";

const log = logger.child({ module: "accounts" });

export type ActionState = { error?: string; success?: boolean };

const accountSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(80),
  type: z.enum(AccountType),
  iban: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .refine((value) => value === "" || /^CH\d{2}[A-Z0-9]{12,30}$/.test(value), {
      message: "IBAN sieht nicht wie eine gültige Schweizer IBAN aus.",
    })
    .transform((value) => value || null),
  openingBalance: z.string(),
  btcAmount: z.string(),
  btcCostBasis: z.string(),
  color: z.string().trim().max(20).optional(),
  excludeFromBudget: z.boolean(),
  notes: z.string().trim().max(500).optional(),
});

function readForm(formData: FormData) {
  return accountSchema.safeParse({
    name: formData.get("name") ?? "",
    type: formData.get("type") ?? "Checking",
    iban: formData.get("iban") ?? "",
    openingBalance: String(formData.get("openingBalance") ?? "0"),
    btcAmount: String(formData.get("btcAmount") ?? "0"),
    btcCostBasis: String(formData.get("btcCostBasis") ?? ""),
    color: formData.get("color") ?? undefined,
    excludeFromBudget: formData.get("excludeFromBudget") === "on",
    notes: formData.get("notes") ?? undefined,
  });
}

export async function saveAccountAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = readForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const isCrypto = parsed.data.type === "Crypto";

  let openingBalanceCents = 0;
  let btcAmount: number | null = null;
  let btcCostBasisCents: number | null = null;
  let iban: string | null = parsed.data.iban;

  if (isCrypto) {
    const raw = parsed.data.btcAmount.trim().replace(",", ".");
    btcAmount = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(btcAmount) || btcAmount < 0) {
      return { error: "BTC-Bestand ist keine gültige Zahl." };
    }
    const costRaw = parsed.data.btcCostBasis.trim();
    if (costRaw !== "") {
      const cents = parseMoney(costRaw);
      if (cents === null || cents < 0) return { error: "Einstandswert ist keine gültige Zahl." };
      btcCostBasisCents = cents;
    }
    iban = null; // crypto wallets don't have one, and IBAN is unique
  } else {
    const cents = parseMoney(parsed.data.openingBalance || "0");
    if (cents === null) return { error: "Startsaldo ist keine gültige Zahl." };
    openingBalanceCents = cents;
  }

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  const data = {
    name: parsed.data.name,
    type: parsed.data.type,
    iban,
    openingBalanceCents,
    btcAmount,
    btcCostBasisCents,
    color: parsed.data.color || null,
    excludeFromBudget: parsed.data.excludeFromBudget,
    notes: parsed.data.notes || null,
  };

  try {
    if (id) {
      await prisma.account.update({ where: { id }, data });
      await logAudit(session, "UPDATE", "Account", id, { name: data.name });
    } else {
      const created = await prisma.account.create({
        data: { ...data, sortOrder: await nextSortOrder() },
      });
      await logAudit(session, "CREATE", "Account", created.id, { name: data.name });
    }
  } catch (err) {
    // The IBAN is unique so a statement can be matched to exactly one account;
    // report the collision rather than the raw Prisma error.
    if (isUniqueViolation(err)) {
      return { error: "Diese IBAN ist bereits einem anderen Konto zugeordnet." };
    }
    throw err;
  }

  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { success: true };
}

async function nextSortOrder(): Promise<number> {
  const last = await prisma.account.findFirst({ orderBy: { sortOrder: "desc" } });
  return (last?.sortOrder ?? -1) + 1;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

const btcPurchaseSchema = z.object({
  date: z.string().refine(isValidDateString, "Ungültiges Datum."),
  description: z.string().trim().min(1, "Beschreibung darf nicht leer sein.").max(200),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Books a Bitcoin purchase: CHF leaves a normal account (categorisable, a
 * real outflow in budget/analytics), BTC lands in the wallet. See
 * lib/transactions.ts for why this isn't modelled as a transfer.
 */
export async function recordBtcPurchaseAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = btcPurchaseSchema.safeParse({
    date: formData.get("date") ?? "",
    description: formData.get("description") ?? "",
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const sourceAccountId = parseInt(String(formData.get("sourceAccountId") ?? ""), 10);
  const cryptoAccountId = parseInt(String(formData.get("cryptoAccountId") ?? ""), 10);
  if (!Number.isInteger(sourceAccountId) || !Number.isInteger(cryptoAccountId)) {
    return { error: "Bitte Quellkonto und Wallet auswählen." };
  }

  const chfAmountCents = parseMoney(String(formData.get("chfAmount") ?? ""));
  if (chfAmountCents === null || chfAmountCents <= 0) {
    return { error: "CHF-Betrag ist keine gültige Zahl." };
  }

  const btcRaw = String(formData.get("btcAmount") ?? "").trim().replace(",", ".");
  const btcAmount = Number(btcRaw);
  if (!Number.isFinite(btcAmount) || btcAmount <= 0) {
    return { error: "BTC-Menge ist keine gültige Zahl." };
  }

  const categoryRaw = formData.get("categoryId");
  const categoryId =
    categoryRaw && categoryRaw !== "" ? parseInt(String(categoryRaw), 10) : null;

  try {
    const transaction = await recordBtcPurchase(prisma, {
      sourceAccountId,
      cryptoAccountId,
      date: parsed.data.date,
      chfAmountCents,
      btcAmount,
      categoryId,
      description: parsed.data.description,
      notes: parsed.data.notes ?? null,
      createdById: parseInt(session.user.id, 10),
    });
    await logAudit(session, "CREATE", "Transaction", transaction.id, {
      btcPurchase: true,
      chfAmountCents,
      btcAmount,
      cryptoAccountId,
    });
  } catch (err) {
    log.error({ err, sourceAccountId, cryptoAccountId }, "BTC purchase failed");
    return { error: err instanceof Error ? err.message : "Kauf konnte nicht erfasst werden." };
  }

  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/analytics");
  return { success: true };
}

/**
 * Persists a drag-and-drop reorder: the client sends the full new id order,
 * we write sortOrder = index for each. Rewriting the whole list (rather than
 * touching only the moved row) also heals ties left over from before
 * reordering existed (every account defaulted to sortOrder 0).
 */
export async function reorderAccountsAction(orderedIds: number[]): Promise<ActionState> {
  const session = await requireEditor();

  const count = await prisma.account.count({ where: { id: { in: orderedIds } } });
  if (count !== orderedIds.length) return { error: "Konto nicht gefunden." };

  await prisma.$transaction(
    orderedIds.map((id, i) => prisma.account.update({ where: { id }, data: { sortOrder: i } }))
  );
  await logAudit(session, "UPDATE", "Account", undefined, { reordered: orderedIds });

  revalidatePath("/accounts");
  return { success: true };
}

export async function toggleAccountActiveAction(id: number, isActive: boolean): Promise<ActionState> {
  const session = await requireEditor();
  const account = await prisma.account.update({ where: { id }, data: { isActive } });
  await logAudit(session, "UPDATE", "Account", id, { name: account.name, isActive });
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Deletes an account. Refused while it still holds transactions — deleting
 * would cascade them away and silently rewrite months of history. Deactivating
 * is offered instead, which hides the account without losing anything.
 */
export async function deleteAccountAction(id: number): Promise<ActionState> {
  const session = await requireEditor();

  const count = await prisma.transaction.count({ where: { accountId: id } });
  if (count > 0) {
    return {
      error: `Konto hat ${count} Buchung(en) und kann nicht gelöscht werden. Bitte stattdessen deaktivieren.`,
    };
  }

  const account = await prisma.account.delete({ where: { id } });
  await logAudit(session, "DELETE", "Account", id, { name: account.name });
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  return { success: true };
}
