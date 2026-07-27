import type { RuleField, RuleMatch, RuleSign } from "@prisma/client";

/**
 * Labels for the import-rule form.
 *
 * Kept apart from lib/import/rules.ts so the Client Component that renders the
 * form does not pull the pino logger (and its Node built-ins) into the browser
 * bundle.
 */
export const MATCH_TYPE_LABELS: Record<RuleMatch, string> = {
  Contains: "enthält",
  StartsWith: "beginnt mit",
  EndsWith: "endet mit",
  Regex: "Regex",
};

export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  Description: "Beschreibung",
  Counterparty: "Gegenpartei",
};

export const RULE_SIGN_LABELS: Record<RuleSign, string> = {
  Any: "beliebig",
  Positive: "nur Eingänge (+)",
  Negative: "nur Ausgänge (−)",
};
