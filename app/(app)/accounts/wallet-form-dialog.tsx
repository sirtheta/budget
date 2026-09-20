"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { deleteCryptoWalletAction, saveCryptoWalletAction } from "./actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
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

/**
 * Creates, renames or deletes a physical wallet grouping. Deleting only
 * detaches the stake accounts (onDelete: SetNull on the DB side) — their
 * balances are untouched, so the confirmation text says exactly that.
 */
export function WalletFormDialog({
  wallet,
}: {
  wallet?: { id: number; name: string; notes: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(saveCryptoWalletAction, {
    onSuccess: () => setOpen(false),
    successMessage: "Wallet gespeichert.",
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {wallet ? (
          <Button variant="ghost" size="icon" aria-label="Wallet bearbeiten">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline">
            <Plus className="h-4 w-4" /> Neue Wallet
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{wallet ? "Wallet bearbeiten" : "Neue Wallet"}</DialogTitle>
          <DialogDescription>
            Eine Wallet gruppiert die Krypto-Konten, die je einen Anteil am selben physischen
            Wallet abbilden. Beim Löschen bleiben die Anteils-Konten samt Beständen erhalten; sie
            werden nur von der Wallet gelöst.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {wallet && <input type="hidden" name="id" value={wallet.id} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor="wallet-name">Name</Label>
            <Input id="wallet-name" name="name" defaultValue={wallet?.name ?? ""} required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="wallet-notes">Notiz (optional)</Label>
            <Textarea id="wallet-notes" name="notes" rows={2} defaultValue={wallet?.notes ?? ""} />
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            {wallet && (
              <Button
                type="button"
                variant="destructive"
                onClick={async () => {
                  const result = await deleteCryptoWalletAction(wallet.id);
                  if (result.error) toast.error(result.error);
                  else {
                    toast.success("Wallet gelöscht.");
                    setOpen(false);
                  }
                }}
              >
                Löschen
              </Button>
            )}
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
