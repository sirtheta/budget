import { describe, expect, it } from "vitest";
import { splitDuplicates, verifyImportHash, withHashes } from "@/lib/import/dedupe";
import type { ParsedTransaction } from "@/lib/import/types";

function tx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: "2026-02-05",
    amountCents: -8240,
    description: "Migros",
    counterparty: "Migros Zürich",
    bankReference: null,
    ...overrides,
  };
}

describe("withHashes", () => {
  it("is deterministic, so re-importing the same file yields the same hashes", () => {
    const first = withHashes(1, [tx(), tx({ amountCents: -1000 })]);
    const second = withHashes(1, [tx(), tx({ amountCents: -1000 })]);
    expect(first.map((r) => r.hash)).toEqual(second.map((r) => r.hash));
  });

  it("scopes the hash to the account", () => {
    const [a] = withHashes(1, [tx()]);
    const [b] = withHashes(2, [tx()]);
    expect(a.hash).not.toBe(b.hash);
  });

  it("distinguishes two identical bookings on the same day", () => {
    // Two CHF 4.50 coffees must both import — but re-importing the file must
    // still skip both, which is why the counter is positional, not random.
    const rows = withHashes(1, [tx({ amountCents: -450 }), tx({ amountCents: -450 })]);
    expect(rows[0].hash).not.toBe(rows[1].hash);
    const rerun = withHashes(1, [tx({ amountCents: -450 }), tx({ amountCents: -450 })]);
    expect(rerun.map((r) => r.hash)).toEqual(rows.map((r) => r.hash));
  });

  it("ignores formatting noise in the description", () => {
    const [a] = withHashes(1, [tx({ description: "MIGROS  ZÜRICH" })]);
    const [b] = withHashes(1, [tx({ description: "migros zürich" })]);
    expect(a.hash).toBe(b.hash);
  });

  it("keys on the bank reference alone when one is present", () => {
    // Same reference, different rendering of the text — still one booking.
    const [a] = withHashes(1, [tx({ bankReference: "REF-1", description: "Migros" })]);
    const [b] = withHashes(1, [tx({ bankReference: "REF-1", description: "Anders geschrieben" })]);
    expect(a.hash).toBe(b.hash);
  });

  it("separates different bank references", () => {
    const [a] = withHashes(1, [tx({ bankReference: "REF-1" })]);
    const [b] = withHashes(1, [tx({ bankReference: "REF-2" })]);
    expect(a.hash).not.toBe(b.hash);
  });

  it("reacts to a changed amount or date", () => {
    const [base] = withHashes(1, [tx()]);
    const [otherAmount] = withHashes(1, [tx({ amountCents: -8241 })]);
    const [otherDate] = withHashes(1, [tx({ date: "2026-02-06" })]);
    expect(base.hash).not.toBe(otherAmount.hash);
    expect(base.hash).not.toBe(otherDate.hash);
  });
});

describe("splitDuplicates", () => {
  it("separates already-imported rows from new ones", () => {
    const rows = withHashes(1, [tx(), tx({ amountCents: -1000, description: "Coop" })]);
    const { fresh, duplicates } = splitDuplicates(rows, new Set([rows[0].hash]));
    expect(duplicates).toHaveLength(1);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].description).toBe("Coop");
  });

  it("treats everything as new when nothing is known yet", () => {
    const rows = withHashes(1, [tx()]);
    expect(splitDuplicates(rows, new Set()).fresh).toHaveLength(1);
  });
});

describe("verifyImportHash", () => {
  const account = 7;
  const plain = {
    date: "2026-02-05",
    amountCents: -450,
    description: "Kaffee",
    counterparty: null,
    bankReference: null,
  };

  it("accepts the hash the preview computed", () => {
    const [row] = withHashes(account, [plain]);
    expect(verifyImportHash(account, plain, row.hash)).toBe(true);
  });

  it("accepts a later occurrence of an identical booking", () => {
    // Two identical coffees the same day: the second row's hash carries
    // occurrence 1, and the commit may well arrive without the first.
    const rows = withHashes(account, [plain, plain]);
    expect(verifyImportHash(account, plain, rows[1].hash)).toBe(true);
  });

  it("rejects a hash that was simply made up", () => {
    expect(verifyImportHash(account, plain, "f".repeat(64))).toBe(false);
  });

  it("rejects a hash belonging to a different row", () => {
    const [other] = withHashes(account, [{ ...plain, amountCents: -99900 }]);
    expect(verifyImportHash(account, plain, other.hash)).toBe(false);
  });

  it("rejects a hash computed for another account", () => {
    const [row] = withHashes(account + 1, [plain]);
    expect(verifyImportHash(account, plain, row.hash)).toBe(false);
  });

  it("ignores the occurrence when a bank reference is present", () => {
    const referenced = { ...plain, bankReference: "ACCTSVCR-4711" };
    const [row] = withHashes(account, [referenced]);
    expect(verifyImportHash(account, referenced, row.hash)).toBe(true);
    expect(verifyImportHash(account, { ...referenced, bankReference: "OTHER" }, row.hash)).toBe(
      false
    );
  });
});
