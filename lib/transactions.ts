import { randomUUID } from "crypto";
import type { PrismaClient, Transaction, TransactionSource } from "@prisma/client";

/**
 * Transfers between the household's own accounts.
 *
 * A transfer is stored as two rows sharing a `transferGroupId`: a negative one
 * on the source account and a positive one on the target. Both carry no
 * category, which is what keeps them out of every income/expense evaluation
 * (see lib/budget.ts and lib/analytics.ts) while each account's balance stays
 * a plain sum of its own rows.
 *
 * The alternative — one row with a counter-account column — would make every
 * balance query a two-sided special case. This shape keeps the common path
 * simple at the cost of one extra row.
 */

export interface TransferInput {
  fromAccountId: number;
  toAccountId: number;
  date: string;
  /** Positive magnitude in Rappen; the sign per leg is derived. */
  amountCents: number;
  description: string;
  notes?: string | null;
  createdById?: number | null;
  source?: TransactionSource;
}

export async function createTransfer(
  prisma: PrismaClient,
  input: TransferInput
): Promise<[Transaction, Transaction]> {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error("Quell- und Zielkonto müssen unterschiedlich sein.");
  }
  const amount = Math.abs(input.amountCents);
  if (amount === 0) throw new Error("Der Betrag einer Umbuchung darf nicht 0 sein.");

  const transferGroupId = randomUUID();
  const shared = {
    date: input.date,
    description: input.description,
    notes: input.notes ?? null,
    transferGroupId,
    categoryId: null,
    source: input.source ?? "Manual",
    createdById: input.createdById ?? null,
  };

  return prisma.$transaction([
    prisma.transaction.create({
      data: { ...shared, accountId: input.fromAccountId, amountCents: -amount },
    }),
    prisma.transaction.create({
      data: { ...shared, accountId: input.toAccountId, amountCents: amount },
    }),
  ]);
}

/**
 * Updates both legs of a transfer at once. Editing only the row the user
 * happened to click would leave the two sides inconsistent.
 */
export async function updateTransfer(
  prisma: PrismaClient,
  transferGroupId: string,
  input: Omit<TransferInput, "createdById" | "source">
): Promise<void> {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error("Quell- und Zielkonto müssen unterschiedlich sein.");
  }
  const amount = Math.abs(input.amountCents);
  const legs = await prisma.transaction.findMany({
    where: { transferGroupId },
    orderBy: { amountCents: "asc" },
  });
  if (legs.length !== 2) throw new Error("Umbuchung nicht gefunden.");

  const [outgoing, incoming] = legs;
  await prisma.$transaction([
    prisma.transaction.update({
      where: { id: outgoing.id },
      data: {
        accountId: input.fromAccountId,
        amountCents: -amount,
        date: input.date,
        description: input.description,
        notes: input.notes ?? null,
      },
    }),
    prisma.transaction.update({
      where: { id: incoming.id },
      data: {
        accountId: input.toAccountId,
        amountCents: amount,
        date: input.date,
        description: input.description,
        notes: input.notes ?? null,
      },
    }),
  ]);
}

/** Deletes both legs of a transfer. Returns the number of rows removed. */
export async function deleteTransfer(
  prisma: PrismaClient,
  transferGroupId: string
): Promise<number> {
  const { count } = await prisma.transaction.deleteMany({ where: { transferGroupId } });
  return count;
}

export function isTransfer(transaction: Pick<Transaction, "transferGroupId">): boolean {
  return transaction.transferGroupId !== null;
}

/**
 * Records a Bitcoin purchase: money leaving a normal account and BTC landing
 * in a wallet.
 *
 * This is deliberately not a transfer. A transfer moves the same value
 * between two Rappen balances; a BTC purchase moves CHF for an amount of a
 * different asset, chosen by the user because only the exchange knows the
 * exact price and fee actually paid — the app's own rate lookup is an
 * approximation (see lib/crypto-price.ts). The CHF leg is a normal booking
 * (categorisable, shows up in budget/analytics as a real outflow) and the
 * wallet's `btcAmount` is incremented directly rather than derived, since a
 * crypto account carries no transaction ledger of its own.
 */
export interface BtcPurchaseInput {
  sourceAccountId: number;
  cryptoAccountId: number;
  date: string;
  /** Total CHF that left the source account, including any fee, in Rappen. */
  chfAmountCents: number;
  /** BTC actually received, as reported by the exchange. */
  btcAmount: number;
  categoryId?: number | null;
  description: string;
  notes?: string | null;
  createdById?: number | null;
}

export async function recordBtcPurchase(
  prisma: PrismaClient,
  input: BtcPurchaseInput
): Promise<Transaction> {
  if (input.chfAmountCents <= 0) throw new Error("Der CHF-Betrag muss positiv sein.");
  if (input.btcAmount <= 0) throw new Error("Die BTC-Menge muss positiv sein.");

  const [source, cryptoAccount] = await Promise.all([
    prisma.account.findUnique({ where: { id: input.sourceAccountId } }),
    prisma.account.findUnique({ where: { id: input.cryptoAccountId } }),
  ]);
  if (!source || source.type === "Crypto") {
    throw new Error("Quellkonto ist kein gültiges CHF-Konto.");
  }
  if (!cryptoAccount || cryptoAccount.type !== "Crypto") {
    throw new Error("Zielkonto ist kein Bitcoin-Wallet.");
  }

  const [transaction] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        date: input.date,
        amountCents: -input.chfAmountCents,
        accountId: input.sourceAccountId,
        categoryId: input.categoryId ?? null,
        description: input.description,
        notes: input.notes ?? null,
        source: "Manual",
        createdById: input.createdById ?? null,
      },
    }),
    prisma.account.update({
      where: { id: input.cryptoAccountId },
      data: { btcAmount: (cryptoAccount.btcAmount ?? 0) + input.btcAmount },
    }),
  ]);

  return transaction;
}
