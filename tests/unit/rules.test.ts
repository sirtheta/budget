import { describe, expect, it } from "vitest";
import type { ImportRule } from "@prisma/client";
import { hasNestedQuantifier, matchRule, ruleMatches } from "@/lib/import/rules";
import type { ParsedTransaction } from "@/lib/import/types";

function rule(overrides: Partial<ImportRule> = {}): ImportRule {
  return {
    id: 1,
    name: "Migros",
    field: "Description",
    matchType: "Contains",
    pattern: "migros",
    categoryId: 10,
    transferAccountId: null,
    minAmountCents: null,
    maxAmountCents: null,
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

  it("respects an amount range, so the same pattern can be split by size", () => {
    // Same beneficiary ("Revolut") for both a small recurring transfer and a
    // larger one — only distinguishable by amount, not by pattern.
    const pocketMoney = rule({ pattern: "revolut", minAmountCents: null, maxAmountCents: 2000 });
    const creditCard = rule({ pattern: "revolut", minAmountCents: 2001, maxAmountCents: null });

    expect(ruleMatches(pocketMoney, tx({ description: "Revolut", amountCents: -700 }))).toBe(true);
    expect(ruleMatches(pocketMoney, tx({ description: "Revolut", amountCents: -15000 }))).toBe(false);
    expect(ruleMatches(creditCard, tx({ description: "Revolut", amountCents: -15000 }))).toBe(true);
    expect(ruleMatches(creditCard, tx({ description: "Revolut", amountCents: -700 }))).toBe(false);
  });

  it("treats the amount bound as inclusive and ignores sign", () => {
    expect(ruleMatches(rule({ maxAmountCents: 700 }), tx({ amountCents: -700 }))).toBe(true);
    expect(ruleMatches(rule({ maxAmountCents: 699 }), tx({ amountCents: -700 }))).toBe(false);
    expect(ruleMatches(rule({ minAmountCents: 700 }), tx({ amountCents: 700 }))).toBe(true);
  });
});

describe("matchRule", () => {
  it("returns null when nothing matches", () => {
    expect(matchRule([rule({ pattern: "coop" })], tx())).toBeNull();
  });

  it("lets the lowest priority win, so a specific rule beats a catch-all", () => {
    const rules = [
      rule({ id: 1, pattern: "einkauf", categoryId: 99, priority: 50 }),
      rule({ id: 2, pattern: "migros", categoryId: 10, priority: 1 }),
    ];
    expect(matchRule(rules, tx())?.categoryId).toBe(10);
  });

  it("falls back to id order when priorities tie", () => {
    const rules = [
      rule({ id: 5, pattern: "migros", categoryId: 55, priority: 0 }),
      rule({ id: 2, pattern: "einkauf", categoryId: 22, priority: 0 }),
    ];
    expect(matchRule(rules, tx())?.categoryId).toBe(22);
  });

  it("ignores inactive rules", () => {
    expect(matchRule([rule({ isActive: false })], tx())).toBeNull();
  });

  it("returns a transfer-account rule as-is, without a category", () => {
    const matched = matchRule(
      [rule({ pattern: "revolut", categoryId: null, transferAccountId: 7 })],
      tx({ description: "Zahlung an Revolut" })
    );
    expect(matched?.transferAccountId).toBe(7);
    expect(matched?.categoryId).toBeNull();
  });
});

describe("hasNestedQuantifier", () => {
  it.each([
    "(a+)+",
    "(a*)*",
    "(a|aa)+",
    "(\d+)+$",
    "^(x+x+)+y$",
    "([a-z]+)*",
    "(ab{2,})+",
  ])("flags %j", (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(true);
  });

  it.each([
    "MIGROS",
    "^COOP.*ZUERICH$",
    "(MIGROS|COOP)",       // alternation without outer repetition
    "(a+){2}",             // bounded outer repetition cannot blow up
    "\\(\\+41\\)+", // escaped parens and plus are literal text, not structure
    "[+*]+",               // quantifiers inside a character class are literal
    "(abc)+",              // repeated group with no inner repetition
  ])("accepts %j", (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(false);
  });
});

describe("regex rules at runtime", () => {
  it("matches a sound pattern", () => {
    expect(ruleMatches(rule({ matchType: "Regex", pattern: "^einkauf migros" }), tx())).toBe(true);
  });

  it("never matches a nested-quantifier pattern instead of hanging", () => {
    // Handed to the regex engine, this backtracks for effectively forever; the
    // test completing at all is the assertion that matters.
    const evil = rule({ matchType: "Regex", pattern: "(a+)+$" });
    const bait = tx({ description: "a".repeat(40) + "b" });
    const started = Date.now();
    expect(ruleMatches(evil, bait)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
