import type { CsvMapping, PrismaClient } from "@prisma/client";

/**
 * Starter CSV column mappings for exports that show up in almost every Swiss
 * household: the household's own credit card (CSV-only, no CAMT.053) and
 * Revolut. Every mapping stays fully editable or deletable afterwards under
 * Import → CSV-Mappings — this is a starting point, not a fixed list.
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
