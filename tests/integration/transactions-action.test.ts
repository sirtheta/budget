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
  requireSession: vi.fn(async () => sessionHolder.current),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
  saveTransactionAction,
  saveTransferAction,
  convertToTransferAction,
  deleteTransactionAction,
  saveSplitAction,
  unsplitTransactionAction,
  getSplitPartsAction,
  bulkCategorizeAction,
} from "@/app/(app)/transactions/actions";

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

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

function baseTxFields(overrides: Record<string, string> = {}) {
  return {
    date: "2026-07-01",
    description: "Migros",
    accountId: String(fixtures.account.id),
    categoryId: String(fixtures.groceries.id),
    amount: "42.50",
    direction: "expense",
    ...overrides,
  };
}

describe("saveTransactionAction", () => {
  it("rejects an empty description", async () => {
    const result = await saveTransactionAction(undefined, form(baseTxFields({ description: "" })));
    expect(result.error).toBeTruthy();
  });

  it("requires an account", async () => {
    const result = await saveTransactionAction(undefined, form(baseTxFields({ accountId: "" })));
    expect(result.error).toBe("Bitte ein Konto auswählen.");
  });

  it("rejects a zero amount", async () => {
    const result = await saveTransactionAction(undefined, form(baseTxFields({ amount: "0" })));
    expect(result.error).toBe("Betrag darf nicht 0 sein.");
  });

  it("rejects an unknown category", async () => {
    const result = await saveTransactionAction(
      undefined,
      form(baseTxFields({ categoryId: "999999" }))
    );
    expect(result.error).toBe("Kategorie nicht gefunden.");
  });

  it("rejects an expense booked against an income category", async () => {
    const result = await saveTransactionAction(
      undefined,
      form(baseTxFields({ categoryId: String(fixtures.income.id), direction: "expense" }))
    );
    expect(result.error).toMatch(/Einnahmekategorie/);
  });

  it("rejects income booked against an expense category", async () => {
    const result = await saveTransactionAction(
      undefined,
      form(baseTxFields({ categoryId: String(fixtures.groceries.id), direction: "income" }))
    );
    expect(result.error).toMatch(/Ausgabekategorie/);
  });

  it("creates a transaction and logs an audit entry", async () => {
    const result = await saveTransactionAction(undefined, form(baseTxFields()));
    expect(result).toEqual({ success: true, autoApplied: undefined });
    expect(revalidatePathMock).toHaveBeenCalledWith("/transactions");

    const row = await prisma.transaction.findFirstOrThrow({ where: { description: "Migros" } });
    expect(row.amountCents).toBe(-4250);
    expect(row.source).toBe("Manual");
  });

  it("updates an existing transaction", async () => {
    const row = await prisma.transaction.findFirstOrThrow({ where: { description: "Migros" } });
    const result = await saveTransactionAction(
      undefined,
      form(baseTxFields({ id: String(row.id), description: "Migros (korrigiert)" }))
    );
    expect(result).toEqual({ success: true, autoApplied: undefined });
    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.description).toBe("Migros (korrigiert)");
  });

  it("refuses to edit a transfer leg through the plain form", async () => {
    const [outgoing] = await prisma.$transaction([
      prisma.transaction.create({
        data: {
          date: "2026-07-05",
          amountCents: -1000,
          accountId: fixtures.account.id,
          description: "Manuelles Umbuchungs-Leg",
          transferGroupId: "grp-1",
        },
      }),
    ]);
    const result = await saveTransactionAction(
      undefined,
      form(baseTxFields({ id: String(outgoing.id) }))
    );
    expect(result.error).toMatch(/Umbuchungs-Formular/);
  });

  it("creates a counterparty rule and sweeps matching pending bookings when createRule is checked", async () => {
    await prisma.transaction.create({
      data: {
        date: "2026-07-02",
        amountCents: -1500,
        accountId: fixtures.account.id,
        description: "Coop Kauf",
        counterparty: "Coop Supermarkt",
      },
    });

    const result = await saveTransactionAction(
      undefined,
      form(
        baseTxFields({
          description: "Coop Kauf 2",
          counterparty: "Coop Supermarkt",
          createRule: "on",
        })
      )
    );
    expect(result.success).toBe(true);
    expect(result.autoApplied).toBe(1);

    const rule = await prisma.importRule.findFirstOrThrow({ where: { pattern: "Coop Supermarkt" } });
    expect(rule.categoryId).toBe(fixtures.groceries.id);

    const swept = await prisma.transaction.findFirstOrThrow({ where: { description: "Coop Kauf" } });
    expect(swept.categoryId).toBe(fixtures.groceries.id);
  });
});

