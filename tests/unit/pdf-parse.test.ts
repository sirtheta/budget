import { describe, expect, it } from "vitest";
import {
  analyzePdf,
  classifyLines,
  layoutFromRow,
  nativeMatcher,
  parseContextRules,
  parsePdfStatement,
  renderTemplate,
  validateLayout,
  type LineMatcher,
  type PdfLayoutConfig,
} from "@/lib/import/pdf-parse";

function layout(overrides: Partial<PdfLayoutConfig> = {}): PdfLayoutConfig {
  return {
    transactionRegex: String.raw`^(?<date>\d{2}\.\d{2}\.\d{2})\s+(?<text>.+?)\s{2,}(?<amount>[\d']+\.\d{2})(?:\s*-)?$`,
    dateFormat: "DD.MM.YY",
    negativeSuffixRegex: String.raw`\s-$`,
    invertAmount: true,
    descriptionTemplate: "{text}",
    skipRegex: null,
    totalRegex: null,
    contextRules: [],
    ...overrides,
  };
}

describe("validateLayout", () => {
  it("accepts a layout with the required groups", () => {
    expect(validateLayout(layout())).toBeNull();
  });

  it("rejects an invalid regex", () => {
    expect(validateLayout(layout({ transactionRegex: "(" }))).toBe("Buchungszeilen-Regex ist ungültig.");
  });

  it("requires the date and amount groups", () => {
    expect(validateLayout(layout({ transactionRegex: String.raw`^(?<date>\d+)$` }))).toBe(
      "Buchungszeilen-Regex braucht die Gruppen «date» und «amount»."
    );
  });

  it("rejects an unsupported date format", () => {
    expect(validateLayout(layout({ dateFormat: "XX" }))).toBe("Nicht unterstütztes Datumsformat.");
  });

  it("rejects an invalid optional regex and names it", () => {
    expect(validateLayout(layout({ skipRegex: "(" }))).toBe("Überspringen-Regex ist ungültig.");
    expect(validateLayout(layout({ negativeSuffixRegex: "(" }))).toBe("Gutschrift-Regex ist ungültig.");
  });

  it("requires an amount group in the total regex", () => {
    expect(validateLayout(layout({ totalRegex: "^Total" }))).toBe("Total-Regex braucht die Gruppe «amount».");
  });

  it("requires a named group in every context rule", () => {
    expect(validateLayout(layout({ contextRules: [{ regex: "^x$", target: "section" }] }))).toBe(
      "Kontext-Regel 1 braucht mindestens eine benannte Gruppe."
    );
  });
});

