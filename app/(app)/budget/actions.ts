"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { requireEditor } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { parseMoney } from "@/lib/money";
import { copyBudgets } from "@/lib/budget";

export type ActionState = { error?: string; success?: boolean };

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

  if (month < 1 || month > 12) return { error: "Ungültiger Monat." };

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
