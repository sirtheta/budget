import { describe, expect, it } from "vitest";
import { dummyCompare, bcryptRounds } from "@/lib/password";

describe("dummyCompare", () => {
  it("resolves without throwing, regardless of input", async () => {
    await expect(dummyCompare("anything")).resolves.toBeUndefined();
    await expect(dummyCompare("")).resolves.toBeUndefined();
  });
});

describe("bcryptRounds", () => {
  it("is a positive integer sourced from config", () => {
    expect(Number.isInteger(bcryptRounds)).toBe(true);
    expect(bcryptRounds).toBeGreaterThan(0);
  });
});
