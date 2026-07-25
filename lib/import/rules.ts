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
  const magnitude = Math.abs(transaction.amountCents);
  if (rule.minAmountCents !== null && magnitude < rule.minAmountCents) return false;
  if (rule.maxAmountCents !== null && magnitude > rule.maxAmountCents) return false;

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
 * The rule that applies to a transaction, or null when none does. Rules are
 * evaluated by ascending `priority`, so a specific rule can be placed ahead of
 * a broad catch-all. Returns the whole rule rather than just a category id
 * because a rule's action is either `categoryId` (auto-categorise) or
 * `transferAccountId` (auto-transfer) — the caller decides which.
 */
export function matchRule(
  rules: ImportRule[],
  transaction: ParsedTransaction
): ImportRule | null {
  const active = rules
    .filter((rule) => rule.isActive)
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
  for (const rule of active) {
    if (ruleMatches(rule, transaction)) return rule;
  }
  return null;
}

export { MATCH_TYPE_LABELS, RULE_FIELD_LABELS } from "@/lib/import/rule-labels";
