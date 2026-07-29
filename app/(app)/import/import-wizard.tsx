"use client";

import {
  memo,
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Plus, Upload } from "lucide-react";
import type { CategoryKind, CsvMapping } from "@prisma/client";
import { commitImportAction, previewImportAction, type ImportPreview, type PreviewRow } from "./actions";
import { saveCategoryAction } from "@/app/(app)/categories/actions";
import type { CategoryOption } from "@/lib/categories";
import type { AccountOption } from "@/app/(app)/transactions/transaction-form-dialog";
import { formatDateCH } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

/**
 * Real conditional mount, not a CSS `hidden` class: for statements with
 * thousands of rows, keeping both the desktop table and the mobile card
 * list mounted at once doubled the DOM nodes React had to create and diff
 * on every render, which is what made the tab freeze after opening a large
 * file. This preview only ever renders after a client-side action result,
 * so there is no SSR markup to match and reading the viewport up front is
 * safe.
 */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

const AUTO_ACCOUNT = "auto";
const NO_CATEGORY = "none";

type Format = "Camt053" | "Csv";

/** Top-level category, i.e. a group a new leaf category can be filed under. */
export interface CategoryGroupOption {
  id: number;
  name: string;
  kind: CategoryKind;
}

export function ImportWizard({
  accounts,
  categories,
  parents,
  mappings,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  parents: CategoryGroupOption[];
  mappings: CsvMapping[];
}) {
  // Mutable copy of the server-loaded categories: a category created inline
  // while categorising this preview (see QuickCreateCategory below) is
  // appended here so it becomes selectable for every other row immediately,
  // without a page reload — which would also throw away the in-memory
  // preview and force re-reading the file.
  const [categoryList, setCategoryList] = useState(categories);
  const [format, setFormat] = useState<Format>("Camt053");
  const [accountId, setAccountId] = useState(AUTO_ACCOUNT);
  const [mappingId, setMappingId] = useState(String(mappings[0]?.id ?? ""));
  const [state, formAction, pending] = useActionState(previewImportAction, undefined);
  // Client-side only: narrows which rows are shown/selectable so e.g. only
  // one year of a multi-year statement gets imported, without touching the
  // parsed file or the dedupe fingerprints.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [committing, startCommit] = useTransition();
  const preview = state?.preview;

  /**
   * The user's edits to the current preview.
   *
   * Tied to the preview object itself rather than reset from an effect: when a
   * new file is read, `edits.preview` no longer matches and the defaults apply
   * again automatically. That avoids a render pass where stale selections from
   * the previous file are shown against the new rows.
   */
  const [edits, setEdits] = useState<{
    preview: ImportPreview;
    selected: Set<string>;
    /** Per-row override of the rule-suggested categorisation, keyed by row
     *  hash: "none" | `cat:${categoryId}` | `transfer:${accountId}`. Lets a
     *  wrongly-triggered rule (e.g. a broad "Revolut" transfer match) be
     *  corrected before import instead of after, without deleting anything. */
    overrides: Record<string, string>;
    done: { imported: number; skipped: number } | null;
  } | null>(null);
  const active = edits?.preview === preview ? edits : null;

  const filteredRows = useMemo(
    () =>
      preview?.rows.filter(
        (row) => (!dateFrom || row.date >= dateFrom) && (!dateTo || row.date <= dateTo)
      ) ?? [],
    [preview, dateFrom, dateTo]
  );

  // Duplicates start unchecked — re-importing them is exactly what the
  // fingerprint exists to prevent.
  const defaultSelected = useMemo(
    () => new Set(filteredRows.filter((row) => !row.isDuplicate).map((row) => row.hash)),
    [filteredRows]
  );

  const selected = active?.selected ?? defaultSelected;
  const done = active?.done ?? null;
  const isDesktop = useIsDesktop();

  // Read by the stable per-row callbacks below so their identity doesn't
  // have to change (and every row's memoized component re-render) just
  // because the user ticked a different checkbox.
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  });

  const update = (
    changes: Partial<{
      selected: Set<string>;
      overrides: Record<string, string>;
      done: { imported: number; skipped: number } | null;
    }>
  ) => {
    if (!preview) return;
    setEdits({
      preview,
      selected: active?.selected ?? defaultSelected,
      overrides: active?.overrides ?? {},
      done: active?.done ?? null,
      ...changes,
    });
  };

  // The rule-suggested outcome for a row, encoded the same way an override is.
  const defaultSelectionOf = (row: PreviewRow) =>
    row.transferAccountId ? `transfer:${row.transferAccountId}` : `cat:${row.categoryId ?? NO_CATEGORY}`;

  const selectionOf = (row: PreviewRow) =>
    active && row.hash in active.overrides ? active.overrides[row.hash] : defaultSelectionOf(row);

  const toggleRow = useCallback(
    (hash: string, checked: boolean) => {
      if (!preview) return;
      const base = activeRef.current?.preview === preview ? activeRef.current : null;
      const next = new Set(base?.selected ?? defaultSelected);
      if (checked) next.add(hash);
      else next.delete(hash);
      setEdits({
        preview,
        selected: next,
        overrides: base?.overrides ?? {},
        done: base?.done ?? null,
      });
    },
    [preview, defaultSelected]
  );

  const overrideRow = useCallback(
    (hash: string, value: string) => {
      if (!preview) return;
      const base = activeRef.current?.preview === preview ? activeRef.current : null;
      setEdits({
        preview,
        selected: base?.selected ?? defaultSelected,
        overrides: { ...(base?.overrides ?? {}), [hash]: value },
        done: base?.done ?? null,
      });
    },
    [preview, defaultSelected]
  );

  // Precomputed once per category/account change instead of re-filtered for
  // every row on every render (and, before the desktop/mobile split below,
  // twice over) — with a few thousand imported rows that repeated filtering
  // was the other big contributor to the tab locking up.
  const transferOptions = useMemo<ComboboxOption[]>(
    () =>
      preview
        ? accounts
            .filter((account) => account.id !== preview.accountId)
            .map((account) => ({ value: `transfer:${account.id}`, label: `→ Umbuchung: ${account.name}` }))
        : [],
    [accounts, preview]
  );
  const incomeOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: `cat:${NO_CATEGORY}`, label: "Ohne Kategorie" },
      ...categoryList
        .filter((category) => category.kind === "Income")
        .map((category) => ({ value: `cat:${category.id}`, label: category.label })),
      ...transferOptions,
    ],
    [categoryList, transferOptions]
  );
  const expenseOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: `cat:${NO_CATEGORY}`, label: "Ohne Kategorie" },
      ...categoryList
        .filter((category) => category.kind === "Expense")
        .map((category) => ({ value: `cat:${category.id}`, label: category.label })),
      ...transferOptions,
    ],
    [categoryList, transferOptions]
  );

  const commit = () => {
    if (!preview) return;
    const rows = filteredRows
      .filter((row) => selected.has(row.hash))
      .map((row) => {
        const [kind, idPart] = selectionOf(row).split(":");
        const categoryId = kind === "cat" && idPart !== NO_CATEGORY ? parseInt(idPart, 10) : null;
        const transferAccountId = kind === "transfer" ? parseInt(idPart, 10) : null;
        return {
          date: row.date,
          amountCents: row.amountCents,
          description: row.description,
          counterparty: row.counterparty,
          bankReference: row.bankReference,
          hash: row.hash,
          categoryId,
          transferAccountId,
        };
      });

    startCommit(async () => {
      const result = await commitImportAction({
        accountId: preview.accountId,
        filename: preview.filename,
        format: preview.format,
        periodFrom: preview.periodFrom,
        periodTo: preview.periodTo,
        closingBalanceCents: preview.closingBalanceCents,
        rows,
      });
      if (result.error) toast.error(result.error);
      else {
        toast.success(`${result.imported} Buchung(en) importiert.`);
        update({ done: { imported: result.imported ?? 0, skipped: result.skipped ?? 0 } });
      }
    });
  };

  // Applies a category just created from a row's "+" button to that row, and
  // — since the whole reason to categorise inline is that a rule hasn't been
  // written yet — to every other still-uncategorised row in this same
  // preview with the same counterparty, the same signal loadHistoryCategorySuggestions
  // uses to pre-fill from past imports.
  const applyNewCategory = useCallback(
    (row: PreviewRow, category: CategoryOption) => {
      if (!preview) return;
      setCategoryList((prev) => [...prev, category].sort((a, b) => a.label.localeCompare(b.label, "de-CH")));

      const value = `cat:${category.id}`;
      const base = activeRef.current?.preview === preview ? activeRef.current : null;
      const currentOverrides = base?.overrides ?? {};
      const matches = preview.rows.filter(
        (r) =>
          r.hash === row.hash ||
          (!r.isAdopted &&
            r.categoryId === null &&
            r.transferAccountId === null &&
            r.counterparty &&
            row.counterparty &&
            r.counterparty.trim().toLowerCase() === row.counterparty.trim().toLowerCase() &&
            !(r.hash in currentOverrides))
      );
      const nextOverrides = { ...currentOverrides };
      for (const match of matches) nextOverrides[match.hash] = value;
      setEdits({
        preview,
        selected: base?.selected ?? defaultSelected,
        overrides: nextOverrides,
        done: base?.done ?? null,
      });

      toast.success(
        matches.length > 1
          ? `Kategorie "${category.label}" erstellt und auf ${matches.length} Buchungen angewendet.`
          : `Kategorie "${category.label}" erstellt.`
      );
    },
    [preview, defaultSelected]
  );

  const selectedCount = filteredRows.filter((r) => selected.has(r.hash)).length;
  const selectedSum = filteredRows
    .filter((r) => selected.has(r.hash))
    .reduce((sum, r) => sum + r.amountCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datei hochladen</CardTitle>
          <CardDescription>
            CAMT.053 ist der Kontoauszug deiner Bank im ISO-20022-Format und enthält Anfangs- und
            Schlusssaldo — damit lässt sich prüfen, ob der Import vollständig war. CSV ist der
            Rückfallweg, wenn deine Bank kein CAMT anbietet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              // Built from current state rather than left to the DOM's hidden
              // inputs: React resets a <form action> back to its mount-time
              // values on every submit, which silently reverted accountId/
              // mappingId to their first-render defaults on a second import.
              const data = new FormData(event.currentTarget);
              data.set("format", format);
              data.set("accountId", accountId === AUTO_ACCOUNT ? "" : accountId);
              if (format === "Csv") data.set("mappingId", mappingId);
              startTransition(() => formAction(data));
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex gap-1 rounded-lg bg-muted p-1 self-start">
              {(
                [
                  ["Camt053", "CAMT.053 (XML)"],
                  ["Csv", "CSV"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFormat(value)}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                    format === value
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="file">Datei</Label>
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept={format === "Csv" ? ".csv,.txt,text/csv" : ".xml,text/xml,application/xml"}
                  required
                  className="cursor-pointer"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="import-account">Zielkonto</Label>
                <Combobox
                  id="import-account"
                  value={accountId}
                  onValueChange={(value) => {
                    setAccountId(value);
                    const account = accounts.find((a) => String(a.id) === value);
                    const match =
                      account &&
                      mappings.find(
                        (mapping) =>
                          mapping.name.toLowerCase().includes(account.name.toLowerCase()) ||
                          account.name.toLowerCase().includes(mapping.name.toLowerCase())
                      );
                    if (match) setMappingId(String(match.id));
                  }}
                  options={[
                    ...(format === "Camt053"
                      ? [{ value: AUTO_ACCOUNT, label: "Automatisch (über IBAN)" }]
                      : []),
                    ...accounts.map((account) => ({
                      value: String(account.id),
                      label: account.name,
                    })),
                  ]}
                  searchPlaceholder="Konto suchen…"
                  emptyText="Kein Konto gefunden."
                />
              </div>
            </div>

            {format === "Csv" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="import-mapping">Spalten-Mapping</Label>
                {mappings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Noch kein Mapping angelegt. Lege unten eines für deine Bank an — danach
                    kannst du jede weitere Datei derselben Bank ohne erneutes Zuordnen
                    importieren.
                  </p>
                ) : (
                  <Select value={mappingId} onValueChange={setMappingId}>
                    <SelectTrigger id="import-mapping" className="sm:w-1/2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {mappings.map((mapping) => (
                        <SelectItem key={mapping.id} value={String(mapping.id)}>
                          {mapping.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

            <div>
              <Button
                type="submit"
                disabled={pending || (format === "Csv" && mappings.length === 0)}
              >
                <Upload className="h-4 w-4" />
                {pending ? "Lesen…" : "Datei einlesen"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {done && (
        <Card className="border-emerald-500/50">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <p className="text-sm">
              <strong>{done.imported} Buchung(en) importiert.</strong>
              {done.skipped > 0 && ` ${done.skipped} bereits vorhandene übersprungen.`}
            </p>
          </CardContent>
        </Card>
      )}

      {preview && !done && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Vorschau — {preview.filename} → {preview.accountName}
            </CardTitle>
            <CardDescription>
              {dateFrom || dateTo
                ? `${filteredRows.length} von ${preview.rows.length} Bewegung(en) im gewählten Zeitraum`
                : `${preview.rows.length} Bewegung(en)`}
              {preview.periodFrom && preview.periodTo && (
                <>
                  {" · "}
                  {formatDateCH(preview.periodFrom)} – {formatDateCH(preview.periodTo)}
                </>
              )}
              {preview.duplicateCount > 0 &&
                ` · ${preview.duplicateCount} bereits importiert (nicht angehakt)`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex flex-col gap-2">
                <Label htmlFor="filter-date-from">Zeitraum von</Label>
                <Input
                  id="filter-date-from"
                  type="date"
                  className="w-40"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="filter-date-to">bis</Label>
                <Input
                  id="filter-date-to"
                  type="date"
                  className="w-40"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </div>
              {(dateFrom || dateTo) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  Zeitraum zurücksetzen
                </Button>
              )}
            </div>

            {preview.warnings.map((warning, index) => (
              <div key={index} className="flex flex-col gap-1 text-sm text-amber-600 dark:text-amber-400">
                <p className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  {warning}
                </p>
                {preview.rejectedRows.length > 0 && (
                  <ul className="ml-6 list-disc text-xs text-muted-foreground">
                    {preview.rejectedRows.map((row) => (
                      <li key={row.line}>
                        Zeile {row.line}: {row.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            {preview.balanceDeltaCents !== null && (
              <p
                className={cn(
                  "flex items-start gap-2 text-sm rounded-md border p-3",
                  preview.balanceDeltaCents === 0
                    ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                    : "border-amber-500/40 text-amber-700 dark:text-amber-400"
                )}
              >
                {preview.balanceDeltaCents === 0 ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    Schlusssaldo des Auszugs stimmt nach dem Import mit dem Kontostand überein.
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    Nach dem Import weicht der Kontostand um{" "}
                    {formatMoney(preview.balanceDeltaCents, { withCurrency: true })} vom
                    Schlusssaldo des Auszugs ab. Meist fehlt ein früherer Auszug oder der
                    Startsaldo des Kontos stimmt nicht.
                  </>
                )}
              </p>
            )}

            {preview.uncategorizedCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {preview.uncategorizedCount} Buchung(en) ohne automatische Kategorie. Du kannst
                sie hier direkt zuordnen oder später über die Buchungsliste — passende
                Importregeln sparen das beim nächsten Mal.
              </p>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Leaves selections outside the current date filter untouched —
                    // "Alle neuen" only decides what happens within what's shown.
                    const filteredHashes = new Set(filteredRows.map((r) => r.hash));
                    const next = new Set([...selected].filter((h) => !filteredHashes.has(h)));
                    for (const row of filteredRows) if (!row.isDuplicate) next.add(row.hash);
                    update({ selected: next });
                  }}
                >
                  Alle neuen
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const filteredHashes = new Set(filteredRows.map((r) => r.hash));
                    update({ selected: new Set([...selected].filter((h) => !filteredHashes.has(h))) });
                  }}
                >
                  Keine
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedCount} ausgewählt · Summe <Money cents={selectedSum} colored />
              </p>
            </div>

            {isDesktop ? (
              <div className="overflow-x-auto max-h-[32rem] overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card border-b">
                    <tr className="text-left">
                      <th className="p-2 w-10" />
                      <th className="p-2 w-24">Datum</th>
                      <th className="p-2">Beschreibung</th>
                      <th className="p-2 w-56">Kategorie</th>
                      <th className="p-2 w-28 text-right">Betrag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredRows.map((row) => (
                      <DesktopPreviewRow
                        key={row.hash}
                        row={row}
                        isSelected={selected.has(row.hash)}
                        selectionValue={selectionOf(row)}
                        options={row.amountCents >= 0 ? incomeOptions : expenseOptions}
                        showHistoryBadge={
                          row.categorySource === "history" && !(active && row.hash in active.overrides)
                        }
                        parents={parents}
                        onToggle={toggleRow}
                        onOverride={overrideRow}
                        onCreateCategory={applyNewCategory}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-y-auto rounded-md border divide-y">
                {filteredRows.map((row) => (
                  <MobilePreviewRow
                    key={row.hash}
                    row={row}
                    isSelected={selected.has(row.hash)}
                    selectionValue={selectionOf(row)}
                    options={row.amountCents >= 0 ? incomeOptions : expenseOptions}
                    showHistoryBadge={
                      row.categorySource === "history" && !(active && row.hash in active.overrides)
                    }
                    parents={parents}
                    onToggle={toggleRow}
                    onOverride={overrideRow}
                    onCreateCategory={applyNewCategory}
                  />
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={commit} disabled={committing || selectedCount === 0}>
                {committing ? "Importieren…" : `${selectedCount} Buchung(en) importieren`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface PreviewRowProps {
  row: PreviewRow;
  isSelected: boolean;
  selectionValue: string;
  options: ComboboxOption[];
  showHistoryBadge: boolean;
  parents: CategoryGroupOption[];
  onToggle: (hash: string, checked: boolean) => void;
  onOverride: (hash: string, value: string) => void;
  onCreateCategory: (row: PreviewRow, category: CategoryOption) => void;
}

/**
 * One row of the preview table/cards, split out and memoized so that
 * ticking a single row's checkbox — or re-categorising it — doesn't force
 * React to re-render and diff every other row. With a few thousand rows in
 * a large statement, that repeated whole-list re-render was as much of the
 * "tab freezes" complaint as the initial mount.
 */
const DesktopPreviewRow = memo(function DesktopPreviewRow({
  row,
  isSelected,
  selectionValue,
  options,
  showHistoryBadge,
  parents,
  onToggle,
  onOverride,
  onCreateCategory,
}: PreviewRowProps) {
  return (
    <tr className={cn(!isSelected && "opacity-50", row.isDuplicate && "bg-muted/40")}>
      <td className="p-2">
        <input
          type="checkbox"
          checked={isSelected}
          aria-label="Buchung importieren"
          className="size-4 accent-primary"
          onChange={(event) => onToggle(row.hash, event.target.checked)}
        />
      </td>
      <td className="p-2 tabular-nums text-muted-foreground whitespace-nowrap">{formatDateCH(row.date)}</td>
      <td className="p-2">
        <span className="block truncate max-w-md">{row.description}</span>
        <span className="flex items-center gap-2">
          {row.counterparty && (
            <span className="text-xs text-muted-foreground truncate">{row.counterparty}</span>
          )}
          {row.isDuplicate && <Badge variant="secondary">Bereits importiert</Badge>}
        </span>
      </td>
      <td className="p-2">
        {row.isAdopted ? (
          <Badge variant="secondary">Wird mit Umbuchung verknüpft</Badge>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Combobox
                className="h-8 flex-1"
                value={selectionValue}
                options={options}
                onValueChange={(value) => onOverride(row.hash, value)}
                searchPlaceholder="Kategorie oder Umbuchung suchen…"
                emptyText="Nichts gefunden."
              />
              <QuickCreateCategory
                kind={row.amountCents >= 0 ? "Income" : "Expense"}
                parents={parents}
                onCreated={(category) => onCreateCategory(row, category)}
              />
            </div>
            {showHistoryBadge && (
              <Badge
                variant="outline"
                className="text-[10px]"
                title="Kategorie aus früherer Buchung mit gleichem Empfänger übernommen"
              >
                Verlauf
              </Badge>
            )}
          </div>
        )}
      </td>
      <td className="p-2 text-right font-medium whitespace-nowrap">
        <Money cents={row.amountCents} colored />
      </td>
    </tr>
  );
});

const MobilePreviewRow = memo(function MobilePreviewRow({
  row,
  isSelected,
  selectionValue,
  options,
  showHistoryBadge,
  parents,
  onToggle,
  onOverride,
  onCreateCategory,
}: PreviewRowProps) {
  return (
    <div
      className={cn("p-3 flex flex-col gap-2", !isSelected && "opacity-50", row.isDuplicate && "bg-muted/40")}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={isSelected}
          aria-label="Buchung importieren"
          className="size-4 accent-primary mt-0.5 shrink-0"
          onChange={(event) => onToggle(row.hash, event.target.checked)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate font-medium text-sm">{row.description}</span>
            <span className="shrink-0 font-medium text-sm whitespace-nowrap">
              <Money cents={row.amountCents} colored />
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              {formatDateCH(row.date)}
            </span>
            {row.counterparty && (
              <span className="text-xs text-muted-foreground truncate">{row.counterparty}</span>
            )}
            {row.isDuplicate && <Badge variant="secondary">Bereits importiert</Badge>}
          </div>
        </div>
      </div>

      {row.isAdopted ? (
        <Badge variant="secondary" className="self-start">
          Wird mit Umbuchung verknüpft
        </Badge>
      ) : (
        <div className="space-y-1 pl-6">
          <div className="flex items-center gap-1">
            <Combobox
              className="h-8 flex-1"
              value={selectionValue}
              options={options}
              onValueChange={(value) => onOverride(row.hash, value)}
              searchPlaceholder="Kategorie oder Umbuchung suchen…"
              emptyText="Nichts gefunden."
            />
            <QuickCreateCategory
              kind={row.amountCents >= 0 ? "Income" : "Expense"}
              parents={parents}
              onCreated={(category) => onCreateCategory(row, category)}
            />
          </div>
          {showHistoryBadge && (
            <Badge
              variant="outline"
              className="text-[10px]"
              title="Kategorie aus früherer Buchung mit gleichem Empfänger übernommen"
            >
              Verlauf
            </Badge>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Creates a leaf category under an existing group without leaving the import
 * preview. Restricted to filing under a group that already exists — a brand
 * new top-level group needs a colour and placement decision that belongs on
 * the categories page, not in a popover meant for "one more leaf category".
 */
function QuickCreateCategory({
  kind,
  parents,
  onCreated,
}: {
  kind: CategoryKind;
  parents: CategoryGroupOption[];
  onCreated: (category: CategoryOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startCreate] = useTransition();

  const matchingParents = parents.filter((parent) => parent.kind === kind);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || !parentId) return;
    const formData = new FormData();
    formData.set("name", trimmed);
    formData.set("kind", kind);
    formData.set("parentId", parentId);

    startCreate(async () => {
      const result = await saveCategoryAction(undefined, formData);
      if (result.error || !result.id) {
        setError(result.error ?? "Kategorie konnte nicht erstellt werden.");
        return;
      }
      const parent = matchingParents.find((p) => String(p.id) === parentId);
      onCreated({
        id: result.id,
        name: trimmed,
        kind,
        parentName: parent?.name ?? null,
        label: parent ? `${parent.name} › ${trimmed}` : trimmed,
      });
      setName("");
      setParentId("");
      setError(null);
      setOpen(false);
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Neue Kategorie erstellen"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 flex flex-col gap-3" align="start">
        <p className="text-sm font-medium">Neue Kategorie</p>
        <Input
          autoFocus
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Combobox
          value={parentId}
          onValueChange={setParentId}
          placeholder="Gruppe wählen…"
          options={matchingParents.map((parent) => ({
            value: String(parent.id),
            label: parent.name,
          }))}
          searchPlaceholder="Gruppe suchen…"
          emptyText="Keine passende Gruppe gefunden."
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="button" size="sm" disabled={pending || !name.trim() || !parentId} onClick={submit}>
          {pending ? "Erstellen…" : "Erstellen"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
