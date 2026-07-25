import type { PrismaClient, RuleField, RuleMatch } from "@prisma/client";

/**
 * Starter rule set for a Swiss household: the merchants and online shops that
 * show up on almost every CHF bank statement. Without it a fresh CAMT.053
 * import lands entirely in "ohne Kategorie" and the household has to invent
 * every rule by hand before the app becomes useful. Every rule stays fully
 * editable or deletable afterwards under Import → Regeln — this is a
 * starting point, not a fixed taxonomy.
 *
 * Priority starts at 100 so a rule the user derives from manually
 * categorising a booking (created at priority 0, see transactions/actions.ts)
 * always wins over this generic default when both would match.
 */
export const DEFAULT_IMPORT_RULES: {
  name: string;
  field: RuleField;
  matchType: RuleMatch;
  pattern: string;
  categoryGroup: string;
  categoryChild: string;
}[] = [
  // Lebensmittel
  { name: "Migros", field: "Counterparty", matchType: "Contains", pattern: "migros", categoryGroup: "Lebenshaltung", categoryChild: "Lebensmittel" },
  { name: "Coop", field: "Counterparty", matchType: "Contains", pattern: "coop", categoryGroup: "Lebenshaltung", categoryChild: "Lebensmittel" },
  { name: "Denner", field: "Counterparty", matchType: "Contains", pattern: "denner", categoryGroup: "Lebenshaltung", categoryChild: "Lebensmittel" },
  { name: "Aldi", field: "Counterparty", matchType: "Contains", pattern: "aldi", categoryGroup: "Lebenshaltung", categoryChild: "Lebensmittel" },
  { name: "Lidl", field: "Counterparty", matchType: "Contains", pattern: "lidl", categoryGroup: "Lebenshaltung", categoryChild: "Lebensmittel" },
  { name: "Volg", field: "Counterparty", matchType: "Contains", pattern: "volg", categoryGroup: "Lebenshaltung", categoryChild: "Lebensmittel" },
  { name: "Spar", field: "Counterparty", matchType: "Contains", pattern: "spar gruppe", categoryGroup: "Lebenshaltung", categoryChild: "Lebensmittel" },

  // Auswärts essen
  { name: "McDonald's", field: "Counterparty", matchType: "Contains", pattern: "mcdonald", categoryGroup: "Lebenshaltung", categoryChild: "Auswärts essen" },
  { name: "Starbucks", field: "Counterparty", matchType: "Contains", pattern: "starbucks", categoryGroup: "Lebenshaltung", categoryChild: "Auswärts essen" },
  { name: "Burger King", field: "Counterparty", matchType: "Contains", pattern: "burger king", categoryGroup: "Lebenshaltung", categoryChild: "Auswärts essen" },
  { name: "Subway", field: "Counterparty", matchType: "Contains", pattern: "subway", categoryGroup: "Lebenshaltung", categoryChild: "Auswärts essen" },

  // Haushalt & Drogerie
  { name: "IKEA", field: "Counterparty", matchType: "Contains", pattern: "ikea", categoryGroup: "Lebenshaltung", categoryChild: "Haushalt & Drogerie" },
  { name: "Migros Do it + Garden", field: "Counterparty", matchType: "Contains", pattern: "do it + garden", categoryGroup: "Lebenshaltung", categoryChild: "Haushalt & Drogerie" },
  { name: "Jumbo", field: "Counterparty", matchType: "Contains", pattern: "jumbo", categoryGroup: "Lebenshaltung", categoryChild: "Haushalt & Drogerie" },

  // Kleidung
  { name: "Zalando", field: "Counterparty", matchType: "Contains", pattern: "zalando", categoryGroup: "Lebenshaltung", categoryChild: "Kleidung" },
  { name: "H&M", field: "Counterparty", matchType: "Contains", pattern: "h&m", categoryGroup: "Lebenshaltung", categoryChild: "Kleidung" },
  { name: "C&A", field: "Counterparty", matchType: "Contains", pattern: "c&a", categoryGroup: "Lebenshaltung", categoryChild: "Kleidung" },

  // Mobilität
  { name: "SBB", field: "Counterparty", matchType: "Contains", pattern: "sbb", categoryGroup: "Mobilität", categoryChild: "ÖV-Abo" },
  { name: "Migrol", field: "Counterparty", matchType: "Contains", pattern: "migrol", categoryGroup: "Mobilität", categoryChild: "Benzin" },
  { name: "Shell", field: "Counterparty", matchType: "Contains", pattern: "shell", categoryGroup: "Mobilität", categoryChild: "Benzin" },
  { name: "Avia", field: "Counterparty", matchType: "Contains", pattern: "avia", categoryGroup: "Mobilität", categoryChild: "Benzin" },
  { name: "Tankstelle", field: "Description", matchType: "Contains", pattern: "tankstelle", categoryGroup: "Mobilität", categoryChild: "Benzin" },

  // Wohnen
  { name: "Swisscom", field: "Counterparty", matchType: "Contains", pattern: "swisscom", categoryGroup: "Wohnen", categoryChild: "Internet & TV" },
  { name: "Salt", field: "Counterparty", matchType: "Contains", pattern: "salt mobile", categoryGroup: "Wohnen", categoryChild: "Internet & TV" },
  { name: "Sunrise", field: "Counterparty", matchType: "Contains", pattern: "sunrise", categoryGroup: "Wohnen", categoryChild: "Internet & TV" },
  { name: "NetZulg", field: "Counterparty", matchType: "Contains", pattern: "NetZulg", categoryGroup: "Wohnen", categoryChild: "Strom" },

  // Freizeit & Bildung
  { name: "Netflix", field: "Counterparty", matchType: "Contains", pattern: "netflix", categoryGroup: "Freizeit & Bildung", categoryChild: "Abos & Streaming" },
  { name: "Spotify", field: "Counterparty", matchType: "Contains", pattern: "spotify", categoryGroup: "Freizeit & Bildung", categoryChild: "Abos & Streaming" },
  { name: "Disney+", field: "Counterparty", matchType: "Contains", pattern: "disney", categoryGroup: "Freizeit & Bildung", categoryChild: "Abos & Streaming" },
  { name: "Decathlon", field: "Counterparty", matchType: "Contains", pattern: "decathlon", categoryGroup: "Freizeit & Bildung", categoryChild: "Sport & Hobby" },

  // Versicherungen & Gesundheit
  { name: "Helsana", field: "Counterparty", matchType: "Contains", pattern: "helsana", categoryGroup: "Versicherungen & Gesundheit", categoryChild: "Krankenkasse" },
  { name: "Die Mobiliar", field: "Counterparty", matchType: "Contains", pattern: "mobiliar", categoryGroup: "Versicherungen & Gesundheit", categoryChild: "Weitere Versicherungen" },

  // Persönliches
  { name: "Amazon", field: "Counterparty", matchType: "Contains", pattern: "amazon", categoryGroup: "Persönliches", categoryChild: "Diverses" },
  { name: "digitec", field: "Counterparty", matchType: "Contains", pattern: "digitec", categoryGroup: "Persönliches", categoryChild: "Diverses" },
  { name: "Galaxus", field: "Counterparty", matchType: "Contains", pattern: "galaxus", categoryGroup: "Persönliches", categoryChild: "Diverses" },
  { name: "Interdiscount", field: "Counterparty", matchType: "Contains", pattern: "interdiscount", categoryGroup: "Persönliches", categoryChild: "Diverses" },
  { name: "Manor", field: "Counterparty", matchType: "Contains", pattern: "manor", categoryGroup: "Persönliches", categoryChild: "Diverses" },
  { name: "Coiffeur", field: "Description", matchType: "Contains", pattern: "coiffeur", categoryGroup: "Persönliches", categoryChild: "Coiffeur & Körperpflege" },

  // Steuern & Abgaben
  { name: "Serafe", field: "Counterparty", matchType: "Contains", pattern: "serafe", categoryGroup: "Steuern & Abgaben", categoryChild: "Serafe" },
  { name: "Steueramt", field: "Counterparty", matchType: "Contains", pattern: "steueramt", categoryGroup: "Steuern & Abgaben", categoryChild: "Steuern" },
  { name: "Steuerverwaltung", field: "Counterparty", matchType: "Contains", pattern: "steuerverwaltung", categoryGroup: "Steuern & Abgaben", categoryChild: "Steuern" },
];

