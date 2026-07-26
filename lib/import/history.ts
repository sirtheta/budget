import type { Db } from "@/lib/transactions";
import { normalize } from "@/lib/import/dedupe";

/**
 * Category suggestions for import rows whose counterparty has no matching
 * `ImportRule` but has been categorised by hand before.
 *
 * This is what makes categorising the *first* rule-less merchant cheaper: the
 * user still has to categorise it once, but every later import of the same
 * counterparty is pre-filled from that one decision instead of requiring a
 * dedicated rule.
 */

/** Fraction of a counterparty's categorised history a category must reach to
 *  be suggested. Below this, "Migros" categorised half groceries/half
 *  household is genuinely ambiguous — a wrong guess is worse than none. */
const DOMINANCE_THRESHOLD = 0.6;

/**
 * The category to suggest from a counterparty's categorisation counts, or
 * null when no single category clearly dominates.
 */
export function pickDominantCategory(counts: Map<number, number>): number | null {
  let total = 0;
  let bestCategoryId: number | null = null;
  let bestCount = 0;
  for (const [categoryId, count] of counts) {
    total += count;
    if (count > bestCount) {
      bestCount = count;
      bestCategoryId = categoryId;
    }
  }
  if (total === 0 || bestCategoryId === null) return null;
  return bestCount / total >= DOMINANCE_THRESHOLD ? bestCategoryId : null;
}

/**
 * Suggested `categoryId` per normalised counterparty, derived from every
 * previously categorised transaction. Loaded as a flat scan rather than a
 * grouped query keyed on the batch's counterparties: a household's ledger is
 * small enough that this costs nothing, and it sidesteps SQLite's
 * case-sensitive `IN` matching against the normalised (lower-cased) keys used
 * for lookup.
 */
export async function loadHistoryCategorySuggestions(db: Db): Promise<Map<string, number>> {
  const rows = await db.transaction.findMany({
    where: { counterparty: { not: null }, categoryId: { not: null } },
    select: { counterparty: true, categoryId: true },
  });

  const countsByCounterparty = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const key = normalize(row.counterparty);
    if (!key) continue;
    const counts = countsByCounterparty.get(key) ?? new Map<number, number>();
    // categoryId is non-null by the query filter above.
    const categoryId = row.categoryId as number;
    counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    countsByCounterparty.set(key, counts);
  }

  const suggestions = new Map<string, number>();
  for (const [key, counts] of countsByCounterparty) {
    const categoryId = pickDominantCategory(counts);
    if (categoryId !== null) suggestions.set(key, categoryId);
  }
  return suggestions;
}
