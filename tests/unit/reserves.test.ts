import { describe, expect, it } from "vitest";
import type { Reserve, SavingsGoal } from "@prisma/client";
import {
  goalStatus,
  monthlyRateCents,
  monthsUntilDue,
  reserveStatus,
  settleReserve,
  totalMonthlyReserveCents,
} from "@/lib/reserves";

function reserve(overrides: Partial<Reserve> = {}): Reserve {
  return {
    id: 1,
    name: "Krankenkasse",
    targetAmountCents: 120000,
    intervalMonths: 12,
    nextDueDate: "2026-12-31",
    savedCents: 0,
    categoryId: null,
    accountId: null,
    isActive: true,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: 1,
    name: "Ferien",
    targetAmountCents: 400000,
    savedCents: 100000,
    targetDate: "2026-07-01",
    accountId: null,
    color: null,
    isActive: true,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("monthsUntilDue", () => {
  it("counts whole months ahead", () => {
    expect(monthsUntilDue("2026-01-01", "2026-12-31")).toBe(11);
  });

  it("floors at zero for a due date this month or in the past", () => {
    expect(monthsUntilDue("2026-12-01", "2026-12-31")).toBe(0);
    expect(monthsUntilDue("2027-01-01", "2026-12-31")).toBe(0);
  });
});

describe("monthlyRateCents", () => {
  it("spreads the outstanding amount over the remaining months", () => {
    // 1200.00 due in 12 months → 100.00 a month.
    expect(monthlyRateCents(reserve({ nextDueDate: "2027-01-01" }), "2026-01-01")).toBe(10000);
  });

  it("only spreads what is still missing", () => {
    expect(
      monthlyRateCents(reserve({ savedCents: 60000, nextDueDate: "2026-07-01" }), "2026-01-01")
    ).toBe(10000);
  });

  it("rounds up, so the pot is never short at the due date", () => {
    expect(
      monthlyRateCents(reserve({ targetAmountCents: 100, nextDueDate: "2026-04-01" }), "2026-01-01")
    ).toBe(34);
  });

  it("demands the full amount at once once the due date has arrived", () => {
    expect(monthlyRateCents(reserve({ nextDueDate: "2026-01-15" }), "2026-01-20")).toBe(120000);
  });

  it("is zero once fully funded", () => {
    expect(monthlyRateCents(reserve({ savedCents: 120000 }), "2026-01-01")).toBe(0);
    expect(monthlyRateCents(reserve({ savedCents: 130000 }), "2026-01-01")).toBe(0);
  });
});

describe("reserveStatus", () => {
  it("flags a reserve that is due and underfunded", () => {
    const status = reserveStatus(reserve({ nextDueDate: "2026-01-01", savedCents: 50000 }), "2026-01-15");
    expect(status.isDue).toBe(true);
    expect(status.isShort).toBe(true);
    expect(status.missingCents).toBe(70000);
  });

  it("does not flag a due reserve that is fully funded", () => {
    const status = reserveStatus(
      reserve({ nextDueDate: "2026-01-01", savedCents: 120000 }),
      "2026-01-15"
    );
    expect(status.isDue).toBe(true);
    expect(status.isShort).toBe(false);
  });

  it("caps progress at 1 even when over-funded", () => {
    expect(reserveStatus(reserve({ savedCents: 200000 }), "2026-01-01").progress).toBe(1);
  });
});

describe("settleReserve", () => {
  it("consumes the pot and moves the due date one interval on", () => {
    const result = settleReserve(reserve({ savedCents: 120000, nextDueDate: "2026-01-15" }));
    expect(result.savedCents).toBe(0);
    expect(result.nextDueDate).toBe("2027-01-15");
  });

  it("carries a surplus into the next period instead of dropping it", () => {
    const result = settleReserve(reserve({ savedCents: 130000 }));
    expect(result.savedCents).toBe(10000);
  });

  it("never goes negative when the bill exceeded what was set aside", () => {
    expect(settleReserve(reserve({ savedCents: 10000 })).savedCents).toBe(0);
  });

  it("honours a half-yearly interval", () => {
    const result = settleReserve(
      reserve({ intervalMonths: 6, nextDueDate: "2026-01-31", savedCents: 120000 })
    );
    expect(result.nextDueDate).toBe("2026-07-31");
  });
});

describe("totalMonthlyReserveCents", () => {
  it("sums only active reserves", () => {
    const total = totalMonthlyReserveCents(
      [
        reserve({ id: 1, targetAmountCents: 120000, nextDueDate: "2027-01-01" }),
        reserve({ id: 2, targetAmountCents: 60000, nextDueDate: "2027-01-01" }),
        reserve({ id: 3, targetAmountCents: 999900, nextDueDate: "2027-01-01", isActive: false }),
      ],
      "2026-01-01"
    );
    expect(total).toBe(15000);
  });
});

describe("goalStatus", () => {
  it("derives a monthly rate from the target date", () => {
    // 3000.00 missing over 6 months → 500.00 a month.
    const status = goalStatus(goal({ targetDate: "2026-07-01" }), "2026-01-01");
    expect(status.missingCents).toBe(300000);
    expect(status.monthlyRateCents).toBe(50000);
  });

  it("has no rate without a target date", () => {
    expect(goalStatus(goal({ targetDate: null }), "2026-01-01").monthlyRateCents).toBeNull();
  });

  it("reports a reached goal", () => {
    const status = goalStatus(goal({ savedCents: 400000 }), "2026-01-01");
    expect(status.isReached).toBe(true);
    expect(status.monthlyRateCents).toBeNull();
  });
});
