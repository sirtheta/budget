import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { seedDefaultCategories, categoryOptions, DEFAULT_CATEGORIES } from "@/lib/categories";
import { createTestDb } from "./helpers";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
});

afterAll(async () => cleanup());

describe("seedDefaultCategories", () => {
  it("creates every default group with its children", async () => {
    const created = await seedDefaultCategories(prisma);
    const expectedCount = DEFAULT_CATEGORIES.reduce((sum, g) => sum + 1 + g.children.length, 0);
    expect(created).toBe(expectedCount);

    const top = await prisma.category.findMany({ where: { parentId: null } });
    expect(top.map((c) => c.name).sort()).toEqual(
      [...DEFAULT_CATEGORIES.map((g) => g.name)].sort()
    );
  });

  it("is idempotent: a second run skips existing groups", async () => {
    const created = await seedDefaultCategories(prisma);
    expect(created).toBe(0);
    const top = await prisma.category.findMany({ where: { parentId: null } });
    expect(top).toHaveLength(DEFAULT_CATEGORIES.length);
  });

  it("only skips groups that already exist by name, not the whole seed", async () => {
    await prisma.category.deleteMany();
    // Pre-create just the first group so the rest still need seeding.
    await prisma.category.create({
      data: { name: DEFAULT_CATEGORIES[0].name, kind: DEFAULT_CATEGORIES[0].kind },
    });
    const created = await seedDefaultCategories(prisma);
    const expectedRest = DEFAULT_CATEGORIES.slice(1).reduce((sum, g) => sum + 1 + g.children.length, 0);
    expect(created).toBe(expectedRest);
  });
});

describe("categoryOptions", () => {
  beforeAll(async () => {
    await prisma.category.deleteMany();
  });

  it("labels leaf categories with their parent group, and excludes parents that have children", async () => {
    const wohnen = await prisma.category.create({ data: { name: "Wohnen", kind: "Expense" } });
    await prisma.category.create({
      data: { name: "Miete", kind: "Expense", parentId: wohnen.id },
    });
    // A top-level category with no children of its own is directly bookable.
    await prisma.category.create({ data: { name: "Diverses", kind: "Expense" } });

    const options = await categoryOptions(prisma);
    const labels = options.map((o) => o.label);

    expect(labels).toContain("Wohnen › Miete");
    expect(labels).toContain("Diverses");
    // The "Wohnen" group itself is not bookable now that it has a child.
    expect(labels).not.toContain("Wohnen");
  });

  it("excludes inactive categories", async () => {
    await prisma.category.deleteMany();
    await prisma.category.create({ data: { name: "Alt", kind: "Expense", isActive: false } });
    expect(await categoryOptions(prisma)).toHaveLength(0);
  });

  it("sorts options by their display label", async () => {
    await prisma.category.deleteMany();
    await prisma.category.create({ data: { name: "Zoo", kind: "Expense" } });
    await prisma.category.create({ data: { name: "Auto", kind: "Expense" } });
    const options = await categoryOptions(prisma);
    expect(options.map((o) => o.name)).toEqual(["Auto", "Zoo"]);
  });
});
