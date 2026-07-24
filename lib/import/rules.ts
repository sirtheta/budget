import type { ImportRule } from "@prisma/client";
import logger from "@/lib/logger";
import type { ParsedTransaction } from "@/lib/import/types";

const log = logger.child({ module: "import-rules" });

/**
 * Auto-categorisation of imported transactions.
 *
 * This is what turns importing from "type everything anyway" into something
 * useful: after a handful of rules ("Beschreibung enthält MIGROS →
 * Lebensmittel"), a monthly statement lands almost fully categorised and only
 * the unusual bookings need attention.
 */

/** Field of a transaction a rule matches against. */
function fieldValue(transaction: ParsedTransaction, field: ImportRule["field"]): string {
  const value = field === "Counterparty" ? transaction.counterparty : transaction.description;
  return (value ?? "").toLowerCase();
}

/**
 * Whether a rule matches. User-supplied regexes are compiled defensively: an
 * invalid pattern must not take down the whole import, it just never matches.
 */
export function ruleMatches(rule: ImportRule, transaction: ParsedTransaction): boolean {
  const value = fieldValue(transaction, rule.field);
  if (!value) return false;
  const pattern = rule.pattern.toLowerCase();

  switch (rule.matchType) {
    case "Contains":
      return value.includes(pattern);
    case "StartsWith":
      return value.startsWith(pattern);
    case "EndsWith":
      return value.endsWith(pattern);
    case "Regex":
      try {
        return new RegExp(rule.pattern, "i").test(value);
      } catch (err) {
        log.warn({ err, ruleId: rule.id, pattern: rule.pattern }, "Invalid regex in import rule");
        return false;
      }
    default:
      return false;
  }
}

/**
 * Category for a transaction, or null when no rule applies. Rules are
 * evaluated by ascending `priority`, so a specific rule can be placed ahead of
 * a broad catch-all.
 */
export function categorize(
  rules: ImportRule[],
  transaction: ParsedTransaction
): number | null {
  const active = rules
    .filter((rule) => rule.isActive)
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
  for (const rule of active) {
    if (ruleMatches(rule, transaction)) return rule.categoryId;
  }
  return null;
}

/** Applies `categorize` to a whole batch, keeping the input order. */
export function categorizeAll<T extends ParsedTransaction>(
  rules: ImportRule[],
  transactions: T[]
): (T & { categoryId: number | null })[] {
  return transactions.map((transaction) => ({
    ...transaction,
    categoryId: categorize(rules, transaction),
  }));
}

export { MATCH_TYPE_LABELS, RULE_FIELD_LABELS } from "@/lib/import/rule-labels";
