import { describe, expect, it } from "vitest";
import { nativeMatcher } from "@/lib/import/pdf-parse";
import { RegexTimeoutError, createSafeMatcher } from "@/lib/import/safe-regex";

const MESSAGE = "Ein Regex im Layout braucht zu lange (vermutlich endloses Backtracking). Bitte vereinfachen.";
const EVIL_LINE = `${"a".repeat(40)}b`;

describe("createSafeMatcher", () => {
  it("returns the same matches as the native matcher", () => {
    const source = String.raw`^(?<date>\d{2}\.\d{2}\.\d{2})\s+(?<text>.+?)(?:\s{2,}(?<currency>[A-Z]{3}))?\s{2,}(?<amount>[\d']+\.\d{2})$`;
    const lines = ["26.09.26 Migros  12.50", "26.09.26 SumUp  EUR  100.00", "Footer", ""];
    expect(createSafeMatcher()(source, lines)).toEqual(nativeMatcher(source, lines));
  });

  it("returns an empty groups object for a match without named groups", () => {
    expect(createSafeMatcher()("^x$", ["x", "y"])).toEqual([{}, null]);
  });

  it("aborts a catastrophically backtracking regex at its limit", () => {
    const started = performance.now();
    expect(() => createSafeMatcher({ perRegexMs: 100 })("^(a+)+$", [EVIL_LINE])).toThrow(RegexTimeoutError);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("uses the German message", () => {
    expect(() => createSafeMatcher({ perRegexMs: 100 })("^(a+)+$", [EVIL_LINE])).toThrow(MESSAGE);
  });

  it("shares one budget across regexes and stays exhausted after a timeout", () => {
    const matcher = createSafeMatcher({ perRegexMs: 100, totalMs: 1000 });
    expect(() => matcher("^(a+)+$", [EVIL_LINE])).toThrow(RegexTimeoutError);
    expect(() => matcher("^x$", ["x"])).toThrow(RegexTimeoutError);
  });

  it("lets ordinary regexes run repeatedly within the budget", () => {
    const matcher = createSafeMatcher({ perRegexMs: 100, totalMs: 1000 });
    for (let i = 0; i < 5; i++) expect(matcher("^x$", ["x"])).toEqual([{}]);
  });
});
