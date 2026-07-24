"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setBudgetAction } from "./actions";
import { Input } from "@/components/ui/input";

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

  const commit = () => {
    if (value === saved) return;
    startTransition(async () => {
      const result = await setBudgetAction(categoryId, year, month, value);
      if (result.error) {
        toast.error(result.error);
        setValue(saved);
      } else {
        setSaved(value);
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
