import { describe, expect, it } from "vitest";
import { projectMonthEnd } from "@/lib/budget";

const totals = { actualIncomeCents: 700000, actualExpenseCents: 300000 };

describe("projectMonthEnd", () => {
  it("extrapolates the daily expense rate to the whole month", () => {
    // 300'000 over 10 days = 30'000 per day, 31 days in January.
    const projection = projectMonthEnd(totals, "2026-01-10");
    expect(projection).not.toBeNull();
    expect(projection!.dailyExpenseCents).toBe(30000);
    expect(projection!.projectedExpenseCents).toBe(930000);
    expect(projection!.daysInMonth).toBe(31);
  });

  it("leaves income alone — it arrives in lumps, not per day", () => {
    const projection = projectMonthEnd(totals, "2026-01-10")!;
    expect(projection.projectedBalanceCents).toBe(700000 - 930000);
  });

  it("uses the real length of a short month", () => {
    expect(projectMonthEnd(totals, "2026-02-10")!.projectedExpenseCents).toBe(30000 * 28);
  });

  it("refuses to extrapolate from the first few days", () => {
    expect(projectMonthEnd(totals, "2026-01-04")).toBeNull();
  });

  it("returns null on the last day, where the booked total is the answer", () => {
    expect(projectMonthEnd(totals, "2026-01-31")).toBeNull();
  });

  it("projects zero for a month without expenses yet", () => {
    const projection = projectMonthEnd({ actualIncomeCents: 0, actualExpenseCents: 0 }, "2026-01-10")!;
    expect(projection.dailyExpenseCents).toBe(0);
    expect(projection.projectedExpenseCents).toBe(0);
  });
});