describe("saveTransferAction", () => {
  it("requires both accounts", async () => {
    const result = await saveTransferAction(
      undefined,
      form({ date: "2026-07-01", amount: "100", fromAccountId: "", toAccountId: "" })
    );
    expect(result.error).toBe("Bitte Quell- und Zielkonto auswählen.");
  });

  it("creates a transfer between two accounts", async () => {
    const result = await saveTransferAction(
      undefined,
      form({
        date: "2026-07-01",
        amount: "300",
        fromAccountId: String(fixtures.account.id),
        toAccountId: String(fixtures.savings.id),
      })
    );
    expect(result).toEqual({ success: true });

    const legs = await prisma.transaction.findMany({ where: { description: "Umbuchung" } });
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => l.amountCents).sort()).toEqual([-30000, 30000]);
  });

  it("updates an existing transfer by group id", async () => {
    const [leg] = await prisma.transaction.findMany({ where: { description: "Umbuchung" }, take: 1 });
    const result = await saveTransferAction(
      undefined,
      form({
        date: "2026-07-02",
        amount: "350",
        fromAccountId: String(fixtures.account.id),
        toAccountId: String(fixtures.savings.id),
        transferGroupId: leg.transferGroupId!,
      })
    );
    expect(result).toEqual({ success: true });
  });

  it("reports an error instead of throwing when the transfer is invalid", async () => {
    const result = await saveTransferAction(
      undefined,
      form({
        date: "2026-07-01",
        amount: "100",
        fromAccountId: String(fixtures.account.id),
        toAccountId: String(fixtures.account.id),
      })
    );
    expect(result.error).toBeTruthy();
  });
});

describe("convertToTransferAction", () => {
  it("requires a valid target account", async () => {
    const result = await convertToTransferAction(
      undefined,
      form({ id: "1", targetAccountId: "not-a-number" })
    );
    expect(result.error).toBe("Bitte ein Gegenkonto wählen.");
  });

  it("converts a plain booking into a transfer", async () => {
    const row = await prisma.transaction.create({
      data: {
        date: "2026-07-10",
        amountCents: -2000,
        accountId: fixtures.account.id,
        description: "Zur Sparkonto-Einzahlung",
      },
    });
    const result = await convertToTransferAction(
      undefined,
      form({ id: String(row.id), targetAccountId: String(fixtures.savings.id) })
    );
    expect(result).toEqual({ success: true, autoApplied: undefined });
    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.transferGroupId).toBeTruthy();
  });

  it("refuses to convert an already-transferred booking", async () => {
    const [leg] = await prisma.transaction.findMany({ where: { description: "Umbuchung" }, take: 1 });
    const result = await convertToTransferAction(
      undefined,
      form({ id: String(leg.id), targetAccountId: String(fixtures.account.id) })
    );
    expect(result.error).toBe("Buchung ist bereits eine Umbuchung.");
  });
});

describe("deleteTransactionAction", () => {
  it("returns an error for an unknown transaction", async () => {
    const result = await deleteTransactionAction(999999);
    expect(result.error).toBe("Buchung nicht gefunden.");
  });

  it("deletes both legs of a transfer together", async () => {
    const legs = await prisma.transaction.findMany({ where: { description: "Umbuchung" } });
    const result = await deleteTransactionAction(legs[0].id);
    expect(result).toEqual({ success: true });
    const remaining = await prisma.transaction.findMany({
      where: { transferGroupId: legs[0].transferGroupId },
    });
    expect(remaining).toHaveLength(0);
  });

  it("deletes a plain booking", async () => {
    const row = await prisma.transaction.create({
      data: {
        date: "2026-07-11",
        amountCents: -500,
        accountId: fixtures.account.id,
        description: "Löschbar",
      },
    });
    const result = await deleteTransactionAction(row.id);
    expect(result).toEqual({ success: true });
    await expect(prisma.transaction.findUniqueOrThrow({ where: { id: row.id } })).rejects.toBeTruthy();
  });
});

