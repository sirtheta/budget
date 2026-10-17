# PDF Statement Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import credit-card statements delivered as PDF (first target: Viseca / Migros Bank Cumulus) through user-editable regex layouts, reusing the existing import preview/commit pipeline.

**Architecture:** A new `PdfLayout` model stores regexes per issuer. `lib/import/pdf.ts` (server only) extracts text lines from the PDF with `unpdf`; `lib/import/pdf-parse.ts` (pure, client-safe) turns lines + layout into a `ParsedStatement`. `previewImportAction` gets a `Pdf` branch; a layout dialog with live preview manages layouts.

**Tech Stack:** Next.js 16 Server Actions, Prisma 7 + SQLite, `unpdf` 1.9.0 (pdfjs, pure JS), Vitest 5, Playwright, zod 4.

**Spec:** `docs/superpowers/specs/2026-10-17-pdf-import-design.md`

## Global Constraints

- UI text, error messages, warnings: **German**. Code, comments, commit messages: **English**. Commits follow Conventional Commits (`feat(import): …`), each ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Amounts are signed integer Rappen; negative = expense (`lib/money.ts`). Never floats in the DB.
- `lib/import/pdf-parse.ts` must not import Prisma runtime, `unpdf`, `fs`, or `pino` (it runs in the browser for the live preview). Type-only Prisma imports are fine.
- Next.js 16: before touching routing or server-action conventions check `node_modules/next/dist/docs/`. This plan only adds files that follow patterns already used in `app/(app)/import/`.
- Uploads are read in the request and discarded; the PDF is never stored (it holds card numbers and an address). No real statement in the repo — fixtures contain invented data only.
- Vitest coverage thresholds (statements 85, branches 75, functions 87, lines 87) apply to `lib/**` and `app/**/actions.ts`; new lib code ships with tests.
- Git: work on a feature branch off the spec branch (`feat/pdf-import`), never commit to `main` directly. `scripts/viseca-pdf-to-csv.py` stays untracked and is not part of this plan.

## Deviations from the spec (decided while planning)

- `PdfLayout` has **no** `decimalSeparator`/`thousandsSeparator`: `CsvMapping` stores them but `parseCsvStatement` never reads them — `parseMoney` already handles `1'234.50`, `1 234,50` and `1.234,50`. Task 1 fixes the spec text.
- The sum-check section key is a reserved named group `key` (in a section context regex and in the total regex). Without `key` in the total regex, all transactions are summed against the sum of all printed totals.
- A `target: "transaction"` context line only attaches while the previous line was that transaction or another `transaction` context line (a "run" directly after the booking). Any other line closes it. This stops page headers from becoming a category.
- "No transaction read" is a warning (same text as CSV), not a thrown error, so the preview shows the cause next to `rejectedRows`.
- No `iban` group and no deterministic pathological-regex test (see spec edits in Task 1, Step 5); the 500-character line cap is the protection and is tested.

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + new migration | `ImportFormat.Pdf`, model `PdfLayout` |
| `lib/import/csv.ts` (modify) | add `DD.MM.YY` to `parseCsvDate` |
| `lib/import/pdf-parse.ts` (create) | `PdfLayoutConfig`, `validateLayout`, `parsePdfStatement`, `classifyLines`, `layoutFromRow`, `parseContextRules` — pure |
| `lib/import/pdf.ts` (create) | `extractPdfLines`, `PdfExtractError` — server only |
| `lib/import/default-mappings.ts` (modify) | `DEFAULT_PDF_LAYOUTS`, `seedDefaultPdfLayouts` |
| `app/(app)/import/actions.ts` (modify) | `Pdf` branch in `previewImportAction`, `inspectPdfAction`, bytes upload |
| `app/(app)/import/pdf-layout-actions.ts` (create) | save / delete / seed layouts |
| `app/(app)/import/pdf-layout-dialog.tsx` (create) | layout form + live preview |
| `app/(app)/import/seed-default-pdf-layouts-button.tsx` (create) | one-click starter layout |
| `app/(app)/import/import-history.tsx` (modify) | `DeletePdfLayoutButton` |
| `app/(app)/import/import-wizard.tsx`, `page.tsx` (modify) | third format, layout select, Mappings tab |
| `tests/build-pdf.ts` (create) | `buildTextPdf` — hand-built PDF for tests |
| `tests/unit/pdf-parse.test.ts`, `pdf-extract.test.ts`, `tests/unit/fixtures/viseca-statement.txt` | unit tests |
| `tests/integration/pdf-import.test.ts` | actions against a real test DB |
| `tests/e2e/pdf-import.spec.ts` | one UI pass |
| `CLAUDE.md`, `public/benutzerhandbuch.html` | docs |

---

### Task 1: Dependency, schema, migration

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Modify: `prisma/schema.prisma` (`ImportFormat` enum at ~line 376, new model after `CsvMapping` at ~line 497)
- Create: `prisma/migrations/<timestamp>_add_pdf_layout/migration.sql` (generated)
- Modify: `docs/superpowers/specs/2026-10-17-pdf-import-design.md`

**Interfaces:**
- Produces: Prisma model `PdfLayout` with fields `id, name, transactionRegex, dateFormat, negativeSuffixRegex, invertAmount, descriptionTemplate, skipRegex, totalRegex, contextRegexes (JSON string), createdAt, updatedAt`; enum member `ImportFormat.Pdf`.

- [ ] **Step 1: Create the feature branch**

```bash
git switch docs/pdf-import-spec && git switch -c feat/pdf-import
```

- [ ] **Step 2: Install unpdf**

```bash
npm install unpdf@1.9.0
```
Expected: `package.json` gains `"unpdf": "1.9.0"` under `dependencies`.

- [ ] **Step 3: Extend the schema**

In `prisma/schema.prisma` change the enum:

```prisma
enum ImportFormat {
  Camt053
  Csv
  Pdf
}
```

Add after the `CsvMapping` model (before the `// ── Audit log` banner):

```prisma
/// How the transaction lines of one issuer's PDF statement look once the PDF
/// text has been extracted line by line (lib/import/pdf.ts). The regexes use
/// named groups; see lib/import/pdf-parse.ts for which names carry meaning.
model PdfLayout {
  id   Int    @id @default(autoincrement())
  name String @unique

  /// One booking line. Required groups: date, amount. Optional: valuta, text,
  /// counterparty, currency, foreignAmount, key.
  transactionRegex String
  dateFormat       String  @default("DD.MM.YY")
  /// Tested against the whole booking line; a match makes the amount negative
  /// (credits and refunds that carry a trailing minus).
  negativeSuffixRegex String?
  /// Same meaning as CsvMapping.invertAmount.
  invertAmount        Boolean @default(false)
  /// `{group}` placeholders filled from the line's named groups.
  descriptionTemplate String  @default("{text}")
  /// Lines that are never bookings (payments, carry-overs).
  skipRegex           String?
  /// Printed totals for the sum check; group `amount`, optional group `key`.
  totalRegex          String?
  /// JSON array of { regex, target: "section" | "transaction" }.
  contextRegexes      String  @default("[]")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 4: Generate and apply the migration**

```bash
npx prisma migrate dev --name add_pdf_layout
```
Expected: a new folder `prisma/migrations/<timestamp>_add_pdf_layout/` containing `CREATE TABLE "PdfLayout"` and `CREATE UNIQUE INDEX "PdfLayout_name_key"`; Prisma client regenerated. SQLite stores enums as TEXT, so `Pdf` needs no SQL.

- [ ] **Step 5: Fix the spec text for the removed separators**

In `docs/superpowers/specs/2026-10-17-pdf-import-design.md` delete the bullet `- \`decimalSeparator\`, \`thousandsSeparator\` — defaults \`.\` and \`'\`.` and in "Parse flow" step 3 replace "using the layout separators" with "(it already accepts `1'234.50`, `1 234,50` and `1.234,50`)". Also add one sentence to the `contextRegexes` bullet: "A `transaction` context only applies while the previous line was that booking or another `transaction` context line." In "Parse flow" delete the sentence "`iban` is `null` unless the layout supplies a group `iban`, so the target account is chosen in the wizard." and replace it with "`iban` is always `null` (statements like the Viseca bill carry none), so the target account is chosen in the wizard." In "Tests" delete "pathological regex and" from the `pdf-parse` edge-case list (a pathological pattern cannot be asserted deterministically; the line-length cap is the protection and has its own test) and add `sum check per card key` to that list.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npm test -- --run tests/integration/import-action.test.ts
```
Expected: no type errors; the existing integration tests still pass (they replay all migrations, so this also proves the new SQL is valid).

```bash
git add package.json package-lock.json prisma docs/superpowers/specs/2026-10-17-pdf-import-design.md
git commit -m "feat(import): add PdfLayout model and Pdf import format"
```

---

### Task 2: `DD.MM.YY` date format

**Files:**
- Modify: `lib/import/csv.ts:92-120`
- Test: `tests/unit/csv.test.ts`

**Interfaces:**
- Produces: `parseCsvDate(value, "DD.MM.YY")` returning `YYYY-MM-DD` with the year read as `20YY`. `SUPPORTED_DATE_FORMATS` now contains `"DD.MM.YY"` (CSV mapping dialog offers it too — harmless).

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("parseCsvDate", …)` block of `tests/unit/csv.test.ts` (create the block at the end of the file if it does not exist):

