import { formatMoney, parseMoney } from "@/lib/money";
import { SUPPORTED_DATE_FORMATS, parseCsvDate } from "@/lib/import/csv";
import type { ParsedStatement, ParsedTransaction } from "@/lib/import/types";

/**
 * Turns the text lines of a PDF statement into bookings, driven by a
 * user-defined layout (see `PdfLayout` in the schema).
 *
 * Pure: no Prisma, no PDF library, no Node APIs, so client components may import
 * its validation helpers. The PDF → lines step lives in lib/import/pdf.ts.
 *
 * The regexes are user input and a badly written one can backtrack
 * catastrophically (`(a+)+$`). Every regex therefore runs through an injected
 * `LineMatcher`: `nativeMatcher` for trusted input and tests, and
 * `createSafeMatcher` (lib/import/safe-regex.ts, `node:vm` with hard timeouts)
 * for everything driven by a request. Lines longer than MAX_PDF_LINE_LENGTH are
 * ignored, which bounds the cost of ordinary regexes.
 */

export const MAX_PDF_LINE_LENGTH = 500;

export type ContextTarget = "section" | "transaction";

export interface ContextRule {
  regex: string;
  target: ContextTarget;
}

export interface PdfLayoutConfig {
  transactionRegex: string;
  dateFormat: string;
  negativeSuffixRegex: string | null;
  invertAmount: boolean;
  descriptionTemplate: string;
  skipRegex: string | null;
  totalRegex: string | null;
  contextRules: ContextRule[];
}

/** The fields of the Prisma `PdfLayout` this module needs. */
export interface PdfLayoutRow {
  transactionRegex: string;
  dateFormat: string;
  negativeSuffixRegex: string | null;
  invertAmount: boolean;
  descriptionTemplate: string;
  skipRegex: string | null;
  totalRegex: string | null;
  contextRegexes: string;
}

export interface PdfParseResult extends ParsedStatement {
  /** Lines that looked like bookings but could not be read, with the reason. */
  rejectedRows: { line: number; reason: string; raw: string[] }[];
}

export type LineKind = "transaction" | "context" | "skip" | "total" | "other";

export type Groups = Record<string, string | undefined>;

/** Runs one regex over many lines: one entry per line, null where it does not match. */
export type LineMatcher = (source: string, lines: string[]) => (Groups | null)[];

/** In-process matcher — fine for trusted input and tests, no protection against ReDoS. */
export const nativeMatcher: LineMatcher = (source, lines) => {
  const re = new RegExp(source);
  return lines.map((line) => {
    const match = re.exec(line);
    return match ? { ...(match.groups ?? {}) } : null;
  });
};

function groupNames(source: string): string[] {
  return [...source.matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((match) => match[1]);
}

function compiles(source: string | null): boolean {
  if (!source) return false;
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/** A German message when the layout cannot be used, otherwise null. */
export function validateLayout(layout: PdfLayoutConfig): string | null {
  if (!compiles(layout.transactionRegex)) return "Buchungszeilen-Regex ist ungültig.";
  const groups = groupNames(layout.transactionRegex);
  if (!groups.includes("date") || !groups.includes("amount")) {
    return "Buchungszeilen-Regex braucht die Gruppen «date» und «amount».";
  }
  if (!SUPPORTED_DATE_FORMATS.includes(layout.dateFormat)) return "Nicht unterstütztes Datumsformat.";
  if (layout.negativeSuffixRegex && !compiles(layout.negativeSuffixRegex)) return "Gutschrift-Regex ist ungültig.";
  if (layout.skipRegex && !compiles(layout.skipRegex)) return "Überspringen-Regex ist ungültig.";
  if (layout.totalRegex) {
    if (!compiles(layout.totalRegex)) return "Total-Regex ist ungültig.";
    if (!groupNames(layout.totalRegex).includes("amount")) return "Total-Regex braucht die Gruppe «amount».";
  }
  for (const [index, rule] of layout.contextRules.entries()) {
    if (!compiles(rule.regex)) return `Kontext-Regel ${index + 1} ist ungültig.`;
    if (groupNames(rule.regex).length === 0) {
      return `Kontext-Regel ${index + 1} braucht mindestens eine benannte Gruppe.`;
    }
  }
  return null;
}

/** Fills `{group}` placeholders; a missing group leaves no dangling separator behind. */
export function renderTemplate(template: string, groups: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, name: string) => (Object.hasOwn(groups, name) ? groups[name].trim() : ""))
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s-]+|[\s-]+$/g, "")
    .trim();
}

function definedGroups(groups: Groups): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(groups)) {
    if (value !== undefined) result[name] = value;
  }
  return result;
}

