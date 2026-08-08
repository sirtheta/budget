import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  dueRecurring,
  pendingSuggestions,
  postDueRecurring,
  upcomingRecurring,
} from "@/lib/recurring";
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

async function makeRecurring(overrides: Record<string, unknown> = {}) {
  return prisma.recurringTransaction.create({
    data: {
      name: "Miete",
      amountCents: -185000,
      accountId: fixtures.account.id,
      categoryId: fixtures.groceries.id,
      intervalMonths: 1,
      startDate: "2026-01-01",
      nextDate: "2026-01-01",
      ...overrides,
    },
  });
}

describe("dueRecurring", () => {
  it("selects only active, auto-posting entries that have come due", async () => {
    const rows = [
      { id: 1, isActive: true, autoPost: true, nextDate: "2026-01-01", endDate: null },
      { id: 2, isActive: true, autoPost: true, nextDate: "2026-03-01", endDate: null },
      { id: 3, isActive: false, autoPost: true, nextDate: "2026-01-01", endDate: null },
      { id: 4, isActive: true, autoPost: false, nextDate: "2026-01-01", endDate: null },
    ] as Parameters<typeof dueRecurring>[0];

    expect(dueRecurring(rows, "2026-02-01").map((r) => r.id)).toEqual([1]);
    expect(pendingSuggestions(rows, "2026-02-01").map((r) => r.id)).toEqual([4]);
  });
});

describe("upcomingRecurring", () => {
  it("takes the next 30 days, skipping what is already due or ended", async () => {
    const rows = [
      { id: 1, name: "Miete", isActive: true, nextDate: "2026-02-05", endDate: null },
      { id: 2, name: "Serafe", isActive: true, nextDate: "2026-02-20", endDate: null },
      // Already due — posted or waiting as a suggestion, not "coming up".
      { id: 3, name: "Alt", isActive: true, nextDate: "2026-02-01", endDate: null },
      // Beyond the horizon.
      { id: 4, name: "Steuern", isActive: true, nextDate: "2026-04-01", endDate: null },
      { id: 5, name: "Inaktiv", isActive: false, nextDate: "2026-02-06", endDate: null },
      { id: 6, name: "Ausgelaufen", isActive: true, nextDate: "2026-02-07", endDate: "2026-01-31" },
    ] as Parameters<typeof upcomingRecurring>[0];

    expect(upcomingRecurring(rows, "2026-02-01", 30).map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("postDueRecurring", () => {
  it("posts one occurrence and advances the schedule", async () => {
    const row = await makeRecurring({ name: "Einmal" });
    const result = await postDueRecurring(prisma, "2026-01-15");

    expect(result.postedCount).toBe(1);
    const posted = await prisma.transaction.findMany({ where: { recurringId: row.id } });
    expect(posted).toHaveLength(1);
    expect(posted[0].date).toBe("2026-01-01");
    expect(posted[0].amountCents).toBe(-185000);
    expect(posted[0].source).toBe("Recurring");

    const updated = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.nextDate).toBe("2026-02-01");
  });

  it("is a no-op when run again before the next date", async () => {
    const result = await postDueRecurring(prisma, "2026-01-20");
    expect(result.postedCount).toBe(0);
  });

  it("catches up every occurrence missed while the app was down", async () => {
    await prisma.recurringTransaction.deleteMany();
    await prisma.transaction.deleteMany();
    const row = await makeRecurring({ name: "Nachholen" });

    // Three months later: January, February and March are all due.
    const result = await postDueRecurring(prisma, "2026-03-15");
    expect(result.postedCount).toBe(3);

    const posted = await prisma.transaction.findMany({
      where: { recurringId: row.id },
      orderBy: { date: "asc" },
    });
    expect(posted.map((p) => p.date)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);

    const updated = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.nextDate).toBe("2026-04-01");
  });

  it("stops at the end date and retires the entry", async () => {
    await prisma.recurringTransaction.deleteMany();
    await prisma.transaction.deleteMany();
    const row = await makeRecurring({ name: "Befristet", endDate: "2026-02-15" });

    const result = await postDueRecurring(prisma, "2026-06-01");
    // January and February fall inside the window; March does not.
    expect(result.postedCount).toBe(2);

    const updated = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.isActive).toBe(false);
  });

  it("respects a quarterly interval", async () => {
    await prisma.recurringTransaction.deleteMany();
    await prisma.transaction.deleteMany();
    const row = await makeRecurring({ name: "Quartal", intervalMonths: 3 });

    const result = await postDueRecurring(prisma, "2026-08-01");
    expect(result.postedCount).toBe(3); // Jan, Apr, Jul

    const updated = await prisma.recurringTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.nextDate).toBe("2026-10-01");
  });

  it("clamps a month-end schedule instead of drifting into the next month", async () => {
    await prisma.recurringTransaction.deleteMany();
    await prisma.transaction.deleteMany();
    const row = await makeRecurring({
      name: "Monatsende",
      startDate: "2026-01-31",
      nextDate: "2026-01-31",
    });

    await postDueRecurring(prisma, "2026-02-28");
    const posted = await prisma.transaction.findMany({
      where: { recurringId: row.id },
      orderBy: { date: "asc" },
    });
    // 31.01. + 1 month clamps to 28.02. rather than rolling over to 03.03.
    expect(posted.map((p) => p.date)).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("creates both legs when a counter account makes it a transfer", async () => {
    await prisma.recurringTransaction.deleteMany();
    await prisma.transaction.deleteMany();
    await makeRecurring({
      name: "Dauerauftrag Sparen",
      amountCents: 70000,
      categoryId: null,
      counterAccountId: fixtures.savings.id,
    });

    await postDueRecurring(prisma, "2026-01-15");
    const legs = await prisma.transaction.findMany({
      where: { transferGroupId: { not: null } },
      orderBy: { amountCents: "asc" },
    });
    expect(legs).toHaveLength(2);
    expect(legs[0].accountId).toBe(fixtures.account.id);
    expect(legs[0].amountCents).toBe(-70000);
    expect(legs[1].accountId).toBe(fixtures.savings.id);
    expect(legs[1].amountCents).toBe(70000);
    expect(legs.every((leg) => leg.source === "Recurring")).toBe(true);
  });

  it("never posts an entry marked as suggestion-only", async () => {
    await prisma.recurringTransaction.deleteMany();
    await prisma.transaction.deleteMany();
    await makeRecurring({ name: "Nur Vorschlag", autoPost: false });

    const result = await postDueRecurring(prisma, "2026-06-01");
    expect(result.postedCount).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });
});
