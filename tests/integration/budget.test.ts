import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { budgetStatus, copyBudgets, loadBudgetMonth } from "@/lib/budget";
import { createTransfer } from "@/lib/transactions";
import { createTestDb, seedBasics } from "./helpers";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let fixtures: Awaited<ReturnType<typeof seedBasics>>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  fixtures = await seedBasics(prisma);

  await prisma.budget.createMany({
    data: [
      { categoryId: fixtures.groceries.id, year: 2026, month: 1, amountCents: 60000 },
      { categoryId: fixtures.income.id, year: 2026, month: 1, amountCents: 680000 },
    ],
  });

  await prisma.transaction.createMany({
    data: [
      {
        date: "2026-01-05",
        amountCents: -20000,
        accountId: fixtures.account.id,
        categoryId: fixtures.groceries.id,
        description: "Migros",
      },
      {
        date: "2026-01-19",
        amountCents: -35000,
        accountId: fixtures.account.id,
        categoryId: fixtures.groceries.id,
        description: "Coop",
      },
      {
        date: "2026-01-25",
        amountCents: 680000,
        accountId: fixtures.account.id,
        categoryId: fixtures.income.id,
        description: "Lohn",
      },
      // Outside the month — must not be counted.
      {
        date: "2026-02-02",
        amountCents: -99900,
        accountId: fixtures.account.id,
        categoryId: fixtures.groceries.id,
        description: "Februar",
      },
      // Uncategorised — reported separately, not inside any line.
      {
        date: "2026-01-12",
        amountCents: -4500,
        accountId: fixtures.account.id,
        description: "Unbekannt",
      },
    ],
  });
});

afterAll(async () => cleanup());

describe("budgetStatus", () => {
  it("classifies by share of the planned amount", () => {
    expect(budgetStatus(0, 5000)).toBe("unbudgeted");
    expect(budgetStatus(10000, 5000)).toBe("ok");
    expect(budgetStatus(10000, 8999)).toBe("ok");
    expect(budgetStatus(10000, 9000)).toBe("warning");
    // Exactly on budget is exhausted but not exceeded — still a warning.
    expect(budgetStatus(10000, 10000)).toBe("warning");
    expect(budgetStatus(10000, 10001)).toBe("over");
  });
});

describe("loadBudgetMonth", () => {
  it("reports expenses as positive magnitudes against the plan", async () => {
    const result = await loadBudgetMonth(prisma, 2026, 1);
    const groceries = result.groups
      .flatMap((group) => group.lines)
      .find((line) => line.categoryId === fixtures.groceries.id)!;

    expect(groceries.plannedCents).toBe(60000);
    expect(groceries.actualCents).toBe(55000);
    expect(groceries.remainingCents).toBe(5000);
    expect(groceries.status).toBe("warning");
    expect(groceries.transactionCount).toBe(2);
  });

  it("keeps income positive", async () => {
    const result = await loadBudgetMonth(prisma, 2026, 1);
    const income = result.groups
      .flatMap((group) => group.lines)
      .find((line) => line.categoryId === fixtures.income.id)!;
    expect(income.actualCents).toBe(680000);
  });

  it("reports uncategorised bookings separately", async () => {
    const result = await loadBudgetMonth(prisma, 2026, 1);
    expect(result.totals.uncategorizedCount).toBe(1);
    expect(result.totals.uncategorizedCents).toBe(-4500);
  });

  it("computes month totals", async () => {
    const result = await loadBudgetMonth(prisma, 2026, 1);
    expect(result.totals.actualIncomeCents).toBe(680000);
    expect(result.totals.actualExpenseCents).toBe(55000);
    expect(result.totals.actualBalanceCents).toBe(625000);
    expect(result.totals.plannedBalanceCents).toBe(620000);
  });

  it("ignores bookings from other months", async () => {
    const february = await loadBudgetMonth(prisma, 2026, 2);
    const groceries = february.groups
      .flatMap((group) => group.lines)
      .find((line) => line.categoryId === fixtures.groceries.id)!;
    expect(groceries.actualCents).toBe(99900);
    expect(groceries.plannedCents).toBe(0);
    expect(groceries.status).toBe("unbudgeted");
  });

  it("leaves transfers out of the evaluation entirely", async () => {
    const before = await loadBudgetMonth(prisma, 2026, 1);
    await createTransfer(prisma, {
      fromAccountId: fixtures.account.id,
      toAccountId: fixtures.savings.id,
      date: "2026-01-26",
      amountCents: 70000,
      description: "Dauerauftrag Sparen",
    });
    const after = await loadBudgetMonth(prisma, 2026, 1);

    expect(after.totals.actualExpenseCents).toBe(before.totals.actualExpenseCents);
    expect(after.totals.uncategorizedCount).toBe(before.totals.uncategorizedCount);
  });

  it("excludes accounts flagged excludeFromBudget", async () => {
    const depot = await prisma.account.create({
      data: { name: "Depot", type: "Investment", excludeFromBudget: true },
    });
    await prisma.transaction.create({
      data: {
        date: "2026-01-20",
        amountCents: -500000,
        accountId: depot.id,
        categoryId: fixtures.groceries.id,
        description: "Wertschriftenkauf",
      },
    });

    const result = await loadBudgetMonth(prisma, 2026, 1);
    const groceries = result.groups
      .flatMap((group) => group.lines)
      .find((line) => line.categoryId === fixtures.groceries.id)!;
    expect(groceries.actualCents).toBe(55000);
  });
});

describe("copyBudgets", () => {
  it("carries budgets forward without touching existing ones", async () => {
    await prisma.budget.create({
      data: { categoryId: fixtures.groceries.id, year: 2026, month: 3, amountCents: 11111 },
    });

    const copied = await copyBudgets(prisma, { year: 2026, month: 1 }, { year: 2026, month: 3 });

    // Income copied; groceries already had a budget and was left alone.
    expect(copied).toBe(1);
    const groceries = await prisma.budget.findFirst({
      where: { categoryId: fixtures.groceries.id, year: 2026, month: 3 },
    });
    expect(groceries?.amountCents).toBe(11111);
  });

  it("overwrites when asked to", async () => {
    const copied = await copyBudgets(
      prisma,
      { year: 2026, month: 1 },
      { year: 2026, month: 3 },
      { overwrite: true }
    );
    expect(copied).toBe(1);
    const groceries = await prisma.budget.findFirst({
      where: { categoryId: fixtures.groceries.id, year: 2026, month: 3 },
    });
    expect(groceries?.amountCents).toBe(60000);
  });
});
