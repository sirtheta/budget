import type { CsvMapping, PdfLayout, PrismaClient } from "@prisma/client";

/**
 * Starter CSV column mappings for exports that show up in almost every Swiss
 * household: the household's own credit card (CSV-only, no CAMT.053) and
 * Revolut. Every mapping stays fully editable or deletable afterwards under
 * Import → Mappings — this is a starting point, not a fixed list. PDF layouts
 * for statements that only come as PDF follow below.
 */
export const DEFAULT_CSV_MAPPINGS: Omit<
  CsvMapping,
  "id" | "encoding" | "decimalSeparator" | "thousandsSeparator" | "createdAt" | "updatedAt"
>[] = [
  {
    // Viseca/Six card-movement export (Migros Bank Cumulus Mastercard and
    // similar): purchases come out as a positive amount, credits negative —
    // the opposite of this app's convention, hence invertAmount.
    name: "Migros Kreditkarte",
    delimiter: ",",
    skipRows: 0,
    hasHeader: true,
    dateColumn: 2,
    dateFormat: "YYYY-MM-DD",
    descriptionColumn: 12,
    amountColumn: 4,
    invertAmount: true,
    debitColumn: null,
    creditColumn: null,
    counterpartyColumn: 8,
  },
  {
    // Revolut account statement: Betrag is already signed the way this app
    // expects, and there is no separate merchant column.
    name: "Revolut",
    delimiter: ",",
    skipRows: 0,
    hasHeader: true,
    dateColumn: 3,
    dateFormat: "YYYY-MM-DD",
    descriptionColumn: 4,
    amountColumn: 5,
    invertAmount: false,
    debitColumn: null,
    creditColumn: null,
    counterpartyColumn: 4,
  },
];

/** Creates the starter CSV mappings, skipping any name that already exists. */
export async function seedDefaultCsvMappings(
  prisma: PrismaClient
): Promise<{ created: number; skipped: number }> {
  const existing = await prisma.csvMapping.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((m) => m.name));

  let created = 0;
  let skipped = 0;
  for (const mapping of DEFAULT_CSV_MAPPINGS) {
    if (existingNames.has(mapping.name)) {
      skipped++;
      continue;
    }
    await prisma.csvMapping.create({ data: mapping });
    created++;
  }
  return { created, skipped };
}

const CARD_NUMBER = String.raw`\d{4} [\dX]{4} X{4} \d{4}`;
const AMOUNT = String.raw`[\d']+\.\d{2}`;

/**
 * Starter PDF layouts. Like the CSV mappings these stay editable under
 * Import → Mappings.
 */
export const DEFAULT_PDF_LAYOUTS: Omit<PdfLayout, "id" | "createdAt" | "updatedAt">[] = [
  {
    // Viseca / Migros Bank Cumulus statement. Purchases are printed positive,
    // credits carry a trailing minus — hence invertAmount. One booking per
    // line; the next line is the card network's merchant category, and
    // foreign-currency bookings add a currency/amount pair plus a rate line.
    name: "Migros Kreditkarte (PDF)",
    transactionRegex:
      String.raw`^(?<date>\d{2}\.\d{2}\.\d{2})\s+(?<valuta>\d{2}\.\d{2}\.\d{2})\s+(?<text>.+?)` +
      String.raw`(?:\s{2,}(?<currency>[A-Z]{3})\s{2,}(?<foreignAmount>${AMOUNT}))?` +
      String.raw`\s{2,}(?<amount>${AMOUNT})(?:\s*-)?$`,
    dateFormat: "DD.MM.YY",
    negativeSuffixRegex: String.raw`\s*-$`,
    invertAmount: true,
    descriptionTemplate: "{text} - {category}",
    skipRegex: "Ihre Zahlung|Totalbetrag letzte Abrechnung",
    totalRegex: String.raw`^Total Karte .*?(?<key>${CARD_NUMBER})\s+(?<amount>${AMOUNT}(?:\s*-)?)$`,
    contextRegexes: JSON.stringify([
      { regex: String.raw`^(?<key>${CARD_NUMBER})\s+.*,\s*(?<holder>.+)$`, target: "section" },
      { regex: String.raw`^Umrechnungskurs\s+(?<rate>[\d.]+)`, target: "transaction" },
      { regex: String.raw`^(?<category>[^\d]+)$`, target: "transaction" },
    ]),
  },
];

/** Creates the starter PDF layouts, skipping any name that already exists. */
export async function seedDefaultPdfLayouts(
  prisma: PrismaClient
): Promise<{ created: number; skipped: number }> {
  const existing = await prisma.pdfLayout.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((l) => l.name));

  let created = 0;
  let skipped = 0;
  for (const layout of DEFAULT_PDF_LAYOUTS) {
    if (existingNames.has(layout.name)) {
      skipped++;
      continue;
    }
    await prisma.pdfLayout.create({ data: layout });
    created++;
  }
  return { created, skipped };
}
