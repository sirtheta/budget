"use client";

import { startTransition, useActionState, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import type { CsvMapping } from "@prisma/client";
import { commitImportAction, previewImportAction, type ImportPreview, type PreviewRow } from "./actions";
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
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

const AUTO_ACCOUNT = "auto";
const NO_CATEGORY = "none";

type Format = "Camt053" | "Csv";

export function ImportWizard({
  accounts,
  categories,
  mappings,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  mappings: CsvMapping[];
}) {
  const [format, setFormat] = useState<Format>("Camt053");
  const [accountId, setAccountId] = useState(AUTO_ACCOUNT);
  const [mappingId, setMappingId] = useState(String(mappings[0]?.id ?? ""));
  const [state, formAction, pending] = useActionState(previewImportAction, undefined);

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

  // Duplicates start unchecked — re-importing them is exactly what the
  // fingerprint exists to prevent.
  const defaultSelected = useMemo(
    () => new Set(preview?.rows.filter((row) => !row.isDuplicate).map((row) => row.hash) ?? []),
    [preview]
  );

  const selected = active?.selected ?? defaultSelected;
  const done = active?.done ?? null;

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

  const commit = () => {
    if (!preview) return;
    const rows = preview.rows
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

  const selectedCount = preview ? preview.rows.filter((r) => selected.has(r.hash)).length : 0;
  const selectedSum = preview
    ? preview.rows
        .filter((r) => selected.has(r.hash))
        .reduce((sum, r) => sum + r.amountCents, 0)
    : 0;

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
              {preview.rows.length} Bewegung(en)
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
            {preview.warnings.map((warning, index) => (
              <p key={index} className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                {warning}
              </p>
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
                  onClick={() =>
                    update({
                      selected: new Set(
                        preview.rows.filter((r) => !r.isDuplicate).map((r) => r.hash)
                      ),
                    })
                  }
                >
                  Alle neuen
                </Button>
                <Button variant="outline" size="sm" onClick={() => update({ selected: new Set() })}>
                  Keine
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedCount} ausgewählt · Summe <Money cents={selectedSum} colored />
              </p>
            </div>

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
                  {preview.rows.map((row) => {
                    const isSelected = selected.has(row.hash);
                    return (
                      <tr
                        key={row.hash}
                        className={cn(!isSelected && "opacity-50", row.isDuplicate && "bg-muted/40")}
                      >
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            aria-label="Buchung importieren"
                            className="size-4 accent-primary"
                            onChange={(event) => {
                              const next = new Set(selected);
                              if (event.target.checked) next.add(row.hash);
                              else next.delete(row.hash);
                              update({ selected: next });
                            }}
                          />
                        </td>
                        <td className="p-2 tabular-nums text-muted-foreground whitespace-nowrap">
                          {formatDateCH(row.date)}
                        </td>
                        <td className="p-2">
                          <span className="block truncate max-w-md">{row.description}</span>
                          <span className="flex items-center gap-2">
                            {row.counterparty && (
                              <span className="text-xs text-muted-foreground truncate">
                                {row.counterparty}
                              </span>
                            )}
                            {row.isDuplicate && (
                              <Badge variant="secondary">Bereits importiert</Badge>
                            )}
                          </span>
                        </td>
                        <td className="p-2">
                          {row.isAdopted ? (
                            <Badge variant="secondary">Wird mit Umbuchung verknüpft</Badge>
                          ) : (
                            <Combobox
                              className="h-8"
                              value={selectionOf(row)}
                              options={[
                                { value: `cat:${NO_CATEGORY}`, label: "Ohne Kategorie" },
                                ...categories
                                  .filter((category) =>
                                    row.amountCents >= 0
                                      ? category.kind === "Income"
                                      : category.kind === "Expense"
                                  )
                                  .map((category) => ({
                                    value: `cat:${category.id}`,
                                    label: category.label,
                                  })),
                                ...accounts
                                  .filter((account) => account.id !== preview.accountId)
                                  .map((account) => ({
                                    value: `transfer:${account.id}`,
                                    label: `→ Umbuchung: ${account.name}`,
                                  })),
                              ]}
                              onValueChange={(value) =>
                                update({
                                  overrides: { ...(active?.overrides ?? {}), [row.hash]: value },
                                })
                              }
                              searchPlaceholder="Kategorie oder Umbuchung suchen…"
                              emptyText="Nichts gefunden."
                            />
                          )}
                        </td>
                        <td className="p-2 text-right font-medium whitespace-nowrap">
                          <Money cents={row.amountCents} colored />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

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
