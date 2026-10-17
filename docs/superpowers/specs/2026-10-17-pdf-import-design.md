# PDF statement import — design

Date: 2026-10-17

## Goal

Import credit-card statements delivered as PDF (first target: Viseca / Migros
Bank Cumulus) directly in the app, for the cases where the CSV export of the
issuer is unavailable. The mechanism is generic: a **PdfLayout** describes, per
issuer, how transaction lines look in the extracted PDF text — analogous to
`CsvMapping` for CSV. Viseca ships as a built-in template.

Out of scope: OCR for scanned PDFs, a click-to-build layout editor, storing the
PDF file, a cardholder field on `Transaction`.

## Decisions

- Layouts are user-editable in the UI: regular expressions with named groups,
  with a live preview against a sample PDF.
- A layout parses straight into the existing `ParsedStatement`. Everything after
  parsing (dedupe, rules, history suggestions, transfer adoption, preview,
  commit, undo) is unchanged.
- Text extraction runs server-side in Node (`unpdf`, pure JS, works in the
  ARM64 image — no poppler). Parsing is a pure function with an injected regex
  matcher. Request-driven code uses a matcher that runs every regex inside
  `node:vm` with hard timeouts, so catastrophic backtracking aborts instead of
  stalling the server; the layout dialog's live preview therefore also runs on
  the server.
- Rejected alternatives: PDF → virtual CSV → `CsvMapping` (two configurations
  per issuer, harder to debug); Python sidecar (second runtime in the image);
  automatic table detection (unreliable with foreign currency, multi-line rows,
  several cards per document).

## Data model

- `ImportFormat` gains `Pdf` (also stored on `ImportBatch.format`).
- New model `PdfLayout`:
  - `name` (unique)
  - `transactionRegex` — one transaction line. Required named groups `date`,
    `amount`; optional `valuta`, `text`, `counterparty`, `currency`,
    `foreignAmount`.
  - `dateFormat` — the `CsvMapping` formats plus `DD.MM.YY` (two-digit year,
    interpreted as 20YY).
  - `negativeSuffixRegex` — marks credits (Viseca: trailing `-`).
  - `invertAmount` — same meaning as on `CsvMapping` (purchases positive in the
    document, negative in the app).
  - `descriptionTemplate` — e.g. `{text} - {category}`; default `{text}`.
  - `skipRegex` — lines that are never transactions ("Ihre Zahlung", "Übertrag",
    totals).
  - `totalRegex` (optional) — group `amount`, used for the sum check.
  - `contextRegexes` (JSON list of `{ regex, target }`). `target: "section"`
    writes its named groups into the section state, which applies to all
    following transactions (e.g. card number and holder). `target: "transaction"`
    attaches its named groups (e.g. category, exchange rate) to the transaction
    parsed immediately before the matching line. Groups are available to
    `descriptionTemplate` as `{name}`. A `transaction` context only applies while
    the previous line was that booking or another `transaction` context line.
- Migration via `prisma migrate dev`; production applies it through
  `scripts/startup.js` as before.
- Starter layout "Migros Kreditkarte (PDF)" lives next to the CSV templates in
  `lib/import/default-mappings.ts` and is seeded by name, skipping existing ones.

## Modules

- `lib/import/pdf.ts` (server only): `extractPdfLines(bytes): Promise<string[]>`.
  Groups text items by y position, sorts by x, joins columns with at least two
  spaces so regexes can anchor on column gaps. Throws typed errors for
  password-protected and text-less PDFs.
