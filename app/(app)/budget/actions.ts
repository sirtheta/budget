"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { parseMoney } from "@/lib/money";
import { copyBudgets } from "@/lib/budget";
import { MAX_YEAR, MIN_YEAR } from "@/lib/date";

export type ActionState = { error?: string; success?: boolean };

/**
 * These actions take positional arguments rather than a FormData, so nothing
 * about the call is checked at runtime by default — a Server Action is a POST
 * endpoint and the parameter types are erased at compile time. The schema
 * below is what actually holds, for any caller.
 *
 * `year` matters more than it looks: it flows into `year * 12 + month`
 * arithmetic and into `YYYY-MM-DD` strings, so a non-integer or out-of-range
 * value produces budget rows that no month view can ever address again.
 */
const INVALID = {
  year: "Ungültiges Jahr.",
  month: "Ungültiger Monat.",
  category: "Ungültige Kategorie.",
  amount: "Ungültiger Betrag.",
} as const;

// The message is repeated on the type check as well as the refinements because
// zod rejects NaN at the type level — without it, a forged NaN would surface
// zod's own English default to a German UI.
const monthSchema = z.object({
  year: z
    .number({ error: INVALID.year })
    .int(INVALID.year)
    .min(MIN_YEAR, INVALID.year)
    .max(MAX_YEAR, INVALID.year),
  month: z
    .number({ error: INVALID.month })
    .int(INVALID.month)
    .min(1, INVALID.month)
    .max(12, INVALID.month),
});

const setBudgetSchema = monthSchema.extend({
  categoryId: z.number({ error: INVALID.category }).int(INVALID.category).positive(INVALID.category),
  amount: z.string({ error: INVALID.amount }),
});

/**
 * Sets (or clears) the planned amount for one category in one month.
 * An empty or zero input removes the budget row rather than storing a 0, so
 * "no budget" and "budgeted at zero" stay distinguishable in the evaluation.
 */
export async function setBudgetAction(
  categoryId: number,
  year: number,
  month: number,
  amount: string
): Promise<ActionState> {
  const session = await requireEditor();

  const parsed = setBudgetSchema.safeParse({ categoryId, year, month, amount });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };

  const trimmed = amount.trim();
  const amountCents = trimmed === "" ? 0 : parseMoney(trimmed);
  if (amountCents === null) return { error: "Betrag ist keine gültige Zahl." };
  if (amountCents < 0) return { error: "Budgetbeträge sind immer positiv." };

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) return { error: "Kategorie nicht gefunden." };

  if (amountCents === 0) {
    await prisma.budget.deleteMany({ where: { categoryId, year, month } });
  } else {
    await prisma.budget.upsert({
      where: { categoryId_year_month: { categoryId, year, month } },
      create: { categoryId, year, month, amountCents },
      update: { amountCents },
    });
  }

  await logAudit(session, "UPDATE", "Budget", categoryId, {
    categoryName: category.name,
    year,
    month,
    amountCents,
  });

  revalidatePath("/budget");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Carries the previous month's budgets forward. This is what makes the app
 * usable month to month — budgets rarely change, and re-typing twenty numbers
 * every month is the fastest way to stop using a budget app.
 */
export async function copyPreviousMonthAction(
  year: number,
  month: number,
  overwrite = false
): Promise<ActionState & { copied?: number }> {
  const session = await requireEditor();

  const parsedMonth = monthSchema.safeParse({ year, month });
  if (!parsedMonth.success) {
    return { error: parsedMonth.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }

  const total = year * 12 + (month - 1) - 1;
  const source = { year: Math.floor(total / 12), month: (total % 12) + 1 };

  const copied = await copyBudgets(prisma, source, { year, month }, { overwrite });
  await logAudit(session, "UPDATE", "Budget", undefined, {
    action: "copyPreviousMonth",
    from: `${source.month}/${source.year}`,
    to: `${month}/${year}`,
    copied,
  });

  revalidatePath("/budget");
  revalidatePath("/dashboard");
  return { success: true, copied };
}
