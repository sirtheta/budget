import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { searchVariants, transactionSearchFilter } from "@/lib/search";
import { createTestDb, seedBasics } from "./helpers";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

/** Finds transactions the way the list and the CSV export both do. */
async function search(term: string): Promise<string[]> {
  const or = transactionSearchFilter(term);
  const rows = await prisma.transaction.findMany({
    where: or ? { OR: or } : {},
    orderBy: { id: "asc" },
    select: { description: true },
  });
  return rows.map((row) => row.description);
}

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  const { account } = await seedBasics(prisma);

  await prisma.transaction.createMany({
    data: [
      { date: "2026-01-05", amountCents: -1200, accountId: account.id, description: "Bäckerei Müller" },
      { date: "2026-01-06", amountCents: -1300, accountId: account.id, description: "BÄCKEREI MÜLLER" },
      { date: "2026-01-07", amountCents: -1400, accountId: account.id, description: "Migros" },
      { date: "2026-01-08", amountCents: -1500, accountId: account.id, description: "MIGROS" },
      {
        date: "2026-01-09",
        amountCents: -1600,
        accountId: account.id,
        description: "Zahlung",
        counterparty: "Zürcher Kantonalbank",
      },
      {
        date: "2026-01-10",
        amountCents: -1700,
        accountId: account.id,
        description: "Diverses",
        notes: "Für Gäste eingekauft",
      },
    ],
  });
});

afterAll(async () => cleanup());

describe("searchVariants", () => {
  it("returns the term as typed plus its lower and upper forms", () => {
    expect(searchVariants("Bäckerei")).toEqual(["Bäckerei", "bäckerei", "BÄCKEREI"]);
  });

  it("does not repeat a term that is already lowercase-only", () => {
    expect(searchVariants("migros")).toEqual(["migros", "MIGROS"]);
  });

  it("trims surrounding whitespace", () => {
    expect(searchVariants("  migros  ")).toEqual(["migros", "MIGROS"]);
  });

  it("returns nothing for an empty term", () => {
    expect(searchVariants("")).toEqual([]);
    expect(searchVariants("   ")).toEqual([]);
  });
});

describe("transactionSearchFilter", () => {
  it("leaves the filter off for an empty term", () => {
    expect(transactionSearchFilter("")).toBeUndefined();
    expect(transactionSearchFilter(null)).toBeUndefined();
    expect(transactionSearchFilter(undefined)).toBeUndefined();
  });
});

describe("searching transactions", () => {
  it("finds ASCII descriptions regardless of case", () => {
    // This much SQLite's LIKE already did on its own.
    return expect(search("migros")).resolves.toEqual(["Migros", "MIGROS"]);
  });

  it("finds an umlaut description typed in lowercase", async () => {
    // The bug: SQLite's LIKE folds ASCII only, so this used to return just
    // the all-caps row — searching German words in a German app missed.
    expect(await search("bäckerei")).toEqual(["Bäckerei Müller", "BÄCKEREI MÜLLER"]);
  });

  it("finds an umlaut description typed in uppercase", async () => {
    expect(await search("BÄCKEREI")).toEqual(["Bäckerei Müller", "BÄCKEREI MÜLLER"]);
  });

  it("finds an umlaut description typed as it is stored", async () => {
    expect(await search("Bäckerei")).toEqual(["Bäckerei Müller", "BÄCKEREI MÜLLER"]);
  });

  it("searches the counterparty too", async () => {
    expect(await search("zürcher")).toEqual(["Zahlung"]);
  });

  it("searches the notes too", async () => {
    expect(await search("gäste")).toEqual(["Diverses"]);
  });

  it("still matches nothing for a term that is not there", async () => {
    expect(await search("Wocheneinkauf")).toEqual([]);
  });
});
