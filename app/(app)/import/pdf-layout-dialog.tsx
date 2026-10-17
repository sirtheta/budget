"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PdfLayout } from "@prisma/client";
import { inspectPdfAction } from "./actions";
import { previewPdfLayoutAction, savePdfLayoutAction } from "./pdf-layout-actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
import { SUPPORTED_DATE_FORMATS } from "@/lib/import/csv";
import { formatDateCH } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import {
  parseContextRules,
  validateLayout,
  type ContextRule,
  type LineKind,
  type PdfLayoutConfig,
  type PdfParseResult,
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

  // Compiling is cheap, so validation follows every keystroke. Running the
  // regexes over the sample happens on the server (previewPdfLayoutAction, with
  // hard regex timeouts) and is debounced; a flag drops answers that a newer
  // edit has overtaken.
  const problem = useMemo(() => validateLayout(config), [config]);
  const [analysis, setAnalysis] = useState<{
    kinds: LineKind[];
    result: PdfParseResult | null;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!lines || problem) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const response = await previewPdfLayoutAction({ lines, layout: config });
        if (stale) return;
        setAnalysis(
          response.error
            ? { kinds: [], result: null, error: response.error }
            : { kinds: response.kinds ?? [], result: response.result ?? null }
        );
      } catch {
        if (!stale) setAnalysis({ kinds: [], result: null, error: "Vorschau nicht verfügbar." });
      }
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [lines, config, problem]);
  const shown = lines && !problem ? analysis : null;
  const kinds = shown?.kinds ?? [];
  const result = shown?.result ?? null;
  const previewError = shown?.error ?? null;

  const inspect = (file: File) => {
    const data = new FormData();
    data.set("file", file);
    startInspect(async () => {
      try {
        const response = await inspectPdfAction(data);
        if (response.error) toast.error(response.error);
        else setLines(response.lines ?? null);
      } catch {
        // A framework-level failure (e.g. request body too large) throws instead of returning.
        toast.error("Das PDF konnte nicht gelesen werden (Datei zu gross?).");
      }
    });
  };

  // The fields are controlled, so a form reset does not clear them: restore the
  // saved layout (or the defaults of a new one) each time the dialog opens.
  const reset = () => {
    setName(layout?.name ?? "");
    setTransactionRegex(layout?.transactionRegex ?? STARTER_REGEX);
    setDateFormat(layout?.dateFormat ?? "DD.MM.YY");
    setNegativeSuffixRegex(layout?.negativeSuffixRegex ?? "");
    setInvertAmount(layout?.invertAmount ?? true);
    setDescriptionTemplate(layout?.descriptionTemplate ?? "{text}");
    setSkipRegex(layout?.skipRegex ?? "");
    setTotalRegex(layout?.totalRegex ?? "");
    setRules(layout ? parseContextRules(layout.contextRegexes) : []);
    setLines(null);
  };

  const updateRule = (index: number, patch: Partial<ContextRule>) =>
    setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
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
            Beispiel-PDF, um die Regeln gegen echten Text zu prüfen. Das PDF wird nicht gespeichert. Ändere die Gruppen date, valuta, text und amount der Buchungszeile nicht nachträglich:
            sie bilden den Duplikat-Fingerabdruck, und schon importierte Zeilen gälten beim erneuten Einlesen als neu.
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
                <Input id="negativeSuffixRegex" name="negativeSuffixRegex" value={negativeSuffixRegex} onChange={(e) => setNegativeSuffixRegex(e.target.value)} className="font-mono text-xs" placeholder={String.raw`\s*-$`} />
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

                {previewError && <p className="text-sm text-destructive">{previewError}</p>}

                {result && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">{result.transactions.length} Buchung(en) erkannt</p>
                    {result.warnings.map((warning, index) => (
                      <p key={index} className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>
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
