"use client";

import { useState } from "react";
import { Pencil, Target } from "lucide-react";
import type { SavingsGoal } from "@prisma/client";
import { saveGoalAction } from "./actions";
import { useDialogFormAction } from "@/components/use-dialog-form";
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
import { Combobox } from "@/components/ui/combobox";

const NONE = "none";

export function GoalFormDialog({
  goal,
  accounts,
  trigger,
}: {
  goal?: SavingsGoal;
  accounts: AccountOption[];
  /** Omit to get the default button — building it in a Server Component page breaks Radix's Slot. */
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useDialogFormAction(saveGoalAction, {
    onSuccess: () => setOpen(false),
    successMessage: goal ? "Sparziel gespeichert." : "Sparziel angelegt.",
  });
  const [accountId, setAccountId] = useState(String(goal?.accountId ?? NONE));

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>
        {trigger ??
          (goal ? (
            <Button variant="ghost" size="icon" className="size-8" aria-label="Bearbeiten">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button variant="outline">
              <Target className="h-4 w-4" /> Neues Sparziel
            </Button>
          ))}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{goal ? "Sparziel bearbeiten" : "Neues Sparziel"}</DialogTitle>
          <DialogDescription>
            Mit einem Zieldatum rechnet die App die nötige monatliche Sparrate aus.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {goal && <input type="hidden" name="id" value={goal.id} />}
          <input type="hidden" name="accountId" value={accountId} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="goal-name">Bezeichnung</Label>
            <Input
              id="goal-name"
              name="name"
              defaultValue={goal?.name}
              placeholder="z. B. Ferien Norwegen"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="goal-target">Zielbetrag (CHF)</Label>
              <Input
                id="goal-target"
                name="targetAmount"
                inputMode="decimal"
                defaultValue={goal ? (goal.targetAmountCents / 100).toFixed(2) : ""}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="goal-saved">Bereits gespart (CHF)</Label>
              <Input
                id="goal-saved"
                name="saved"
                inputMode="decimal"
                defaultValue={goal ? (goal.savedCents / 100).toFixed(2) : "0.00"}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="goal-date">Zieldatum (optional)</Label>
              <Input
                id="goal-date"
                name="targetDate"
                type="date"
                defaultValue={goal?.targetDate ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="goal-color">Farbe</Label>
              <Input
                id="goal-color"
                name="color"
                type="color"
                defaultValue={goal?.color ?? "#6366f1"}
                className="h-9 p-1"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="goal-account">Konto (optional)</Label>
            <Combobox
              id="goal-account"
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="goal-notes">Notiz (optional)</Label>
            <Textarea id="goal-notes" name="notes" defaultValue={goal?.notes ?? ""} rows={2} />
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