describe("parsePdfStatement", () => {
  it("parses a booking and inverts the sign (purchases are positive in the document)", () => {
    const result = parsePdfStatement(["26.09.26 Migros Bern  42.50"], layout());
    expect(result.transactions).toEqual([
      {
        date: "2026-09-26",
        amountCents: -4250,
        description: "Migros Bern",
        counterparty: "Migros Bern",
        bankReference: "pdf:2026-09-26||Migros Bern|4250|0",
      },
    ]);
    expect(result.periodFrom).toBe("2026-09-26");
    expect(result.periodTo).toBe("2026-09-26");
  });

  it("turns a trailing-minus credit into a positive amount", () => {
    const result = parsePdfStatement(["28.09.26 Rueckerstattung  12.00 -"], layout());
    expect(result.transactions[0].amountCents).toBe(1200);
  });

  it("keeps the document sign when invertAmount is off", () => {
    const result = parsePdfStatement(["26.09.26 Lohn  5'000.00"], layout({ invertAmount: false }));
    expect(result.transactions[0].amountCents).toBe(500000);
  });

  it("uses the text before the first comma as counterparty", () => {
    const result = parsePdfStatement(["26.09.26 Coop-1500 Steffisb, Steffisburg CH  3.60"], layout());
    expect(result.transactions[0].counterparty).toBe("Coop-1500 Steffisb");
  });

  it("falls back to the text prefix when the counterparty group is empty", () => {
    const result = parsePdfStatement(
      ["26.09.26 Coop, Bern  3.60"],
      layout({
        transactionRegex: String.raw`^(?<date>\d{2}\.\d{2}\.\d{2})\s(?<counterparty>\s?)(?<text>.+?)\s{2,}(?<amount>[\d']+\.\d{2})$`,
      })
    );
    expect(result.transactions[0].counterparty).toBe("Coop");
  });

  it("can fill a context group named like an Object.prototype member", () => {
    const result = parsePdfStatement(
      ["26.09.26 Kaffee  4.50", "Typ Genuss"],
      layout({
        descriptionTemplate: "{text} {constructor}",
        contextRules: [{ regex: String.raw`^Typ (?<constructor>\w+)$`, target: "transaction" }],
      })
    );
    expect(result.transactions[0].description).toBe("Kaffee Genuss");
  });

  it("rejects an impossible date with the reason", () => {
    const result = parsePdfStatement(["31.02.26 Test  1.00"], layout());
    expect(result.transactions).toHaveLength(0);
    expect(result.rejectedRows).toEqual([
      { line: 1, reason: 'Datum "31.02.26" passt nicht zum Format DD.MM.YY', raw: ["31.02.26 Test  1.00"] },
    ]);
  });

  it("rejects a zero amount", () => {
    const result = parsePdfStatement(["26.09.26 Test  0.00"], layout());
    expect(result.rejectedRows[0].reason).toBe("Betrag ist 0");
  });

  it("keeps two identical bookings on the same day", () => {
    const result = parsePdfStatement(["26.09.26 Kaffee  4.50", "26.09.26 Kaffee  4.50"], layout());
    expect(result.transactions).toHaveLength(2);
  });

  it("ignores lines that match nothing", () => {
    const result = parsePdfStatement(["Seite 1/3", "26.09.26 Test  1.00", "Fusszeile"], layout());
    expect(result.transactions).toHaveLength(1);
    expect(result.rejectedRows).toHaveLength(0);
  });

  it("skips lines matching skipRegex and warns when the line looked like a booking", () => {
    const result = parsePdfStatement(
      ["28.09.26 Ihre Zahlung - Danke  2'794.25 -", "26.09.26 Test  1.00"],
      layout({ skipRegex: "Ihre Zahlung" })
    );
    expect(result.transactions).toHaveLength(1);
    expect(result.warnings).toContain("Übersprungen: 28.09.26 Ihre Zahlung - Danke  2'794.25 -");
  });

  it("does not warn about skipped lines that were never bookings", () => {
    const result = parsePdfStatement(["Übertrag Total  649.00", "26.09.26 Test  1.00"], layout({ skipRegex: "Übertrag" }));
    expect(result.warnings.some((warning) => warning.startsWith("Übersprungen"))).toBe(false);
  });

  it("warns when nothing could be read", () => {
    const result = parsePdfStatement(["nichts"], layout());
    expect(result.warnings).toContain(
      "Aus der Datei konnte keine einzige Buchung gelesen werden. " +
        "Layout und Textansicht unter Import → Mappings → PDF-Layouts prüfen."
    );
  });

  it("warns about rejected rows", () => {
    const result = parsePdfStatement(["31.02.26 Test  1.00", "26.09.26 Ok  1.00"], layout());
    expect(result.warnings).toContain("1 Zeile(n) konnten nicht gelesen werden — Layout prüfen.");
  });

  it("throws the validation message for an unusable layout", () => {
    expect(() => parsePdfStatement([], layout({ transactionRegex: "(" }))).toThrow(
      "Buchungszeilen-Regex ist ungültig."
    );
  });

  it("ignores lines longer than the cap instead of running regexes on them", () => {
    const long = `26.09.26 ${"x".repeat(600)}  1.00`;
    const result = parsePdfStatement([long, "26.09.26 Ok  1.00"], layout());
    expect(result.transactions).toHaveLength(1);
  });
});

describe("sum check", () => {
  const withTotal = layout({ totalRegex: String.raw`^Total\s+(?<amount>[\d']+\.\d{2})$` });

  it("is silent when the printed total matches", () => {
    const result = parsePdfStatement(["26.09.26 A  1.00", "27.09.26 B  2.50", "Total  3.50"], withTotal);
    expect(result.warnings).toEqual([]);
  });

  it("warns when the printed total differs", () => {
    const result = parsePdfStatement(["26.09.26 A  1.00", "27.09.26 B  2.50", "Total  9.99"], withTotal);
    expect(result.warnings).toEqual(["Summe weicht ab: gelesen 3.50, laut PDF 9.99."]);
  });

  it("says so when no total line was found", () => {
    const result = parsePdfStatement(["26.09.26 A  1.00"], withTotal);
    expect(result.warnings).toEqual(["Im PDF wurde kein Gesamtbetrag gefunden — Summenprüfung nicht möglich."]);
  });

  it("says so when the layout has no total regex", () => {
    const result = parsePdfStatement(["26.09.26 A  1.00"], layout());
    expect(result.warnings).toEqual(["Keine Summenprüfung: Das Layout hat keine Total-Regex."]);
  });

  it("compares per key when the total regex has a key group", () => {
    const keyed = layout({
      totalRegex: String.raw`^Total (?<key>\w+)\s+(?<amount>[\d']+\.\d{2})$`,
      contextRules: [{ regex: "^Karte (?<key>\\w+)$", target: "section" }],
    });
    const lines = ["Karte A", "26.09.26 X  1.00", "Total A  1.00", "Karte B", "26.09.26 Y  2.00", "Total B  5.00"];
    expect(parsePdfStatement(lines, keyed).warnings).toEqual([
      "Summe für B weicht ab: gelesen 2.00, laut PDF 5.00.",
    ]);
  });
});

