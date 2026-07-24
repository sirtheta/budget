import type { CategoryKind, PrismaClient } from "@prisma/client";
import { MONTH_NAMES_SHORT, monthKey, monthRange } from "@/lib/date";
import { colorFor } from "@/lib/colors";

/**
 * Read models for the dashboard and the analytics page.
 *
 * Every query here excludes transfers (`transferGroupId != null`) and accounts
 * flagged `excludeFromBudget`, so shifting money to savings or into a
 * portfolio never shows up as income or expense.
 *
 * Aggregation over a date range happens in JavaScript rather than as twelve
 * separate `groupBy` queries: a household's transaction volume is small, and
 * one pass keeps the month buckets, the category split, and the running
 * balance consistent with each other by construction.
 */

/** Filter shared by every evaluation, so the rules can't drift apart. */
const budgetRelevantWhere = {
  transferGroupId: null,
  account: { excludeFromBudget: false },
} as const;

export interface MonthlySummary {
  year: number;
  month: number;
  /** `Jan 26` — short enough for a chart axis. */
  label: string;
  incomeCents: number;
  /** Positive magnitude. */
  expenseCents: number;
  /** income − expense. */
  balanceCents: number;
}

/**
 * Income, expenses and balance per month for a contiguous list of months
 * (see `trailingMonths` in lib/date.ts).
 */
export async function monthlySeries(
  prisma: PrismaClient,
  months: { year: number; month: number }[]
): Promise<MonthlySummary[]> {
  if (months.length === 0) return [];
  const from = monthRange(months[0].year, months[0].month).from;
  const to = monthRange(months[months.length - 1].year, months[months.length - 1].month).to;

  const rows = await prisma.transaction.findMany({
    where: { ...budgetRelevantWhere, date: { gte: from, lte: to } },
    select: { date: true, amountCents: true },
  });

  const buckets = new Map<string, { income: number; expense: number }>();
  for (const row of rows) {
    const key = monthKey(row.date);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { income: 0, expense: 0 };
      buckets.set(key, bucket);
    }
    if (row.amountCents >= 0) bucket.income += row.amountCents;
    else bucket.expense += -row.amountCents;
  }

  return months.map(({ year, month }) => {
    const bucket = buckets.get(`${year}-${String(month).padStart(2, "0")}`) ?? {
      income: 0,
      expense: 0,
    };
    return {
      year,
      month,
      label: `${MONTH_NAMES_SHORT[month - 1]} ${String(year).slice(2)}`,
      incomeCents: bucket.income,
      expenseCents: bucket.expense,
      balanceCents: bucket.income - bucket.expense,
    };
  });
}

export interface CategorySlice {
  categoryId: number | null;
  name: string;
  parentName: string | null;
  color: string;
  /** Positive magnitude in Rappen. */
  amountCents: number;
  /** Share of the total, 0–1. */
  share: number;
  transactionCount: number;
}

/**
 * Spend (or income) per category in a date range, largest first.
 * Uncategorised transactions are reported as a slice with `categoryId: null`
 * rather than dropped — a large "Ohne Kategorie" slice is exactly the signal
 * the user needs to go and categorise.
 */
export async function categoryBreakdown(
  prisma: PrismaClient,
  from: string,
  to: string,
  kind: CategoryKind = "Expense"
): Promise<CategorySlice[]> {
  const [rows, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        ...budgetRelevantWhere,
        date: { gte: from, lte: to },
        ...(kind === "Expense" ? { amountCents: { lt: 0 } } : { amountCents: { gt: 0 } }),
      },
      select: { amountCents: true, categoryId: true },
    }),
    prisma.category.findMany({ select: { id: true, name: true, color: true, parentId: true } }),
  ]);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<number | null, { amount: number; count: number }>();
  for (const row of rows) {
    const key = row.categoryId;
    const entry = totals.get(key) ?? { amount: 0, count: 0 };
    entry.amount += Math.abs(row.amountCents);
    entry.count += 1;
    totals.set(key, entry);
  }

  const grandTotal = [...totals.values()].reduce((sum, e) => sum + e.amount, 0);

  return [...totals.entries()]
    .map(([categoryId, entry]) => {
      const category = categoryId === null ? undefined : byId.get(categoryId);
      const parent = category?.parentId ? byId.get(category.parentId) : undefined;
      return {
        categoryId,
        name: category?.name ?? "Ohne Kategorie",
        parentName: parent?.name ?? null,
        color: categoryId === null ? "#94a3b8" : colorFor(categoryId, category?.color),
        amountCents: entry.amount,
        share: grandTotal > 0 ? entry.amount / grandTotal : 0,
        transactionCount: entry.count,
      };
    })
    .sort((a, b) => b.amountCents - a.amountCents);
}

export interface NetWorthPoint {
  year: number;
  month: number;
  label: string;
  netWorthCents: number;
}

/**
 * Net worth at the end of each month.
 *
 * Unlike the income/expense series this deliberately includes transfers and
 * excluded accounts: the point is total wealth, and money moved into a
 * portfolio has not left the household.
 */
export async function netWorthSeries(
  prisma: PrismaClient,
  months: { year: number; month: number }[]
): Promise<NetWorthPoint[]> {
  if (months.length === 0) return [];
  const from = monthRange(months[0].year, months[0].month).from;

  const [openingSum, priorSum, rows] = await Promise.all([
    prisma.account.aggregate({ _sum: { openingBalanceCents: true } }),
    prisma.transaction.aggregate({
      where: { date: { lt: from } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.findMany({
      where: { date: { gte: from } },
      select: { date: true, amountCents: true },
    }),
  ]);

  const deltas = new Map<string, number>();
  for (const row of rows) {
    const key = monthKey(row.date);
    deltas.set(key, (deltas.get(key) ?? 0) + row.amountCents);
  }

  let running = (openingSum._sum.openingBalanceCents ?? 0) + (priorSum._sum.amountCents ?? 0);
  return months.map(({ year, month }) => {
    running += deltas.get(`${year}-${String(month).padStart(2, "0")}`) ?? 0;
    return {
      year,
      month,
      label: `${MONTH_NAMES_SHORT[month - 1]} ${String(year).slice(2)}`,
      netWorthCents: running,
    };
  });
}

export interface CounterpartySlice {
  name: string;
  amountCents: number;
  transactionCount: number;
}

/**
 * Biggest recipients of money in a range — answers "where does it actually
 * go" more directly than a category chart when categories are coarse.
 */
export async function topCounterparties(
  prisma: PrismaClient,
  from: string,
  to: string,
  limit = 10
): Promise<CounterpartySlice[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      ...budgetRelevantWhere,
      date: { gte: from, lte: to },
      amountCents: { lt: 0 },
    },
    select: { counterparty: true, description: true, amountCents: true },
  });

  const totals = new Map<string, { amount: number; count: number }>();
  for (const row of rows) {
    const name = (row.counterparty || row.description || "Unbekannt").trim();
    const entry = totals.get(name) ?? { amount: 0, count: 0 };
    entry.amount += -row.amountCents;
    entry.count += 1;
    totals.set(name, entry);
  }

  return [...totals.entries()]
    .map(([name, entry]) => ({
      name,
      amountCents: entry.amount,
      transactionCount: entry.count,
    }))
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, limit);
}

/** Headline figures for one month, used by the dashboard tiles. */
export async function monthSummary(
  prisma: PrismaClient,
  year: number,
  month: number
): Promise<MonthlySummary> {
  const [summary] = await monthlySeries(prisma, [{ year, month }]);
  return summary;
}