```ts
describe("parseCsvDate DD.MM.YY", () => {
  it("reads a two-digit year as 20YY", () => {
    expect(parseCsvDate("26.09.26", "DD.MM.YY")).toBe("2026-09-26");
  });

  it("does not accept a four-digit year for the two-digit format", () => {
    expect(parseCsvDate("26.09.2026", "DD.MM.YY")).toBeNull();
  });

  it("rejects impossible dates", () => {
    expect(parseCsvDate("31.02.26", "DD.MM.YY")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/csv.test.ts -t "DD.MM.YY"`
Expected: FAIL (`parseCsvDate` returns `null` because the format is unknown).

- [ ] **Step 3: Implement**

In `lib/import/csv.ts` add the pattern to `DATE_PATTERNS` (after `"DD.MM.YYYY"`):

```ts
  "DD.MM.YY": /^(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)/,
```

and in `parseCsvDate` extend the destructuring branch so the year is expanded:

```ts
  let year: string, month: string, day: string;
  if (format === "YYYY-MM-DD") {
    [, year, month, day] = match;
  } else if (format === "MM/DD/YYYY") {
    [, month, day, year] = match;
  } else {
    [, day, month, year] = match;
  }
  if (format === "DD.MM.YY") year = `20${year}`;
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run tests/unit/csv.test.ts`
Expected: all csv tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/import/csv.ts tests/unit/csv.test.ts
git commit -m "feat(import): accept DD.MM.YY dates in statement parsing"
```

---

### Task 3: PDF parser core (`pdf-parse.ts`)

**Files:**
- Create: `lib/import/pdf-parse.ts`
- Test: `tests/unit/pdf-parse.test.ts`

**Interfaces:**
- Consumes: `parseMoney` (`lib/money.ts`), `parseCsvDate` + `SUPPORTED_DATE_FORMATS` (`lib/import/csv.ts`), `ParsedStatement`/`ParsedTransaction` (`lib/import/types.ts`), `formatMoney` (`lib/money.ts`).
- Produces (exact):

```ts
export const MAX_PDF_LINE_LENGTH = 500;
export type ContextTarget = "section" | "transaction";
export interface ContextRule { regex: string; target: ContextTarget }
export interface PdfLayoutConfig {
  transactionRegex: string;
  dateFormat: string;
  negativeSuffixRegex: string | null;
  invertAmount: boolean;
  descriptionTemplate: string;
  skipRegex: string | null;
  totalRegex: string | null;
  contextRules: ContextRule[];
}
export interface PdfLayoutRow {            // structural subset of the Prisma PdfLayout
  transactionRegex: string; dateFormat: string; negativeSuffixRegex: string | null;
  invertAmount: boolean; descriptionTemplate: string; skipRegex: string | null;
  totalRegex: string | null; contextRegexes: string;
}
export interface PdfParseResult extends ParsedStatement {
  rejectedRows: { line: number; reason: string; raw: string[] }[];
}
export type LineKind = "transaction" | "context" | "skip" | "total" | "other";
export function validateLayout(layout: PdfLayoutConfig): string | null;
export function parsePdfStatement(lines: string[], layout: PdfLayoutConfig): PdfParseResult;
export function classifyLines(lines: string[], layout: PdfLayoutConfig): LineKind[];
export function layoutFromRow(row: PdfLayoutRow): PdfLayoutConfig;
export function parseContextRules(json: string): ContextRule[];
export function renderTemplate(template: string, groups: Record<string, string>): string;
```

Behaviour (spec "Parse flow"): per line in order — skip → total → transaction → context rules (first matching rule wins; `section` merges groups into the section state, `transaction` fills missing groups of the open booking) → otherwise ignore and close the open booking. Descriptions are rendered after the whole walk.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/pdf-parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  classifyLines,
  layoutFromRow,
  parseContextRules,
  parsePdfStatement,
  renderTemplate,
  validateLayout,
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
      { date: "2026-09-26", amountCents: -4250, description: "Migros Bern", counterparty: "Migros Bern", bankReference: null },
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
    expect(result.warnings).toContain("Aus der Datei konnte keine einzige Buchung gelesen werden.");
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

describe("renderTemplate", () => {
  it("fills placeholders", () => {
    expect(renderTemplate("{text} - {category}", { text: "Migros", category: "Lebensmittel" })).toBe("Migros - Lebensmittel");
  });

  it("drops a dangling separator when a group is missing", () => {
    expect(renderTemplate("{text} - {category}", { text: "Migros" })).toBe("Migros");
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
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/pdf-parse.test.ts`
Expected: FAIL — cannot resolve `@/lib/import/pdf-parse`.

- [ ] **Step 3: Implement `lib/import/pdf-parse.ts`**

