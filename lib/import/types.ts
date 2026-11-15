/** One transaction as parsed out of a statement file, before it is booked. */
export interface ParsedTransaction {
  /** Booking date, YYYY-MM-DD. */
  date: string;
  /** Signed amount in Rappen: negative = money out. Includes `feeCents`. */
  amountCents: number;
  /**
   * Fee the bank lists separately from the amount, as a positive number of
   * Rappen already folded into `amountCents`. Kept so the fingerprint can still
   * be derived from the amount as printed. Absent/0 when the file has none.
   */
  feeCents?: number;
  description: string;
  counterparty: string | null;
  /** AcctSvcrRef / EndToEndId, when the file provides one. */
  bankReference: string | null;
}

/** Result of parsing a whole statement file. */
export interface ParsedStatement {
  transactions: ParsedTransaction[];
  /** IBAN the statement belongs to, used to auto-select the target account. */
  iban: string | null;
  currency: string | null;
  /** Closing balance reported by the bank, in Rappen. */
  closingBalanceCents: number | null;
  openingBalanceCents: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** Non-fatal problems worth showing above the import preview. */
  warnings: string[];
}
