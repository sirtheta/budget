import { describe, expect, it } from "vitest";
import type { CsvMapping } from "@prisma/client";
import { detectDelimiter, parseCsvDate, parseCsvRows, parseCsvStatement } from "@/lib/import/csv";

function mapping(overrides: Partial<CsvMapping> = {}): CsvMapping {
  return {
    id: 1,
    name: "Test",
    delimiter: ";",
    encoding: "utf-8",
    skipRows: 0,
    hasHeader: true,
    dateColumn: 0,
    dateFormat: "DD.MM.YYYY",
    descriptionColumn: 1,
    amountColumn: 2,
    invertAmount: false,
    debitColumn: null,
    creditColumn: null,
    counterpartyColumn: null,
    decimalSeparator: ".",
    thousandsSeparator: "'",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("parseCsvRows", () => {
  it("splits plain rows", () => {
    expect(parseCsvRows("a;b;c\n1;2;3", ";")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("respects quoted fields containing the delimiter", () => {
    expect(parseCsvRows('a;"b;still b";c', ";")).toEqual([["a", "b;still b", "c"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsvRows('a;"say ""hi""";c', ";")).toEqual([["a", 'say "hi"', "c"]]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsvRows('a;"line1\nline2";c', ";")).toEqual([["a", "line1\nline2", "c"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsvRows("a;b\r\n1;2", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips the UTF-8 BOM Excel prepends", () => {
    expect(parseCsvRows("﻿a;b", ";")).toEqual([["a", "b"]]);
  });

  it("drops fully blank rows", () => {
    expect(parseCsvRows("a;b\n\n;\n1;2", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("detectDelimiter", () => {
  it("picks the most frequent candidate", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
});

describe("parseCsvDate", () => {
  it("converts each supported format to YYYY-MM-DD", () => {
    expect(parseCsvDate("05.02.2026", "DD.MM.YYYY")).toBe("2026-02-05");
    expect(parseCsvDate("2026-02-05", "YYYY-MM-DD")).toBe("2026-02-05");
    expect(parseCsvDate("05/02/2026", "DD/MM/YYYY")).toBe("2026-02-05");
    expect(parseCsvDate("02/05/2026", "MM/DD/YYYY")).toBe("2026-02-05");
    expect(parseCsvDate("5.2.2026", "DD.MM.YYYY")).toBe("2026-02-05");
  });

  it("returns null when the cell does not match the format", () => {
    expect(parseCsvDate("2026-02-05", "DD.MM.YYYY")).toBeNull();
    expect(parseCsvDate("kein Datum", "DD.MM.YYYY")).toBeNull();
    expect(parseCsvDate("30.02.2026", "DD.MM.YYYY")).toBeNull();
  });
});

describe("parseCsvStatement", () => {
  it("reads a signed amount column", () => {
    const csv = "Datum;Text;Betrag\n05.02.2026;Migros;-82.40\n25.02.2026;Lohn;6800.00";
    const result = parseCsvStatement(csv, mapping());
    expect(result.transactions).toEqual([
      expect.objectContaining({ date: "2026-02-05", amountCents: -8240, description: "Migros" }),
      expect.objectContaining({ date: "2026-02-25", amountCents: 680000, description: "Lohn" }),
    ]);
  });

  it("negates the debit column, since banks write both sides positive", () => {
    const csv = "Datum;Text;Soll;Haben\n05.02.2026;Migros;82.40;\n25.02.2026;Lohn;;6800.00";
    const result = parseCsvStatement(
      csv,
      mapping({ amountColumn: null, debitColumn: 2, creditColumn: 3 })
    );
    expect(result.transactions.map((t) => t.amountCents)).toEqual([-8240, 680000]);
  });

  it("flips the sign when invertAmount is set, e.g. credit card exports where purchases are positive", () => {
    const csv = "Datum;Text;Betrag\n05.02.2026;Migros;82.40\n25.02.2026;Gutschrift;-40.00";
    const result = parseCsvStatement(csv, mapping({ invertAmount: true }));
    expect(result.transactions.map((t) => t.amountCents)).toEqual([-8240, 4000]);
  });

  it("skips metadata lines before the header", () => {
    const csv = "Kontoauszug PostFinance\nIBAN CH93...\nDatum;Text;Betrag\n05.02.2026;Migros;-82.40";
    const result = parseCsvStatement(csv, mapping({ skipRows: 2 }));
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe("Migros");
  });

  it("reports unreadable rows instead of silently dropping them", () => {
    const csv = "Datum;Text;Betrag\nkaputt;Migros;-82.40\n05.02.2026;Coop;-40.00";
    const result = parseCsvStatement(csv, mapping());
    expect(result.transactions).toHaveLength(1);
    expect(result.rejectedRows).toHaveLength(1);
    expect(result.rejectedRows[0].reason).toContain("Datum");
    expect(result.warnings.join(" ")).toContain("nicht gelesen");
  });

  it("derives the period from the rows it read", () => {
    const csv = "Datum;Text;Betrag\n25.02.2026;Lohn;6800.00\n05.02.2026;Migros;-82.40";
    const result = parseCsvStatement(csv, mapping());
    expect(result.periodFrom).toBe("2026-02-05");
    expect(result.periodTo).toBe("2026-02-25");
  });

  it("refuses a mapping without any amount column", () => {
    expect(() =>
      parseCsvStatement("a;b", mapping({ amountColumn: null, debitColumn: null, creditColumn: null }))
    ).toThrow(/Betragsspalte/);
  });

  it("picks up the counterparty column when mapped", () => {
    const csv = "Datum;Text;Betrag;Empfänger\n05.02.2026;Einkauf;-82.40;Migros Zürich";
    const result = parseCsvStatement(csv, mapping({ counterpartyColumn: 3 }));
    expect(result.transactions[0].counterparty).toBe("Migros Zürich");
  });
});
