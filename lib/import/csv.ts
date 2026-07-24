import type { CsvMapping } from "@prisma/client";
import { parseMoney } from "@/lib/money";
import { isValidDateString } from "@/lib/date";
import type { ParsedStatement, ParsedTransaction } from "@/lib/import/types";

/**
 * CSV import with a per-bank column mapping.
 *
 * CAMT.053 is the better source, but not every account offers it (credit
 * cards in particular usually only export CSV), and no two banks agree on
 * column order, date format, or whether amounts come as one signed column or
 * as separate debit/credit columns. The mapping is stored per bank
 * (`CsvMapping`) so a file only has to be described once.
 */

/**
 * Splits CSV text into rows of fields (RFC 4180: quoted fields may contain
 * the delimiter, newlines, and doubled quotes).
 *
 * Hand-written rather than pulled from a library: the rules are short, and a
 * dependency here would still need the same wrapper for the Swiss quirks
 * (BOM, CRLF, semicolon default).
 */
export function parseCsvRows(input: string, delimiter = ";"): string[][] {
  // Excel writes a UTF-8 BOM; left in place it becomes part of the first field.
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Swallow the \n of a \r\n pair.
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Guesses the delimiter of a CSV file by counting candidates in the first
 * lines. Only a starting point for the mapping form — the user can override.
 */
export function detectDelimiter(input: string): string {
  const sample = input.replace(/^﻿/, "").split(/\r?\n/).slice(0, 5).join("\n");
  const candidates = [";", ",", "\t", "|"];
  let best = ";";
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = sample.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

const DATE_PATTERNS: Record<string, RegExp> = {
  "DD.MM.YYYY": /^(\d{1,2})\.(\d{1,2})\.(\d{4})/,
  "DD/MM/YYYY": /^(\d{1,2})\/(\d{1,2})\/(\d{4})/,
  "MM/DD/YYYY": /^(\d{1,2})\/(\d{1,2})\/(\d{4})/,
  "YYYY-MM-DD": /^(\d{4})-(\d{1,2})-(\d{1,2})/,
  "DD-MM-YYYY": /^(\d{1,2})-(\d{1,2})-(\d{4})/,
};

export const SUPPORTED_DATE_FORMATS = Object.keys(DATE_PATTERNS);

/** Converts a date cell into `YYYY-MM-DD`, or null when it doesn't match. */
export function parseCsvDate(value: string, format: string): string | null {
  const pattern = DATE_PATTERNS[format];
  if (!pattern) return null;
  const match = pattern.exec(value.trim());
  if (!match) return null;

  let year: string, month: string, day: string;
  if (format === "YYYY-MM-DD") {
    [, year, month, day] = match;
  } else if (format === "MM/DD/YYYY") {
    [, month, day, year] = match;
  } else {
    [, day, month, year] = match;
  }

  const result = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isValidDateString(result) ? result : null;
}

function cell(row: string[], index: number | null | undefined): string {
  if (index === null || index === undefined) return "";
  return (row[index] ?? "").trim();
}

export interface CsvParseResult extends ParsedStatement {
  /** Rows that could not be interpreted, with the reason — shown above the preview. */
  rejectedRows: { line: number; reason: string; raw: string[] }[];
}

/**
 * Applies a stored column mapping to CSV text.
 *
 * Amounts come either as one signed column or as separate debit/credit
 * columns; in the latter case the debit column is negated, since banks write
 * both as positive numbers.
 */
export function parseCsvStatement(input: string, mapping: CsvMapping): CsvParseResult {
  const rows = parseCsvRows(input, mapping.delimiter);
  const rejectedRows: CsvParseResult["rejectedRows"] = [];
  const transactions: ParsedTransaction[] = [];
  const warnings: string[] = [];

  const start = mapping.skipRows + (mapping.hasHeader ? 1 : 0);
  const dataRows = rows.slice(start);

  if (mapping.amountColumn === null && mapping.debitColumn === null && mapping.creditColumn === null) {
    throw new Error(
      "Das Mapping definiert weder eine Betragsspalte noch Soll-/Haben-Spalten."
    );
  }

  dataRows.forEach((row, index) => {
    const line = start + index + 1;

    const date = parseCsvDate(cell(row, mapping.dateColumn), mapping.dateFormat);
    if (!date) {
      rejectedRows.push({
        line,
        reason: `Datum "${cell(row, mapping.dateColumn)}" passt nicht zum Format ${mapping.dateFormat}`,
        raw: row,
      });
      return;
    }

    let amountCents: number | null = null;
    if (mapping.amountColumn !== null) {
      amountCents = parseMoney(cell(row, mapping.amountColumn));
    } else {
      const debit = parseMoney(cell(row, mapping.debitColumn));
      const credit = parseMoney(cell(row, mapping.creditColumn));
      // Banks write both columns as positive amounts; the column itself
      // carries the direction.
      if (debit !== null && debit !== 0) amountCents = -Math.abs(debit);
      else if (credit !== null && credit !== 0) amountCents = Math.abs(credit);
    }

    if (amountCents === null) {
      rejectedRows.push({ line, reason: "Kein lesbarer Betrag gefunden", raw: row });
      return;
    }
    if (amountCents === 0) {
      rejectedRows.push({ line, reason: "Betrag ist 0", raw: row });
      return;
    }

    const counterparty = cell(row, mapping.counterpartyColumn) || null;
    transactions.push({
      date,
      amountCents,
      description: cell(row, mapping.descriptionColumn) || counterparty || "Ohne Beschreibung",
      counterparty,
      bankReference: null,
    });
  });

  if (transactions.length === 0) {
    warnings.push("Aus der Datei konnte keine einzige Buchung gelesen werden.");
  }
  if (rejectedRows.length > 0) {
    warnings.push(
      `${rejectedRows.length} Zeile(n) konnten nicht gelesen werden — Spaltenzuordnung prüfen.`
    );
  }

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

/** First rows of a file, for the column-mapping preview table. */
export function previewRows(input: string, delimiter: string, limit = 8): string[][] {
  return parseCsvRows(input, delimiter).slice(0, limit);
}
