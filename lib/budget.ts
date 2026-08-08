import type { CategoryKind, PrismaClient } from "@prisma/client";
import { daysInMonth, monthRange } from "@/lib/date";
import { colorFor } from "@/lib/colors";

/**
 * Soll/Ist evaluation for one month.
 *
 * Amounts here are magnitudes (always ≥ 0), not the signed values stored on
 * Transaction: a budget of "800 for groceries" is easier to reason about than
 * "−800", and the direction is already carried by the category's `kind`.
 */
export interface BudgetLine {
  categoryId: number;
  name: string;
  kind: CategoryKind;
  parentId: number | null;
  parentName: string | null;
  color: string;
  /** Planned amount (Soll) in Rappen; 0 when no budget is set. */
  plannedCents: number;
  /** Booked amount (Ist) in Rappen, as a magnitude. */
  actualCents: number;
  /** planned − actual. Negative means the budget is exceeded. */
  remainingCents: number;
  /** actual / planned; null when nothing was planned. */
  progress: number | null;
  status: BudgetStatus;
  transactionCount: number;
}

export type BudgetStatus = "unbudgeted" | "ok" | "warning" | "over";

/** Share of the budget from which the line is flagged amber. */
export const WARNING_THRESHOLD = 0.9;

export function budgetStatus(
  plannedCents: number,
  actualCents: number,
  kind: CategoryKind = "Expense"
): BudgetStatus {
  if (plannedCents <= 0) return "unbudgeted";
  // Income has no "exhausted" or "exceeded" — reaching or passing the plan is
  // the goal, not a ceiling, so "warning"/"over" (both Expense-only concepts)
  // never apply here.
  if (kind === "Income") return "ok";
  const ratio = actualCents / plannedCents;
  if (ratio > 1) return "over";
  if (ratio >= WARNING_THRESHOLD) return "warning";
  return "ok";
}

export const STATUS_LABELS: Record<BudgetStatus, string> = {
  unbudgeted: "Kein Budget",
  ok: "Im Rahmen",
  warning: "Fast ausgeschöpft",
  over: "Überschritten",
};

export interface BudgetGroup {
  parentId: number | null;
  parentName: string;
  kind: CategoryKind;
  lines: BudgetLine[];
  plannedCents: number;
  actualCents: number;
}

export interface BudgetMonth {
  year: number;
  month: number;
  groups: BudgetGroup[];
  totals: {
    plannedIncomeCents: number;
    actualIncomeCents: number;
    plannedExpenseCents: number;
    actualExpenseCents: number;
    /** Planned income − planned expenses. */
    plannedBalanceCents: number;
    /** Booked income − booked expenses. */
    actualBalanceCents: number;
    /** Booked expenses without a category — these distort every evaluation. */
    uncategorizedCents: number;
    uncategorizedCount: number;
  };
}

/**
 * Loads planned and booked amounts for every leaf category of one month,
 * grouped by top-level category.
 *
 * Transfers (categoryId = null, linked by transferGroupId) and accounts marked
 * `excludeFromBudget` are left out, so moving money to savings is never
 * counted as an expense.
 */
