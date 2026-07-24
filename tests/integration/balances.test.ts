import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { accountBalance, accountBalances, balanceAsOf, netWorthCents } from "@/lib/balances";
import { createTransfer, deleteTransfer } from "@/lib/transactions";
import { createTestDb, seedBasics } from "./helpers";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let fixtures: Awaited<ReturnType<typeof seedBasics>>;

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  fixtures = await seedBasics(prisma);
});

afterAll(async () => cleanup());

describe("account balances", () => {
  it("starts at the opening balance", async () => {
    expect(await accountBalance(prisma, fixtures.account.id)).toBe(100000);
  });

  it("adds signed transactions to the opening balance", async () => {
    await prisma.transaction.createMany({
      data: [
        {
          date: "2026-01-05",
          amountCents: -8240,
          accountId: fixtures.account.id,
          categoryId: fixtures.groceries.id,
          description: "Migros",
        },
        {
          date: "2026-01-25",
          amountCents: 680000,
          accountId: fixtures.account.id,
          categoryId: fixtures.income.id,
          description: "Lohn",
        },
      ],
    });
    expect(await accountBalance(prisma, fixtures.account.id)).toBe(100000 - 8240 + 680000);
  });

  it("reports a balance as of a past date, ignoring later bookings", async () => {
    expect(await balanceAsOf(prisma, fixtures.account.id, "2026-01-10")).toBe(100000 - 8240);
  });

  it("returns null for an unknown account rather than 0", async () => {
    expect(await accountBalance(prisma, 99_999)).toBeNull();
  });
});

describe("transfers", () => {
  it("moves money without changing net worth", async () => {
    const before = netWorthCents(await accountBalances(prisma));

    await createTransfer(prisma, {
      fromAccountId: fixtures.account.id,
      toAccountId: fixtures.savings.id,
      date: "2026-01-26",
      amountCents: 70000,
      description: "Dauerauftrag Sparen",
    });

    const balances = await accountBalances(prisma);
    expect(netWorthCents(balances)).toBe(before);
    expect(balances.find((a) => a.id === fixtures.savings.id)?.balanceCents).toBe(570000);
  });

  it("writes exactly two linked legs with opposite signs and no category", async () => {
    const legs = await prisma.transaction.findMany({
      where: { transferGroupId: { not: null } },
      orderBy: { amountCents: "asc" },
    });
    expect(legs).toHaveLength(2);
    expect(legs[0].amountCents).toBe(-70000);
    expect(legs[1].amountCents).toBe(70000);
    expect(legs[0].transferGroupId).toBe(legs[1].transferGroupId);
    expect(legs.every((leg) => leg.categoryId === null)).toBe(true);
  });

  it("normalises a negative input to a magnitude", async () => {
    const [outgoing] = await createTransfer(prisma, {
      fromAccountId: fixtures.account.id,
      toAccountId: fixtures.savings.id,
      date: "2026-02-26",
      amountCents: -5000,
      description: "Sparen",
    });
    expect(outgoing.amountCents).toBe(-5000);
    await deleteTransfer(prisma, outgoing.transferGroupId!);
  });

  it("refuses a transfer to the same account", async () => {
    await expect(
      createTransfer(prisma, {
        fromAccountId: fixtures.account.id,
        toAccountId: fixtures.account.id,
        date: "2026-01-26",
        amountCents: 100,
        description: "Unsinn",
      })
    ).rejects.toThrow(/unterschiedlich/);
  });

  it("refuses a zero-amount transfer", async () => {
    await expect(
      createTransfer(prisma, {
        fromAccountId: fixtures.account.id,
        toAccountId: fixtures.savings.id,
        date: "2026-01-26",
        amountCents: 0,
        description: "Nichts",
      })
    ).rejects.toThrow(/nicht 0/);
  });

  it("deletes both legs together", async () => {
    const [outgoing] = await createTransfer(prisma, {
      fromAccountId: fixtures.account.id,
      toAccountId: fixtures.savings.id,
      date: "2026-03-01",
      amountCents: 12345,
      description: "Test",
    });
    const removed = await deleteTransfer(prisma, outgoing.transferGroupId!);
    expect(removed).toBe(2);
  });
});
