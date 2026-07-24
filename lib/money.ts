/**
 * Money handling. Every amount in the database is a signed integer number of
 * Rappen — never a float and never a Prisma `Decimal`.
 *
 * Integers keep arithmetic exact (0.1 + 0.2 problems simply cannot occur) and
 * survive the Server-Component → Client-Component boundary unchanged, which a
 * `Decimal` does not. Conversion to francs happens only for display and for
 * chart values.
 *
 * Sign convention throughout the app: negative = expense, positive = income.
 */

export const RAPPEN_PER_FRANC = 100;

/** Rappen → francs, as a plain number. Only for display and chart axes. */
export function toFrancs(cents: number): number {
  return cents / RAPPEN_PER_FRANC;
}

/**
 * Francs → Rappen, rounded half-away-from-zero.
 *
 * The `toFixed(4)` step is not cosmetic: `1.005 * 100` evaluates to
 * `100.49999999999999` in binary floating point, so a plain `Math.round`
 * would round a half down. Normalising the scaled value first makes the
 * documented rounding actually hold.
 */
export function toCents(francs: number): number {
  const scaled = Number((Math.abs(francs) * RAPPEN_PER_FRANC).toFixed(4));
  return (francs < 0 ? -1 : 1) * Math.round(scaled);
}

const chfFormatter = new Intl.NumberFormat("de-CH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface FormatMoneyOptions {
  /** Prepend the currency code, e.g. `CHF 1'234.50`. */
  withCurrency?: boolean;
  /** ISO code shown when `withCurrency` is set. */
  currency?: string;
  /** Always show a sign, so income reads `+1'234.50`. */
  forceSign?: boolean;
}

/**
 * Formats Rappen in Swiss notation (`1'234.50`). Returns a string, so the
 * caller never has to think about float rendering.
 */
export function formatMoney(cents: number, options: FormatMoneyOptions = {}): string {
  const { withCurrency = false, currency = "CHF", forceSign = false } = options;
  const formatted = chfFormatter.format(Math.abs(cents) / RAPPEN_PER_FRANC);
  const sign = cents < 0 ? "−" : forceSign && cents > 0 ? "+" : "";
  return withCurrency ? `${sign}${currency} ${formatted}` : `${sign}${formatted}`;
}

/** Shorthand for amounts in charts and tiles where the sign carries meaning. */
export function formatMoneySigned(cents: number, currency = "CHF"): string {
  return formatMoney(cents, { withCurrency: true, currency, forceSign: true });
}

/**
 * Compact form for chart axes: `1.2k`, `-350`. Full precision would make the
 * axis labels overlap on narrow screens.
 */
export function formatMoneyCompact(cents: number): string {
  const francs = toFrancs(cents);
  const abs = Math.abs(francs);
  const sign = francs < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}${Math.round(abs)}`;
}

/**
 * Parses user- and bank-supplied amount strings into Rappen.
 *
 * Accepts the shapes that actually turn up in Swiss bank exports and in form
 * input: `1'234.50`, `1 234,50`, `1.234,50`, `-42`, `42-` (trailing minus,
 * used by some legacy exports), `CHF 12.–`, and `(12.50)` for negatives.
 * Returns null when the input isn't a number at all, so callers can tell
 * "invalid" apart from "zero".
 */
export function parseMoney(input: string): number | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;

  // Strip currency codes/symbols and the Swiss "–" shorthand for ".00".
  s = s.replace(/chf|fr\.?|₣/gi, "").replace(/[–—]$/, "").trim();

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Remove thousands separators: apostrophes and spaces are never decimal
  // separators, so they can go unconditionally.
  s = s.replace(/['’\s]/g, "");

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present — whichever comes last is the decimal separator.
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    s = s.split(thousandsSep).join("");
    if (decimalSep === ",") s = s.replace(",", ".");
  } else if (lastComma >= 0) {
    // A lone comma is a decimal separator unless it groups three digits
    // (e.g. "1,234" from an English-formatted export).
    s = s.length - lastComma === 4 ? s.replace(",", "") : s.replace(",", ".");
  }

  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const francs = Number(s);
  if (!Number.isFinite(francs)) return null;

  const cents = toCents(francs);
  return negative ? -cents : cents;
}

/**
 * Parses a form field into Rappen, throwing a German error message that the
 * Server Action can hand straight back to the form.
 */
export function parseMoneyOrThrow(input: string, label = "Betrag"): number {
  const cents = parseMoney(input);
  if (cents === null) throw new Error(`${label} ist keine gültige Zahl.`);
  return cents;
}

/** Sum of the `amountCents` of a list of rows. */
export function sumCents<T extends { amountCents: number }>(rows: T[]): number {
  return rows.reduce((total, row) => total + row.amountCents, 0);
}

/**
 * Splits a total into `parts` whole-Rappen shares that add back up to the
 * total exactly — the remainder is spread over the first shares instead of
 * being lost to rounding. Used for reserve rates (lib/reserves.ts).
 */
export function splitEvenly(totalCents: number, parts: number): number[] {
  if (parts <= 0) return [];
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}