export async function loadBudgetMonth(
  prisma: PrismaClient,
  year: number,
  month: number
): Promise<BudgetMonth> {
  const { from, to } = monthRange(year, month);

  const [categories, budgets, sums, uncategorized] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.budget.findMany({ where: { year, month } }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        date: { gte: from, lte: to },
        categoryId: { not: null },
        account: { excludeFromBudget: false },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.transaction.aggregate({
      where: {
        date: { gte: from, lte: to },
        categoryId: null,
        transferGroupId: null,
        account: { excludeFromBudget: false },
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
  ]);

  const plannedByCategory = new Map(budgets.map((b) => [b.categoryId, b.amountCents]));
  const actualByCategory = new Map(
    sums.map((row) => [
      row.categoryId as number,
      { sum: row._sum.amountCents ?? 0, count: row._count._all },
    ])
  );
  const byId = new Map(categories.map((c) => [c.id, c]));

  const leaves = categories.filter((c) => c.parentId !== null);
  // Top-level categories that carry transactions directly (allowed for users
  // who don't want sub-categories) are treated as their own leaf.
  const parentIdsWithChildren = new Set(leaves.map((c) => c.parentId));
  const standalone = categories.filter(
    (c) => c.parentId === null && !parentIdsWithChildren.has(c.id)
  );

  const lines: BudgetLine[] = [...leaves, ...standalone].map((category) => {
    const planned = plannedByCategory.get(category.id) ?? 0;
    const actual = actualByCategory.get(category.id) ?? { sum: 0, count: 0 };
    // Expenses are stored negative; report the magnitude so Soll and Ist are
    // directly comparable.
    const actualCents = category.kind === "Expense" ? -actual.sum : actual.sum;
    const parent = category.parentId ? byId.get(category.parentId) : undefined;
    return {
      categoryId: category.id,
      name: category.name,
      kind: category.kind,
      parentId: category.parentId,
      parentName: parent?.name ?? null,
      color: colorFor(category.id, category.color ?? parent?.color),
      plannedCents: planned,
      actualCents,
      remainingCents: planned - actualCents,
      progress: planned > 0 ? actualCents / planned : null,
      status: budgetStatus(planned, actualCents, category.kind),
      transactionCount: actual.count,
    };
  });

  const groups = groupLines(lines, byId);

  const totals = {
    plannedIncomeCents: sumBy(lines, "Income", "plannedCents"),
    actualIncomeCents: sumBy(lines, "Income", "actualCents"),
    plannedExpenseCents: sumBy(lines, "Expense", "plannedCents"),
    actualExpenseCents: sumBy(lines, "Expense", "actualCents"),
    plannedBalanceCents: 0,
    actualBalanceCents: 0,
    uncategorizedCents: uncategorized._sum.amountCents ?? 0,
    uncategorizedCount: uncategorized._count._all,
  };
  totals.plannedBalanceCents = totals.plannedIncomeCents - totals.plannedExpenseCents;
  totals.actualBalanceCents = totals.actualIncomeCents - totals.actualExpenseCents;

  return { year, month, groups, totals };
}

function sumBy(
  lines: BudgetLine[],
  kind: CategoryKind,
  field: "plannedCents" | "actualCents"
): number {
  return lines.filter((l) => l.kind === kind).reduce((total, l) => total + l[field], 0);
}

function groupLines(
  lines: BudgetLine[],
  byId: Map<number, { id: number; name: string }>
): BudgetGroup[] {
  const groups = new Map<number | null, BudgetGroup>();
  for (const line of lines) {
    const key = line.parentId;
    let group = groups.get(key);
    if (!group) {
      group = {
        parentId: key,
        parentName: key === null ? line.name : (byId.get(key)?.name ?? "Ohne Gruppe"),
        kind: line.kind,
        lines: [],
        plannedCents: 0,
        actualCents: 0,
      };
      groups.set(key, group);
    }
    group.lines.push(line);
    group.plannedCents += line.plannedCents;
    group.actualCents += line.actualCents;
  }
  // Income first — the month reads top-down as "what came in, what went out".
  return [...groups.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "Income" ? -1 : 1;
    return a.parentName.localeCompare(b.parentName, "de-CH");
  });
}

export interface MonthProjection {
  /** Days of the month already booked, including today. */
  elapsedDays: number;
  daysInMonth: number;
  /** Average day-to-day expense per elapsed day, excluding fixed costs. */
  dailyVariableExpenseCents: number;
  /** Expenses extrapolated to the full month, as a positive magnitude. */
  projectedExpenseCents: number;
  /** Booked income plus the fixed income still to come. */
  projectedIncomeCents: number;
  /** projectedIncome − projectedExpense. */
  projectedBalanceCents: number;
}

/** Below this an extrapolation says more about one big booking than about the month. */
const MIN_DAYS_FOR_PROJECTION = 5;

export interface MonthProjectionInput {
  actualIncomeCents: number;
  /** Positive magnitude, as in BudgetMonth["totals"]. */
  actualExpenseCents: number;
  /**
   * Of the booked expenses, the fixed-cost part (magnitude): bookings a
   * recurring entry posted, plus bookings in the categories those entries use
   * — an imported rent debit is a fixed cost too, even though nothing linked
   * it to the schedule.
   */
  bookedFixedExpenseCents: number;
  /** Recurring expenses still to be posted before month end (magnitude). */
  dueRecurringExpenseCents: number;
  /** Recurring income still to be posted before month end. */
  dueRecurringIncomeCents: number;
}

/**
 * Extrapolates the running month to its end — the "at this rate you end the
 * month at X" figure.
 *
 * Fixed costs are handled separately from day-to-day spending, and that split
 * is the whole point: rent, health insurance and the like are booked in the
 * first days of the month, so a plain daily average taken on the 8th projects
 * a household paying its rent every single day. Only what is left after the
 * recurring entries is spread over the remaining days; the fixed costs still
 * ahead are added at their actual amounts, from the schedule that already
 * knows them.
 *
 * Income is never spread for the same reason — a salary lands once. Recurring
 * income still due this month is added at its scheduled amount.
 *
 * Returns null for a month that is too young to extrapolate from, and on its
 * last day, where the booked total is the answer.
 */
export function projectMonthEnd(
  input: MonthProjectionInput,
  today: string
): MonthProjection | null {
  const [year, month, day] = today.split("-").map(Number);
  const elapsedDays = day;
  const days = daysInMonth(year, month);
  if (elapsedDays < MIN_DAYS_FOR_PROJECTION || elapsedDays >= days) return null;

  const variableSoFar = Math.max(
    0,
    input.actualExpenseCents - input.bookedFixedExpenseCents
  );
  const dailyVariableExpenseCents = Math.round(variableSoFar / elapsedDays);
  const projectedExpenseCents =
    input.actualExpenseCents +
    dailyVariableExpenseCents * (days - elapsedDays) +
    input.dueRecurringExpenseCents;
  const projectedIncomeCents = input.actualIncomeCents + input.dueRecurringIncomeCents;

  return {
    elapsedDays,
    daysInMonth: days,
    dailyVariableExpenseCents,
    projectedExpenseCents,
    projectedIncomeCents,
    projectedBalanceCents: projectedIncomeCents - projectedExpenseCents,
  };
}

/**
 * Copies every budget of one month to another, skipping categories that
 * already have a budget in the target month. Returns the number copied.
 *
 * This is what makes the app usable month to month: budgets rarely change, so
 * carrying the previous month forward beats re-entering twenty numbers.
 */
export async function copyBudgets(
  prisma: PrismaClient,
  source: { year: number; month: number },
  target: { year: number; month: number },
  options: { overwrite?: boolean } = {}
): Promise<number> {
  const [sourceBudgets, targetBudgets] = await Promise.all([
    prisma.budget.findMany({ where: { year: source.year, month: source.month } }),
    prisma.budget.findMany({ where: { year: target.year, month: target.month } }),
  ]);
  const existing = new Map(targetBudgets.map((b) => [b.categoryId, b]));

  let copied = 0;
  for (const budget of sourceBudgets) {
    const current = existing.get(budget.categoryId);
    if (current && !options.overwrite) continue;
    if (current) {
      if (current.amountCents === budget.amountCents) continue;
      await prisma.budget.update({
        where: { id: current.id },
        data: { amountCents: budget.amountCents },
      });
    } else {
      await prisma.budget.create({
        data: {
          categoryId: budget.categoryId,
          year: target.year,
          month: target.month,
          amountCents: budget.amountCents,
        },
      });
    }
    copied++;
  }
  return copied;
}
