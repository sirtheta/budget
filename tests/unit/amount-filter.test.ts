import { describe, expect, it } from "vitest";
import { amountRangeFilter } from "@/lib/search";

describe("amountRangeFilter", () => {
  it("returns undefined without usable bounds", () => {
    expect(amountRangeFilter("", null)).toBeUndefined();
    expect(amountRangeFilter("abc", undefined)).toBeUndefined();
  });

  it("matches exact magnitude for both signs", () => {
    expect(amountRangeFilter("50", "50")).toEqual({
      OR: [
        { amountCents: { gte: 5000, lte: 5000 } },
        { amountCents: { gte: -5000, lte: -5000 } },
      ],
    });
  });

  it("supports open-ended ranges", () => {
    expect(amountRangeFilter("10.50", null)).toEqual({
      OR: [{ amountCents: { gte: 1050 } }, { amountCents: { lte: -1050 } }],
    });
    expect(amountRangeFilter(null, "20")).toEqual({
      OR: [{ amountCents: { lte: 2000 } }, { amountCents: { gte: -2000 } }],
    });
  });
});
