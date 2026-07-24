import type { Reserve, SavingsGoal } from "@prisma/client";
import { addMonths, monthsBetween } from "@/lib/date";

/**
 * Rückstellungen: costs that fall due yearly or half-yearly (Krankenkasse,
 * Steuern, Versicherungsprämien) but have to be set aside monthly.
 *
 * Without this, a household budget looks healthy for eleven months and then
 * collapses in the month the bill arrives — which is precisely why a private
 * budget needs the concept at all.
 */

export interface ReserveStatus {
  id: number;
  name: string;
  targetAmountCents: number;
  savedCents: number;
  /** target − saved, floored at 0. */
  missingCents: number;
  nextDueDate: string;
  intervalMonths: number;
  /** Whole months from today until the due date; 0 when due this month or overdue. */
  monthsRemaining: number;
  /** What has to be set aside each month to be complete by the due date. */
  monthlyRateCents: number;
  /** saved / target, capped at 1. */
  progress: number;
  /** True when the due date has passed and the reserve is still short. */
  isShort: boolean;
  isDue: boolean;
}

/**
 * Whole months from `today` until `dueDate`, floored at 0. A due date in the
 * current month counts as 0 — the money is needed now, not next month.
 */
export function monthsUntilDue(today: string, dueDate: string): number {
  return Math.max(0, monthsBetween(today, dueDate));
}

/**
 * Monthly amount needed to reach the target by the due date.
 *
 * When the due date is this month or already past, the full outstanding
 * amount is required at once rather than being spread — spreading a bill that
 * is already due would understate the real obligation.
 */
export function monthlyRateCents(
  reserve: Pick<Reserve, "targetAmountCents" | "savedCents" | "nextDueDate" | "intervalMonths">,
  today: string
): number {
  const missing = Math.max(0, reserve.targetAmountCents - reserve.savedCents);
  if (missing === 0) return 0;
  const months = monthsUntilDue(today, reserve.nextDueDate);
  if (months <= 0) return missing;
  return Math.ceil(missing / months);
}

export function reserveStatus(reserve: Reserve, today: string): ReserveStatus {
  const missing = Math.max(0, reserve.targetAmountCents - reserve.savedCents);
  const monthsRemaining = monthsUntilDue(today, reserve.nextDueDate);
  return {
    id: reserve.id,
    name: reserve.name,
    targetAmountCents: reserve.targetAmountCents,
    savedCents: reserve.savedCents,
    missingCents: missing,
    nextDueDate: reserve.nextDueDate,
    intervalMonths: reserve.intervalMonths,
    monthsRemaining,
    monthlyRateCents: monthlyRateCents(reserve, today),
    progress:
      reserve.targetAmountCents > 0
        ? Math.min(1, reserve.savedCents / reserve.targetAmountCents)
        : 0,
    isShort: reserve.nextDueDate <= today && missing > 0,
    isDue: reserve.nextDueDate <= today,
  };
}

/** Total that has to be set aside this month across all active reserves. */
export function totalMonthlyReserveCents(reserves: Reserve[], today: string): number {
  return reserves
    .filter((r) => r.isActive)
    .reduce((total, r) => total + monthlyRateCents(r, today), 0);
}

/**
 * Books a reserve as paid: the set-aside amount is consumed and the due date
 * moves on by one interval. Returns the fields to persist.
 *
 * Any surplus (more was set aside than the bill came to) is carried into the
 * next period instead of being dropped.
 */
export function settleReserve(
  reserve: Pick<Reserve, "targetAmountCents" | "savedCents" | "nextDueDate" | "intervalMonths">,
  paidCents?: number
): { savedCents: number; nextDueDate: string } {
  const paid = paidCents ?? reserve.targetAmountCents;
  return {
    savedCents: Math.max(0, reserve.savedCents - paid),
    nextDueDate: addMonths(reserve.nextDueDate, reserve.intervalMonths),
  };
}

// ── Savings goals ─────────────────────────────────────────────────────────────

export interface GoalStatus {
  id: number;
  name: string;
  targetAmountCents: number;
  savedCents: number;
  missingCents: number;
  targetDate: string | null;
  monthsRemaining: number | null;
  /** Suggested monthly rate; null when the goal has no target date. */
  monthlyRateCents: number | null;
  progress: number;
  isReached: boolean;
  color: string | null;
}

export function goalStatus(goal: SavingsGoal, today: string): GoalStatus {
  const missing = Math.max(0, goal.targetAmountCents - goal.savedCents);
  const monthsRemaining = goal.targetDate ? monthsUntilDue(today, goal.targetDate) : null;
  return {
    id: goal.id,
    name: goal.name,
    targetAmountCents: goal.targetAmountCents,
    savedCents: goal.savedCents,
    missingCents: missing,
    targetDate: goal.targetDate,
    monthsRemaining,
    monthlyRateCents:
      monthsRemaining === null || missing === 0
        ? null
        : monthsRemaining <= 0
          ? missing
          : Math.ceil(missing / monthsRemaining),
    progress:
      goal.targetAmountCents > 0 ? Math.min(1, goal.savedCents / goal.targetAmountCents) : 0,
    isReached: goal.savedCents >= goal.targetAmountCents,
    color: goal.color,
  };
}
