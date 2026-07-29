import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_CSV_MAPPINGS, seedDefaultCsvMappings } from "@/lib/import/default-mappings";
import { DEFAULT_IMPORT_RULES, seedDefaultImportRules } from "@/lib/import/default-rules";
import { seedDefaultCategories } from "@/lib/categories";
import { createTestDb } from "./helpers";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
});

afterAll(async () => cleanup());

describe("seedDefaultCsvMappings", () => {
  it("creates every default mapping", async () => {
    const result = await seedDefaultCsvMappings(prisma);
    expect(result).toEqual({ created: DEFAULT_CSV_MAPPINGS.length, skipped: 0 });
    const rows = await prisma.csvMapping.findMany();
    expect(rows.map((r) => r.name).sort()).toEqual(
      [...DEFAULT_CSV_MAPPINGS.map((m) => m.name)].sort()
    );
  });

  it("is idempotent: a second run skips every existing mapping", async () => {
    const result = await seedDefaultCsvMappings(prisma);
    expect(result).toEqual({ created: 0, skipped: DEFAULT_CSV_MAPPINGS.length });
  });

  it("skips only mappings that already exist by name", async () => {
    await prisma.csvMapping.deleteMany();
    await prisma.csvMapping.create({
      data: {
        name: DEFAULT_CSV_MAPPINGS[0].name,
        dateColumn: 0,
        descriptionColumn: 1,
        amountColumn: 2,
      },
    });
    const result = await seedDefaultCsvMappings(prisma);
    expect(result).toEqual({ created: DEFAULT_CSV_MAPPINGS.length - 1, skipped: 1 });
  });
});

describe("seedDefaultImportRules", () => {
  it("skips every rule when the default category tree isn't present", async () => {
    await prisma.category.deleteMany();
    const result = await seedDefaultImportRules(prisma);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(DEFAULT_IMPORT_RULES.length);
  });

  it("creates rules once the matching leaf categories exist", async () => {
    await prisma.importRule.deleteMany();
    await seedDefaultCategories(prisma);
    const result = await seedDefaultImportRules(prisma);
    expect(result.created).toBeGreaterThan(0);
    expect(result.created + result.skipped).toBe(DEFAULT_IMPORT_RULES.length);

    const rule = await prisma.importRule.findFirstOrThrow({ where: { name: "Migros" } });
    expect(rule.priority).toBeGreaterThanOrEqual(100);
  });

  it("is idempotent: a second run skips every rule already present", async () => {
    const result = await seedDefaultImportRules(prisma);
    expect(result.created).toBe(0);
  });

  it("does not duplicate a pattern the user already created by hand", async () => {
    await prisma.importRule.deleteMany();
    const category = await prisma.category.findFirstOrThrow({ where: { name: "Lebensmittel" } });
    await prisma.importRule.create({
      data: { name: "Custom", field: "Counterparty", matchType: "Contains", pattern: "MIGROS", categoryId: category.id },
    });
    const result = await seedDefaultImportRules(prisma);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    const migrosRules = await prisma.importRule.findMany({ where: { pattern: { in: ["migros", "MIGROS"] } } });
    expect(migrosRules).toHaveLength(1);
  });
});