```ts
import { formatMoney, parseMoney } from "@/lib/money";
import { SUPPORTED_DATE_FORMATS, parseCsvDate } from "@/lib/import/csv";
import type { ParsedStatement, ParsedTransaction } from "@/lib/import/types";

/**
 * Turns the text lines of a PDF statement into bookings, driven by a
 * user-defined layout (see `PdfLayout` in the schema).
 *
 * Pure on purpose — no Prisma, no PDF library — because the layout dialog runs
 * it in the browser for its live preview. The PDF → lines step lives in
 * lib/import/pdf.ts.
 *
 * Lines longer than MAX_PDF_LINE_LENGTH are ignored: the regexes are user
 * input, and capping the line keeps a badly written one from stalling the
 * server on a pathological line.
 */

export const MAX_PDF_LINE_LENGTH = 500;

export type ContextTarget = "section" | "transaction";

export interface ContextRule {
  regex: string;
  target: ContextTarget;
}

export interface PdfLayoutConfig {
  transactionRegex: string;
  dateFormat: string;
  negativeSuffixRegex: string | null;
  invertAmount: boolean;
  descriptionTemplate: string;
  skipRegex: string | null;
  totalRegex: string | null;
  contextRules: ContextRule[];
}

/** The fields of the Prisma `PdfLayout` this module needs. */
export interface PdfLayoutRow {
  transactionRegex: string;
  dateFormat: string;
  negativeSuffixRegex: string | null;
  invertAmount: boolean;
  descriptionTemplate: string;
  skipRegex: string | null;
  totalRegex: string | null;
  contextRegexes: string;
}

export interface PdfParseResult extends ParsedStatement {
  /** Lines that looked like bookings but could not be read, with the reason. */
  rejectedRows: { line: number; reason: string; raw: string[] }[];
}

export type LineKind = "transaction" | "context" | "skip" | "total" | "other";

function groupNames(source: string): string[] {
  return [...source.matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((match) => match[1]);
}

function compile(source: string | null): RegExp | null {
  if (!source) return null;
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

/** A German message when the layout cannot be used, otherwise null. */
export function validateLayout(layout: PdfLayoutConfig): string | null {
  if (!compile(layout.transactionRegex)) return "Buchungszeilen-Regex ist ungültig.";
  const groups = groupNames(layout.transactionRegex);
  if (!groups.includes("date") || !groups.includes("amount")) {
    return "Buchungszeilen-Regex braucht die Gruppen «date» und «amount».";
  }
  if (!SUPPORTED_DATE_FORMATS.includes(layout.dateFormat)) return "Nicht unterstütztes Datumsformat.";
  if (layout.negativeSuffixRegex && !compile(layout.negativeSuffixRegex)) return "Gutschrift-Regex ist ungültig.";
  if (layout.skipRegex && !compile(layout.skipRegex)) return "Überspringen-Regex ist ungültig.";
  if (layout.totalRegex) {
    if (!compile(layout.totalRegex)) return "Total-Regex ist ungültig.";
    if (!groupNames(layout.totalRegex).includes("amount")) return "Total-Regex braucht die Gruppe «amount».";
  }
  for (const [index, rule] of layout.contextRules.entries()) {
    if (!compile(rule.regex)) return `Kontext-Regel ${index + 1} ist ungültig.`;
    if (groupNames(rule.regex).length === 0) {
      return `Kontext-Regel ${index + 1} braucht mindestens eine benannte Gruppe.`;
    }
  }
  return null;
}

/** Fills `{group}` placeholders; a missing group leaves no dangling separator behind. */
export function renderTemplate(template: string, groups: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, name: string) => groups[name]?.trim() ?? "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s-]+|[\s-]+$/g, "")
    .trim();
}

function definedGroups(groups: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(groups)) {
    if (value !== undefined) result[name] = value;
  }
  return result;
}

interface Draft {
  date: string;
  amountCents: number;
  /** Amount with the document's sign convention, for the sum check. */
  documentCents: number;
  key: string;
  groups: Record<string, string>;
}

export function parsePdfStatement(lines: string[], layout: PdfLayoutConfig): PdfParseResult {
  const problem = validateLayout(layout);
  if (problem) throw new Error(problem);

  const transactionRe = new RegExp(layout.transactionRegex);
  const negativeRe = compile(layout.negativeSuffixRegex);
  const skipRe = compile(layout.skipRegex);
  const totalRe = compile(layout.totalRegex);
  const contexts = layout.contextRules.map((rule) => ({ re: new RegExp(rule.regex), target: rule.target }));

  const rejectedRows: PdfParseResult["rejectedRows"] = [];
  const warnings: string[] = [];
  const drafts: Draft[] = [];
  const printedTotals = new Map<string, number>();
  let section: Record<string, string> = {};
  // The booking whose following lines may still add groups (category, rate).
  let open: Draft | null = null;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const lineNumber = index + 1;
    if (!line || line.length > MAX_PDF_LINE_LENGTH) {
      open = null;
      return;
    }

    if (skipRe?.test(line)) {
      if (transactionRe.test(line)) warnings.push(`Übersprungen: ${line}`);
      open = null;
      return;
    }

    const total = totalRe?.exec(line);
    if (total?.groups) {
      const cents = parseMoney(total.groups.amount ?? "");
      if (cents !== null) {
        const key = total.groups.key ?? "";
        printedTotals.set(key, (printedTotals.get(key) ?? 0) + cents);
      }
      open = null;
      return;
    }

    const match = transactionRe.exec(line);
    if (match?.groups) {
      open = null;
      const groups = match.groups;
      const date = parseCsvDate(groups.date ?? "", layout.dateFormat);
      if (!date) {
        rejectedRows.push({
          line: lineNumber,
          reason: `Datum "${groups.date}" passt nicht zum Format ${layout.dateFormat}`,
          raw: [raw],
        });
        return;
      }
      let cents = parseMoney(groups.amount ?? "");
      if (cents === null) {
        rejectedRows.push({ line: lineNumber, reason: "Kein lesbarer Betrag gefunden", raw: [raw] });
        return;
      }
      if (cents === 0) {
        rejectedRows.push({ line: lineNumber, reason: "Betrag ist 0", raw: [raw] });
        return;
      }
      if (negativeRe?.test(line)) cents = -Math.abs(cents);
      const merged = { ...section, ...definedGroups(groups) };
      const draft: Draft = {
        date,
        amountCents: layout.invertAmount ? -cents : cents,
        documentCents: cents,
        key: merged.key ?? "",
        groups: merged,
      };
      drafts.push(draft);
      open = draft;
      return;
    }

    for (const context of contexts) {
      const found = context.re.exec(line);
      if (!found?.groups) continue;
      const values = definedGroups(found.groups);
      if (context.target === "section") {
        section = { ...section, ...values };
        open = null;
      } else if (open) {
        for (const [name, value] of Object.entries(values)) {
          if (!(name in open.groups)) open.groups[name] = value;
        }
      }
      return;
    }

    open = null;
  });

  const transactions: ParsedTransaction[] = drafts.map((draft) => ({
    date: draft.date,
    amountCents: draft.amountCents,
    description:
      renderTemplate(layout.descriptionTemplate, draft.groups) || draft.groups.text?.trim() || "Ohne Beschreibung",
    counterparty: (draft.groups.counterparty ?? draft.groups.text?.split(",")[0] ?? "").trim() || null,
    bankReference: null,
  }));

  if (transactions.length === 0) {
    warnings.push("Aus der Datei konnte keine einzige Buchung gelesen werden.");
  }
  if (rejectedRows.length > 0) {
    warnings.push(`${rejectedRows.length} Zeile(n) konnten nicht gelesen werden — Layout prüfen.`);
  }
  warnings.push(...sumCheck(drafts, printedTotals, Boolean(layout.totalRegex)));

  const dates = transactions.map((t) => t.date).sort();
  return {
    transactions,
    rejectedRows,
    iban: null,
    currency: null,
    closingBalanceCents: null,
    openingBalanceCents: null,
    periodFrom: dates[0] ?? null,
    periodTo: dates[dates.length - 1] ?? null,
    warnings,
  };
}

/**
 * Compares what was read with the totals printed in the statement. A mismatch
 * is a warning, not an abort: the user sees it above the preview and decides.
 */
function sumCheck(drafts: Draft[], printed: Map<string, number>, hasTotalRegex: boolean): string[] {
  if (!hasTotalRegex) return ["Keine Summenprüfung: Das Layout hat keine Total-Regex."];
  if (printed.size === 0) return ["Im PDF wurde kein Gesamtbetrag gefunden — Summenprüfung nicht möglich."];

  const messages: string[] = [];
  if (printed.size === 1 && printed.has("")) {
    const read = drafts.reduce((sum, draft) => sum + draft.documentCents, 0);
    const expected = printed.get("") ?? 0;
    if (read !== expected) {
      messages.push(`Summe weicht ab: gelesen ${formatMoney(read)}, laut PDF ${formatMoney(expected)}.`);
    }
    return messages;
  }

  const sums = new Map<string, number>();
  for (const draft of drafts) sums.set(draft.key, (sums.get(draft.key) ?? 0) + draft.documentCents);
  for (const [key, expected] of printed) {
    const read = sums.get(key) ?? 0;
    if (read !== expected) {
      messages.push(`Summe für ${key} weicht ab: gelesen ${formatMoney(read)}, laut PDF ${formatMoney(expected)}.`);
    }
  }
  return messages;
}

/** Which role each line plays — drives the colouring in the layout dialog. */
export function classifyLines(lines: string[], layout: PdfLayoutConfig): LineKind[] {
  if (validateLayout(layout)) return lines.map(() => "other");
  const transactionRe = new RegExp(layout.transactionRegex);
  const skipRe = compile(layout.skipRegex);
  const totalRe = compile(layout.totalRegex);
  const contexts = layout.contextRules.map((rule) => new RegExp(rule.regex));
  return lines.map((raw) => {
    const line = raw.trim();
    if (!line || line.length > MAX_PDF_LINE_LENGTH) return "other";
    if (skipRe?.test(line)) return "skip";
    if (totalRe?.test(line)) return "total";
    if (transactionRe.test(line)) return "transaction";
    if (contexts.some((re) => re.test(line))) return "context";
    return "other";
  });
}

export function parseContextRules(json: string): ContextRule[] {
  try {
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (item): item is ContextRule =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ContextRule).regex === "string" &&
        ((item as ContextRule).target === "section" || (item as ContextRule).target === "transaction")
    );
  } catch {
    return [];
  }
}

export function layoutFromRow(row: PdfLayoutRow): PdfLayoutConfig {
  return {
    transactionRegex: row.transactionRegex,
    dateFormat: row.dateFormat,
    negativeSuffixRegex: row.negativeSuffixRegex,
    invertAmount: row.invertAmount,
    descriptionTemplate: row.descriptionTemplate,
    skipRegex: row.skipRegex,
    totalRegex: row.totalRegex,
    contextRules: parseContextRules(row.contextRegexes),
  };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run tests/unit/pdf-parse.test.ts`
Expected: all tests PASS. If the "skips lines … warns" test fails because the skipped line did not match the transaction regex, check the test layout's `transactionRegex` requires `\s{2,}` before the amount (the test line has two spaces).

- [ ] **Step 5: Commit**

```bash
git add lib/import/pdf-parse.ts tests/unit/pdf-parse.test.ts
git commit -m "feat(import): add layout-driven PDF statement parser"
```

---

### Task 4: Viseca starter layout, anonymised fixture, context + sum-check tests

**Files:**
- Modify: `lib/import/default-mappings.ts`
- Create: `tests/unit/fixtures/viseca-statement.txt`
- Modify: `tests/unit/pdf-parse.test.ts` (append)
- Create: `tests/unit/default-pdf-layouts.test.ts`

**Interfaces:**
- Consumes: `layoutFromRow` (Task 3), Prisma `PdfLayout` type (Task 1).
- Produces:
  - `DEFAULT_PDF_LAYOUTS: Omit<PdfLayout, "id" | "createdAt" | "updatedAt">[]` with one entry named `"Migros Kreditkarte (PDF)"`.
  - `seedDefaultPdfLayouts(prisma: PrismaClient): Promise<{ created: number; skipped: number }>`.

- [ ] **Step 1: Create the anonymised fixture**

Create `tests/unit/fixtures/viseca-statement.txt`. This is the line structure of a real Viseca/Migros statement with invented merchants, names and numbers. Columns are separated by two spaces, exactly as `extractPdfLines` produces them. Keep every line of it (page headers and footers are part of what the parser must ignore):

```text
Migros Bank AG
Postfach
8010 Zürich
Herr
Test Person
Musterweg 1
3000 Bern
Abrechnung vom  14.10.2026
Kartenkontonummer  1111 2222 3333 4444
Fälliger Betrag  226.50
Datum  Valuta  Details  Währung  Betrag  Betrag in CHF
14.09.26 Totalbetrag letzte Abrechnung  300.00
28.09.26 15.09.26 Ihre Zahlung - Danke  300.00 -
4435 92XX XXXX 1111 Cumulus Kreditkarte, Anna Muster
Kartenlimite CHF 10'000
26.09.26 28.09.26 Beispiel Pay**0001*, Zurich CH  150.00
Finanzdienstleistungen
26.09.26 28.09.26 SumUp *Testlokal 54 R, Hamburg DE  EUR  100.00  96.85
Restaurants
Umrechnungskurs 0.9683388 vom 26.09.26  CHF  96.85
01.10.26 02.10.26 Testmarkt Bern, Bern CH  1.15
Supermärkte, Lebensmittel
02.10.26 03.10.26 Testshop Rueckgabe, Bern CH  10.00 -
Warenhäuser
Total Karte Cumulus Kreditkarte 4435 92XX XXXX 1111  238.00
Zwischensumme Total  238.00
Seite 1/2  Einzug der Forderung durch
Viseca Payment Services SA,
Hagenholzstrasse 56, 8050 Zürich
Migros Bank AG
Postfach
8010 Zürich
Datum  Valuta  Details  Währung  Betrag  Betrag in CHF
Übertrag Total  238.00
4435 92XX XXXX 2222 Cumulus Kreditkarte, Ben Muster
Kartenlimite CHF 10'000
14.09.26 15.09.26 Testdrogerie, Thun CH  8.50
Drogerien und Apotheken
18.09.26 21.09.26 Testmarkt Thun, Thun CH  47.60
Supermärkte, Lebensmittel
18.09.26 21.09.26 Testmarkt Thun, Thun CH  47.60
Supermärkte, Lebensmittel
Total Karte Cumulus Kreditkarte 4435 92XX XXXX 2222  103.70
Total Rechnungsbetrag zu unseren Gunsten  341.70
Seite 2/2  Einzug der Forderung durch
Viseca Payment Services SA,
Hagenholzstrasse 56, 8050 Zürich
```

