"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { setBudgetAction, type ActionState } from "./actions";
import { Input } from "@/components/ui/input";

/**
 * Backstop for commit(): the field must never stay disabled forever with no
 * feedback, whatever goes wrong between blur and the saved value coming back.
 * Raced *inside* the transition (not by bypassing it) so the normal case still
 * lets Next apply the revalidated data as part of this same transition, instead
 * of only on the next unrelated action.
 */
const SAVE_TIMEOUT_MS = 10_000;

function timeout(ms: number): Promise<ActionState> {
  return new Promise((resolve) =>
    setTimeout(
      () => resolve({ error: "Speichern hat zu lange gedauert. Bitte Seite neu laden." }),
      ms
    )
  );
}

/**
 * Inline Soll input. Saves on blur rather than behind a submit button: a
 * budget month is twenty numbers, and a round-trip per field would make
 * entering them tedious.
 */
export function BudgetAmountInput({
  categoryId,
  year,
  month,
  plannedCents,
  disabled = false,
}: {
  categoryId: number;
  year: number;
  month: number;
  plannedCents: number;
  disabled?: boolean;
}) {
  const initial = plannedCents > 0 ? (plannedCents / 100).toFixed(2) : "";
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  // Deliberately not `pending` from useTransition: that stays true until React
  // commits the *whole* transition, which includes Next applying the action's
  // revalidated router data. Whenever that step is delayed, a `pending`-driven
  // `disabled` locks the input for exactly as long — which is how a router bug
  // in Next 16.2 turned into a permanently grey field. This flag tracks the
  // save itself and nothing else.
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const skipNextCommitRef = useRef(false);

  const commit = () => {
    if (skipNextCommitRef.current) {
      skipNextCommitRef.current = false;
      return;
    }
    if (value === saved) return;

    const amount = value;
    setSaving(true);
    startTransition(async () => {
      let error: string | undefined;
      try {
        const result = await Promise.race([
          setBudgetAction(categoryId, year, month, amount),
          timeout(SAVE_TIMEOUT_MS),
        ]);
        error = result.error;
      } catch {
        error = "Speichern fehlgeschlagen. Bitte Seite neu laden.";
      }
      // Escape the transition scope. State set directly here would be a
      // transition update and would queue behind the very router update that
      // may be stuck; a macrotask puts these back at normal priority so
      // unlocking the field and reporting the error cannot be held up.
      setTimeout(() => {
        setSaving(false);
        if (error) {
          toast.error(error);
          setValue(saved);
        } else {
          setSaved(amount);
        }
      }, 0);
    });
  };

  return (
    <Input
      inputMode="decimal"
      value={value}
      disabled={disabled || saving}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          // blur() below fires onBlur synchronously, before this render's
          // `commit` closure sees the setValue() update — without the guard,
          // "cancel" would blur-commit the old, unwanted edited value.
          skipNextCommitRef.current = true;
          setValue(saved);
          event.currentTarget.blur();
        }
      }}
      placeholder="—"
      aria-label="Budgetbetrag"
      className="h-8 w-24 text-right tabular-nums ml-auto"
    />
  );
}
