/**
 * CSV export. Written for Excel on a Swiss locale: semicolon-separated and
 * prefixed with a UTF-8 BOM, without which Excel mangles umlauts on open.
 */

/**
 * Characters that make Excel, LibreOffice and Google Sheets treat a cell as a
 * formula rather than text. `\t` and `\r` are in the list because both are
 * stripped on paste, exposing whatever follows them.
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralises spreadsheet formula injection ("CSV injection").
 *
 * Transaction descriptions and counterparties come straight from bank
 * statements, and the payment reference of an incoming transfer is text the
 * *sender* chooses — so a cell like `=cmd|'/c calc'!A0` can arrive without
 * anyone in the household typing it. Prefixing a single quote makes the
 * spreadsheet read the cell as text; it is the one mitigation every major
 * spreadsheet honours.
 *
 * Plain numbers are exempt, so a negative amount from csvAmount() stays a
 * number in the spreadsheet instead of becoming the text `'-42.50`.
 */
const PLAIN_NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

function neutralizeFormula(text: string): string {
  if (PLAIN_NUMBER_RE.test(text)) return text;
  return FORMULA_TRIGGERS.some((trigger) => text.startsWith(trigger)) ? `'${text}` : text;
}

/**
 * Escapes one field per RFC 4180 (quote it when it contains a delimiter, quote
 * or newline) after defusing anything a spreadsheet would evaluate.
 */
function escapeField(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) return "";
  const text = neutralizeFormula(String(value));
  if (text.includes(delimiter) || text.includes('"') || /[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  options: { delimiter?: string; bom?: boolean } = {}
): string {
  const delimiter = options.delimiter ?? ";";
  const lines = [
    columns.map((column) => escapeField(column.header, delimiter)).join(delimiter),
    ...rows.map((row) =>
      columns.map((column) => escapeField(column.value(row), delimiter)).join(delimiter)
    ),
  ];
  const body = lines.join("\r\n");
  return options.bom === false ? body : `﻿${body}`;
}

/**
 * Amount for a CSV cell: plain decimal point and no thousands separator, so
 * the value is a number again in any spreadsheet regardless of its locale.
 */
export function csvAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** `Content-Disposition` value with a filename that is safe in a header. */
export function attachmentHeader(filename: string): string {
  const safe = filename.replace(/[^\w.\-]/g, "_");
  return `attachment; filename="${safe}"`;
}
