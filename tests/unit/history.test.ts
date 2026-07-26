import { describe, expect, it } from "vitest";
import { pickDominantCategory } from "@/lib/import/history";

describe("pickDominantCategory", () => {
  it("suggests the only category seen", () => {
    expect(pickDominantCategory(new Map([[1, 3]]))).toBe(1);
  });

  it("suggests a category that clearly dominates the history", () => {
    expect(pickDominantCategory(new Map([[1, 8], [2, 2]]))).toBe(1);
  });

  it("refuses to guess on a 50/50 split", () => {
    expect(pickDominantCategory(new Map([[1, 5], [2, 5]]))).toBeNull();
  });

  it("refuses to guess just under the dominance threshold", () => {
    // 5 of 9 is ~55%, below the 60% threshold.
    expect(pickDominantCategory(new Map([[1, 5], [2, 4]]))).toBeNull();
  });

  it("suggests right at the dominance threshold", () => {
    // 6 of 10 is exactly 60%.
    expect(pickDominantCategory(new Map([[1, 6], [2, 4]]))).toBe(1);
  });

  it("returns null for an empty history", () => {
    expect(pickDominantCategory(new Map())).toBeNull();
  });
});
