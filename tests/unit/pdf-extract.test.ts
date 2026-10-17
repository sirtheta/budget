import { describe, expect, it, vi } from "vitest";
import { buildTextPdf } from "../build-pdf";
import { PdfExtractError, extractPdfLines } from "@/lib/import/pdf";

describe("extractPdfLines", () => {
  it("joins columns on one baseline with two spaces and keeps reading order", async () => {
    const pdf = buildTextPdf([
      [
        { x: 50, y: 700, text: "26.09.26 28.09.26 Testladen, Bern CH" },
        { x: 400, y: 700, text: "150.00" },
        { x: 50, y: 686, text: "Finanzdienstleistungen" },
      ],
    ]);
    expect(await extractPdfLines(pdf)).toEqual([
      "26.09.26 28.09.26 Testladen, Bern CH  150.00",
      "Finanzdienstleistungen",
    ]);
  });

  it("reads all pages in order", async () => {
    const pdf = buildTextPdf([
      [{ x: 50, y: 700, text: "Seite eins" }],
      [{ x: 50, y: 700, text: "Seite zwei" }],
    ]);
    expect(await extractPdfLines(pdf)).toEqual(["Seite eins", "Seite zwei"]);
  });

  it("reports a PDF without any text as a probable scan", async () => {
    const pdf = buildTextPdf([[]]);
    await expect(extractPdfLines(pdf)).rejects.toThrow("PDF enthält keinen lesbaren Text (Scan?).");
  });

  it("reports garbage as unreadable", async () => {
    const error = await extractPdfLines(new Uint8Array([1, 2, 3, 4])).catch((e) => e);
    expect(error).toBeInstanceOf(PdfExtractError);
    expect(error.message).toBe("Das PDF konnte nicht gelesen werden.");
  });
});

describe("extractPdfLines with a password-protected document", () => {
  it("maps pdf.js's PasswordException to a clear message", async () => {
    vi.resetModules();
    vi.doMock("unpdf", () => ({
      getDocumentProxy: vi.fn().mockRejectedValue(Object.assign(new Error("No password given"), { name: "PasswordException" })),
    }));
    const { extractPdfLines: mocked } = await import("@/lib/import/pdf");
    await expect(mocked(new Uint8Array([1]))).rejects.toThrow("Das PDF ist passwortgeschützt.");
    vi.doUnmock("unpdf");
  });
});
