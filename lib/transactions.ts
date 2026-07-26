import { randomUUID } from "crypto";
import { Prisma, type PrismaClient, type Transaction, type TransactionSource } from "@prisma/client";
import { addDays } from "@/lib/date";

/**
 * Accepted by the transfer-leg helpers below so they can run either
 * standalone (the top-level `PrismaClient`) or nested inside a caller's own
 * interactive transaction (a `Prisma.TransactionClient`) — see `atomic()`.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Runs `fn` atomically. When `db` is the top-level client, wraps it in its
 * own transaction; when `db` is already an interactive transaction, just
 * runs `fn` directly against it — SQLite has no nested transactions, and the
 * outer transaction already covers atomicity in that case.
 */
function atomic<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return "$transaction" in db ? db.$transaction(fn) : fn(db);
}

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

/**
 * How many days apart the two legs of an auto-detected transfer (see
 * `applyAutoTransfer` / `findAdoptableTransferLeg`) may post on their
 * respective accounts and still count as the same movement. Interbank
 * transfers (e.g. into Revolut or a credit card settlement) routinely clear a
 * day or two apart on each side's statement.
 */
export const TRANSFER_MATCH_TOLERANCE_DAYS = 5;

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
    // Atomic, NULL-safe increment. `{ btcAmount: { increment } }` compiles to
    // `SET btcAmount = btcAmount + ?`, which stays NULL for a wallet that has
    // never held BTC before (Float? has no column default); COALESCE is what
    // makes the first purchase land instead of vanishing. Doing this as a
    // read (`cryptoAccount.btcAmount ?? 0`) then a plain `update` — the
    // previous approach — read the balance before this transaction started,
    // so two concurrent purchases (double-click, two tabs) could both start
    // from the same value and the second write would silently discard the
    // first's BTC.
    prisma.$executeRaw`UPDATE "Account" SET "btcAmount" = COALESCE("btcAmount", 0) + ${input.btcAmount} WHERE "id" = ${input.cryptoAccountId}`,
  ]);

  return transaction;
}

/**
 * An existing, not-yet-real transfer leg that a freshly imported row could
 * belong to: created by an earlier `applyAutoTransfer` call as the synthetic
 * counterpart on the *other* account, it carries no `importHash` because no
 * statement has confirmed it yet. Matched on account, opposite-sign amount
 * and a date within `TRANSFER_MATCH_TOLERANCE_DAYS`.
 */
export function findAdoptableTransferLeg(
  db: Db,
  accountId: number,
  amountCents: number,
  date: string
): Promise<Transaction | null> {
  return db.transaction.findFirst({
    where: {
      accountId,
      importHash: null,
      transferGroupId: { not: null },
      amountCents,
      date: {
        gte: addDays(date, -TRANSFER_MATCH_TOLERANCE_DAYS),
        lte: addDays(date, TRANSFER_MATCH_TOLERANCE_DAYS),
      },
    },
    orderBy: { date: "asc" },
  });
}

/**
 * Adopts an already-imported row into an existing synthetic transfer leg,
 * attaching the real bank data instead of creating a duplicate row. Used when
 * the *other* side of a transfer (e.g. the Revolut or credit-card account)
 * is later imported for real.
 */
export async function adoptTransferLeg(
  db: Db,
  legId: number,
  realData: {
    date: string;
    description: string;
    counterparty: string | null;
    bankReference: string | null;
    importHash: string;
    importBatchId: number;
  }
): Promise<void> {
  await db.transaction.update({
    where: { id: legId },
    data: { ...realData, source: "Import" },
  });
}

export interface AutoTransferInput {
  /** Id of the transaction row already created for the triggering side. */
  transactionId: number;
  targetAccountId: number;
}

/**
 * Turns a plain transaction into one leg of a transfer to `targetAccountId`.
 *
 * If a matching plain transaction already sits on the target account (it was
 * imported earlier and never categorised into this transfer), both rows are
 * linked as-is. Otherwise a synthetic counterpart leg is created immediately
 * — same shape as manually booking "Neue Buchung → Umbuchung" — so the
 * transfer is complete and both balances are correct right away. It carries
 * no `importHash`, so a later real import of the target account's own
 * statement can adopt it instead of creating a duplicate (see
 * `findAdoptableTransferLeg`).
 */
export async function applyAutoTransfer(db: Db, input: AutoTransferInput): Promise<void> {
  const source = await db.transaction.findUnique({ where: { id: input.transactionId } });
  if (!source) throw new Error("Buchung nicht gefunden.");
  if (source.transferGroupId) return;
  if (source.accountId === input.targetAccountId) {
    throw new Error("Quell- und Zielkonto müssen unterschiedlich sein.");
  }

  const counterpartAmount = -source.amountCents;
  const groupId = randomUUID();

  const candidate = await db.transaction.findFirst({
    where: {
      accountId: input.targetAccountId,
      transferGroupId: null,
      amountCents: counterpartAmount,
      date: {
        gte: addDays(source.date, -TRANSFER_MATCH_TOLERANCE_DAYS),
        lte: addDays(source.date, TRANSFER_MATCH_TOLERANCE_DAYS),
      },
    },
    orderBy: { date: "asc" },
  });

  await atomic(db, async (tx) => {
    await tx.transaction.update({
      where: { id: source.id },
      data: { transferGroupId: groupId, categoryId: null },
    });
    if (candidate) {
      await tx.transaction.update({
        where: { id: candidate.id },
        data: { transferGroupId: groupId, categoryId: null },
      });
    } else {
      await tx.transaction.create({
        data: {
          date: source.date,
          amountCents: counterpartAmount,
          accountId: input.targetAccountId,
          description: source.description,
          transferGroupId: groupId,
          categoryId: null,
          source: "Manual",
        },
      });
    }
  });
}
