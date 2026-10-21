import type { PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/transactions";

export type HoldingEntryKind = "Initial" | "Stake" | "Purchase" | "PurchaseReversal" | "Edit";

export interface HoldingEntryInput {
  accountId: number;
  kind: HoldingEntryKind;
  btcDelta: number;
  costDeltaCents: number;
  createdById?: number | null;
}

/**
 * Appends a history row that snapshots the account's holding *as it stands when
 * the statement runs*. It is a lazy statement, so it has to be queued after the
 * UPDATE it describes — in a `$transaction([...])` array or inside an
 * interactive transaction. Taking the snapshot in SQL rather than reading the
 * account first keeps it correct when two submits race, the same reason the
 * balance itself is changed with a raw increment.
 *
 * The timestamp is epoch milliseconds because that is what Prisma itself writes
 * for a SQLite DateTime; the column's CURRENT_TIMESTAMP default is text and
 * would not read back as the same kind of value.
 */
export function holdingEntryStatement(db: Db, input: HoldingEntryInput) {
  return db.$executeRaw`INSERT INTO "BtcHoldingEntry" ("accountId", "kind", "btcDelta", "costDeltaCents", "btcAfter", "costBasisAfterCents", "createdById", "createdAt") SELECT "id", ${input.kind}, ${input.btcDelta}, ${input.costDeltaCents}, COALESCE("btcAmount", 0), "btcCostBasisCents", ${input.createdById ?? null}, CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER) FROM "Account" WHERE "id" = ${input.accountId}`;
}

export interface HoldingHistoryRow {
  id: number;
  accountId: number;
  accountName: string;
  kind: HoldingEntryKind;
  btcDelta: number;
  costDeltaCents: number;
  btcAfter: number;
  costBasisAfterCents: number | null;
  userName: string | null;
  /** ISO string — a Date would not survive the Server→Client boundary as one. */
  createdAt: string;
}

/** Newest first, across all given accounts (a wallet's stakes share one list). */
export async function loadHoldingHistory(
  client: PrismaClient,
  accountIds: number[],
  limit = 200
): Promise<HoldingHistoryRow[]> {
  if (accountIds.length === 0) return [];
  const rows = await client.btcHoldingEntry.findMany({
    where: { accountId: { in: accountIds } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    include: { account: { select: { name: true } }, createdBy: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    accountName: row.account.name,
    kind: row.kind as HoldingEntryKind,
    btcDelta: row.btcDelta,
    costDeltaCents: row.costDeltaCents,
    btcAfter: row.btcAfter,
    costBasisAfterCents: row.costBasisAfterCents,
    userName: row.createdBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}