/** What every regex returned for every line, computed once. */
interface Tables {
  /** Trimmed line, or null for lines that are blank or too long to look at. */
  texts: (string | null)[];
  skip: (Groups | null)[] | null;
  total: (Groups | null)[] | null;
  transaction: (Groups | null)[];
  negative: (Groups | null)[] | null;
  context: (Groups | null)[][];
}

function buildTables(lines: string[], layout: PdfLayoutConfig, matcher: LineMatcher): Tables {
  const texts = lines.map((raw) => {
    const line = raw.trim();
    return line && line.length <= MAX_PDF_LINE_LENGTH ? line : null;
  });
  const input = texts.map((text) => text ?? "");
  const run = (source: string | null) => (source ? matcher(source, input) : null);
  return {
    texts,
    skip: run(layout.skipRegex),
    total: run(layout.totalRegex),
    transaction: matcher(layout.transactionRegex, input),
    negative: run(layout.negativeSuffixRegex),
    context: layout.contextRules.map((rule) => matcher(rule.regex, input)),
  };
}

interface Draft {
  date: string;
  amountCents: number;
  /** Amount with the document's sign convention, for the sum check. */
  documentCents: number;
  key: string;
  groups: Record<string, string>;
  reference: string | null;
}

function assertValid(layout: PdfLayoutConfig): void {
  const problem = validateLayout(layout);
  if (problem) throw new Error(problem);
}

export function parsePdfStatement(
  lines: string[],
  layout: PdfLayoutConfig,
  matcher: LineMatcher = nativeMatcher
): PdfParseResult {
  assertValid(layout);
  return parseTables(buildTables(lines, layout, matcher), layout);
}

/** Which role each line plays — drives the colouring in the layout dialog. */
export function classifyLines(
  lines: string[],
  layout: PdfLayoutConfig,
  matcher: LineMatcher = nativeMatcher
): LineKind[] {
  if (validateLayout(layout)) return lines.map(() => "other");
  return classifyTables(buildTables(lines, layout, matcher));
}

/** Line kinds and parse result from a single regex pass. */
export function analyzePdf(
  lines: string[],
  layout: PdfLayoutConfig,
  matcher: LineMatcher = nativeMatcher
): { kinds: LineKind[]; result: PdfParseResult } {
  assertValid(layout);
  const tables = buildTables(lines, layout, matcher);
  return { kinds: classifyTables(tables), result: parseTables(tables, layout) };
}

function classifyTables(tables: Tables): LineKind[] {
  return tables.texts.map((text, index) => {
    if (text === null) return "other";
    if (tables.skip?.[index]) return "skip";
    if (tables.total?.[index]) return "total";
    if (tables.transaction[index]) return "transaction";
    if (tables.context.some((table) => table[index])) return "context";
    return "other";
  });
}

