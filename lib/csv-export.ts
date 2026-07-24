/**
 * CSV export. Written for Excel on a Swiss locale: semicolon-separated and
 * prefixed with a UTF-8 BOM, without which Excel mangles umlauts on open.
 */

/** Escapes one field per RFC 4180 (quote it when it contains a delimiter, quote or newline). */
function escapeField(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
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
