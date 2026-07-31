"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { Reserve } from "@prisma/client";
import { saveReserveAction } from "./actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
import { INTERVAL_LABELS } from "@/lib/intervals";
import type { CategoryOption } from "@/lib/categories";
import type { AccountOption } from "@/app/(app)/transactions/transaction-form-dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";

const NONE = "none";

export function ReserveFormDialog({
  reserve,
  accounts,
  categories,
  today,
  trigger,
}: {
  reserve?: Reserve;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
  /** Omit to get the default button — building it in a Server Component page breaks Radix's Slot. */
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(saveReserveAction, {
    onSuccess: () => setOpen(false),
    successMessage: reserve ? "Rückstellung gespeichert." : "Rückstellung angelegt.",
  });
  const [interval, setInterval] = useState(String(reserve?.intervalMonths ?? 12));
  const [accountId, setAccountId] = useState(String(reserve?.accountId ?? NONE));
  const [categoryId, setCategoryId] = useState(String(reserve?.categoryId ?? NONE));

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>
        {trigger ??
          (reserve ? (
            <Button variant="ghost" size="icon" className="size-8" aria-label="Bearbeiten">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button>
              <Plus className="h-4 w-4" /> Neue Rückstellung
            </Button>
          ))}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reserve ? "Rückstellung bearbeiten" : "Neue Rückstellung"}</DialogTitle>
          <DialogDescription>
            Für Kosten, die jährlich oder halbjährlich anfallen — Krankenkasse, Steuern,
            Versicherungen. Die App rechnet aus, wie viel du monatlich zurücklegen musst.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {reserve && <input type="hidden" name="id" value={reserve.id} />}
          <input type="hidden" name="intervalMonths" value={interval} />
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="categoryId" value={categoryId} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Bezeichnung</Label>
            <Input
              id="name"
              name="name"
              defaultValue={reserve?.name}
              placeholder="z. B. Krankenkasse Jahresprämie"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="targetAmount">Betrag pro Fälligkeit (CHF)</Label>
              <Input
                id="targetAmount"
                name="targetAmount"
                inputMode="decimal"
                defaultValue={reserve ? (reserve.targetAmountCents / 100).toFixed(2) : ""}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="saved">Bereits zurückgelegt (CHF)</Label>
              <Input
                id="saved"
                name="saved"
                inputMode="decimal"
                defaultValue={reserve ? (reserve.savedCents / 100).toFixed(2) : "0.00"}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="interval-trigger">Rhythmus</Label>
              <Select value={interval} onValueChange={setInterval}>
                <SelectTrigger id="interval-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INTERVAL_LABELS).map(([months, label]) => (
                    <SelectItem key={months} value={months}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="nextDueDate">Nächste Fälligkeit</Label>
              <Input
                id="nextDueDate"
                name="nextDueDate"
                type="date"
                defaultValue={reserve?.nextDueDate ?? today}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="reserve-category">Kategorie (optional)</Label>
              <Combobox
                id="reserve-category"
                value={categoryId}
                onValueChange={setCategoryId}
                options={[
                  { value: NONE, label: "Keine" },
                  ...categories
                    .filter((category) => category.kind === "Expense")
                    .map((category) => ({ value: String(category.id), label: category.label })),
                ]}
                searchPlaceholder="Kategorie suchen…"
                emptyText="Keine Kategorie gefunden."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reserve-account">Konto (optional)</Label>
              <Combobox
                id="reserve-account"
                value={accountId}
                onValueChange={setAccountId}
                options={[
                  { value: NONE, label: "Keines" },
                  ...accounts.map((account) => ({ value: String(account.id), label: account.name })),
                ]}
                searchPlaceholder="Konto suchen…"
                emptyText="Kein Konto gefunden."
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">Notiz (optional)</Label>
            <Textarea id="notes" name="notes" defaultValue={reserve?.notes ?? ""} rows={2} />
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
