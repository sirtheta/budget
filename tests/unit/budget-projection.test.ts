import { describe, expect, it } from "vitest";
import { projectMonthEnd, type MonthProjectionInput } from "@/lib/budget";

/**
 * A household eight days into January: salary in, rent and insurance already
 * booked, plus 400.00 of groceries. One more fixed cost is still ahead.
 */
const input: MonthProjectionInput = {
  actualIncomeCents: 700000,
  actualExpenseCents: 280000,
  bookedFixedExpenseCents: 240000,
  dueRecurringExpenseCents: 50000,
  dueRecurringIncomeCents: 0,
};

describe("projectMonthEnd", () => {
  it("spreads only the variable part over the remaining days", () => {
    const projection = projectMonthEnd(input, "2026-01-08")!;
    // 40'000 variable over 8 days = 5'000 per day, 23 days left.
    expect(projection.dailyVariableExpenseCents).toBe(5000);
    expect(projection.projectedExpenseCents).toBe(280000 + 5000 * 23 + 50000);
  });

  it("does not project rent as a daily cost", () => {
    // The same month seen as one undifferentiated expense stream would put the
    // fixed costs into every remaining day — the failure this split exists for.
    const naive = Math.round(280000 / 8) * 31;
    expect(projectMonthEnd(input, "2026-01-08")!.projectedExpenseCents).toBeLessThan(naive);
  });

  it("adds recurring income at its scheduled amount instead of spreading it", () => {
    const projection = projectMonthEnd(
      { ...input, dueRecurringIncomeCents: 120000 },
      "2026-01-08"
    )!;
    expect(projection.projectedIncomeCents).toBe(820000);
    expect(projection.projectedBalanceCents).toBe(820000 - projection.projectedExpenseCents);
  });

  it("uses the real length of a short month", () => {
    const projection = projectMonthEnd(input, "2026-02-08")!;
    expect(projection.daysInMonth).toBe(28);
    expect(projection.projectedExpenseCents).toBe(280000 + 5000 * 20 + 50000);
  });

  it("refuses to extrapolate from the first few days", () => {
    expect(projectMonthEnd(input, "2026-01-04")).toBeNull();
  });

  it("returns null on the last day, where the booked total is the answer", () => {
    expect(projectMonthEnd(input, "2026-01-31")).toBeNull();
  });

  it("floors the variable part at zero when fixed costs exceed the booked total", () => {
    // Possible after a refund on a recurring booking: the split would go
    // negative and project a month that spends less than it already has.
    const projection = projectMonthEnd(
      { ...input, actualExpenseCents: 200000, bookedFixedExpenseCents: 240000 },
      "2026-01-08"
    )!;
    expect(projection.dailyVariableExpenseCents).toBe(0);
    expect(projection.projectedExpenseCents).toBe(250000);
  });
});
