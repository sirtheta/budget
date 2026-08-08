import cron from "node-cron";
import type { PrismaClient, RecurringTransaction } from "@prisma/client";
import logger from "@/lib/logger";
import { config } from "@/lib/config";
import { addDays, addMonths, todayInZone } from "@/lib/date";
import { createTransfer } from "@/lib/transactions";

const log = logger.child({ module: "recurring" });

const globalForScheduler = globalThis as unknown as {
  recurringSchedulerStarted?: boolean;
};

/**
 * Safety cap on catch-up postings per entry and run. A container that was off
 * for a year should not silently create hundreds of rows; the cap makes such a
 * case visible in the log instead.
 */
const MAX_CATCHUP_POSTINGS = 24;

export interface PostResult {
  postedCount: number;
  /** Entries that hit MAX_CATCHUP_POSTINGS and still have a past `nextDate`. */
  cappedIds: number[];
}

/** Entries whose next posting is due on or before `today`. */
export function dueRecurring(
  rows: RecurringTransaction[],
  today: string
): RecurringTransaction[] {
  return rows.filter(
    (row) =>
      row.isActive &&
      row.autoPost &&
      row.nextDate <= today &&
      (row.endDate === null || row.nextDate <= row.endDate)
  );
}

/**
 * Entries that are due but marked `autoPost: false` — surfaced on the
 * dashboard as a suggestion instead of being booked automatically.
 */
export function pendingSuggestions(
  rows: RecurringTransaction[],
  today: string
): RecurringTransaction[] {
  return rows.filter(
    (row) =>
      row.isActive &&
      !row.autoPost &&
      row.nextDate <= today &&
      (row.endDate === null || row.nextDate <= row.endDate)
  );
}

/**
 * Entries whose next occurrence falls into the coming `days` days.
 *
 * Deliberately excludes anything already due: that has either been posted or
 * is waiting as a suggestion. What this answers is the other question a
 * household has mid-month — how much of the balance is already spoken for
 * before the next salary lands.
 */
export function upcomingRecurring(
  rows: RecurringTransaction[],
  today: string,
  days = 30
): RecurringTransaction[] {
  const horizon = addDays(today, days);
  return rows
    .filter(
      (row) =>
        row.isActive &&
        row.nextDate > today &&
        row.nextDate <= horizon &&
        (row.endDate === null || row.nextDate <= row.endDate)
    )
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name));
}

/**
 * Advances `nextDate` by one interval, returning null once the entry has run
 * past its end date (the caller then deactivates it).
 */
export function advance(row: RecurringTransaction): string | null {
  const next = addMonths(row.nextDate, row.intervalMonths);
  if (row.endDate !== null && next > row.endDate) return null;
  return next;
}

/**
 * Posts one due occurrence of a recurring entry and advances its schedule.
 *
 * Entries with a `counterAccountId` create a transfer (both legs); the rest
 * create a single categorised transaction.
 */
export async function postOnce(
  prisma: PrismaClient,
  row: RecurringTransaction
): Promise<void> {
  if (row.counterAccountId !== null) {
    await createTransfer(prisma, {
      fromAccountId: row.accountId,
      toAccountId: row.counterAccountId,
      date: row.nextDate,
      amountCents: row.amountCents,
      description: row.name,
      notes: row.notes,
      source: "Recurring",
    });
  } else {
    await prisma.transaction.create({
      data: {
        date: row.nextDate,
        amountCents: row.amountCents,
        accountId: row.accountId,
        categoryId: row.categoryId,
        description: row.name,
        notes: row.notes,
        source: "Recurring",
        recurringId: row.id,
      },
    });
  }
}

/**
 * Posts every due recurring entry, catching up any occurrences missed while
 * the app was down, and advances each entry's `nextDate`.
 *
 * Safe to run repeatedly: an entry is only posted for dates that are actually
 * due, and `nextDate` moves forward in the same pass.
 */
export async function postDueRecurring(
  prisma: PrismaClient,
  today = todayInZone(config.recurring.timezone)
): Promise<PostResult> {
  const rows = await prisma.recurringTransaction.findMany({ where: { isActive: true } });
  const due = dueRecurring(rows, today);

  let postedCount = 0;
  const cappedIds: number[] = [];

  for (const row of due) {
    let nextDate = row.nextDate;
    let postings = 0;

    while (nextDate <= today && (row.endDate === null || nextDate <= row.endDate)) {
      if (postings >= MAX_CATCHUP_POSTINGS) {
        cappedIds.push(row.id);
        log.warn(
          { recurringId: row.id, name: row.name, nextDate },
          "Catch-up limit reached — remaining occurrences will be posted on the next run"
        );
        break;
      }
      await postOnce(prisma, { ...row, nextDate });
      postings++;
      postedCount++;
      nextDate = addMonths(nextDate, row.intervalMonths);
    }

    // Past its end date, the entry has nothing left to post — retire it so it
    // stops being scanned on every run.
    const exhausted = row.endDate !== null && nextDate > row.endDate;
    if (nextDate !== row.nextDate || exhausted) {
      await prisma.recurringTransaction.update({
        where: { id: row.id },
        data: { nextDate, ...(exhausted ? { isActive: false } : {}) },
      });
    }
  }

  if (postedCount > 0) {
    log.info({ postedCount, today }, "Posted due recurring transactions");
  }
  return { postedCount, cappedIds };
}

/** Starts the hourly cron job that posts due recurring entries. */
export function startRecurringScheduler(): void {
  if (globalForScheduler.recurringSchedulerStarted) return;
  if (process.env.DISABLE_RECURRING === "true") {
    log.info("Wiederkehrende Buchungen deaktiviert (DISABLE_RECURRING=true)");
    return;
  }
  const schedule = config.recurring.cronSchedule;
  if (!cron.validate(schedule)) {
    log.error({ schedule }, "Invalid RECURRING_CRON_SCHEDULE — scheduler not started");
    return;
  }
  cron.schedule(schedule, async () => {
    const { default: prisma } = await import("@/lib/prisma");
    try {
      await postDueRecurring(prisma);
    } catch (err) {
      log.error({ err }, "Posting recurring transactions failed");
    }
  });
  globalForScheduler.recurringSchedulerStarted = true;
  log.info({ schedule, timezone: config.recurring.timezone }, "Recurring scheduler started");
}

// Re-exported for server-side callers; the definitions live in a module
// without server dependencies so Client Components can import them too.
export { INTERVAL_LABELS, intervalLabel } from "@/lib/intervals";