Check by hand: card 1 = 150.00 + 96.85 + 1.15 − 10.00 = 238.00 ✓; card 2 = 8.50 + 47.60 + 47.60 = 103.70 ✓. Note the two identical Testmarkt Thun bookings on the same day.

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/default-pdf-layouts.test.ts`:

```ts
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PDF_LAYOUTS, seedDefaultPdfLayouts } from "@/lib/import/default-mappings";
import { layoutFromRow, parsePdfStatement, validateLayout } from "@/lib/import/pdf-parse";

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
```

- [ ] **Step 3: Run, expect FAIL**

Run: `npx vitest run tests/unit/default-pdf-layouts.test.ts`
Expected: FAIL — `DEFAULT_PDF_LAYOUTS` is not exported.

- [ ] **Step 4: Implement the starter layout and seeding**

In `lib/import/default-mappings.ts` change the first import to `import type { CsvMapping, PdfLayout, PrismaClient } from "@prisma/client";` and append:

```ts
const CARD_NUMBER = String.raw`\d{4} [\dX]{4} X{4} \d{4}`;
const AMOUNT = String.raw`[\d']+\.\d{2}`;

/**
 * Starter PDF layouts. Like the CSV mappings these stay editable under
 * Import → Mappings.
 */
export const DEFAULT_PDF_LAYOUTS: Omit<PdfLayout, "id" | "createdAt" | "updatedAt">[] = [
  {
    // Viseca / Migros Bank Cumulus statement. Purchases are printed positive,
    // credits carry a trailing minus — hence invertAmount. One booking per
    // line; the next line is the card network's merchant category, and
    // foreign-currency bookings add a currency/amount pair plus a rate line.
    name: "Migros Kreditkarte (PDF)",
    transactionRegex:
      String.raw`^(?<date>\d{2}\.\d{2}\.\d{2})\s+(?<valuta>\d{2}\.\d{2}\.\d{2})\s+(?<text>.+?)` +
      String.raw`(?:\s{2,}(?<currency>[A-Z]{3})\s{2,}(?<foreignAmount>${AMOUNT}))?` +
      String.raw`\s{2,}(?<amount>${AMOUNT})(?:\s*-)?$`,
    dateFormat: "DD.MM.YY",
    negativeSuffixRegex: String.raw`\s-$`,
    invertAmount: true,
    descriptionTemplate: "{text} - {category}",
    skipRegex: "Ihre Zahlung|Totalbetrag letzte Abrechnung",
    totalRegex: String.raw`^Total Karte .*?(?<key>${CARD_NUMBER})\s+(?<amount>${AMOUNT})$`,
    contextRegexes: JSON.stringify([
      { regex: String.raw`^(?<key>${CARD_NUMBER})\s+.*,\s*(?<holder>.+)$`, target: "section" },
      { regex: String.raw`^Umrechnungskurs\s+(?<rate>[\d.]+)`, target: "transaction" },
      { regex: String.raw`^(?<category>[^\d]+)$`, target: "transaction" },
    ]),
  },
];

/** Creates the starter PDF layouts, skipping any name that already exists. */
export async function seedDefaultPdfLayouts(
  prisma: PrismaClient
): Promise<{ created: number; skipped: number }> {
  const existing = await prisma.pdfLayout.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((l) => l.name));

  let created = 0;
  let skipped = 0;
  for (const layout of DEFAULT_PDF_LAYOUTS) {
    if (existingNames.has(layout.name)) {
      skipped++;
      continue;
    }
    await prisma.pdfLayout.create({ data: layout });
    created++;
  }
  return { created, skipped };
}
```

Also update the file's top doc comment to mention PDF layouts (one added sentence: "PDF layouts for statements that only come as PDF follow below.").

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run tests/unit/default-pdf-layouts.test.ts tests/unit/pdf-parse.test.ts`
Expected: PASS. If the sum-check test fails, print `result.warnings` — the likeliest cause is a fixture line with a single instead of two spaces before an amount.

- [ ] **Step 6: Commit**

```bash
git add lib/import/default-mappings.ts tests/unit/default-pdf-layouts.test.ts tests/unit/fixtures/viseca-statement.txt
git commit -m "feat(import): add Viseca PDF starter layout"
```

---

### Task 5: PDF text extraction (`pdf.ts`) and the test PDF builder

**Files:**
- Create: `lib/import/pdf.ts`
- Create: `tests/build-pdf.ts`
- Test: `tests/unit/pdf-extract.test.ts`

**Interfaces:**
- Consumes: `getDocumentProxy` from `unpdf`.
- Produces:

```ts
export class PdfExtractError extends Error {}
export async function extractPdfLines(bytes: Uint8Array): Promise<string[]>;
```
and in `tests/build-pdf.ts`:
```ts
export interface PdfText { x: number; y: number; text: string }
export function buildTextPdf(pages: PdfText[][]): Uint8Array;
```
Behaviour: items are grouped into lines by y (±2 pt), sorted by x, joined with two spaces when the gap between items exceeds 4 pt (otherwise nothing or one space), whitespace-only items dropped, pages concatenated top to bottom. Errors: password → «Das PDF ist passwortgeschützt.», unreadable → «Das PDF konnte nicht gelesen werden.», no text anywhere → «PDF enthält keinen lesbaren Text (Scan?).» ASCII only in `buildTextPdf` text (standard Helvetica without encoding table; use `ae`, not `ä`).

- [ ] **Step 1: Create the PDF builder**

`tests/build-pdf.ts`:

```ts
/**
 * Builds a minimal PDF with positioned Helvetica text, so extraction tests need
 * no binary fixtures (and no real statement with real card numbers).
 *
 * ASCII only: the font has no encoding table.
 */
export interface PdfText {
  x: number;
  y: number;
  text: string;
}

function escapePdfText(text: string): string {
  return text.replace(/[()\\]/g, (char) => `\\${char}`);
}

export function buildTextPdf(pages: PdfText[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const catalog = add("");
  const pagesObject = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: string[] = [];

  for (const items of pages) {
    const stream = items
      .map((item) => `BT /F1 10 Tf ${item.x} ${item.y} Td (${escapePdfText(item.text)}) Tj ET`)
      .join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const page = add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`
    );
    kids.push(`${page} 0 R`);
  }
  objects[catalog - 1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[pagesObject - 1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/pdf-extract.test.ts`:

```ts
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
```

- [ ] **Step 3: Run, expect FAIL**

Run: `npx vitest run tests/unit/pdf-extract.test.ts`
Expected: FAIL — cannot resolve `@/lib/import/pdf`.

- [ ] **Step 4: Implement `lib/import/pdf.ts`**

```ts
import { getDocumentProxy } from "unpdf";

/**
 * PDF → text lines, the input of lib/import/pdf-parse.ts. Server only: it pulls
 * in pdf.js.
 *
 * pdf.js hands out positioned text fragments, not lines. Fragments within
 * Y_TOLERANCE_PT of each other share a line; a horizontal gap wider than
 * COLUMN_GAP_PT becomes two spaces, which is what layout regexes anchor on to
 * tell table columns apart ("Merchant, Place CC␣␣150.00").
 */

const Y_TOLERANCE_PT = 2;
const COLUMN_GAP_PT = 4;

/** An expected failure with a message that can go straight to the user. */
export class PdfExtractError extends Error {}

interface Fragment {
  text: string;
  x: number;
  y: number;
  width: number;
}

export async function extractPdfLines(bytes: Uint8Array): Promise<string[]> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") {
      throw new PdfExtractError("Das PDF ist passwortgeschützt.");
    }
    throw new PdfExtractError("Das PDF konnte nicht gelesen werden.");
  }

  // No explicit cleanup: unpdf's document proxy has no destroy(), and the
  // document is garbage-collected once this request ends.
  const lines: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    const fragments: Fragment[] = [];
    for (const item of content.items) {
      if (!("str" in item) || item.str.trim() === "") continue;
      fragments.push({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
    }
    lines.push(...fragmentsToLines(fragments));
  }
  if (lines.length === 0) throw new PdfExtractError("PDF enthält keinen lesbaren Text (Scan?).");
  return lines;
}