describe("saveSplitAction / unsplitTransactionAction / getSplitPartsAction", () => {
  it("rejects malformed JSON parts", async () => {
    const result = await saveSplitAction(undefined, form({ id: "1", parts: "not-json" }));
    expect(result.error).toBe("Ungültige Aufteilung.");
  });

  it("rejects fewer than two parts", async () => {
    const result = await saveSplitAction(
      undefined,
      form({ id: "1", parts: JSON.stringify([{ categoryId: 1, amountCents: 100 }]) })
    );
    expect(result.error).toBeTruthy();
  });

  it("splits a transaction across two categories, then unsplits it", async () => {
    const salary = await prisma.transaction.create({
      data: {
        date: "2026-07-13",
        amountCents: 500000,
        accountId: fixtures.account.id,
        description: "13. Monatslohn",
      },
    });
    const otherCategory = await prisma.category.create({ data: { name: "Bonus", kind: "Income" } });

    const splitResult = await saveSplitAction(
      undefined,
      form({
        id: String(salary.id),
        parts: JSON.stringify([
          { categoryId: fixtures.income.id, amountCents: 300000 },
          { categoryId: otherCategory.id, amountCents: 200000 },
        ]),
      })
    );
    expect(splitResult).toEqual({ success: true });

    const parts = await prisma.transaction.findMany({
      where: { splitGroupId: { not: null }, date: "2026-07-13" },
    });
    expect(parts).toHaveLength(2);

    const fetchedParts = await getSplitPartsAction(parts[0].splitGroupId!);
    expect(fetchedParts).toHaveLength(2);

    const unsplitResult = await unsplitTransactionAction(parts[0].splitGroupId!);
    expect(unsplitResult).toEqual({ success: true });
    const merged = await prisma.transaction.findMany({ where: { date: "2026-07-13" } });
    expect(merged).toHaveLength(1);
    expect(merged[0].amountCents).toBe(500000);
  });

  it("reports an error instead of throwing for an unknown transaction id", async () => {
    const result = await saveSplitAction(
      undefined,
      form({
        id: "999999",
        parts: JSON.stringify([
          { categoryId: fixtures.groceries.id, amountCents: 100 },
          { categoryId: fixtures.income.id, amountCents: 100 },
        ]),
      })
    );
    expect(result.error).toBeTruthy();
  });
});

describe("bulkCategorizeAction", () => {
  it("returns an error when no ids are given", async () => {
    const result = await bulkCategorizeAction([], fixtures.groceries.id);
    expect(result.error).toBe("Keine Buchungen ausgewählt.");
  });

  it("returns an error for an unknown category", async () => {
    const result = await bulkCategorizeAction([1], 999999);
    expect(result.error).toBe("Kategorie nicht gefunden.");
  });

  it("categorizes only rows whose sign matches the category", async () => {
    const expense = await prisma.transaction.create({
      data: { date: "2026-07-14", amountCents: -1000, accountId: fixtures.account.id, description: "A" },
    });
    const income = await prisma.transaction.create({
      data: { date: "2026-07-14", amountCents: 1000, accountId: fixtures.account.id, description: "B" },
    });

    const result = await bulkCategorizeAction([expense.id, income.id], fixtures.groceries.id);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    expect(result.error).toMatch(/übersprungen/);

    const updatedExpense = await prisma.transaction.findUniqueOrThrow({ where: { id: expense.id } });
    expect(updatedExpense.categoryId).toBe(fixtures.groceries.id);
    const updatedIncome = await prisma.transaction.findUniqueOrThrow({ where: { id: income.id } });
    expect(updatedIncome.categoryId).toBeNull();
  });
});
