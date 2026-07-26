import { describe, expect, it } from "vitest";
import { attachmentHeader, csvAmount, toCsv } from "@/lib/csv-export";

/** Strips the UTF-8 BOM so assertions read cleanly. */
function body(csv: string): string[] {
  return csv.replace(/^﻿/, "").split("\r\n");
}

describe("toCsv", () => {
  it("writes a BOM and semicolon-separated rows", () => {
    const csv = toCsv([{ a: "x", b: "y" }], [
      { header: "A", value: (r) => r.a },
      { header: "B", value: (r) => r.b },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(body(csv)).toEqual(["A;B", "x;y"]);
  });

  it("quotes fields containing the delimiter, quotes or newlines", () => {
    const rows = [{ v: 'a;b' }, { v: 'say "hi"' }, { v: "two\nlines" }];
    const csv = toCsv(rows, [{ header: "V", value: (r) => r.v }]);
    expect(body(csv).slice(1)).toEqual(['"a;b"', '"say ""hi"""', '"two\nlines"']);
  });

  it("renders null and undefined as empty cells", () => {
    const csv = toCsv([{ v: null }, { v: undefined }], [{ header: "V", value: (r) => r.v }]);
    expect(body(csv).slice(1)).toEqual(["", ""]);
  });
});

describe("formula injection", () => {
  // Descriptions and counterparties come from bank statements, and the payment
  // reference of an incoming transfer is chosen by the sender — so these values
  // can arrive without anyone in the household typing them.
  it.each([
    ["=cmd|'/c calc'!A0", "'=cmd|'/c calc'!A0"],
    ["+1+1", "'+1+1"],
    ["-1+1", "'-1+1"],
    ["@SUM(A1:A9)", "'@SUM(A1:A9)"],
    ["\tSUM(A1)", "'\tSUM(A1)"],
  ])("prefixes %j so the spreadsheet reads it as text", (input, expected) => {
    const csv = toCsv([{ v: input }], [{ header: "V", value: (r) => r.v }]);
    expect(body(csv)[1]).toBe(expected);
  });

  it("prefixes a formula that also needs RFC-4180 quoting", () => {
    const csv = toCsv([{ v: "=A1;B2" }], [{ header: "V", value: (r) => r.v }]);
    expect(body(csv)[1]).toBe(`"'=A1;B2"`);
  });

  it("leaves ordinary text untouched", () => {
    const csv = toCsv([{ v: "MIGROS ZUERICH" }], [{ header: "V", value: (r) => r.v }]);
    expect(body(csv)[1]).toBe("MIGROS ZUERICH");
  });

  it("keeps negative amounts numeric", () => {
    // A leading "-" makes this look like a formula, but quoting it would stop
    // the spreadsheet parsing the amount as a number.
    const csv = toCsv([{ v: csvAmount(-8240) }], [{ header: "V", value: (r) => r.v }]);
    expect(body(csv)[1]).toBe("-82.40");
  });
});

describe("csvAmount", () => {
  it("uses a decimal point and no thousands separator", () => {
    expect(csvAmount(123456)).toBe("1234.56");
    expect(csvAmount(-50)).toBe("-0.50");
    expect(csvAmount(0)).toBe("0.00");
  });
});

describe("attachmentHeader", () => {
  it("strips anything that would break out of the header", () => {
    expect(attachmentHeader('buchungen";\r\nX-Evil: 1.csv')).toBe(
      'attachment; filename="buchungen____X-Evil__1.csv"'
    );
  });
});
