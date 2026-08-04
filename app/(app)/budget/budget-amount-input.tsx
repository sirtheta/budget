"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { setBudgetAction, type ActionState } from "./actions";
import { Input } from "@/components/ui/input";

/**
 * Safety net for commit(): if the server action's promise never settles —
 * e.g. the session's periodic re-check (lib/auth.ts) invalidates mid-edit and
 * the resulting redirect() confuses the client action runtime, which expects
 * an RSC flight response and instead follows a redirect to /login — the
 * field must not stay disabled forever with no feedback. Raced *inside* the
 * transition (not by bypassing it) so the normal case still lets Next apply
 * the revalidated data as part of this same transition, instead of only on
 * the next unrelated action.
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
  const [pending, startTransition] = useTransition();
  const skipNextCommitRef = useRef(false);

  const commit = () => {
    if (skipNextCommitRef.current) {
      skipNextCommitRef.current = false;
      return;
    }
    if (value === saved) return;

    const amount = value;
    startTransition(async () => {
      try {
        const result = await Promise.race([
          setBudgetAction(categoryId, year, month, amount),
          timeout(SAVE_TIMEOUT_MS),
        ]);
        if (result.error) {
          toast.error(result.error);
          setValue(saved);
        } else {
          setSaved(amount);
        }
      } catch {
        toast.error("Speichern fehlgeschlagen. Bitte Seite neu laden.");
        setValue(saved);
      }
    });
  };

  return (
    <Input
      inputMode="decimal"
      value={value}
      disabled={disabled || pending}
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