function parseTables(tables: Tables, layout: PdfLayoutConfig): PdfParseResult {
  const rejectedRows: PdfParseResult["rejectedRows"] = [];
  const warnings: string[] = [];
  const drafts: Draft[] = [];
  const printedTotals = new Map<string, number>();
  const occurrences = new Map<string, number>();
  let section: Record<string, string> = {};
  // The booking whose following lines may still add groups (category, rate).
  let open: Draft | null = null;

  tables.texts.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line === null) {
      open = null;
      return;
    }

    if (tables.skip?.[index]) {
      if (tables.transaction[index]) warnings.push(`Übersprungen: ${line}`);
      open = null;
      return;
    }

    const total = tables.total?.[index];
    if (total) {
      const cents = parseMoney(total.amount ?? "");
      if (cents !== null) {
        const key = total.key ?? "";
        printedTotals.set(key, (printedTotals.get(key) ?? 0) + cents);
      }
      open = null;
      return;
    }

    const groups = tables.transaction[index];
    if (groups) {
      open = null;
      const date = parseCsvDate(groups.date ?? "", layout.dateFormat);
      if (!date) {
        rejectedRows.push({
          line: lineNumber,
          reason: `Datum "${groups.date}" passt nicht zum Format ${layout.dateFormat}`,
          raw: [line],
        });
        return;
      }
      let cents = parseMoney(groups.amount ?? "");
      if (cents === null) {
        rejectedRows.push({ line: lineNumber, reason: "Kein lesbarer Betrag gefunden", raw: [line] });
        return;
      }
      if (cents === 0) {
        rejectedRows.push({ line: lineNumber, reason: "Betrag ist 0", raw: [line] });
        return;
      }
      if (tables.negative?.[index]) cents = -Math.abs(cents);

      // Built from the raw groups only, so editing the description template or
      // the context rules never changes the dedupe fingerprint. The occurrence
      // number is part of the string: verifyImportHash only checks occurrence 0
      // when a reference is set, and two identical bookings must both import.
      let reference: string | null = null;
      if (groups.text !== undefined) {
        const base = `pdf:${date}|${(groups.valuta ?? "").trim()}|${groups.text.trim().replace(/\s+/g, " ")}|${cents}`;
        const occurrence = occurrences.get(base) ?? 0;
        occurrences.set(base, occurrence + 1);
        reference = `${base}|${occurrence}`;
      }

      const merged = { ...section, ...definedGroups(groups) };
      const draft: Draft = {
        date,
        amountCents: layout.invertAmount ? -cents : cents,
        documentCents: cents,
        key: merged.key ?? "",
        groups: merged,
        reference,
      };
      drafts.push(draft);
      open = draft;
      return;
    }

    for (const [ruleIndex, rule] of layout.contextRules.entries()) {
      const found = tables.context[ruleIndex][index];
      if (!found) continue;
      const values = definedGroups(found);
      if (rule.target === "section") {
        section = { ...section, ...values };
        open = null;
      } else if (open) {
        for (const [name, value] of Object.entries(values)) {
          if (!Object.hasOwn(open.groups, name)) open.groups[name] = value;
        }
      }
      return;
    }

    open = null;
  });

  const transactions: ParsedTransaction[] = drafts.map((draft) => ({
    date: draft.date,
    amountCents: draft.amountCents,
    description:
      renderTemplate(layout.descriptionTemplate, draft.groups) || draft.groups.text?.trim() || "Ohne Beschreibung",
    counterparty: (draft.groups.counterparty?.trim() || draft.groups.text?.split(",")[0] || "").trim() || null,
    bankReference: draft.reference,
  }));

  if (transactions.length === 0) {
    warnings.push(
      "Aus der Datei konnte keine einzige Buchung gelesen werden. " +
        "Layout und Textansicht unter Import → Mappings → PDF-Layouts prüfen."
    );
  }
  if (rejectedRows.length > 0) {
    warnings.push(`${rejectedRows.length} Zeile(n) konnten nicht gelesen werden — Layout prüfen.`);
  }
  warnings.push(...sumCheck(drafts, printedTotals, Boolean(layout.totalRegex)));

  const dates = transactions.map((t) => t.date).sort();
  return {
    transactions,
    rejectedRows,
    iban: null,
    currency: null,
    closingBalanceCents: null,
    openingBalanceCents: null,
    periodFrom: dates[0] ?? null,
    periodTo: dates[dates.length - 1] ?? null,
    warnings,
  };
}

/**
 * Compares what was read with the totals printed in the statement. A mismatch
 * is a warning, not an abort: the user sees it above the preview and decides.
 */
function sumCheck(drafts: Draft[], printed: Map<string, number>, hasTotalRegex: boolean): string[] {
  if (!hasTotalRegex) return ["Keine Summenprüfung: Das Layout hat keine Total-Regex."];
  if (printed.size === 0) return ["Im PDF wurde kein Gesamtbetrag gefunden — Summenprüfung nicht möglich."];

  const messages: string[] = [];
  if (printed.size === 1 && printed.has("")) {
    const read = drafts.reduce((sum, draft) => sum + draft.documentCents, 0);
    const expected = printed.get("") ?? 0;
    if (read !== expected) {
      messages.push(`Summe weicht ab: gelesen ${formatMoney(read)}, laut PDF ${formatMoney(expected)}.`);
    }
    return messages;
  }

  const sums = new Map<string, number>();
  for (const draft of drafts) sums.set(draft.key, (sums.get(draft.key) ?? 0) + draft.documentCents);
  for (const [key, expected] of printed) {
    const read = sums.get(key) ?? 0;
    if (read !== expected) {
      messages.push(`Summe für ${key} weicht ab: gelesen ${formatMoney(read)}, laut PDF ${formatMoney(expected)}.`);
    }
  }
  return messages;
}

export function parseContextRules(json: string): ContextRule[] {
  try {
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (item): item is ContextRule =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ContextRule).regex === "string" &&
        ((item as ContextRule).target === "section" || (item as ContextRule).target === "transaction")
    );
  } catch {
    return [];
  }
}

export function layoutFromRow(row: PdfLayoutRow): PdfLayoutConfig {
  return {
    transactionRegex: row.transactionRegex,
    dateFormat: row.dateFormat,
    negativeSuffixRegex: row.negativeSuffixRegex,
    invertAmount: row.invertAmount,
    descriptionTemplate: row.descriptionTemplate,
    skipRegex: row.skipRegex,
    totalRegex: row.totalRegex,
    contextRules: parseContextRules(row.contextRegexes),
  };
}
