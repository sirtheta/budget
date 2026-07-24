import { createHash } from "crypto";
import type { ParsedTransaction } from "@/lib/import/types";

/**
 * Duplicate detection for statement imports.
 *
 * Statements overlap in practice — the user re-downloads a month, or the
 * period boundaries of two exports touch — so importing the same movement
 * twice has to be impossible. Each candidate gets a fingerprint that is stored
 * in `Transaction.importHash` under a unique index, which makes the database
 * itself the last line of defence even if two imports run concurrently.
 *
 * The fingerprint deliberately includes an occurrence counter: two genuinely
 * separate but identical bookings on the same day (two CHF 4.50 coffees) must
 * both import, while re-importing the same file must skip both. The counter is
 * assigned per file in reading order, so it is stable across re-imports of the
 * same export.
 */

/** Normalises free text so trivial formatting differences don't defeat matching. */
function normalize(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fingerprint of one parsed transaction for a given account.
 *
 * When the bank supplies a reference it dominates the hash: references are
 * unique per bank and survive changes in how the description is rendered.
 */
export function importHash(
  accountId: number,
  transaction: ParsedTransaction,
  occurrence: number
): string {
  const parts = transaction.bankReference
    ? [accountId, transaction.bankReference.trim()]
    : [
        accountId,
        transaction.date,
        transaction.amountCents,
        normalize(transaction.description),
        normalize(transaction.counterparty),
        occurrence,
      ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export interface HashedTransaction extends ParsedTransaction {
  hash: string;
}

/**
 * Attaches a fingerprint to every parsed transaction, numbering identical
 * ones in reading order.
 */
export function withHashes(
  accountId: number,
  transactions: ParsedTransaction[]
): HashedTransaction[] {
  const seen = new Map<string, number>();
  return transactions.map((transaction) => {
    const key = [
      transaction.date,
      transaction.amountCents,
      normalize(transaction.description),
      normalize(transaction.counterparty),
    ].join("|");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { ...transaction, hash: importHash(accountId, transaction, occurrence) };
  });
}

export interface DedupeResult {
  fresh: HashedTransaction[];
  duplicates: HashedTransaction[];
}

/**
 * Splits candidates into those not yet in the database and those already
 * imported, given the set of hashes that exist for the account.
 */
export function splitDuplicates(
  candidates: HashedTransaction[],
  existingHashes: Set<string>
): DedupeResult {
  const fresh: HashedTransaction[] = [];
  const duplicates: HashedTransaction[] = [];
  for (const candidate of candidates) {
    if (existingHashes.has(candidate.hash)) duplicates.push(candidate);
    else fresh.push(candidate);
  }
  return { fresh, duplicates };
}
