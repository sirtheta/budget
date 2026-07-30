"use client";

import { useState } from "react";
import type { RecurringTransaction } from "@prisma/client";
import { saveRecurringAction } from "./actions";
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
import { cn } from "@/lib/utils";

const NONE = "none";

export function RecurringFormDialog({
  recurring,
  accounts,
  categories,
  today,
  trigger,
}: {
  recurring?: RecurringTransaction;
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(saveRecurringAction, {
    onSuccess: () => setOpen(false),
    successMessage: recurring ? "Gespeichert." : "Wiederkehrende Buchung angelegt.",
  });

  const [mode, setMode] = useState<"booking" | "transfer">(
    recurring?.counterAccountId ? "transfer" : "booking"
  );
  const [direction, setDirection] = useState<"expense" | "income">(
    recurring && recurring.amountCents > 0 && !recurring.counterAccountId ? "income" : "expense"
  );
  const [interval, setInterval] = useState(String(recurring?.intervalMonths ?? 1));
  const [accountId, setAccountId] = useState(
    String(recurring?.accountId ?? accounts[0]?.id ?? "")
  );
  const [counterAccountId, setCounterAccountId] = useState(
    String(recurring?.counterAccountId ?? NONE)
  );
  const [categoryId, setCategoryId] = useState(String(recurring?.categoryId ?? NONE));

  const visibleCategories = categories.filter((category) =>
    direction === "income" ? category.kind === "Income" : category.kind === "Expense"
  );

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {recurring ? "Wiederkehrende Buchung bearbeiten" : "Neue wiederkehrende Buchung"}
          </DialogTitle>
          <DialogDescription>
            Miete, Abos, Versicherungen — oder ein monatlicher Dauerauftrag aufs Sparkonto.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {recurring && <input type="hidden" name="id" value={recurring.id} />}
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="direction" value={direction} />
          <input type="hidden" name="intervalMonths" value={interval} />
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="counterAccountId" value={counterAccountId} />
          <input type="hidden" name="categoryId" value={categoryId} />

          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(
              [
                ["booking", "Einnahme / Ausgabe"],
                ["transfer", "Umbuchung"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === value
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="rec-name">Bezeichnung</Label>
            <Input
              id="rec-name"
              name="name"
              defaultValue={recurring?.name}
              placeholder="z. B. Miete"
              required
              autoFocus
            />
          </div>

          {mode === "booking" && (
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  ["expense", "Ausgabe"],
                  ["income", "Einnahme"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setDirection(value);
                    setCategoryId(NONE);
                  }}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    direction === value
                      ? value === "income"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 shadow-sm"
                        // See transaction-form-dialog: text-destructive on its
                        // own tint does not reach the contrast floor.
                        : "bg-destructive/15 text-red-800 dark:text-red-400 shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="rec-amount">Betrag (CHF)</Label>
              <Input
                id="rec-amount"
                name="amount"
                inputMode="decimal"
                defaultValue={
                  recurring ? (Math.abs(recurring.amountCents) / 100).toFixed(2) : ""
                }
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rec-interval">Rhythmus</Label>
              <Select value={interval} onValueChange={setInterval}>
                <SelectTrigger id="rec-interval">
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="rec-account">{mode === "transfer" ? "Von Konto" : "Konto"}</Label>
              <Combobox
                id="rec-account"
                value={accountId}
                onValueChange={setAccountId}
                options={accounts.map((account) => ({
                  value: String(account.id),
                  label: account.name,
                }))}
                placeholder="Konto wählen"
                searchPlaceholder="Konto suchen…"
                emptyText="Kein Konto gefunden."
              />
            </div>
            {mode === "transfer" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="rec-counter">Auf Konto</Label>
                <Combobox
                  id="rec-counter"
                  value={counterAccountId}
                  onValueChange={setCounterAccountId}
                  options={accounts.map((account) => ({
                    value: String(account.id),
                    label: account.name,
                  }))}
                  placeholder="Zielkonto"
                  searchPlaceholder="Konto suchen…"
                  emptyText="Kein Konto gefunden."
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="rec-category">Kategorie</Label>
                <Combobox
                  id="rec-category"
                  value={categoryId}
                  onValueChange={setCategoryId}
                  options={[
                    { value: NONE, label: "Ohne Kategorie" },
                    ...visibleCategories.map((category) => ({
                      value: String(category.id),
                      label: category.label,
                    })),
                  ]}
                  searchPlaceholder="Kategorie suchen…"
                  emptyText="Keine Kategorie gefunden."
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="rec-start">Erste Buchung</Label>
              <Input
                id="rec-start"
                name="startDate"
                type="date"
                defaultValue={recurring?.startDate ?? today}
                required
                disabled={!!recurring}
              />
              {recurring && (
                <p className="text-xs text-muted-foreground">
                  Nächste Buchung: {recurring.nextDate}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rec-end">Ende (optional)</Label>
              <Input
                id="rec-end"
                name="endDate"
                type="date"
                defaultValue={recurring?.endDate ?? ""}
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="autoPost"
              defaultChecked={recurring?.autoPost ?? true}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              Automatisch buchen
              <span className="block text-xs text-muted-foreground">
                Ohne Haken erscheint die Buchung nur als Vorschlag auf dem Dashboard und wird
                erst nach Bestätigung erfasst.
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <Label htmlFor="rec-notes">Notiz (optional)</Label>
            <Textarea id="rec-notes" name="notes" defaultValue={recurring?.notes ?? ""} rows={2} />
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
