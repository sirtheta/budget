"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Plus, Trash2 } from "lucide-react";
import {
  addToGoalAction,
  addToReserveAction,
  deleteGoalAction,
  deleteReserveAction,
  settleReserveAction,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Inline "einzahlen" field. Deliberately a delta rather than an absolute
 * amount: setting money aside is an incremental act, and typing the new total
 * every month invites arithmetic errors.
 */
export function AddToPot({
  id,
  kind,
  suggestionCents,
}: {
  id: number;
  kind: "reserve" | "goal";
  /** Pre-filled monthly rate, so the common case is one click. */
  suggestionCents?: number | null;
}) {
  const [amount, setAmount] = useState(
    suggestionCents && suggestionCents > 0 ? (suggestionCents / 100).toFixed(2) : ""
  );
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!amount.trim()) return;
    startTransition(async () => {
      const action = kind === "reserve" ? addToReserveAction : addToGoalAction;
      const result = await action(id, amount);
      if (result.error) toast.error(result.error);
      else toast.success("Betrag zurückgelegt.");
    });
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
        placeholder="0.00"
        aria-label="Betrag einzahlen"
        className="h-8 w-24 text-right tabular-nums"
      />
      <Button
        variant="secondary"
        size="icon"
        className="size-8"
        aria-label="Einzahlen"
        onClick={submit}
        disabled={pending}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function SettleReserveButton({ id, name }: { id: number; name: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm(`"${name}" als bezahlt markieren? Die Fälligkeit rückt eine Periode weiter.`))
          return;
        startTransition(async () => {
          const result = await settleReserveAction(id);
          if (result.error) toast.error(result.error);
          else toast.success("Als bezahlt markiert.");
        });
      }}
    >
      <Check className="h-3.5 w-3.5" /> Bezahlt
    </Button>
  );
}

export function DeletePotButton({
  id,
  name,
  kind,
}: {
  id: number;
  name: string;
  kind: "reserve" | "goal";
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-destructive"
      aria-label="Löschen"
      disabled={pending}
      onClick={() => {
        if (!confirm(`"${name}" wirklich löschen?`)) return;
        startTransition(async () => {
          const action = kind === "reserve" ? deleteReserveAction : deleteGoalAction;
          const result = await action(id);
          if (result.error) toast.error(result.error);
          else toast.success("Gelöscht.");
        });
      }}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}
