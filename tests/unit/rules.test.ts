import { describe, expect, it } from "vitest";
import type { ImportRule } from "@prisma/client";
import { categorize, categorizeAll, ruleMatches } from "@/lib/import/rules";
import type { ParsedTransaction } from "@/lib/import/types";

function rule(overrides: Partial<ImportRule> = {}): ImportRule {
  return {
    id: 1,
    name: "Migros",
    field: "Description",
    matchType: "Contains",
    pattern: "migros",
    categoryId: 10,
    priority: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function tx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: "2026-02-05",
    amountCents: -8240,
    description: "Einkauf Migros Zürich",
    counterparty: "Migros Genossenschaft",
    bankReference: null,
    ...overrides,
  };
}

describe("ruleMatches", () => {
  it("matches case-insensitively", () => {
    expect(ruleMatches(rule({ pattern: "MIGROS" }), tx())).toBe(true);
  });

  it("supports each comparison type", () => {
    expect(ruleMatches(rule({ matchType: "StartsWith", pattern: "einkauf" }), tx())).toBe(true);
    expect(ruleMatches(rule({ matchType: "StartsWith", pattern: "migros" }), tx())).toBe(false);
    expect(ruleMatches(rule({ matchType: "EndsWith", pattern: "zürich" }), tx())).toBe(true);
    expect(ruleMatches(rule({ matchType: "Regex", pattern: "^Einkauf .*Zürich$" }), tx())).toBe(true);
  });

  it("can match the counterparty instead of the description", () => {
    expect(
      ruleMatches(rule({ field: "Counterparty", pattern: "genossenschaft" }), tx())
    ).toBe(true);
    expect(ruleMatches(rule({ field: "Counterparty", pattern: "einkauf" }), tx())).toBe(false);
  });

  it("never matches on an empty field", () => {
    expect(ruleMatches(rule({ field: "Counterparty" }), tx({ counterparty: null }))).toBe(false);
  });

  it("survives an invalid regex instead of breaking the import", () => {
    expect(ruleMatches(rule({ matchType: "Regex", pattern: "([unclosed" }), tx())).toBe(false);
  });
});

describe("categorize", () => {
  it("returns null when nothing matches", () => {
    expect(categorize([rule({ pattern: "coop" })], tx())).toBeNull();
  });

  it("lets the lowest priority win, so a specific rule beats a catch-all", () => {
    const rules = [
      rule({ id: 1, pattern: "einkauf", categoryId: 99, priority: 50 }),
      rule({ id: 2, pattern: "migros", categoryId: 10, priority: 1 }),
    ];
    expect(categorize(rules, tx())).toBe(10);
  });

  it("falls back to id order when priorities tie", () => {
    const rules = [
      rule({ id: 5, pattern: "migros", categoryId: 55, priority: 0 }),
      rule({ id: 2, pattern: "einkauf", categoryId: 22, priority: 0 }),
    ];
    expect(categorize(rules, tx())).toBe(22);
  });

  it("ignores inactive rules", () => {
    expect(categorize([rule({ isActive: false })], tx())).toBeNull();
  });
});

describe("categorizeAll", () => {
  it("keeps the input order and attaches the resolved category", () => {
    const rules = [rule({ pattern: "migros", categoryId: 10 })];
    const result = categorizeAll(rules, [tx(), tx({ description: "Coop" })]);
    expect(result.map((row) => row.categoryId)).toEqual([10, null]);
  });
});
