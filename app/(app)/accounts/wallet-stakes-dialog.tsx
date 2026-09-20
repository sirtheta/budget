"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { updateWalletStakesAction } from "./actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
import type { WalletView } from "@/lib/crypto-wallets";
import { formatMoney, parseMoney } from "@/lib/money";
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

/**
 * Books a top-up for every stake of one physical wallet in a single submit.
 * The user types what each person gained — never a recomputed total — because
 * splitting a new total across the stakes by hand is exactly the arithmetic
 * this replaces. Negative values mean a sale or a correction.
 */
export function WalletStakesDialog({ wallet }: { wallet: WalletView }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(updateWalletStakesAction, {
    onSuccess: () => setOpen(false),
    successMessage: "Anteile erfasst.",
  });
  const [btcDeltas, setBtcDeltas] = useState<Record<number, string>>({});
  const [costDeltas, setCostDeltas] = useState<Record<number, string>>({});

  const btcDelta = (accountId: number) => {
    const value = Number((btcDeltas[accountId] ?? "").replace(",", "."));
    return Number.isFinite(value) ? value : 0;
  };
  const costDelta = (accountId: number) => parseMoney(costDeltas[accountId] ?? "") ?? 0;

  const newTotalBtc = wallet.stakes.reduce(
    (sum, stake) => sum + stake.btcAmount + btcDelta(stake.accountId),
    0
  );
  const addedCostCents = wallet.stakes.reduce(
    (sum, stake) => sum + costDelta(stake.accountId),
    0
  );

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4" /> Anteile erfassen
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Anteile erfassen — {wallet.name}</DialogTitle>
          <DialogDescription>
            Pro Person eintragen, wie viel dazugekommen ist. Negative Werte für Verkauf oder
            Korrektur. Es wird keine Buchung auf einem Bankkonto ausgelöst.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="walletId" value={wallet.id} />

          <div className="flex flex-col gap-4">
            {wallet.stakes.map((stake) => (
              <div key={stake.accountId} className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">
                  {stake.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {stake.btcAmount.toFixed(8)} BTC
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <Label htmlFor={`btcDelta-${stake.accountId}`}>+ BTC</Label>
                  <Label htmlFor={`costDelta-${stake.accountId}`}>+ Einstand (CHF)</Label>
                  <Input
                    id={`btcDelta-${stake.accountId}`}
                    name={`btcDelta-${stake.accountId}`}
                    inputMode="decimal"
                    placeholder="0.00050000"
                    value={btcDeltas[stake.accountId] ?? ""}
                    onChange={(e) =>
                      setBtcDeltas((prev) => ({ ...prev, [stake.accountId]: e.target.value }))
                    }
                  />
                  <Input
                    id={`costDelta-${stake.accountId}`}
                    name={`costDelta-${stake.accountId}`}
                    inputMode="decimal"
                    placeholder="50.00"
                    value={costDeltas[stake.accountId] ?? ""}
                    onChange={(e) =>
                      setCostDeltas((prev) => ({ ...prev, [stake.accountId]: e.target.value }))
                    }
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Neuer Bestand: {(stake.btcAmount + btcDelta(stake.accountId)).toFixed(8)} BTC
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-md bg-muted p-3 text-sm">
            <p>
              Wallet-Total neu: <strong>{newTotalBtc.toFixed(8)} BTC</strong>
            </p>
            <p className="text-muted-foreground">
              Zusätzlicher Einstandswert: {formatMoney(addedCostCents, { withCurrency: true })}
            </p>
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