- `lib/import/pdf-parse.ts` (no Prisma, no `unpdf`, no Node APIs, so client
  components may import its validation helpers — see "Client/server module
  boundary" in CLAUDE.md):
  `parsePdfStatement(lines, layout, matcher?): PdfParseResult` where
  `PdfParseResult extends ParsedStatement` with `rejectedRows`, like
  `CsvParseResult`; `analyzePdf` returns line kinds and result from one regex
  pass. Every regex goes through a `LineMatcher` (`(source, lines) => matches`):
  `nativeMatcher` by default (trusted input, tests).
- `lib/import/safe-regex.ts` (server only): `createSafeMatcher()` runs each regex
  over all lines in one `node:vm` script with a hard timeout (500 ms per regex,
  2 s per request) and throws `RegexTimeoutError`. `node:vm` rather than
  `worker_threads`: a worker file is not bundled by Next's standalone output and
  costs a thread per request, while the effect — a timeout on a synchronous
  regex — is the same.
- `app/(app)/import/actions.ts`: `previewImportAction` gets a `Pdf` branch
  (`layoutId`, upload read as bytes via `arrayBuffer`); `readUpload` returns bytes
  for PDF. New `inspectPdfAction` returns the extracted lines of a sample PDF
  without storing it.
- `app/(app)/import/pdf-layout-actions.ts` (new): `savePdfLayoutAction`,
  `deletePdfLayoutAction`, `seedDefaultPdfLayoutsAction`,
  `previewPdfLayoutAction` (live preview of an unsaved layout against sample
  lines, with the safe matcher); `requireEditor()`, audit log, zod validation
  (regexes compile, required groups present).

## Parse flow

`parsePdfStatement` walks the lines once and keeps state: the current section
groups (e.g. `card`, `holder`) and the most recent transaction. Per line, in
order:

1. `skipRegex` matches → ignore, and add an info warning naming the skipped line.
2. `totalRegex` matches → remember the amount against the current section, for
   the sum check. No transaction.
3. `transactionRegex` matches → new transaction. Date parsed with `dateFormat`
   (invalid → `rejectedRows`). Amount parsed with `parseMoney` (it already accepts
   `1'234.50`, `1 234,50` and `1.234,50`); negative if `negativeSuffixRegex` matches, then `invertAmount`
   applied (zero or unreadable → `rejectedRows`). Section groups are attached.
4. A context regex matches → `target: "section"`: write groups into the section
   state; `target: "transaction"`: attach groups (category, exchange rate) to the
   immediately preceding transaction. A `transaction` match with no preceding
   transaction in the current section is ignored.
5. Nothing matches → ignore (page headers and footers are normal, not warnings).

Because follow-up lines add groups after the transaction line, descriptions are
rendered once the whole file has been walked, not on the transaction line.

Output per transaction: `date`, `amountCents`, `description` from the template,
`counterparty` from group `counterparty` else the `text` up to the first comma,
and a stable `bankReference` =
`pdf:<date>|<valuta>|<text>|<document cents>|<occurrence>`, built from the raw
`date`, `valuta`, `text` and `amount` groups. `importHash` uses a reference
alone, so editing the description template or context rules does not change the
fingerprint and a re-read of the same PDF stays a duplicate. The occurrence
number (per identical tuple, in reading order) is part of the string because
`verifyImportHash` only checks occurrence 0 when a reference is set; two
identical bookings on one day therefore both import. A layout without a `text`
group gets no reference and falls back to the description-based hash. Still
true: changing those four groups of the booking regex, or comparing a CSV
export with the PDF of the same card, defeats duplicate detection.

`periodFrom`/`periodTo` come from the min/max booking date. `iban` is always
`null` (statements like the Viseca bill carry none), so the target account is
chosen in the wizard. `closingBalanceCents` stays `null`.

### Sum check

With `totalRegex`, the sum of parsed transactions per section key (the card) is
compared with the printed total. A mismatch is a warning above the preview, not
an abort. Without `totalRegex`, an info warning says the check was not done.

## UI

- `page.tsx`: tab "CSV-Mappings" becomes "Mappings" with two sections (CSV, PDF),
  each with create/edit/delete and a "Fertige Vorlagen" seed button; loads
  `prisma.pdfLayout.findMany`.
- `import-wizard.tsx`: `Format` gains `"Pdf"`; third toggle; `accept=".pdf"`;
  a "PDF-Layout" select replaces the column-mapping select (`layoutId`); target
  account is required; submit disabled without layouts.
- `pdf-layout-dialog.tsx` (new): form on the left, live preview on the right. A
  sample PDF is extracted via `inspectPdfAction` (not stored). Lines are
  colour-coded (transaction, context, skipped, unrecognised); below, a table of
  recognised transactions plus `rejectedRows` and warnings. On each (debounced)
  edit the dialog calls `previewPdfLayoutAction`, which runs the parser
  server-side with the safe matcher; answers overtaken by a newer edit are
  dropped. Regexes compile while typing; errors show as one message above the
  buttons and block saving.

## Error handling

| Case | Behaviour |
|---|---|
| Password-protected PDF | "PDF ist passwortgeschützt", no crash |
| Scan without text layer | "PDF enthält keinen lesbaren Text (Scan?)", no OCR |
| File over size limit | existing `readUpload` message |
| No layout selected | "Bitte ein PDF-Layout auswählen." |
| Layout matches nothing | "keine einzige Buchung" plus hint to check layout and text view |
| Sum mismatch | warning above preview, import still possible |
| Invalid regex | rejected on save; `parsePdfStatement` throws the validation message for a layout that was never validated |
| Catastrophic regex | aborted by the matcher: "Ein Regex im Layout braucht zu lange (vermutlich endloses Backtracking). Bitte vereinfachen." |
| Extraction throws | `log.warn` and message returned, like `Statement parse failed` for CSV |

User-supplied regexes are validated on save. Lines are capped at 500 characters
(bounding ordinary regexes) and every regex runs through the matcher described
under Modules, which bounds catastrophic backtracking to 500 ms per regex and
2 s per request.

The PDF is read within the request and discarded; it contains card numbers and an
address.

## Tests

- `tests/unit/pdf-parse.test.ts` (main body): anonymised text fixture of the
  October Viseca statement (no name, address, card or Cumulus numbers), checked
  against the starter layout: 28 transactions, per-card totals 649.00 / 785.40,
  no warning; "Ihre Zahlung" skipped with an info warning; EUR booking yields the
  CHF amount and the rate line does not become a transaction; holder correct per
  section. Edge cases: credit with trailing `-`; `DD.MM.YY`; invalid date, zero
  and unreadable amounts in `rejectedRows`; two identical bookings on one day both
  kept; sum mismatch warns without aborting; no match gives the "no transaction"
  warning; over-long line; stable `bankReference` (independent of template and
  context rules, numbered for identical bookings, null without `text`).
- `tests/unit/safe-regex.test.ts`: same matches as the native matcher; a
  catastrophic pattern aborts at its limit; the total budget is shared and stays
  exhausted after a timeout.
- `tests/unit/pdf-extract.test.ts`: a PDF built in the test with invented content
  and two columns on one y position (line grouping, two-space separation); a PDF
  without text layer; a password-protected PDF. No real statements in the repo.
- `tests/integration/pdf-import.test.ts`: `previewImportAction` with
  `format=Pdf` and a mini PDF; after commit `ImportBatch.format` is `Pdf` and a
  second import skips everything, also after the layout's description template
  changed; a catastrophic layout aborts with the timeout message;
  `savePdfLayoutAction` validation, unique name, audit entry;
  `previewPdfLayoutAction`. Schema comes from the committed migration SQL as
  usual.
- `tests/e2e/pdf-import.spec.ts`: one pass — create layout from the template,
  upload a mini PDF, see the preview, import.

## Documentation

`CLAUDE.md` (Import section: `pdf.ts`, `pdf-parse.ts`, `safe-regex.ts`, client/server boundary) and
`public/benutzerhandbuch.html` (PDF path, layout dialog; screenshots regenerated
through `scripts/manual-screenshots.ts`, not edited by hand).

## Notes

- `scripts/viseca-pdf-to-csv.py` is an untracked stop-gap that converts a Viseca
  PDF to the CSV of the existing "Migros Kreditkarte" mapping. It is independent
  of this feature and can be dropped once the PDF import ships.
