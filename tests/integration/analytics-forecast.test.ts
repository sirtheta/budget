import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { netWorthForecast } from "@/lib/analytics";
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

describe("netWorthForecast", () => {
  it("reports insufficient data with no booked history", async () => {
    const forecast = await netWorthForecast(prisma, { asOfYear: 2026, asOfMonth: 1 });
    expect(forecast.insufficientData).toBe(true);
    expect(forecast.monthlyGrowthCents).toBe(0);
    expect(forecast.points.every((point) => !point.projected)).toBe(true);
  });

  it("extrapolates the average monthly change over the history window", async () => {
    // Net worth rises by 1000 Rappen each month: Jan, Feb, Mar.
    await prisma.transaction.createMany({
      data: [
        {
          date: "2026-01-15",
          amountCents: 1000,
          accountId: fixtures.account.id,
          categoryId: fixtures.income.id,
          description: "Jan",
        },
        {
          date: "2026-02-15",
          amountCents: 1000,
          accountId: fixtures.account.id,
          categoryId: fixtures.income.id,
          description: "Feb",
        },
        {
          date: "2026-03-15",
          amountCents: 1000,
          accountId: fixtures.account.id,
          categoryId: fixtures.income.id,
          description: "Mar",
        },
      ],
    });

    const forecast = await netWorthForecast(prisma, {
      asOfYear: 2026,
      asOfMonth: 3,
      forecastMonths: 3,
    });

    expect(forecast.insufficientData).toBe(false);
    expect(forecast.monthlyGrowthCents).toBe(1000);
    // 3 history months (Jan–Mar) + 3 projected months (Apr–Jun).
    expect(forecast.points).toHaveLength(6);

    const history = forecast.points.filter((point) => !point.projected);
    const projected = forecast.points.filter((point) => point.projected);
    expect(history).toHaveLength(3);
    expect(projected).toHaveLength(3);

    const lastHistory = history[history.length - 1];
    expect(projected[0].netWorthCents).toBe(lastHistory.netWorthCents + 1000);
    expect(projected[2].netWorthCents).toBe(lastHistory.netWorthCents + 3000);
    expect(projected[2].year).toBe(2026);
    expect(projected[2].month).toBe(6);
  });

  it("clamps the history window to the months actually elapsed since the first booking", async () => {
    // Only 3 months of real transactions exist above, so a 12-month request
    // must not be diluted by 9 flat months before the first booking.
    const forecast = await netWorthForecast(prisma, {
      asOfYear: 2026,
      asOfMonth: 3,
      historyMonths: 12,
    });
    expect(forecast.historyMonths).toBe(3);
    expect(forecast.monthlyGrowthCents).toBe(1000);
  });
});
