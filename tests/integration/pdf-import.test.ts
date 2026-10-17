import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_PDF_LAYOUTS } from "@/lib/import/default-mappings";
import { buildTextPdf } from "../build-pdf";
import { createTestDb, seedBasics } from "./helpers";

const { prismaHolder, sessionHolder } = vi.hoisted(() => ({
  prismaHolder: { current: undefined as unknown },
  sessionHolder: { current: { user: { id: "1", role: "Editor", name: "Editor", email: "e@test.ch" } } },
}));

vi.mock("@/lib/prisma", () => ({
  get default() {
    return prismaHolder.current;
  },
  getDbPath: () => "/unused",
}));
vi.mock("@/lib/permissions", () => ({
  requireEditor: vi.fn(async () => sessionHolder.current),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { commitImportAction, inspectPdfAction, previewImportAction } from "@/app/(app)/import/actions";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let fixtures: Awaited<ReturnType<typeof seedBasics>>;
let layoutId: number;

function statementPdf() {
  return buildTextPdf([
    [
      { x: 50, y: 720, text: "4435 92XX XXXX 1111 Cumulus Kreditkarte, Anna Muster" },
      { x: 50, y: 700, text: "26.09.26 28.09.26 Testladen, Bern CH" },
      { x: 400, y: 700, text: "12.50" },
      { x: 50, y: 686, text: "Lebensmittel" },
      { x: 50, y: 660, text: "Total Karte Cumulus Kreditkarte 4435 92XX XXXX 1111" },
      { x: 400, y: 660, text: "12.50" },
    ],
  ]);
}

function pdfForm(fields: Record<string, string> = {}, bytes: Uint8Array = statementPdf()) {
  const data = new FormData();
  data.append("file", new File([bytes as BlobPart], "statement.pdf", { type: "application/pdf" }));
  data.append("format", "Pdf");
  data.append("layoutId", String(layoutId));
  data.append("accountId", String(fixtures.account.id));
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeAll(async () => {
  const db = createTestDb();
  prisma = db.prisma;
  cleanup = db.cleanup;
  prismaHolder.current = prisma;
  fixtures = await seedBasics(prisma);
  const editor = await prisma.user.create({
    data: { email: "e@test.ch", name: "Editor", passwordHash: "x", role: "Editor" },
  });
  sessionHolder.current = { user: { id: String(editor.id), role: "Editor", name: "Editor", email: "e@test.ch" } };
  layoutId = (await prisma.pdfLayout.create({ data: DEFAULT_PDF_LAYOUTS[0] })).id;
});

afterAll(async () => cleanup());

describe("previewImportAction with a PDF", () => {
  it("requires a layout", async () => {
    const data = pdfForm();
    data.delete("layoutId");
    expect((await previewImportAction(undefined, data)).error).toBe("Bitte ein PDF-Layout auswählen.");
  });

  it("rejects an unknown layout", async () => {
    expect((await previewImportAction(undefined, pdfForm({ layoutId: "999999" }))).error).toBe(
      "PDF-Layout nicht gefunden."
    );
  });

  it("requires a target account (PDF statements carry no IBAN)", async () => {
    const data = pdfForm();
    data.delete("accountId");
    expect((await previewImportAction(undefined, data)).error).toBe("Bitte das Zielkonto auswählen.");
  });

  it("returns a preview with the parsed booking and no sum warning", async () => {
    const result = await previewImportAction(undefined, pdfForm());
    expect(result.error).toBeUndefined();
    expect(result.preview?.format).toBe("Pdf");
    expect(result.preview?.rows).toHaveLength(1);
    expect(result.preview?.rows[0]).toMatchObject({
      date: "2026-09-26",
      amountCents: -1250,
      description: "Testladen, Bern CH - Lebensmittel",
      counterparty: "Testladen",
    });
    expect(result.preview?.warnings).toEqual([]);
  });

  it("returns the extraction error for a PDF without text", async () => {
    const result = await previewImportAction(undefined, pdfForm({}, buildTextPdf([[]])));
    expect(result.error).toBe("PDF enthält keinen lesbaren Text (Scan?).");
  });

  it("commits as Pdf and skips everything on a second read", async () => {
    const preview = (await previewImportAction(undefined, pdfForm())).preview!;
    const committed = await commitImportAction({
      accountId: preview.accountId,
      filename: preview.filename,
      format: preview.format,
      periodFrom: preview.periodFrom,
      periodTo: preview.periodTo,
      closingBalanceCents: preview.closingBalanceCents,
      rows: preview.rows.map((row) => ({
        date: row.date,
        amountCents: row.amountCents,
        description: row.description,
        counterparty: row.counterparty,
        bankReference: row.bankReference,
        hash: row.hash,
        categoryId: null,
        transferAccountId: null,
      })),
    });
    expect(committed).toMatchObject({ success: true, imported: 1 });
    expect((await prisma.importBatch.findFirst({ orderBy: { id: "desc" } }))?.format).toBe("Pdf");

    const again = (await previewImportAction(undefined, pdfForm())).preview!;
    expect(again.duplicateCount).toBe(1);
  });

  it("still recognises the duplicate after the layout's description template changed", async () => {
    await prisma.pdfLayout.update({ where: { id: layoutId }, data: { descriptionTemplate: "{text}" } });
    try {
      const preview = (await previewImportAction(undefined, pdfForm())).preview!;
      expect(preview.rows[0].description).toBe("Testladen, Bern CH");
      expect(preview.duplicateCount).toBe(1);
    } finally {
      await prisma.pdfLayout.update({
        where: { id: layoutId },
        data: { descriptionTemplate: DEFAULT_PDF_LAYOUTS[0].descriptionTemplate },
      });
    }
  });

  it("aborts a layout whose regex backtracks catastrophically", async () => {
    const evil = await prisma.pdfLayout.create({
      data: { ...DEFAULT_PDF_LAYOUTS[0], name: "Boese", transactionRegex: String.raw`^(?<date>(a+)+)(?<amount>b)$` },
    });
    const bytes = buildTextPdf([[{ x: 50, y: 700, text: `${"a".repeat(40)}c` }]]);
    const started = Date.now();
    const result = await previewImportAction(undefined, pdfForm({ layoutId: String(evil.id) }, bytes));
    expect(result.error).toBe(
      "Ein Regex im Layout braucht zu lange (vermutlich endloses Backtracking). Bitte vereinfachen."
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("inspectPdfAction", () => {
  it("returns the extracted lines", async () => {
    const data = new FormData();
    data.append("file", new File([statementPdf() as BlobPart], "s.pdf", { type: "application/pdf" }));
    const result = await inspectPdfAction(data);
    expect(result.lines).toContain("26.09.26 28.09.26 Testladen, Bern CH  12.50");
  });

  it("rejects an empty upload", async () => {
    expect((await inspectPdfAction(new FormData())).error).toBe("Bitte eine Datei auswählen.");
  });
});