function fragmentsToLines(fragments: Fragment[]): string[] {
  const rows: { y: number; items: Fragment[] }[] = [];
  for (const fragment of fragments) {
    const row = rows.find((candidate) => Math.abs(candidate.y - fragment.y) <= Y_TOLERANCE_PT);
    if (row) row.items.push(fragment);
    else rows.push({ y: fragment.y, items: [fragment] });
  }
  // PDF y grows upwards, so the top of the page has the largest y.
  rows.sort((a, b) => b.y - a.y);

  return rows.map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    let line = "";
    let end: number | null = null;
    for (const item of row.items) {
      if (end !== null) {
        if (item.x - end > COLUMN_GAP_PT) line += "  ";
        else if (!item.text.startsWith(" ")) line += " ";
      }
      line += item.text;
      end = item.x + item.width;
    }
    return line.trim();
  });
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run tests/unit/pdf-extract.test.ts`
Expected: PASS. If the first test returns `"…Bern CH 150.00"` (single space), the gap threshold did not trigger: the item at x=400 starts far beyond `end` of the first item (≈218), so check the fragments' `width` is not 0 (print `content.items`).

- [ ] **Step 6: Commit**

```bash
git add lib/import/pdf.ts tests/build-pdf.ts tests/unit/pdf-extract.test.ts
git commit -m "feat(import): extract positioned text lines from PDF statements"
```

---

### Task 6: Import actions — Pdf branch and `inspectPdfAction`

**Files:**
- Modify: `app/(app)/import/actions.ts` (imports ~line 12-13, `readUpload` ~line 71, `previewImportAction` ~lines 94-117, new `inspectPdfAction` at end)
- Test: `tests/integration/pdf-import.test.ts`

**Interfaces:**
- Consumes: `extractPdfLines`, `PdfExtractError` (Task 5); `parsePdfStatement`, `layoutFromRow` (Task 3); `DEFAULT_PDF_LAYOUTS` (Task 4); `buildTextPdf`.
- Produces: `previewImportAction` accepts `format = "Pdf"` with `layoutId`; `inspectPdfAction(formData): Promise<{ error?: string; lines?: string[] }>` (cap 2000 lines).

- [ ] **Step 1: Write the failing integration tests**

`tests/integration/pdf-import.test.ts` (same mocking pattern as `import-action.test.ts`):

```ts
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
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/integration/pdf-import.test.ts`
Expected: FAIL — `inspectPdfAction` is not exported.

- [ ] **Step 3: Implement in `actions.ts`**

Add imports:

```ts
import { extractPdfLines } from "@/lib/import/pdf";
import { layoutFromRow, parsePdfStatement } from "@/lib/import/pdf-parse";
```
(`PdfExtractError` is not imported: the existing `catch` returns `err.message`, which is already the German text. An unused import would fail lint.)

Replace `readUpload` with a version that can read bytes:

```ts
async function readUpload(
  formData: FormData,
  binary = false
): Promise<{ file: File; text: string; bytes: Uint8Array } | string> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return "Bitte eine Datei auswählen.";
  if (file.size > config.import.maxFileSizeBytes) {
    return `Die Datei ist grösser als ${Math.round(config.import.maxFileSizeBytes / 1024 / 1024)} MB.`;
  }
  // pdf.js takes ownership of the buffer, so each caller gets its own copy.
  return binary
    ? { file, text: "", bytes: new Uint8Array(await file.arrayBuffer()) }
    : { file, text: await file.text(), bytes: new Uint8Array() };
}
```

In `previewImportAction` replace the block from `const upload = await readUpload(formData);` through the end of the `try/catch` with:

```ts
  const formatValue = formData.get("format");
  const format =
    formatValue === "Csv"
      ? ImportFormat.Csv
      : formatValue === "Pdf"
        ? ImportFormat.Pdf
        : ImportFormat.Camt053;

  const upload = await readUpload(formData, format === ImportFormat.Pdf);
  if (typeof upload === "string") return { error: upload };
  const { file, text, bytes } = upload;

  let statement: ParsedStatement;
  let rejectedRows: CsvParseResult["rejectedRows"] = [];
  try {
    if (format === ImportFormat.Csv) {
      const mappingId = parseInt(String(formData.get("mappingId") ?? ""), 10);
      if (!Number.isInteger(mappingId)) return { error: "Bitte ein CSV-Mapping auswählen." };
      const mapping = await prisma.csvMapping.findUnique({ where: { id: mappingId } });
      if (!mapping) return { error: "CSV-Mapping nicht gefunden." };
      const csvResult = parseCsvStatement(text, mapping);
      statement = csvResult;
      rejectedRows = csvResult.rejectedRows;
    } else if (format === ImportFormat.Pdf) {
      const layoutId = parseInt(String(formData.get("layoutId") ?? ""), 10);
      if (!Number.isInteger(layoutId)) return { error: "Bitte ein PDF-Layout auswählen." };
      const layout = await prisma.pdfLayout.findUnique({ where: { id: layoutId } });
      if (!layout) return { error: "PDF-Layout nicht gefunden." };
      const pdfResult = parsePdfStatement(await extractPdfLines(bytes), layoutFromRow(layout));
      statement = pdfResult;
      rejectedRows = pdfResult.rejectedRows;
    } else {
      statement = parseCamt053(text);
    }
  } catch (err) {
    log.warn({ err, format }, "Statement parse failed");
    return { error: err instanceof Error ? err.message : "Die Datei konnte nicht gelesen werden." };
  }
```

Append at the end of the file:

```ts
const MAX_INSPECT_LINES = 2000;

/** Text lines of a sample PDF, for building a layout interactively. Nothing is stored. */
export async function inspectPdfAction(
  formData: FormData
): Promise<{ error?: string; lines?: string[] }> {
  await requireEditor();

  const upload = await readUpload(formData, true);
  if (typeof upload === "string") return { error: upload };

  try {
    return { lines: (await extractPdfLines(upload.bytes)).slice(0, MAX_INSPECT_LINES) };
  } catch (err) {
    log.warn({ err }, "PDF inspection failed");
    return { error: err instanceof Error ? err.message : "Das PDF konnte nicht gelesen werden." };
  }
}
```

Leave `inspectCsvAction` as is (`readUpload(formData)` default = text).

- [ ] **Step 4: Run, expect PASS — plus the existing import tests**

Run: `npx vitest run tests/integration/pdf-import.test.ts tests/integration/import-action.test.ts`
Expected: both files PASS.

- [ ] **Step 5: Check the production bundle can load unpdf**

Run: `npm run build`
Expected: build succeeds. If it fails on pdf.js (e.g. `Module not found` for a worker or canvas), add `"unpdf"` to `serverExternalPackages` in `next.config.ts` and rebuild. Either way keep whichever setting makes the build pass.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/import/actions.ts" tests/integration/pdf-import.test.ts next.config.ts
git commit -m "feat(import): preview PDF statements through stored layouts"
```
(Drop `next.config.ts` from `git add` if it was not changed.)

---

### Task 7: Layout CRUD actions

**Files:**
- Create: `app/(app)/import/pdf-layout-actions.ts`
- Modify: `tests/integration/pdf-import.test.ts` (append)

**Interfaces:**
- Consumes: `validateLayout`, `parseContextRules` (Task 3); `seedDefaultPdfLayouts` (Task 4); `SUPPORTED_DATE_FORMATS`.
- Produces: `savePdfLayoutAction(prev, formData): Promise<ActionState>` (form fields: `id?`, `name`, `transactionRegex`, `dateFormat`, `negativeSuffixRegex`, `invertAmount` ("on"), `descriptionTemplate`, `skipRegex`, `totalRegex`, `contextRegexes` (JSON string)); `deletePdfLayoutAction(id)`; `seedDefaultPdfLayoutsAction()` returning `{ created }`. All `requireEditor()`, audit-logged (`entityType: "PdfLayout"`), `revalidatePath("/import")`.

- [ ] **Step 1: Write the failing tests** (append to `tests/integration/pdf-import.test.ts`; add the import line next to the existing action import)

```ts
import {
  deletePdfLayoutAction,
  savePdfLayoutAction,
  seedDefaultPdfLayoutsAction,
} from "@/app/(app)/import/pdf-layout-actions";

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
```

Caveat: the "Migros Kreditkarte (PDF)" row created in `beforeAll` is used by earlier tests via `layoutId`. The last test deletes and recreates it — it runs last, so no earlier test is affected. Keep it last in the file.

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/integration/pdf-import.test.ts -t "PDF layout actions"`
Expected: FAIL — module `pdf-layout-actions` not found.

- [ ] **Step 3: Implement `app/(app)/import/pdf-layout-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { seedDefaultPdfLayouts } from "@/lib/import/default-mappings";
import { parseContextRules, validateLayout } from "@/lib/import/pdf-parse";

export type ActionState = { error?: string; success?: boolean };

const optionalText = z
  .string()
  .max(2000)
  .transform((value) => value.trim() || null);

const layoutSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(60),
  transactionRegex: z.string().trim().min(1, "Buchungszeilen-Regex darf nicht leer sein.").max(2000),
  dateFormat: z.string(),
  negativeSuffixRegex: optionalText,
  invertAmount: z.boolean(),
  descriptionTemplate: z.string().trim().max(200),
  skipRegex: optionalText,
  totalRegex: optionalText,
  contextRegexes: z.string().max(10_000),
});

