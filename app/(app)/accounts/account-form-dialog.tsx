"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { Account } from "@prisma/client";
import { AccountType } from "@prisma/client";
import { saveAccountAction } from "./actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
import { ACCOUNT_TYPE_LABELS } from "@/lib/balances";
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

export function AccountFormDialog({ account }: { account?: Account }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(saveAccountAction, {
    onSuccess: () => setOpen(false),
    successMessage: account ? "Konto gespeichert." : "Konto angelegt.",
  });
  const [type, setType] = useState<AccountType>(account?.type ?? "Checking");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {account ? (
          <Button variant="ghost" size="icon" aria-label="Konto bearbeiten">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" /> Neues Konto
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{account ? "Konto bearbeiten" : "Neues Konto"}</DialogTitle>
          <DialogDescription>
            Der Startsaldo ist der Kontostand zum Zeitpunkt, ab dem du erfasst. Alle Buchungen
            werden darauf addiert.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {account && <input type="hidden" name="id" value={account.id} />}
          <input type="hidden" name="type" value={type} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Bezeichnung</Label>
            <Input
              id="name"
              name="name"
              defaultValue={account?.name}
              placeholder="z. B. Privatkonto PostFinance"
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="type-trigger">Kontoart</Label>
            <Select value={type} onValueChange={(value) => setType(value as AccountType)}>
              <SelectTrigger id="type-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(AccountType).map((value) => (
                  <SelectItem key={value} value={value}>
                    {ACCOUNT_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {type === "Crypto" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="btcAmount">BTC-Bestand</Label>
                <Input
                  id="btcAmount"
                  name="btcAmount"
                  inputMode="decimal"
                  defaultValue={account?.btcAmount ?? "0"}
                  placeholder="0.12345678"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="color">Farbe</Label>
                <Input
                  id="color"
                  name="color"
                  type="color"
                  defaultValue={account?.color ?? "#6366f1"}
                  className="h-9 p-1"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-2">
                <Label htmlFor="btcCostBasis">Einstandswert (CHF, optional)</Label>
                <Input
                  id="btcCostBasis"
                  name="btcCostBasis"
                  inputMode="decimal"
                  defaultValue={
                    account?.btcCostBasisCents != null
                      ? (account.btcCostBasisCents / 100).toFixed(2)
                      : ""
                  }
                  placeholder="z. B. 500.00"
                />
                <p className="text-xs text-muted-foreground">
                  Total tatsächlich bezahlter CHF-Betrag für den aktuellen BTC-Bestand. Nur nötig,
                  um Gewinn/Verlust für einen Bestand anzuzeigen, der nicht über den
                  Bitcoin-Kauf-Dialog erfasst wurde. Wird durch spätere Käufe automatisch erhöht.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="openingBalance">Startsaldo (CHF)</Label>
                <Input
                  id="openingBalance"
                  name="openingBalance"
                  inputMode="decimal"
                  defaultValue={
                    account ? (account.openingBalanceCents / 100).toFixed(2) : "0.00"
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="color">Farbe</Label>
                <Input
                  id="color"
                  name="color"
                  type="color"
                  defaultValue={account?.color ?? "#6366f1"}
                  className="h-9 p-1"
                />
              </div>
            </div>
          )}

          {type !== "Crypto" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="iban">IBAN (optional)</Label>
              <Input
                id="iban"
                name="iban"
                defaultValue={account?.iban ?? ""}
                placeholder="CH93 0076 2011 6238 5295 7"
              />
              <p className="text-xs text-muted-foreground">
                Wird beim CAMT.053-Import verwendet, um den Auszug automatisch diesem Konto
                zuzuordnen.
              </p>
            </div>
          )}

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="excludeFromBudget"
              defaultChecked={account?.excludeFromBudget}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              Nicht ins Budget einrechnen
              <span className="block text-xs text-muted-foreground">
                Für Depots und Anlagekonten: zählt weiter zum Vermögen, verfälscht aber die
                Einnahmen-/Ausgabenauswertung nicht.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="excludeFromNetWorth"
              defaultChecked={account?.excludeFromNetWorth}
              className="mt-1 size-4 accent-primary"
            />
            <span>
              Nicht ins Vermögen einrechnen
              <span className="block text-xs text-muted-foreground">
                Das Konto bleibt für Buchungen und Salden verfügbar, wird aber aus der
                Vermögensrechnung und Vermögensentwicklung ausgeschlossen.
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">Notiz (optional)</Label>
            <Textarea id="notes" name="notes" defaultValue={account?.notes ?? ""} rows={2} />
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
