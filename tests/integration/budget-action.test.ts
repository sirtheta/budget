import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestDb, seedBasics } from "./helpers";

const { prismaHolder, sessionHolder, revalidatePathMock } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sessionHolder: { current: { user: { id: "1", role: "Editor", name: "Editor", email: "e@test.ch" } } },
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => sessionHolder.current),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { setBudgetAction, copyPreviousMonthAction } from "@/app/(app)/budget/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let fixtures: Awaited<ReturnType<typeof seedBasics>>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
  fixtures = await seedBasics(prisma);
  const editor = await prisma.user.create({
    data: { email: "e@test.ch", name: "Editor", passwordHash: "x", role: "Editor" },
  });
  sessionHolder.current = {
    user: { id: String(editor.id), role: "Editor", name: "Editor", email: "e@test.ch" },
  };
});

afterAll(async () => cleanup());

afterEach(() => {
  revalidatePathMock.mockClear();
});

describe("setBudgetAction", () => {
  it("rejects an out-of-range month", async () => {
    const result = await setBudgetAction(fixtures.groceries.id, 2026, 13, "100");
    expect(result.error).toBe("Ungültiger Monat.");
  });

  // A Server Action is a POST endpoint and its parameter types are erased, so
  // nothing stops a caller from sending these. Each of them used to be written
  // straight through into a Budget row that no month view could address again.
  describe("rejects arguments a caller could forge", () => {
    const cases: [string, Parameters<typeof setBudgetAction>, string][] = [
      ["a fractional month", [1, 2026, 1.5, "100"], "Ungültiger Monat."],
      ["a zero month", [1, 2026, 0, "100"], "Ungültiger Monat."],
      ["a NaN month", [1, 2026, NaN, "100"], "Ungültiger Monat."],
      ["a fractional year", [1, 2026.5, 1, "100"], "Ungültiges Jahr."],
      ["a year below four digits", [1, 999, 1, "100"], "Ungültiges Jahr."],
      ["a year above four digits", [1, 10_000, 1, "100"], "Ungültiges Jahr."],
      ["a NaN year", [1, NaN, 1, "100"], "Ungültiges Jahr."],
      ["a negative category id", [-1, 2026, 1, "100"], "Ungültige Kategorie."],
      ["a fractional category id", [1.5, 2026, 1, "100"], "Ungültige Kategorie."],
    ];

    for (const [name, args, message] of cases) {
      it(name, async () => {
        expect((await setBudgetAction(...args)).error).toBe(message);
        expect(await prisma.budget.count({ where: { categoryId: args[0] } })).toBe(0);
      });
    }
  });

  it("rejects a non-numeric amount", async () => {
    const result = await setBudgetAction(fixtures.groceries.id, 2026, 1, "abc");
    expect(result.error).toBeTruthy();
  });

  it("rejects a negative amount", async () => {
    const result = await setBudgetAction(fixtures.groceries.id, 2026, 1, "-10");
    expect(result.error).toBe("Budgetbeträge sind immer positiv.");
  });

  it("rejects an unknown category", async () => {
    const result = await setBudgetAction(999999, 2026, 1, "100");
    expect(result.error).toBe("Kategorie nicht gefunden.");
  });

  it("creates a budget row and logs an audit entry", async () => {
    const result = await setBudgetAction(fixtures.groceries.id, 2026, 1, "600.00");
    expect(result).toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/budget");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");

    const row = await prisma.budget.findUniqueOrThrow({
      where: { categoryId_year_month: { categoryId: fixtures.groceries.id, year: 2026, month: 1 } },
    });
    expect(row.amountCents).toBe(60000);
  });

  it("updates an existing budget row instead of duplicating it", async () => {
    await setBudgetAction(fixtures.groceries.id, 2026, 1, "700");
    const row = await prisma.budget.findUniqueOrThrow({
      where: { categoryId_year_month: { categoryId: fixtures.groceries.id, year: 2026, month: 1 } },
    });
    expect(row.amountCents).toBe(70000);
  });

  it("removes the row instead of storing a zero when the amount is cleared", async () => {
    await setBudgetAction(fixtures.groceries.id, 2026, 1, "");
    const row = await prisma.budget.findUnique({
      where: { categoryId_year_month: { categoryId: fixtures.groceries.id, year: 2026, month: 1 } },
    });
    expect(row).toBeNull();
  });
});

describe("copyPreviousMonthAction", () => {
  it("copies budgets from the prior month and logs an audit entry", async () => {
    await prisma.budget.create({
      data: { categoryId: fixtures.groceries.id, year: 2026, month: 2, amountCents: 55000 },
    });

    const result = await copyPreviousMonthAction(2026, 3);

    expect(result.success).toBe(true);
    expect(result.copied).toBeGreaterThan(0);
    const row = await prisma.budget.findUniqueOrThrow({
      where: { categoryId_year_month: { categoryId: fixtures.groceries.id, year: 2026, month: 3 } },
    });
    expect(row.amountCents).toBe(55000);

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Budget", details: { contains: "copyPreviousMonth" } },
    });
    expect(audit).toBeTruthy();
  });

  it("rolls December of the previous year forward into January", async () => {
    await prisma.budget.create({
      data: { categoryId: fixtures.groceries.id, year: 2025, month: 12, amountCents: 12000 },
    });
    const result = await copyPreviousMonthAction(2026, 1, true);
    expect(result.success).toBe(true);
    const row = await prisma.budget.findUniqueOrThrow({
      where: { categoryId_year_month: { categoryId: fixtures.groceries.id, year: 2026, month: 1 } },
    });
    expect(row.amountCents).toBe(12000);
  });

  it("rejects an out-of-range month before copying anything", async () => {
    const before = await prisma.budget.count();

    expect((await copyPreviousMonthAction(2026, 13)).error).toBe("Ungültiger Monat.");

    expect(await prisma.budget.count()).toBe(before);
  });

  it("rejects a year the date format cannot represent", async () => {
    const before = await prisma.budget.count();

    expect((await copyPreviousMonthAction(99_999, 1)).error).toBe("Ungültiges Jahr.");

    expect(await prisma.budget.count()).toBe(before);
  });

  it("rejects NaN rather than deriving a source month from it", async () => {
    // year * 12 + (month - 1) - 1 on NaN yields NaN, which Math.floor happily
    // passes on into a Budget row.
    const before = await prisma.budget.count();

    expect((await copyPreviousMonthAction(NaN, NaN)).error).toBeTruthy();

    expect(await prisma.budget.count()).toBe(before);
  });
});
