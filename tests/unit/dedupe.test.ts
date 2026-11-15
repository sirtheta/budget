import { describe, expect, it } from "vitest";
import { findRenamedDuplicates, splitDuplicates, verifyImportHash, withHashes } from "@/lib/import/dedupe";
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

describe("fee-aware fingerprint", () => {
  const printed = tx({ amountCents: -7080, counterparty: null });
  const withFee = tx({ amountCents: -7151, feeCents: 71, counterparty: null });

  it("hashes the amount as printed, so rows imported before fee support still match", () => {
    expect(withHashes(1, [withFee])[0].hash).toBe(withHashes(1, [printed])[0].hash);
  });

  it("verifies a fee row against the hash derived from its printed amount", () => {
    const [row] = withHashes(1, [withFee]);
    expect(verifyImportHash(1, withFee, row.hash)).toBe(true);
    // Dropping the fee changes the printed amount, so the hash no longer fits.
    expect(verifyImportHash(1, { ...withFee, feeCents: undefined }, row.hash)).toBe(false);
  });
});

describe("findRenamedDuplicates", () => {
  const booked = (over: Partial<Parameters<typeof findRenamedDuplicates>[1][number]> = {}) => ({
    id: 1,
    date: "2026-09-04",
    amountCents: -1700,
    description: "Anthropic",
    importHash: "old",
    ...over,
  });
  const fresh = (over: Partial<ParsedTransaction> = {}) =>
    withHashes(1, [tx({ date: "2026-09-04", amountCents: -1700, description: "CLAUDE", counterparty: null, ...over })]);

  it("pairs a fresh row with an old booking the statement no longer contains", () => {
    const rows = fresh();
    const result = findRenamedDuplicates(rows, [booked()], new Set(rows.map((r) => r.hash)));
    expect(result.get(rows[0].hash)?.description).toBe("Anthropic");
  });

  it("ignores a booking that still hashes to a row of this statement", () => {
    const rows = fresh();
    const result = findRenamedDuplicates(rows, [booked({ importHash: "kept" })], new Set([...rows.map((r) => r.hash), "kept"]));
    expect(result.size).toBe(0);
  });

  it("lets one old booking explain only one fresh row", () => {
    const rows = withHashes(1, [
      tx({ date: "2026-09-04", amountCents: -1700, description: "CLAUDE", counterparty: null }),
      tx({ date: "2026-09-04", amountCents: -1700, description: "Spotify", counterparty: null }),
    ]);
    const result = findRenamedDuplicates(rows, [booked()], new Set(rows.map((r) => r.hash)));
    expect(result.size).toBe(1);
  });

  it("needs the same date and amount", () => {
    const rows = fresh();
    const hashes = new Set(rows.map((r) => r.hash));
    expect(findRenamedDuplicates(rows, [booked({ date: "2026-09-05" })], hashes).size).toBe(0);
    expect(findRenamedDuplicates(rows, [booked({ amountCents: -1800 })], hashes).size).toBe(0);
  });

  it("also matches an old booking stored with the printed amount when the new row carries a fee", () => {
    const rows = fresh({ amountCents: -1717, feeCents: 17 });
    const result = findRenamedDuplicates(rows, [booked()], new Set(rows.map((r) => r.hash)));
    expect(result.size).toBe(1);
  });
});