export async function savePdfLayoutAction(
  _prevState: ActionState | undefined,
  formData: FormData
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = layoutSchema.safeParse({
    name: formData.get("name") ?? "",
    transactionRegex: formData.get("transactionRegex") ?? "",
    dateFormat: formData.get("dateFormat") ?? "DD.MM.YY",
    negativeSuffixRegex: formData.get("negativeSuffixRegex") ?? "",
    invertAmount: formData.get("invertAmount") === "on",
    descriptionTemplate: formData.get("descriptionTemplate") || "{text}",
    skipRegex: formData.get("skipRegex") ?? "",
    totalRegex: formData.get("totalRegex") ?? "",
    contextRegexes: formData.get("contextRegexes") ?? "[]",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  // The stored string must round-trip: a rule list that parses to something
  // shorter than what was submitted would silently lose rules.
  let submittedRules: unknown;
  try {
    submittedRules = JSON.parse(parsed.data.contextRegexes);
  } catch {
    return { error: "Kontext-Regeln sind ungültig." };
  }
  const rules = parseContextRules(parsed.data.contextRegexes);
  if (!Array.isArray(submittedRules) || rules.length !== submittedRules.length) {
    return { error: "Kontext-Regeln sind ungültig." };
  }

  const problem = validateLayout({
    transactionRegex: parsed.data.transactionRegex,
    dateFormat: parsed.data.dateFormat,
    negativeSuffixRegex: parsed.data.negativeSuffixRegex,
    invertAmount: parsed.data.invertAmount,
    descriptionTemplate: parsed.data.descriptionTemplate,
    skipRegex: parsed.data.skipRegex,
    totalRegex: parsed.data.totalRegex,
    contextRules: rules,
  });
  if (problem) return { error: problem };

  const data = { ...parsed.data, contextRegexes: JSON.stringify(rules) };

  const idRaw = formData.get("id");
  const id = idRaw ? parseInt(String(idRaw), 10) : null;

  try {
    if (id) {
      await prisma.pdfLayout.update({ where: { id }, data });
      await logAudit(session, "UPDATE", "PdfLayout", id, { name: data.name });
    } else {
      const created = await prisma.pdfLayout.create({ data });
      await logAudit(session, "CREATE", "PdfLayout", created.id, { name: data.name });
    }
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002") {
      return { error: "Ein Layout mit diesem Namen existiert bereits." };
    }
    throw err;
  }

  revalidatePath("/import");
  return { success: true };
}

export async function deletePdfLayoutAction(id: number): Promise<ActionState> {
  const session = await requireEditor();
  const layout = await prisma.pdfLayout.delete({ where: { id } });
  await logAudit(session, "DELETE", "PdfLayout", id, { name: layout.name });
  revalidatePath("/import");
  return { success: true };
}

/** Creates the starter PDF layouts (Migros Kreditkarte); skips names already taken. */
export async function seedDefaultPdfLayoutsAction(): Promise<ActionState & { created?: number }> {
  const session = await requireEditor();
  const { created, skipped } = await seedDefaultPdfLayouts(prisma);
  await logAudit(session, "CREATE", "PdfLayout", undefined, { action: "seedDefaults", created, skipped });
  revalidatePath("/import");
  return { success: true, created };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run tests/integration/pdf-import.test.ts`
Expected: PASS. If the audit test fails with an unknown `entityType` check, read `lib/audit.ts` `logAudit` — the entity type is a free string in the existing `CsvMapping` calls, so it should not.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/import/pdf-layout-actions.ts" tests/integration/pdf-import.test.ts
git commit -m "feat(import): add actions to manage PDF layouts"
```

---

### Task 8: Wizard, Mappings tab, seed and delete buttons

**Order:** implement Task 9 (the dialog) first; `page.tsx` here imports it.

**Files:**
- Create: `app/(app)/import/seed-default-pdf-layouts-button.tsx`
- Modify: `app/(app)/import/import-history.tsx` (imports at top, new `DeletePdfLayoutButton` after `DeleteMappingButton` at ~line 92)
- Modify: `app/(app)/import/import-wizard.tsx` (`Format` type line 73, props ~82-92, state ~99-101, submit ~296, toggle ~304, accept ~331, mapping block ~369-393, submit button ~400, card description ~280)
- Modify: `app/(app)/import/page.tsx`

**Interfaces:**
- Consumes: `seedDefaultPdfLayoutsAction`, `deletePdfLayoutAction` (Task 7); the `PdfLayoutDialog` (Task 9) is imported by `page.tsx` — **do Task 9 before the final `page.tsx` edit**, or temporarily render a plain `<Button disabled>Neues Layout</Button>` and replace it in Task 9 Step 4.
- Produces: `ImportWizard` prop `pdfLayouts: PdfLayout[]`; form fields `format=Pdf`, `layoutId`.

- [ ] **Step 1: Seed button** — `seed-default-pdf-layouts-button.tsx`

```tsx
"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { seedDefaultPdfLayoutsAction } from "./pdf-layout-actions";
import { Button } from "@/components/ui/button";

/** One-click starter PDF layout (Migros Kreditkarte), like SeedDefaultMappingsButton for CSV. */
export function SeedDefaultPdfLayoutsButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await seedDefaultPdfLayoutsAction();
          if (result.error) toast.error(result.error);
          else if (!result.created) toast.info("Alle Standardlayouts sind bereits vorhanden.");
          else toast.success(`${result.created} Standardlayout angelegt.`);
        })
      }
    >
      <Sparkles className="h-3.5 w-3.5" /> {pending ? "Anlegen…" : "Standardlayouts anlegen"}
    </Button>
  );
}
```

- [ ] **Step 2: Delete button** — in `import-history.tsx` extend the import `import { deleteCsvMappingAction } from "./mapping-actions";` with a new line `import { deletePdfLayoutAction } from "./pdf-layout-actions";` and add after `DeleteMappingButton`:

```tsx
export function DeletePdfLayoutButton({ id, name }: { id: number; name: string }) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-destructive"
      aria-label="Layout löschen"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ description: `Layout "${name}" wirklich löschen?` }))) return;
        startTransition(async () => {
          const result = await deletePdfLayoutAction(id);
          if (result.error) toast.error(result.error);
          else toast.success("Layout gelöscht.");
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
```

- [ ] **Step 3: Wizard edits** in `import-wizard.tsx`

1. `import type { CategoryKind, CsvMapping } from "@prisma/client";` → add `PdfLayout`.
2. `type Format = "Camt053" | "Csv" | "Pdf";`
3. Props: add `pdfLayouts: PdfLayout[];` to the destructuring and the type.
4. State: after `mappingId` add
```tsx
  const [layoutId, setLayoutId] = useState("");
  // Derived rather than initialised from props: layouts created while the wizard
  // is mounted (the starter button on the Mappings tab) arrive as new props.
  const activeLayoutId = pdfLayouts.some((layout) => String(layout.id) === layoutId)
    ? layoutId
    : String(pdfLayouts[0]?.id ?? "");
```
5. In `onSubmit` after the `Csv` line: `if (format === "Pdf") data.set("layoutId", activeLayoutId);` and use `value={activeLayoutId}` on the layout `<Select>` (step 8).
6. Toggle array: add `["Pdf", "PDF"],` after the CSV entry.
7. `accept`: replace the ternary with
```tsx
accept={
  format === "Csv"
    ? ".csv,.txt,text/csv"
    : format === "Pdf"
      ? ".pdf,application/pdf"
      : ".xml,text/xml,application/xml"
}
```
8. After the `{format === "Csv" && (…)}` block add:
```tsx
            {format === "Pdf" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="import-layout">PDF-Layout</Label>
                {pdfLayouts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Noch kein Layout angelegt. Unter «Mappings» gibt es eine fertige Vorlage für die
                    Migros-Kreditkarte; für andere Abrechnungen legst du ein eigenes Layout an.
                    Das Zielkonto musst du wählen — PDF-Abrechnungen enthalten keine IBAN.
                  </p>
                ) : (
                  <Select value={activeLayoutId} onValueChange={setLayoutId}>
                    <SelectTrigger id="import-layout" className="sm:w-1/2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pdfLayouts.map((layout) => (
                        <SelectItem key={layout.id} value={String(layout.id)}>
                          {layout.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
```
9. Submit button: `disabled={pending || (format === "Csv" && mappings.length === 0) || (format === "Pdf" && pdfLayouts.length === 0)}`
10. Card description (~line 280): append the sentence `PDF ist für Abrechnungen gedacht, die es nur als PDF gibt (z. B. Kreditkarte); es braucht ein Layout, das beschreibt, wie die Buchungszeilen aussehen.` inside the existing `CardDescription` text after the CSV sentence.

The account combobox already hides "Automatisch (über IBAN)" for everything except `Camt053`, so PDF forces an explicit account with no further change.

- [ ] **Step 4: `page.tsx` edits**

1. Imports: `import { PdfLayoutDialog } from "./pdf-layout-dialog";` (Task 9), `import { SeedDefaultPdfLayoutsButton } from "./seed-default-pdf-layouts-button";`, and extend `import { DeleteMappingButton, ImportHistoryList } …` with `DeletePdfLayoutButton`.
2. Add `pdfLayouts` to the `Promise.all` destructuring and call list: `prisma.pdfLayout.findMany({ orderBy: { name: "asc" } }),` right after the `csvMapping` query.
3. `<ImportWizard … pdfLayouts={pdfLayouts} />`.
4. Tab trigger: `<TabsTrigger value="mappings">Mappings ({mappings.length + pdfLayouts.length})</TabsTrigger>`.
5. Wrap the mappings `TabsContent` body in `<div className="space-y-6">` and, after the existing CSV `<Card>…</Card>`, add:

```tsx
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="text-base">PDF-Layouts</CardTitle>
                  <CardDescription>
                    Beschreibt, wie die Buchungszeilen einer PDF-Abrechnung aussehen — nur nötig für den
                    PDF-Import.
                  </CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap w-full sm:w-auto sm:shrink-0">
                  {pdfLayouts.length === 0 && <SeedDefaultPdfLayoutsButton />}
                  <PdfLayoutDialog />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {pdfLayouts.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
                    <p>Noch kein Layout angelegt. Fertige Vorlage: Migros Kreditkarte (PDF).</p>
                    <SeedDefaultPdfLayoutsButton />
                  </div>
                ) : (
                  <ul className="divide-y">
                    {pdfLayouts.map((layout) => (
                      <li key={layout.id} className="flex items-start justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="font-medium">{layout.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Datumsformat {layout.dateFormat}
                            {layout.invertAmount ? " · Vorzeichen umgekehrt" : ""}
                            {layout.totalRegex ? " · mit Summenprüfung" : ""}
                          </p>
                        </div>
                        <div className="flex items-center shrink-0">
                          <PdfLayoutDialog layout={layout} />
                          <DeletePdfLayoutButton id={layout.id} name={layout.name} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
```
Also change the first card's description from "Nur nötig für CSV-Import — CAMT.053 braucht keine Zuordnung." to "Nur nötig für CSV-Import — CAMT.053 und PDF brauchen keine Spaltenzuordnung." and its title stays.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (needs Task 9's `pdf-layout-dialog.tsx` to exist; if doing this task first, stub the dialog with `export function PdfLayoutDialog(_: { layout?: PdfLayout }) { return null; }` in `pdf-layout-dialog.tsx` and replace it in Task 9).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/import"
git commit -m "feat(import): add PDF to the import wizard and mappings tab"
```

---

### Task 9: Layout dialog with live preview

**Files:**
- Create/replace: `app/(app)/import/pdf-layout-dialog.tsx`

**Interfaces:**
- Consumes: `savePdfLayoutAction` (Task 7), `inspectPdfAction` (Task 6), `parsePdfStatement`, `classifyLines`, `validateLayout`, `parseContextRules`, types `PdfLayoutConfig`, `ContextRule` (Task 3), `SUPPORTED_DATE_FORMATS` (`lib/import/csv.ts`), `useDialogFormAction` (`components/use-dialog-form`).
- Produces: `PdfLayoutDialog({ layout?: PdfLayout; trigger?: React.ReactNode })`.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PdfLayout } from "@prisma/client";
import { inspectPdfAction } from "./actions";
import { savePdfLayoutAction } from "./pdf-layout-actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
import { SUPPORTED_DATE_FORMATS } from "@/lib/import/csv";
import { formatDateCH } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import {
  classifyLines,
  parseContextRules,
  parsePdfStatement,
  validateLayout,
  type ContextRule,
  type LineKind,
  type PdfLayoutConfig,
} from "@/lib/import/pdf-parse";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STARTER_REGEX = String.raw`^(?<date>\d{2}\.\d{2}\.\d{2})\s+(?<text>.+?)\s{2,}(?<amount>[\d']+\.\d{2})$`;

const LINE_STYLE: Record<LineKind, string> = {
  transaction: "bg-emerald-500/15",
  context: "bg-sky-500/15",
  skip: "bg-amber-500/15 line-through",
  total: "bg-violet-500/15",
  other: "text-muted-foreground",
};

const LINE_LABEL: Record<LineKind, string> = {
  transaction: "Buchung",
  context: "Kontext",
  skip: "Übersprungen",
  total: "Total",
  other: "Nicht erkannt",
};

/**
 * Editor for one issuer's PDF layout.
 *
 * A sample PDF can be loaded so the regexes are written against the text the
 * parser really sees; the right-hand side re-runs the parser on every
 * keystroke, so a wrong regex shows up as an unrecognised line instead of as a
 * failed import later.
 */
export function PdfLayoutDialog({
  layout,
  trigger,
}: {
  layout?: PdfLayout;
  /** Omit to get the default button — building it in a Server Component page breaks Radix's Slot. */
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(savePdfLayoutAction, {
    onSuccess: () => setOpen(false),
    successMessage: layout ? "Layout gespeichert." : "Layout angelegt.",
  });

  const [name, setName] = useState(layout?.name ?? "");
  const [transactionRegex, setTransactionRegex] = useState(layout?.transactionRegex ?? STARTER_REGEX);
  const [dateFormat, setDateFormat] = useState(layout?.dateFormat ?? "DD.MM.YY");
  const [negativeSuffixRegex, setNegativeSuffixRegex] = useState(layout?.negativeSuffixRegex ?? "");
  const [invertAmount, setInvertAmount] = useState(layout?.invertAmount ?? true);
  const [descriptionTemplate, setDescriptionTemplate] = useState(layout?.descriptionTemplate ?? "{text}");
  const [skipRegex, setSkipRegex] = useState(layout?.skipRegex ?? "");
  const [totalRegex, setTotalRegex] = useState(layout?.totalRegex ?? "");
  const [rules, setRules] = useState<ContextRule[]>(layout ? parseContextRules(layout.contextRegexes) : []);

  const [lines, setLines] = useState<string[] | null>(null);
  const [inspecting, startInspect] = useTransition();

  const config = useMemo<PdfLayoutConfig>(
    () => ({
      transactionRegex,
      dateFormat,
      negativeSuffixRegex: negativeSuffixRegex || null,
      invertAmount,
      descriptionTemplate: descriptionTemplate || "{text}",
      skipRegex: skipRegex || null,
      totalRegex: totalRegex || null,
      contextRules: rules,
    }),
    [transactionRegex, dateFormat, negativeSuffixRegex, invertAmount, descriptionTemplate, skipRegex, totalRegex, rules]
  );

  const problem = useMemo(() => validateLayout(config), [config]);
  const kinds = useMemo(() => (lines ? classifyLines(lines, config) : []), [lines, config]);
  const result = useMemo(() => (lines && !problem ? parsePdfStatement(lines, config) : null), [lines, config, problem]);

  const inspect = (file: File) => {
    const data = new FormData();
    data.set("file", file);
    startInspect(async () => {
      const response = await inspectPdfAction(data);
      if (response.error) toast.error(response.error);
      else setLines(response.lines ?? null);
    });
  };

  const updateRule = (index: number, patch: Partial<ContextRule>) =>
    setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ??
          (layout ? (
            <Button variant="ghost" size="icon" className="size-8" aria-label="Layout bearbeiten">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" /> Neues Layout
            </Button>
          ))}
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{layout ? "Layout bearbeiten" : "Neues PDF-Layout"}</DialogTitle>
          <DialogDescription>
            Beschreibt einmalig, wie die Buchungszeilen einer Abrechnung im PDF-Text aussehen. Lade rechts ein
            Beispiel-PDF, um die Regeln gegen echten Text zu prüfen. Das PDF wird nicht gespeichert.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-2">
          <form action={formAction} className="flex flex-col gap-4">
            {layout && <input type="hidden" name="id" value={layout.id} />}
            <input type="hidden" name="dateFormat" value={dateFormat} />
            <input type="hidden" name="contextRegexes" value={JSON.stringify(rules)} />

            <div className="flex flex-col gap-2">
              <Label htmlFor="layout-name">Name</Label>
              <Input id="layout-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Migros Kreditkarte (PDF)" required />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="transactionRegex">Buchungszeile (Regex)</Label>
              <Input id="transactionRegex" name="transactionRegex" value={transactionRegex} onChange={(e) => setTransactionRegex(e.target.value)} className="font-mono text-xs" required />
              <p className="text-xs text-muted-foreground">
                Benannte Gruppen: <code>date</code> und <code>amount</code> sind Pflicht; optional <code>valuta</code>,{" "}
                <code>text</code>, <code>counterparty</code>, <code>currency</code>, <code>foreignAmount</code>, <code>key</code>.
                Spalten sind im PDF-Text durch zwei Leerzeichen getrennt (<code>\s{"{2,}"}</code>).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="layout-dateformat">Datumsformat</Label>
                <Select value={dateFormat} onValueChange={setDateFormat}>
                  <SelectTrigger id="layout-dateformat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_DATE_FORMATS.map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="negativeSuffixRegex">Gutschrift erkennen (Regex, optional)</Label>
                <Input id="negativeSuffixRegex" name="negativeSuffixRegex" value={negativeSuffixRegex} onChange={(e) => setNegativeSuffixRegex(e.target.value)} className="font-mono text-xs" placeholder={String.raw`\s-$`} />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="invertAmount" checked={invertAmount} onChange={(e) => setInvertAmount(e.target.checked)} className="size-4 accent-primary" />
              Vorzeichen umkehren (Käufe stehen im PDF positiv)
            </label>

            <div className="flex flex-col gap-2">
              <Label htmlFor="descriptionTemplate">Beschreibung (Vorlage)</Label>
              <Input id="descriptionTemplate" name="descriptionTemplate" value={descriptionTemplate} onChange={(e) => setDescriptionTemplate(e.target.value)} className="font-mono text-xs" placeholder="{text} - {category}" />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="skipRegex">Zeilen überspringen (Regex, optional)</Label>
              <Input id="skipRegex" name="skipRegex" value={skipRegex} onChange={(e) => setSkipRegex(e.target.value)} className="font-mono text-xs" placeholder="Ihre Zahlung|Übertrag" />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="totalRegex">Total für die Summenprüfung (Regex, optional)</Label>
              <Input id="totalRegex" name="totalRegex" value={totalRegex} onChange={(e) => setTotalRegex(e.target.value)} className="font-mono text-xs" placeholder={String.raw`^Total Karte .*?(?<key>\d{4} \S+ \S+ \d{4})\s+(?<amount>[\d']+\.\d{2})$`} />
            </div>

            <div className="rounded-md border p-3 flex flex-col gap-3">
              <p className="text-sm font-medium">Kontext-Regeln</p>
              <p className="text-xs text-muted-foreground">
                «Abschnitt» gilt für alle folgenden Buchungen (z. B. Karte und Inhaber). «Folgezeile» ergänzt die
                Buchung direkt davor (z. B. Kategorie, Kurs). Die erste passende Regel gewinnt.
              </p>
              {rules.map((rule, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input value={rule.regex} onChange={(e) => updateRule(index, { regex: e.target.value })} className="font-mono text-xs" aria-label={`Regex Kontext-Regel ${index + 1}`} />
                  <Select value={rule.target} onValueChange={(value) => updateRule(index, { target: value as ContextRule["target"] })}>
                    <SelectTrigger className="w-36" aria-label={`Ziel Kontext-Regel ${index + 1}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="section">Abschnitt</SelectItem>
                      <SelectItem value="transaction">Folgezeile</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" aria-label="Regel entfernen" onClick={() => setRules((current) => current.filter((_, i) => i !== index))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setRules((current) => [...current, { regex: "", target: "transaction" }])}>
                <Plus className="h-3.5 w-3.5" /> Regel hinzufügen
              </Button>
            </div>

            {problem && <p className="text-sm text-destructive">{problem}</p>}
            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
              <Button type="submit" disabled={pending || Boolean(problem)}>{pending ? "Speichern…" : "Speichern"}</Button>
            </DialogFooter>
          </form>

          <div className="flex flex-col gap-3 min-w-0">
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <Label htmlFor="sample-pdf">Beispiel-PDF laden (optional)</Label>
              <Input
                id="sample-pdf"
                type="file"
                accept=".pdf,application/pdf"
                disabled={inspecting}
                className="cursor-pointer"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) inspect(file);
                }}
              />
            </div>

            {lines && (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  {(Object.keys(LINE_LABEL) as LineKind[]).map((kind) => (
                    <span key={kind} className={cn("rounded px-1.5 py-0.5", LINE_STYLE[kind])}>{LINE_LABEL[kind]}</span>
                  ))}
                </div>
                <div className="max-h-72 overflow-y-auto rounded-md border font-mono text-xs" data-testid="pdf-lines">
                  {lines.map((line, index) => (
                    <div key={index} className={cn("whitespace-pre px-2 py-0.5", LINE_STYLE[kinds[index] ?? "other"])}>
                      {line}
                    </div>
                  ))}
                </div>

                {result && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">{result.transactions.length} Buchung(en) erkannt</p>
                    {result.warnings.map((warning) => (
                      <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>
                    ))}
                    {result.rejectedRows.slice(0, 10).map((row) => (
                      <p key={row.line} className="text-xs text-destructive">Zeile {row.line}: {row.reason}</p>
                    ))}
                    <div className="max-h-56 overflow-auto rounded-md border">
                      <table className="w-full text-xs">
                        <tbody>
                          {result.transactions.slice(0, 50).map((tx, index) => (
                            <tr key={index} className="border-b last:border-0">
                              <td className="px-2 py-1 whitespace-nowrap">{formatDateCH(tx.date)}</td>
                              <td className="px-2 py-1">{tx.description}</td>
                              <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{formatMoney(tx.amountCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If `cn` is not in `@/lib/utils`, check how `import-wizard.tsx` imports it and use the same path.

- [ ] **Step 3: Replace any Task 8 stub** — if you created a stub `PdfLayoutDialog` in Task 8 Step 5, this file replaces it; nothing else to change.

- [ ] **Step 4: Manual check in the browser**

Run: `npm run dev`, log in, open `/import` → tab «Mappings». Click «Standardlayouts anlegen», then edit the new layout and load a PDF. Expected: lines are coloured, transactions listed with signs, the form shows a red message while a regex is invalid and the save button is disabled.
(If no real Viseca PDF is at hand, generate a sample with `buildTextPdf` — see Task 10's e2e test for the lines to use — or use the one from `C:\Users\micha\NextcloudPrivat`.)

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/import/pdf-layout-dialog.tsx"
git commit -m "feat(import): add PDF layout editor with live preview"
```

---

### Task 10: End-to-end test and documentation

**Files:**
- Create: `tests/e2e/pdf-import.spec.ts`
- Modify: `CLAUDE.md` (Import section)
- Modify: `public/benutzerhandbuch.html` (Import section, lines ~696-725; role table line ~435; audit line ~769)

**Interfaces:**
- Consumes: everything above; `login` from `tests/e2e/helpers`; `buildTextPdf`.

- [ ] **Step 1: Write the e2e spec**

`tests/e2e/pdf-import.spec.ts` (distinct description token `PdfTest`, like the CAMT spec uses `Auszug`):

```ts
import { expect, test } from "@playwright/test";
import { buildTextPdf } from "../build-pdf";
import { login } from "./helpers";

/**
 * One pass through the PDF import: create the starter layout, read an invented
 * statement, see the preview, book it. Parsing detail is covered by unit tests;
 * this proves the parts meet through the UI.
 */

test.describe.configure({ mode: "serial" });

const statement = buildTextPdf([
  [
    { x: 50, y: 720, text: "4435 92XX XXXX 1111 Cumulus Kreditkarte, Anna Muster" },
    { x: 50, y: 700, text: "26.09.26 28.09.26 PdfTest Laden, Bern CH" },
    { x: 400, y: 700, text: "12.50" },
    { x: 50, y: 686, text: "Lebensmittel" },
    { x: 50, y: 660, text: "Total Karte Cumulus Kreditkarte 4435 92XX XXXX 1111" },
    { x: 400, y: 660, text: "12.50" },
  ],
]);

test("liest eine PDF-Abrechnung über das Standardlayout und bucht sie", async ({ page }) => {
  await login(page);
  await page.goto("/import");

  await page.getByRole("tab", { name: /Mappings/ }).click();
  await page.getByRole("button", { name: "Standardlayouts anlegen" }).first().click();
  await expect(page.getByText("Migros Kreditkarte (PDF)").first()).toBeVisible();

  await page.getByRole("tab", { name: "Neuer Import" }).click();
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Privatkonto" }).click();

  await page.locator("#file").setInputFiles({
    name: "abrechnung.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(statement),
  });
  await page.getByRole("button", { name: "Datei einlesen" }).click();

  await expect(page.getByText("PdfTest Laden, Bern CH - Lebensmittel").first()).toBeVisible();

  await page.getByRole("button", { name: "Alle neuen" }).click();
  await page.getByRole("button", { name: /1 Buchung\(en\) importieren/ }).click();
  await expect(page.getByText(/1 Buchung\(en\) importiert/).first()).toBeVisible();

  await page.goto(`/transactions?q=${encodeURIComponent("PdfTest")}`);
  await expect(page.getByText("PdfTest Laden, Bern CH - Lebensmittel").first()).toBeVisible();
  await expect(page.getByText("−12.50").first()).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npx playwright test tests/e2e/pdf-import.spec.ts`
Expected: PASS. If the `PDF` toggle button is not found by `exact: true`, check the toggle label in `import-wizard.tsx` is exactly `"PDF"`. If "Alle neuen" is absent because the wizard auto-selects, mirror the steps in `tests/e2e/import.spec.ts`.

- [ ] **Step 3: Update `CLAUDE.md`**

In the **Import** section, after the `csv.ts` bullet add:

```markdown
- **`pdf.ts` / `pdf-parse.ts`** — PDF statements (Viseca/Migros credit-card bills when the CSV export is unavailable). `pdf.ts` (server only, `unpdf`) turns a PDF into text lines — fragments are grouped by y position and table columns joined with two spaces; `pdf-parse.ts` (pure, no Prisma/pdf.js, so the layout dialog can run it in the browser for its live preview) applies a stored `PdfLayout`: regexes with named groups for the booking line, section/follow-up context lines (card + holder, category, exchange rate), skipped lines and printed totals for a sum check that warns per card. PDF statements carry no IBAN, so the target account is always chosen in the wizard. The PDF itself is never stored (card numbers, address).
```

Also add `lib/import/pdf-parse.ts` to the sentence in "Client/server module boundary" about modules that must stay free of Prisma/pino imports ("…`lib/colors.ts`, and `lib/import/pdf-parse.ts`") and append to the Import paragraph's list of mappings: "CSV mappings and PDF layouts live under Import → Mappings".

- [ ] **Step 4: Update the user manual** (`public/benutzerhandbuch.html`, German)

1. In the paragraph at ~line 702 add after the CSV sentence: `<strong>PDF</strong> ist für Abrechnungen gedacht, die es nur als PDF gibt (z. B. die Kreditkartenabrechnung, wenn der CSV-Export im Portal nicht funktioniert). Dafür braucht es ein <strong>PDF-Layout</strong>, das beschreibt, wie die Buchungszeilen aussehen; für die Migros-Kreditkarte gibt es eine fertige Vorlage unter «Mappings».`
2. Add a new `<h3 class="sub" id="import-pdf">PDF-Layouts</h3>` section directly before `<h3 class="sub" id="import-regeln">` (mirror the markup of the neighbouring `<h3 class="sub">` + `<p>` blocks) with this text: «Unter *Import → Mappings → PDF-Layouts* legst du fest, wie eine Abrechnung gelesen wird: eine Regex für die Buchungszeile (Pflichtgruppen `date` und `amount`), optional Regeln für Zeilen, die zur Buchung davor gehören (Kategorie, Kurs) oder für den ganzen Abschnitt gelten (Karte, Inhaber), Zeilen zum Überspringen (z. B. «Ihre Zahlung») und eine Total-Regex für die Summenprüfung. Wenn du ein Beispiel-PDF lädst, siehst du den extrahierten Text farbig markiert und rechts sofort die erkannten Buchungen. Das PDF wird nicht gespeichert. Weicht die Summe pro Karte vom gedruckten Total ab, erscheint eine Warnung über der Vorschau. Das Zielkonto wählst du selbst, weil PDF-Abrechnungen keine IBAN enthalten.»
3. Line ~435 and ~769: change "CSV-Mappings" to "CSV-Mappings &amp; PDF-Layouts" (role table) and add "PDF-Layouts" to the audit list.
4. Screenshots: do not hand-edit. Note in the commit message that screenshots were not regenerated; regenerating goes through `scripts/manual-screenshots.ts` (see CLAUDE.md) and is a separate follow-up.

- [ ] **Step 5: Full verification**

Run, in order:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```
Expected: lint clean; all unit and integration tests pass and coverage thresholds hold; build succeeds; e2e suite green. Fix whatever fails before committing — do not lower the coverage thresholds.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/pdf-import.spec.ts CLAUDE.md public/benutzerhandbuch.html
git commit -m "docs(import): document PDF import and add e2e coverage"
```
