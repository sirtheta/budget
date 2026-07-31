import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { isSplit, mergeSplit, splitTransaction } from "@/lib/transactions";
import { createTestDb, seedBasics } from "./helpers";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let fixtures: Awaited<ReturnType<typeof seedBasics>>;
let bonus: { id: number };

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  fixtures = await seedBasics(prisma);
  bonus = await prisma.category.create({ data: { name: "Bonus", kind: "Income" } });
});

afterAll(async () => cleanup());

describe("splitTransaction", () => {
  it("splits a single booking into several categorised parts sharing a splitGroupId", async () => {
    const imported = await prisma.transaction.create({
      data: {
        date: "2026-11-25",
        amountCents: 800000,
        accountId: fixtures.account.id,
        description: "13. Monatslohn",
        source: "Import",
        importHash: "test-hash-13th-salary",
      },
    });

    const { splitGroupId } = await splitTransaction(prisma, imported.id, [
      { categoryId: fixtures.income.id, amountCents: 600000 },
      { categoryId: bonus.id, amountCents: 200000 },
    ]);

    const parts = await prisma.transaction.findMany({
      where: { splitGroupId },
      orderBy: { id: "asc" },
    });
    expect(parts).toHaveLength(2);
    expect(parts.reduce((sum, p) => sum + p.amountCents, 0)).toBe(800000);
    expect(parts[0]).toMatchObject({
      categoryId: fixtures.income.id,
      amountCents: 600000,
      date: "2026-11-25",
      description: "13. Monatslohn",
      importHash: "test-hash-13th-salary",
    });
    expect(parts[1]).toMatchObject({ categoryId: bonus.id, amountCents: 200000, importHash: null });
    expect(parts.every((p) => isSplit(p))).toBe(true);

    // The original row is gone, replaced by the parts.
    expect(await prisma.transaction.findUnique({ where: { id: imported.id } })).toBeNull();
  });

  it("splits an expense the same way, with negative amounts", async () => {
    const shop = await prisma.category.create({ data: { name: "Kleider", kind: "Expense" } });
    const booking = await prisma.transaction.create({
      data: {
        date: "2026-11-10",
        amountCents: -15000,
        accountId: fixtures.account.id,
        description: "Sammelrechnung",
      },
    });

    const { splitGroupId } = await splitTransaction(prisma, booking.id, [
      { categoryId: fixtures.groceries.id, amountCents: 10000 },
      { categoryId: shop.id, amountCents: 5000 },
    ]);

    const parts = await prisma.transaction.findMany({ where: { splitGroupId } });
    expect(parts.reduce((sum, p) => sum + p.amountCents, 0)).toBe(-15000);
    expect(parts.every((p) => p.amountCents < 0)).toBe(true);
  });

  it("rejects parts that don't sum to the original amount", async () => {
    const booking = await prisma.transaction.create({
      data: {
        date: "2026-11-10",
        amountCents: 10000,
        accountId: fixtures.account.id,
        description: "Zu wenig aufgeteilt",
      },
    });

    await expect(
      splitTransaction(prisma, booking.id, [
        { categoryId: fixtures.income.id, amountCents: 6000 },
        { categoryId: bonus.id, amountCents: 3000 },
      ])
    ).rejects.toThrow(/Summe/);

    // Untouched on failure.
    expect(await prisma.transaction.findUnique({ where: { id: booking.id } })).not.toBeNull();
  });

  it("rejects a category whose kind contradicts the booking's direction", async () => {
    const booking = await prisma.transaction.create({
      data: {
        date: "2026-11-10",
        amountCents: 10000,
        accountId: fixtures.account.id,
        description: "Einnahme",
      },
    });

    await expect(
      splitTransaction(prisma, booking.id, [
        { categoryId: fixtures.income.id, amountCents: 5000 },
        { categoryId: fixtures.groceries.id, amountCents: 5000 },
      ])
    ).rejects.toThrow(/Einnahmekategorie/);
  });

  it("refuses to split a transfer leg", async () => {
    const [outgoing] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          date: "2026-11-10",
          amountCents: -5000,
          accountId: fixtures.account.id,
          description: "Umbuchung",
          transferGroupId: "test-transfer-group",
        },
      }),
      prisma.transaction.create({
        data: {
          date: "2026-11-10",
          amountCents: 5000,
          accountId: fixtures.savings.id,
          description: "Umbuchung",
          transferGroupId: "test-transfer-group",
        },
      }),
    ]);

    await expect(
      splitTransaction(prisma, outgoing.id, [
        { categoryId: fixtures.income.id, amountCents: 2500 },
        { categoryId: bonus.id, amountCents: 2500 },
      ])
    ).rejects.toThrow(/Umbuchungen/);
  });

  it("re-splitting an already-split booking replaces the existing parts", async () => {
    const booking = await prisma.transaction.create({
      data: {
        date: "2026-12-01",
        amountCents: 90000,
        accountId: fixtures.account.id,
        description: "Neu aufteilen",
      },
    });
    const first = await splitTransaction(prisma, booking.id, [
      { categoryId: fixtures.income.id, amountCents: 60000 },
      { categoryId: bonus.id, amountCents: 30000 },
    ]);
    const anyPart = await prisma.transaction.findFirstOrThrow({
      where: { splitGroupId: first.splitGroupId },
    });

    const second = await splitTransaction(prisma, anyPart.id, [
      { categoryId: fixtures.income.id, amountCents: 30000 },
      { categoryId: bonus.id, amountCents: 60000 },
    ]);

    expect(second.splitGroupId).not.toBe(first.splitGroupId);
    expect(await prisma.transaction.count({ where: { splitGroupId: first.splitGroupId } })).toBe(0);
    const parts = await prisma.transaction.findMany({ where: { splitGroupId: second.splitGroupId } });
    expect(parts).toHaveLength(2);
    expect(parts.reduce((sum, p) => sum + p.amountCents, 0)).toBe(90000);
  });
});

describe("mergeSplit", () => {
  it("collapses a split group back into one uncategorised booking", async () => {
    const booking = await prisma.transaction.create({
      data: {
        date: "2026-12-05",
        amountCents: 500000,
        accountId: fixtures.account.id,
        description: "Wird zusammengeführt",
        importHash: "test-hash-merge",
      },
    });
    const { splitGroupId } = await splitTransaction(prisma, booking.id, [
      { categoryId: fixtures.income.id, amountCents: 300000 },
      { categoryId: bonus.id, amountCents: 200000 },
    ]);

    const merged = await mergeSplit(prisma, splitGroupId);

    expect(merged.amountCents).toBe(500000);
    expect(merged.categoryId).toBeNull();
    expect(merged.splitGroupId).toBeNull();
    expect(merged.importHash).toBe("test-hash-merge");
    expect(await prisma.transaction.count({ where: { splitGroupId } })).toBe(0);
  });
});
