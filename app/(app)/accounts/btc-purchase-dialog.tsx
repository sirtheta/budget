"use client";

import { useState } from "react";
import { Bitcoin } from "lucide-react";
import { recordBtcPurchaseAction } from "./actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
import type { CategoryOption } from "@/lib/categories";
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
import { Combobox } from "@/components/ui/combobox";

export interface AccountOption {
  id: number;
  name: string;
}

const NO_CATEGORY = "none";

/**
 * Manual entry for a Bitcoin purchase (e.g. a weekly DCA buy): CHF leaves a
 * normal account, BTC lands in the wallet. Not auto-detected from a bank
 * import — the bank statement shows the CHF outflow to the exchange, never
 * the BTC amount or fee the exchange actually charged.
 */
export function BtcPurchaseDialog({
  cryptoAccountId,
  sourceAccounts,
  categories,
  currentRateChf,
  today,
}: {
  cryptoAccountId: number;
  sourceAccounts: AccountOption[];
  categories: CategoryOption[];
  /** Live BTC/CHF rate for the estimate hint, or null if it couldn't be fetched. */
  currentRateChf: number | null;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(recordBtcPurchaseAction, {
    onSuccess: () => setOpen(false),
    successMessage: "Kauf erfasst.",
  });
  const [sourceAccountId, setSourceAccountId] = useState(
    String(sourceAccounts[0]?.id ?? "")
  );
  const [categoryId, setCategoryId] = useState(NO_CATEGORY);
  const [chfAmount, setChfAmount] = useState("");

  const expenseCategories = categories.filter((category) => category.kind === "Expense");

  const estimate =
    currentRateChf !== null && chfAmount
      ? Number(chfAmount.replace(",", ".")) / currentRateChf
      : null;

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Bitcoin-Kauf erfassen">
          <Bitcoin className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bitcoin-Kauf erfassen</DialogTitle>
          <DialogDescription>
            CHF-Betrag und BTC-Menge wie von der Börse bestätigt eintragen — inklusive Gebühr.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="cryptoAccountId" value={cryptoAccountId} />
          <input type="hidden" name="sourceAccountId" value={sourceAccountId} />
          <input
            type="hidden"
            name="categoryId"
            value={categoryId === NO_CATEGORY ? "" : categoryId}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="chfAmount">CHF-Betrag (inkl. Gebühr)</Label>
              <Input
                id="chfAmount"
                name="chfAmount"
                inputMode="decimal"
                placeholder="50.00"
                value={chfAmount}
                onChange={(e) => setChfAmount(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="btcAmount">BTC erhalten</Label>
              <Input
                id="btcAmount"
                name="btcAmount"
                inputMode="decimal"
                placeholder={estimate ? estimate.toFixed(8) : "0.00050000"}
                required
              />
            </div>
          </div>
          {estimate !== null && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Schätzung zum aktuellen Kurs: ≈ {estimate.toFixed(8)} BTC. Die tatsächlich erhaltene
              Menge der Börse eintragen, nicht die Schätzung.
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="date">Datum</Label>
            <Input id="date" name="date" type="date" defaultValue={today} required />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Beschreibung</Label>
            <Input
              id="description"
              name="description"
              defaultValue="Bitcoin-Kauf"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="source-trigger">Von Konto</Label>
              <Combobox
                id="source-trigger"
                value={sourceAccountId}
                onValueChange={setSourceAccountId}
                options={sourceAccounts.map((account) => ({
                  value: String(account.id),
                  label: account.name,
                }))}
                placeholder="Quellkonto"
                searchPlaceholder="Konto suchen…"
                emptyText="Kein Konto gefunden."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="category-trigger">Kategorie (optional)</Label>
              <Combobox
                id="category-trigger"
                value={categoryId}
                onValueChange={setCategoryId}
                options={[
                  { value: NO_CATEGORY, label: "Ohne Kategorie" },
                  ...expenseCategories.map((category) => ({
                    value: String(category.id),
                    label: category.label,
                  })),
                ]}
                placeholder="Kategorie wählen"
                searchPlaceholder="Kategorie suchen…"
                emptyText="Keine Kategorie gefunden."
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">Notiz (optional)</Label>
            <Textarea id="notes" name="notes" rows={2} />
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
