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
// Real extraction by default; one test feeds oversized output that a PDF built
// by buildTextPdf cannot produce (pdf.js drops text beyond the page edge).
vi.mock("@/lib/import/pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/import/pdf")>();
  return { ...actual, extractPdfLines: vi.fn(actual.extractPdfLines) };
});

import { extractPdfLines } from "@/lib/import/pdf";
import { commitImportAction, inspectPdfAction, previewImportAction } from "@/app/(app)/import/actions";
import {
  deletePdfLayoutAction,
  previewPdfLayoutAction,
  savePdfLayoutAction,
  seedDefaultPdfLayoutsAction,
} from "@/app/(app)/import/pdf-layout-actions";

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

  it("caps the number and the length of the returned lines", async () => {
    const extracted = ["a".repeat(3000), ...Array.from({ length: 2500 }, (_, index) => `Zeile ${index}`)];
    vi.mocked(extractPdfLines).mockResolvedValueOnce(extracted);
    const data = new FormData();
    data.append("file", new File([statementPdf() as BlobPart], "long.pdf", { type: "application/pdf" }));
    const result = await inspectPdfAction(data);
    expect(result.lines).toHaveLength(2000);
    expect(result.lines?.[0]).toBe("a".repeat(2000));
    expect(result.lines?.[1]).toBe("Zeile 0");
  });

  it("rejects an empty upload", async () => {
    expect((await inspectPdfAction(new FormData())).error).toBe("Bitte eine Datei auswählen.");
  });
});

function layoutForm(fields: Record<string, string> = {}) {
  const data = new FormData();
  const base: Record<string, string> = {
    name: "Testkarte",
    transactionRegex: String.raw`^(?<date>\d{2}\.\d{2}\.\d{2})\s+(?<text>.+?)\s{2,}(?<amount>[\d']+\.\d{2})$`,
    dateFormat: "DD.MM.YY",
    negativeSuffixRegex: "",
    descriptionTemplate: "{text}",
    skipRegex: "",
    totalRegex: "",
    contextRegexes: "[]",
  };
  for (const [key, value] of Object.entries({ ...base, ...fields })) data.set(key, value);
  return data;
}

