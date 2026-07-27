"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { CsvMapping } from "@prisma/client";
import { saveCsvMappingAction } from "./mapping-actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
import { inspectCsvAction } from "./actions";
import { SUPPORTED_DATE_FORMATS } from "@/lib/import/csv";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Column mapping for one bank's CSV export.
 *
 * A sample file can be loaded first so the columns are picked from what the
 * file actually contains rather than from memory — counting comma-separated
 * fields by hand is where CSV imports usually go wrong.
 */
export function CsvMappingDialog({
  mapping,
  trigger,
}: {
  mapping?: CsvMapping;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(saveCsvMappingAction, {
    onSuccess: () => setOpen(false),
    successMessage: mapping ? "Mapping gespeichert." : "Mapping angelegt.",
  });
  const [sample, setSample] = useState<string[][] | null>(null);
  const [delimiter, setDelimiter] = useState(mapping?.delimiter ?? ";");
  const [dateFormat, setDateFormat] = useState(mapping?.dateFormat ?? "DD.MM.YYYY");
  const [inspecting, startInspect] = useTransition();

  const inspect = (file: File) => {
    const data = new FormData();
    data.set("file", file);
    data.set("delimiter", delimiter);
    startInspect(async () => {
      const result = await inspectCsvAction(data);
      if (result.error) toast.error(result.error);
      else {
        setSample(result.rows ?? null);
        if (result.delimiter) setDelimiter(result.delimiter);
      }
    });
  };

  const columnCount = sample?.[0]?.length ?? 0;
  const columnOptions = Array.from({ length: columnCount }, (_, index) => index);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mapping ? "Mapping bearbeiten" : "Neues CSV-Mapping"}</DialogTitle>
          <DialogDescription>
            Beschreibt einmalig, in welchen Spalten deine Bank Datum, Text und Betrag liefert.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-md border p-3">
          <Label htmlFor="sample-file">Beispieldatei laden (optional)</Label>
          <Input
            id="sample-file"
            type="file"
            accept=".csv,.txt,text/csv"
            disabled={inspecting}
            className="cursor-pointer"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) inspect(file);
            }}
          />
          {sample && (
            <div className="overflow-x-auto mt-2">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    {columnOptions.map((index) => (
                      <th
                        key={index}
                        className="border px-2 py-1 bg-muted font-mono text-muted-foreground"
                      >
                        {index}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sample.slice(0, 5).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {columnOptions.map((index) => (
                        <td key={index} className="border px-2 py-1 max-w-40 truncate">
                          {row[index] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-1">
                Die Zahlen oben sind die Spaltennummern, die du unten einträgst.
              </p>
            </div>
          )}
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          {mapping && <input type="hidden" name="id" value={mapping.id} />}
          <input type="hidden" name="delimiter" value={delimiter} />
          <input type="hidden" name="dateFormat" value={dateFormat} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="mapping-name">Name (Bank)</Label>
              <Input
                id="mapping-name"
                name="name"
                defaultValue={mapping?.name}
                placeholder="PostFinance"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mapping-delimiter">Trennzeichen</Label>
              <Input
                id="mapping-delimiter"
                value={delimiter}
                onChange={(event) => setDelimiter(event.target.value)}
                maxLength={4}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="skipRows">Kopfzeilen überspringen</Label>
              <Input
                id="skipRows"
                name="skipRows"
                type="number"
                min={0}
                max={50}
                defaultValue={mapping?.skipRows ?? 0}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="hasHeader"
              defaultChecked={mapping?.hasHeader ?? true}
              className="size-4 accent-primary"
            />
            Die erste Datenzeile ist eine Spaltenüberschrift
          </label>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <ColumnField
              id="dateColumn"
              label="Spalte Datum"
              defaultValue={mapping?.dateColumn ?? 0}
              required
            />
            <div className="flex flex-col gap-2">
              <Label htmlFor="mapping-dateformat">Datumsformat</Label>
              <Select value={dateFormat} onValueChange={setDateFormat}>
                <SelectTrigger id="mapping-dateformat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_DATE_FORMATS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ColumnField
              id="descriptionColumn"
              label="Spalte Beschreibung"
              defaultValue={mapping?.descriptionColumn ?? 1}
              required
            />
          </div>

          <div className="rounded-md border p-3 flex flex-col gap-3">
            <p className="text-sm font-medium">Betrag</p>
            <p className="text-xs text-muted-foreground">
              Entweder eine Spalte mit Vorzeichen — oder getrennte Soll-/Haben-Spalten, die beide
              positive Zahlen enthalten. Nicht benötigte Felder leer lassen.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <ColumnField
                id="amountColumn"
                label="Betrag (mit Vorzeichen)"
                defaultValue={mapping?.amountColumn ?? null}
              />
              <ColumnField
                id="debitColumn"
                label="Soll / Belastung"
                defaultValue={mapping?.debitColumn ?? null}
              />
              <ColumnField
                id="creditColumn"
                label="Haben / Gutschrift"
                defaultValue={mapping?.creditColumn ?? null}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="invertAmount"
                defaultChecked={mapping?.invertAmount ?? false}
                className="size-4 accent-primary"
              />
              Vorzeichen umkehren (z. B. Kreditkarten-Exporte: Bezüge positiv, Gutschriften negativ)
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <ColumnField
              id="counterpartyColumn"
              label="Spalte Gegenpartei"
              defaultValue={mapping?.counterpartyColumn ?? null}
            />
            <div className="flex flex-col gap-2">
              <Label htmlFor="decimalSeparator">Dezimaltrennzeichen</Label>
              <Input
                id="decimalSeparator"
                name="decimalSeparator"
                maxLength={1}
                defaultValue={mapping?.decimalSeparator ?? "."}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="thousandsSeparator">Tausendertrennzeichen</Label>
              <Input
                id="thousandsSeparator"
                name="thousandsSeparator"
                maxLength={1}
                defaultValue={mapping?.thousandsSeparator ?? "'"}
              />
            </div>
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Speichern…" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ColumnField({
  id,
  label,
  defaultValue,
  required = false,
}: {
  id: string;
  label: string;
  defaultValue: number | null;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type="number"
        min={0}
        defaultValue={defaultValue ?? ""}
        required={required}
        placeholder={required ? undefined : "—"}
      />
    </div>
  );
}
