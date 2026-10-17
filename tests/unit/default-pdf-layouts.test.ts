import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PDF_LAYOUTS, seedDefaultPdfLayouts } from "@/lib/import/default-mappings";
import { layoutFromRow, parsePdfStatement, validateLayout } from "@/lib/import/pdf-parse";
import { createSafeMatcher } from "@/lib/import/safe-regex";

const lines = readFileSync(join(__dirname, "fixtures", "viseca-statement.txt"), "utf8").split(/\r?\n/);
const viseca = layoutFromRow(DEFAULT_PDF_LAYOUTS.find((l) => l.name === "Migros Kreditkarte (PDF)")!);

describe("Migros Kreditkarte (PDF) starter layout", () => {
  it("is a valid layout", () => {
    expect(validateLayout(viseca)).toBeNull();
  });

  it("reads all bookings of both cards with expense-negative signs", () => {
    const result = parsePdfStatement(lines, viseca);
    expect(result.transactions).toHaveLength(7);
    expect(result.transactions.reduce((sum, t) => sum + t.amountCents, 0)).toBe(-(23800 + 10370));
    expect(result.rejectedRows).toEqual([]);
  });

  it("matches the printed per-card totals without warnings except the skipped payment", () => {
    const result = parsePdfStatement(lines, viseca);
    expect(result.warnings).toEqual(["Übersprungen: 28.09.26 15.09.26 Ihre Zahlung - Danke  300.00 -"]);
  });

  it("reads a credit with trailing minus as positive", () => {
    const result = parsePdfStatement(lines, viseca);
    const refund = result.transactions.find((t) => t.description.startsWith("Testshop Rueckgabe"));
    expect(refund?.amountCents).toBe(1000);
  });

  it("puts merchant and category into description and the merchant name into counterparty", () => {
    const result = parsePdfStatement(lines, viseca);
    const first = result.transactions[0];
    expect(first).toMatchObject({
      date: "2026-09-26",
      amountCents: -15000,
      description: "Beispiel Pay**0001*, Zurich CH - Finanzdienstleistungen",
      counterparty: "Beispiel Pay**0001*",
    });
  });

  it("does not turn the exchange-rate line into a booking and keeps the CHF amount", () => {
    const result = parsePdfStatement(lines, viseca);
    const fx = result.transactions.find((t) => t.description.startsWith("SumUp"));
    expect(fx?.amountCents).toBe(-9685);
    expect(fx?.description).toBe("SumUp *Testlokal 54 R, Hamburg DE - Restaurants");
  });

  it("keeps the two identical bookings on the same day", () => {
    const result = parsePdfStatement(lines, viseca);
    expect(result.transactions.filter((t) => t.description.startsWith("Testmarkt Thun"))).toHaveLength(2);
  });

  it("warns per card when a printed total does not match", () => {
    const broken = lines.map((l) => (l.includes("XXXX 2222  103.70") ? l.replace("103.70", "104.70") : l));
    const result = parsePdfStatement(broken, viseca);
    expect(result.warnings).toContain("Summe für 4435 92XX XXXX 2222 weicht ab: gelesen 103.70, laut PDF 104.70.");
  });

  it("reads a trailing minus without a space as a credit", () => {
    const result = parsePdfStatement(["02.10.26 03.10.26 Testshop, Bern CH  10.00-"], viseca);
    expect(result.transactions[0].amountCents).toBe(1000);
  });

  it("checks a card whose printed total is negative", () => {
    const result = parsePdfStatement(
      [
        "4435 92XX XXXX 1111 Cumulus Kreditkarte, Anna Muster",
        "02.10.26 03.10.26 Testshop, Bern CH  10.00 -",
        "Warenhäuser",
        "Total Karte Cumulus Kreditkarte 4435 92XX XXXX 1111  10.00 -",
      ],
      viseca
    );
    expect(result.warnings).toEqual([]);
  });

  it("gives the same result through the vm-backed matcher", () => {
    expect(parsePdfStatement(lines, viseca, createSafeMatcher())).toEqual(parsePdfStatement(lines, viseca));
  });
});

describe("seedDefaultPdfLayouts", () => {
  it("creates missing layouts and skips existing names", async () => {
    const create = vi.fn();
    const prisma = {
      pdfLayout: {
        findMany: vi.fn().mockResolvedValue([{ name: "Migros Kreditkarte (PDF)" }]),
        create,
      },
    } as never;
    expect(await seedDefaultPdfLayouts(prisma)).toEqual({ created: 0, skipped: 1 });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the layout when none exists", async () => {
    const create = vi.fn();
    const prisma = { pdfLayout: { findMany: vi.fn().mockResolvedValue([]), create } } as never;
    expect(await seedDefaultPdfLayouts(prisma)).toEqual({ created: 1, skipped: 0 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