describe("bank reference", () => {
  it("is built from the raw date, valuta, text and document amount", () => {
    const withValuta = layout({
      transactionRegex: String.raw`^(?<date>\d{2}\.\d{2}\.\d{2})\s+(?<valuta>\d{2}\.\d{2}\.\d{2})\s+(?<text>.+?)\s{2,}(?<amount>[\d']+\.\d{2})$`,
    });
    const result = parsePdfStatement(["26.09.26 28.09.26 Revolut, Zurich CH  150.00"], withValuta);
    expect(result.transactions[0].bankReference).toBe("pdf:2026-09-26|28.09.26|Revolut, Zurich CH|15000|0");
  });

  it("numbers identical bookings so both import", () => {
    const result = parsePdfStatement(["26.09.26 Kaffee  4.50", "26.09.26 Kaffee  4.50"], layout());
    expect(result.transactions.map((t) => t.bankReference)).toEqual([
      "pdf:2026-09-26||Kaffee|450|0",
      "pdf:2026-09-26||Kaffee|450|1",
    ]);
  });

  it("does not depend on the description template or on context lines", () => {
    const lines = ["26.09.26 Migros  4.50", "Lebensmittel"];
    const category = { regex: "^(?<category>[^\\d]+)$", target: "transaction" as const };
    const plain = parsePdfStatement(lines, layout());
    const rich = parsePdfStatement(lines, layout({ descriptionTemplate: "{text} - {category}", contextRules: [category] }));
    expect(rich.transactions[0].description).toBe("Migros - Lebensmittel");
    expect(rich.transactions[0].bankReference).toBe(plain.transactions[0].bankReference);
  });

  it("is null when the layout has no text group", () => {
    const noText = layout({ transactionRegex: String.raw`^(?<date>\d{2}\.\d{2}\.\d{2})\s+.+?\s{2,}(?<amount>[\d']+\.\d{2})$` });
    expect(parsePdfStatement(["26.09.26 X  1.00"], noText).transactions[0].bankReference).toBeNull();
  });
});

describe("line matcher", () => {
  it("hands every regex the trimmed lines and blanks out ignored ones", () => {
    const seen: string[][] = [];
    const spy: LineMatcher = (source, lines) => {
      seen.push(lines);
      return nativeMatcher(source, lines);
    };
    parsePdfStatement(["  26.09.26 A  1.00  ", "x".repeat(600), ""], layout(), spy);
    expect(seen[0]).toEqual(["26.09.26 A  1.00", "", ""]);
  });

  it("analyzePdf evaluates each regex once for line kinds and result together", () => {
    const sources: string[] = [];
    const spy: LineMatcher = (source, lines) => {
      sources.push(source);
      return nativeMatcher(source, lines);
    };
    const { kinds, result } = analyzePdf(["26.09.26 A  1.00", "Footer"], layout(), spy);
    expect(kinds).toEqual(["transaction", "other"]);
    expect(result.transactions).toHaveLength(1);
    expect(sources).toHaveLength(2); // transaction regex + negative-suffix regex
  });
});

describe("renderTemplate", () => {
  it("fills placeholders", () => {
    expect(renderTemplate("{text} - {category}", { text: "Migros", category: "Lebensmittel" })).toBe("Migros - Lebensmittel");
  });

  it("drops a dangling separator when a group is missing", () => {
    expect(renderTemplate("{text} - {category}", { text: "Migros" })).toBe("Migros");
  });

  it("ignores placeholders named like Object.prototype members", () => {
    expect(renderTemplate("{text} {toString}", { text: "Migros" })).toBe("Migros");
    expect(renderTemplate("{constructor}", { constructor: "x" })).toBe("x");
  });

  it("returns an empty string when nothing is available", () => {
    expect(renderTemplate("{text}", {})).toBe("");
  });
});

describe("layoutFromRow / parseContextRules", () => {
  it("parses stored context rules", () => {
    expect(parseContextRules(JSON.stringify([{ regex: "^(?<a>x)$", target: "section" }]))).toEqual([
      { regex: "^(?<a>x)$", target: "section" },
    ]);
  });

  it("returns no rules for broken JSON or wrong shapes", () => {
    expect(parseContextRules("not json")).toEqual([]);
    expect(parseContextRules('{"a":1}')).toEqual([]);
    expect(parseContextRules('[{"regex":1,"target":"x"}]')).toEqual([]);
  });

  it("maps a database row to a config", () => {
    const config = layoutFromRow({
      transactionRegex: "r", dateFormat: "DD.MM.YY", negativeSuffixRegex: null, invertAmount: true,
      descriptionTemplate: "{text}", skipRegex: null, totalRegex: null, contextRegexes: "[]",
    });
    expect(config.contextRules).toEqual([]);
    expect(config.invertAmount).toBe(true);
  });
});

describe("classifyLines", () => {
  it("labels skip, total, transaction, context and other lines", () => {
    const config = layout({
      skipRegex: "^Zahlung",
      totalRegex: String.raw`^Total\s+(?<amount>[\d']+\.\d{2})$`,
      contextRules: [{ regex: "^Karte (?<key>\\d+)$", target: "section" }],
    });
    expect(
      classifyLines(["Zahlung x", "Total  5.00", "26.09.26 A  1.00", "Karte 123", "Footer"], config)
    ).toEqual(["skip", "total", "transaction", "context", "other"]);
  });
});