/**
 * Creates the starter rules, skipping any pattern that already exists (on
 * any field, not just this list — a rule the user wrote by hand takes
 * precedence over the seed) and any rule whose target category was renamed
 * or deleted from the default tree. Idempotent, like `seedDefaultCategories`.
 */
export async function seedDefaultImportRules(
  prisma: PrismaClient
): Promise<{ created: number; skipped: number }> {
  const [existingRules, leafCategories] = await Promise.all([
    prisma.importRule.findMany({ select: { field: true, pattern: true } }),
    prisma.category.findMany({
      where: { parentId: { not: null } },
      select: { id: true, name: true, parent: { select: { name: true } } },
    }),
  ]);
  const existingKeys = new Set(
    existingRules.map((r) => `${r.field}:${r.pattern.toLowerCase()}`)
  );

  let created = 0;
  let skipped = 0;
  for (const [index, rule] of DEFAULT_IMPORT_RULES.entries()) {
    const key = `${rule.field}:${rule.pattern.toLowerCase()}`;
    const categoryId = leafCategories.find(
      (c) => c.name === rule.categoryChild && c.parent?.name === rule.categoryGroup
    )?.id;
    if (existingKeys.has(key) || !categoryId) {
      skipped++;
      continue;
    }
    await prisma.importRule.create({
      data: {
        name: rule.name,
        field: rule.field,
        matchType: rule.matchType,
        pattern: rule.pattern,
        categoryId,
        priority: 100 + index,
      },
    });
    created++;
  }
  return { created, skipped };
}
