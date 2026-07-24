import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatMoneyCompact,
  parseMoney,
  splitEvenly,
  sumCents,
  toCents,
  toFrancs,
} from "@/lib/money";

describe("parseMoney", () => {
  it("parses plain decimals", () => {
    expect(parseMoney("12.50")).toBe(1250);
    expect(parseMoney("0.05")).toBe(5);
    expect(parseMoney("100")).toBe(10000);
  });

  it("parses Swiss thousands separators", () => {
    expect(parseMoney("1'234.50")).toBe(123450);
    expect(parseMoney("12'345'678.90")).toBe(1234567890);
    expect(parseMoney("1 234.50")).toBe(123450);
  });

  it("parses a comma as the decimal separator", () => {
    expect(parseMoney("12,50")).toBe(1250);
    expect(parseMoney("1.234,50")).toBe(123450);
  });

  it("treats a comma grouping three digits as a thousands separator", () => {
    expect(parseMoney("1,234")).toBe(123400);
  });

  it("handles the sign in every position banks use", () => {
    expect(parseMoney("-42.00")).toBe(-4200);
    expect(parseMoney("42.00-")).toBe(-4200);
    expect(parseMoney("(42.00)")).toBe(-4200);
    expect(parseMoney("+42.00")).toBe(4200);
  });

  it("strips currency markers", () => {
    expect(parseMoney("CHF 12.50")).toBe(1250);
    expect(parseMoney("Fr. 12.50")).toBe(1250);
    expect(parseMoney("12.–")).toBe(1200);
  });

  it("returns null for non-numeric input, distinguishing it from zero", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1.2.3")).toBeNull();
    expect(parseMoney("0")).toBe(0);
  });
});

describe("formatMoney", () => {
  it("formats in Swiss notation", () => {
    expect(formatMoney(123450)).toBe("1'234.50");
    expect(formatMoney(5)).toBe("0.05");
  });

  it("uses a typographic minus for negatives", () => {
    expect(formatMoney(-1250)).toBe("−12.50");
  });

  it("adds a plus sign only when asked and only for positives", () => {
    expect(formatMoney(1250, { forceSign: true })).toBe("+12.50");
    expect(formatMoney(0, { forceSign: true })).toBe("0.00");
  });

  it("prefixes the currency", () => {
    expect(formatMoney(1250, { withCurrency: true })).toBe("CHF 12.50");
    expect(formatMoney(-1250, { withCurrency: true })).toBe("−CHF 12.50");
  });
});

describe("formatMoneyCompact", () => {
  it("shortens large amounts for chart axes", () => {
    expect(formatMoneyCompact(123450)).toBe("1.2k");
    expect(formatMoneyCompact(1234500)).toBe("12k");
    expect(formatMoneyCompact(123450000)).toBe("1.2M");
    expect(formatMoneyCompact(-35000)).toBe("−350");
  });
});

describe("toCents / toFrancs", () => {
  it("round-trips without float drift", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toFrancs(1250)).toBe(12.5);
  });

  it("rounds away from zero in both directions", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-1.005)).toBe(-101);
  });
});

describe("sumCents", () => {
  it("sums signed amounts", () => {
    expect(sumCents([{ amountCents: 1000 }, { amountCents: -250 }, { amountCents: -750 }])).toBe(0);
  });
});

describe("splitEvenly", () => {
  it("distributes the remainder so the parts add back up to the total", () => {
    const parts = splitEvenly(1000, 3);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("keeps the sign of the total", () => {
    expect(splitEvenly(-1000, 3).reduce((a, b) => a + b, 0)).toBe(-1000);
  });

  it("returns nothing for a non-positive part count", () => {
    expect(splitEvenly(1000, 0)).toEqual([]);
  });
});
