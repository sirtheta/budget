import type { Prisma } from "@prisma/client";

/**
 * Free-text search over transactions.
 *
 * SQLite's built-in LIKE folds case for ASCII only. "migros" finds "MIGROS",
 * but "bäckerei" does not find "Bäckerei" — and German is exactly where that
 * matters. `lower()` is no help: it is ASCII-only for the same reason, so
 * moving the fold into SQL changes nothing.
 *
 * The fix that needs no schema change is to search for the case variants of
 * the term instead. ASCII is already handled by LIKE, so only the non-ASCII
 * letters need covering, and a stored value has them either lowercased
 * ("Bäckerei") or uppercased ("BÄCKEREI"). Searching the term as typed plus
 * its lower and upper forms catches both.
 *
 * The gap this leaves is a stored value with mixed case *inside* a non-ASCII
 * word — "BäCKEREI" searched as "bäckerei". Closing that properly means a
 * normalised, indexed search column and a backfill, which is a real cost for
 * a household-sized dataset and a case that does not occur in bank exports.
 */

/** The term as typed, lowercased and uppercased, without duplicates. */
export function searchVariants(term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) return [];
  return [...new Set([trimmed, trimmed.toLowerCase(), trimmed.toUpperCase()])];
}

/**
 * `OR` conditions matching `term` in a transaction's description,
 * counterparty or notes. Returns undefined for an empty term so callers can
 * leave the filter off entirely rather than search for "".
 */
export function transactionSearchFilter(
  term: string | null | undefined
): Prisma.TransactionWhereInput["OR"] | undefined {
  const variants = searchVariants(term ?? "");
  if (variants.length === 0) return undefined;

  return variants.flatMap((variant) => [
    { description: { contains: variant } },
    { counterparty: { contains: variant } },
    { notes: { contains: variant } },
  ]);
}
