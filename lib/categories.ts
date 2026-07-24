import type { CategoryKind, PrismaClient } from "@prisma/client";

/**
 * Default category tree for a Swiss household.
 *
 * An empty budget app is useless on day one — the user would have to invent a
 * chart of accounts before booking anything. These groups cover what actually
 * shows up on a Swiss bank statement (Krankenkasse and Serafe have no
 * equivalent elsewhere), and every one of them can be renamed or deleted.
 */
export const DEFAULT_CATEGORIES: {
  name: string;
  kind: CategoryKind;
  color: string;
  children: string[];
}[] = [
  {
    name: "Einkommen",
    kind: "Income",
    color: "#10b981",
    children: ["Lohn", "13. Monatslohn", "Nebenerwerb", "Zinsen & Dividenden", "Rückerstattungen"],
  },
  {
    name: "Wohnen",
    kind: "Expense",
    color: "#6366f1",
    children: ["Miete / Hypothek", "Nebenkosten", "Strom", "Internet & TV", "Hausrat- & Haftpflicht"],
  },
  {
    name: "Versicherungen & Gesundheit",
    kind: "Expense",
    color: "#0ea5e9",
    children: ["Krankenkasse", "Selbstbehalt & Franchise", "Zahnarzt", "Weitere Versicherungen"],
  },
  {
    name: "Lebenshaltung",
    kind: "Expense",
    color: "#f59e0b",
    children: ["Lebensmittel", "Haushalt & Drogerie", "Kleidung", "Auswärts essen"],
  },
  {
    name: "Mobilität",
    kind: "Expense",
    color: "#14b8a6",
    children: ["ÖV-Abo", "Benzin", "Autoversicherung & Steuern", "Service & Reparatur", "Parkieren"],
  },
  {
    name: "Steuern & Abgaben",
    kind: "Expense",
    color: "#ef4444",
    children: ["Steuern", "Serafe", "Gebühren"],
  },
  {
    name: "Freizeit & Bildung",
    kind: "Expense",
    color: "#8b5cf6",
    children: ["Ferien & Reisen", "Sport & Hobby", "Abos & Streaming", "Weiterbildung", "Ausgang"],
  },
  {
    name: "Persönliches",
    kind: "Expense",
    color: "#ec4899",
    children: ["Coiffeur & Körperpflege", "Geschenke & Spenden", "Diverses"],
  },
];

/**
 * Creates the default tree, skipping anything that already exists by name.
 * Idempotent, so it can run on every startup and after a partial setup.
 * Returns the number of categories created.
 */
export async function seedDefaultCategories(prisma: PrismaClient): Promise<number> {
  const existing = await prisma.category.findMany({ select: { name: true, parentId: true } });
  const existingTop = new Set(existing.filter((c) => c.parentId === null).map((c) => c.name));

  let created = 0;
  for (const [index, group] of DEFAULT_CATEGORIES.entries()) {
    if (existingTop.has(group.name)) continue;
    await prisma.category.create({
      data: {
        name: group.name,
        kind: group.kind,
        color: group.color,
        sortOrder: index,
        children: {
          create: group.children.map((name, childIndex) => ({
            name,
            kind: group.kind,
            color: group.color,
            sortOrder: childIndex,
          })),
        },
      },
    });
    created += 1 + group.children.length;
  }
  return created;
}

export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  Income: "Einnahme",
  Expense: "Ausgabe",
};

export interface CategoryOption {
  id: number;
  name: string;
  kind: CategoryKind;
  parentName: string | null;
  /** `Wohnen › Miete` — what the select shows. */
  label: string;
}

/**
 * Leaf categories for a select, labelled with their group so two categories
 * named "Diverses" stay distinguishable.
 */
export async function categoryOptions(prisma: PrismaClient): Promise<CategoryOption[]> {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parentIdsWithChildren = new Set(
    categories.filter((c) => c.parentId !== null).map((c) => c.parentId)
  );

  return categories
    // A top-level category is only bookable when it has no children of its own.
    .filter((c) => c.parentId !== null || !parentIdsWithChildren.has(c.id))
    .map((category) => {
      const parent = category.parentId ? byId.get(category.parentId) : undefined;
      return {
        id: category.id,
        name: category.name,
        kind: category.kind,
        parentName: parent?.name ?? null,
        label: parent ? `${parent.name} › ${category.name}` : category.name,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "de-CH"));
}