describe("PDF layout actions", () => {
  it("creates a layout", async () => {
    expect(await savePdfLayoutAction(undefined, layoutForm())).toEqual({ success: true });
    const row = await prisma.pdfLayout.findUnique({ where: { name: "Testkarte" } });
    expect(row).toMatchObject({ dateFormat: "DD.MM.YY", invertAmount: false, skipRegex: null, contextRegexes: "[]" });
  });

  it("rejects a duplicate name", async () => {
    expect((await savePdfLayoutAction(undefined, layoutForm())).error).toBe(
      "Ein Layout mit diesem Namen existiert bereits."
    );
  });

  it("rejects an invalid regex with the validation message", async () => {
    const result = await savePdfLayoutAction(undefined, layoutForm({ name: "Kaputt", transactionRegex: "(" }));
    expect(result.error).toBe("Buchungszeilen-Regex ist ungültig.");
  });

  it("rejects a missing name", async () => {
    expect((await savePdfLayoutAction(undefined, layoutForm({ name: " " }))).error).toBe("Name darf nicht leer sein.");
  });

  it("rejects broken context-rule JSON", async () => {
    const result = await savePdfLayoutAction(undefined, layoutForm({ name: "Json", contextRegexes: "nope" }));
    expect(result.error).toBe("Kontext-Regeln sind ungültig.");
  });

  it("rejects more than 20 context rules", async () => {
    const rule = { regex: "^(?<a>x)$", target: "section" };
    const result = await savePdfLayoutAction(
      undefined,
      layoutForm({ name: "Viele", contextRegexes: JSON.stringify(Array.from({ length: 21 }, () => rule)) })
    );
    expect(result.error).toBe("Höchstens 20 Kontext-Regeln mit je 2000 Zeichen.");
    expect(await prisma.pdfLayout.findUnique({ where: { name: "Viele" } })).toBeNull();
  });

  it("rejects a context rule longer than 2000 characters", async () => {
    const regex = `^(?<a>${"x".repeat(2000)})$`;
    const result = await savePdfLayoutAction(
      undefined,
      layoutForm({ name: "Lang", contextRegexes: JSON.stringify([{ regex, target: "section" }]) })
    );
    expect(result.error).toBe("Höchstens 20 Kontext-Regeln mit je 2000 Zeichen.");
  });

  it("stores context rules with the known keys only", async () => {
    const submitted = [{ regex: "^Typ (?<category>\\w+)$", target: "transaction", extra: "drop me" }];
    const result = await savePdfLayoutAction(
      undefined,
      layoutForm({ name: "Mit Regel", contextRegexes: JSON.stringify(submitted) })
    );
    expect(result).toEqual({ success: true });
    const row = await prisma.pdfLayout.findUniqueOrThrow({ where: { name: "Mit Regel" } });
    expect(JSON.parse(row.contextRegexes)).toEqual([{ regex: "^Typ (?<category>\\w+)$", target: "transaction" }]);
  });

  it("updates an existing layout", async () => {
    const row = await prisma.pdfLayout.findUniqueOrThrow({ where: { name: "Testkarte" } });
    const data = layoutForm({ name: "Testkarte 2" });
    data.set("id", String(row.id));
    data.set("invertAmount", "on");
    expect(await savePdfLayoutAction(undefined, data)).toEqual({ success: true });
    expect(await prisma.pdfLayout.findUnique({ where: { id: row.id } })).toMatchObject({
      name: "Testkarte 2",
      invertAmount: true,
    });
  });

  it("writes audit rows for create and update", async () => {
    const actions = await prisma.auditLog.findMany({ where: { entityType: "PdfLayout" }, select: { action: true } });
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["CREATE", "UPDATE"]));
  });

  it("deletes a layout", async () => {
    const row = await prisma.pdfLayout.findUniqueOrThrow({ where: { name: "Testkarte 2" } });
    expect(await deletePdfLayoutAction(row.id)).toEqual({ success: true });
    expect(await prisma.pdfLayout.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it("seeds the starter layout once", async () => {
    await prisma.pdfLayout.deleteMany({ where: { name: "Migros Kreditkarte (PDF)" } });
    expect(await seedDefaultPdfLayoutsAction()).toEqual({ success: true, created: 1 });
    expect(await seedDefaultPdfLayoutsAction()).toEqual({ success: true, created: 0 });
  });
});

describe("previewPdfLayoutAction", () => {
  const config = {
    transactionRegex: String.raw`^(?<date>\d{2}\.\d{2}\.\d{2})\s+(?<text>.+?)\s{2,}(?<amount>[\d']+\.\d{2})$`,
    dateFormat: "DD.MM.YY",
    negativeSuffixRegex: null,
    invertAmount: true,
    descriptionTemplate: "{text}",
    skipRegex: null,
    totalRegex: null,
    contextRules: [],
  };

  it("returns line kinds and the parse result", async () => {
    const response = await previewPdfLayoutAction({ lines: ["26.09.26 Migros  4.50", "Footer"], layout: config });
    expect(response.kinds).toEqual(["transaction", "other"]);
    expect(response.result?.transactions).toHaveLength(1);
  });

  it("reports an invalid layout", async () => {
    const response = await previewPdfLayoutAction({ lines: [], layout: { ...config, transactionRegex: "(" } });
    expect(response.error).toBe("Buchungszeilen-Regex ist ungültig.");
  });

  it("aborts a catastrophic regex with a message instead of hanging", async () => {
    const started = Date.now();
    const response = await previewPdfLayoutAction({
      lines: [`${"a".repeat(40)}c`],
      layout: { ...config, transactionRegex: String.raw`^(?<date>(a+)+)(?<amount>b)$` },
    });
    expect(response.error).toBe(
      "Ein Regex im Layout braucht zu lange (vermutlich endloses Backtracking). Bitte vereinfachen."
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("rejects malformed input", async () => {
    expect((await previewPdfLayoutAction({ nope: 1 })).error).toBe("Ungültige Vorschau-Daten.");
  });
});
