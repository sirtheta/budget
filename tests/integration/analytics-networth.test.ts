import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { netWorthSeries } from "@/lib/analytics";
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

describe("netWorthSeries", () => {
  it("splits net worth into liquid and illiquid per month", async () => {
    const depot = await prisma.account.create({
      data: { name: "3a", type: "Investment", openingBalanceCents: 200000 },
    });
    await prisma.account.create({
      data: { name: "Durchlaufkonto", type: "Checking", openingBalanceCents: 900000, excludeFromNetWorth: true },
    });

    await prisma.transaction.createMany({
      data: [
        {
          date: "2026-01-15",
          amountCents: 1000,
          accountId: fixtures.account.id,
          categoryId: fixtures.income.id,
          description: "Lohn",
        },
        {
          date: "2026-01-20",
          amountCents: 5000,
          accountId: depot.id,
          description: "Einzahlung 3a",
        },
      ],
    });

    const [point] = await netWorthSeries(prisma, [{ year: 2026, month: 1 }]);

    // Opening balances from seedBasics: Checking 100000 + Savings 500000 (liquid).
    expect(point.liquidCents).toBe(100000 + 500000 + 1000);
    expect(point.illiquidCents).toBe(200000 + 5000);
    expect(point.netWorthCents).toBe(point.liquidCents + point.illiquidCents);
  });
});
