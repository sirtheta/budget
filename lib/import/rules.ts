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

/**
 * Whether a pattern contains an unbounded quantifier applied to a group that
 * itself repeats or alternates — `(a+)+`, `(a|aa)*`, `(\d+)+$`.
 *
 * These are the shapes that backtrack catastrophically: against a few hundred
 * characters of statement text they can run for longer than the universe has
 * existed, and every rule is evaluated against every imported row, so one such
 * pattern hangs the whole import (and the request thread with it). JavaScript
 * offers no way to time a regex out, so the pattern has to be refused up front.
 *
 * Deliberately conservative — it looks for the specific nested-repetition shape
 * rather than trying to decide the general question, which isn't decidable by
 * inspection anyway.
 */
export function hasNestedQuantifier(pattern: string): boolean {
  const groupStarts: number[] = [];
  let inCharClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\") {
      i++; // escaped character, never structural
      continue;
    }
    if (inCharClass) {
      if (char === "]") inCharClass = false;
      continue;
    }
    if (char === "[") {
      inCharClass = true;
    } else if (char === "(") {
      groupStarts.push(i);
    } else if (char === ")") {
      const start = groupStarts.pop();
      if (start === undefined) continue;
      // Only unbounded repetition of the group can blow up; `(a+){2}` cannot.
      if (!/^(?:[*+]|\{\d*,\})/.test(pattern.slice(i + 1))) continue;
      // Escapes stripped so `\+` in the body isn't read as a quantifier.
      const body = pattern.slice(start + 1, i).replace(/\\./g, "");
      if (/[*+|]|\{\d*,\}/.test(body)) return true;
    }
  }
  return false;
}

/**
 * Compiled user regexes, keyed by pattern. `ruleMatches` runs once per rule per
 * imported row — up to 5000 rows a batch — and recompiling each time was pure
 * waste.
 */
const compiled = new Map<string, RegExp | null>();
const COMPILED_CACHE_MAX = 500;

function compile(pattern: string, ruleId: number): RegExp | null {
  const cached = compiled.get(pattern);
  if (cached !== undefined) return cached;

  let regex: RegExp | null = null;
  if (hasNestedQuantifier(pattern)) {
    log.warn({ ruleId, pattern }, "Import rule regex has nested quantifiers — ignored");
  } else {
    try {
      regex = new RegExp(pattern, "i");
    } catch (err) {
      log.warn({ err, ruleId, pattern }, "Invalid regex in import rule");
    }
  }

  // Keys come from stored rules, not request input, so the cache can only grow
  // as far as the rule set — the cap is a backstop, not a hot path.
  if (compiled.size >= COMPILED_CACHE_MAX) compiled.clear();
  compiled.set(pattern, regex);
  return regex;
}

/**
 * Field of a transaction a rule matches against. `Both` joins description and
 * counterparty with a space so one rule covers a counterparty that shows up
 * inconsistently — sometimes in the bank's counterparty field, sometimes only
 * embedded in the free-text description — without duplicating the rule.
 */
function fieldValue(transaction: ParsedTransaction, field: ImportRule["field"]): string {
  const value =
    field === "Counterparty"
      ? transaction.counterparty
      : field === "Both"
        ? [transaction.description, transaction.counterparty].filter(Boolean).join(" ")
        : transaction.description;
  return (value ?? "").toLowerCase();
}

/**
 * Whether a rule matches. User-supplied regexes are compiled defensively: an
 * invalid — or catastrophically backtracking — pattern must not take down the
 * whole import, it just never matches.
 */
export function ruleMatches(rule: ImportRule, transaction: ParsedTransaction): boolean {
  const magnitude = Math.abs(transaction.amountCents);
  if (rule.minAmountCents !== null && magnitude < rule.minAmountCents) return false;
  if (rule.maxAmountCents !== null && magnitude > rule.maxAmountCents) return false;
  if (rule.sign === "Positive" && transaction.amountCents <= 0) return false;
  if (rule.sign === "Negative" && transaction.amountCents >= 0) return false;

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
    case "Regex": {
      const regex = compile(rule.pattern, rule.id);
      return regex !== null && regex.test(value);
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
