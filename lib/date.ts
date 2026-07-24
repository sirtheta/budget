/**
 * Local-time date helpers for `YYYY-MM-DD` form values.
 *
 * These intentionally avoid `new Date("YYYY-MM-DD")` (parsed as UTC midnight)
 * and `Date.toISOString()` (UTC), which shift the calendar day for users in
 * non-UTC timezones. All parsing and formatting happens in local time.
 */

/** Parse a `YYYY-MM-DD` string into a local-time Date (midnight). */
export function parseDate(str: string | undefined): Date | undefined {
  if (!str) return undefined;
  const [y, m, d] = str.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/** Format a Date into a `YYYY-MM-DD` string using its local calendar day. */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** True for a syntactically valid `YYYY-MM-DD` that is also a real calendar day. */
export function isValidDateString(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = parseDate(str);
  return !!d && toDateString(d) === str;
}

/** Format a `YYYY-MM-DD` string as Swiss-standard `DD.MM.YYYY`. */
export function formatDateCH(str: string): string {
  const [y, m, d] = str.split("-");
  return `${d}.${m}.${y}`;
}

/** Add `days` to a `YYYY-MM-DD` string, returning a `YYYY-MM-DD` string. */
export function addDays(str: string, days: number): string {
  const d = parseDate(str);
  if (!d) return str;
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

/**
 * Add `months` to a `YYYY-MM-DD` string, clamping the day to the target
 * month's length. Without the clamp, JavaScript rolls 31.01. + 1 month over
 * into 03.03. — which would silently shift every standing entry booked on a
 * 29th–31st (see lib/recurring.ts).
 */
export function addMonths(str: string, months: number): string {
  const d = parseDate(str);
  if (!d) return str;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth() + 1)));
  return toDateString(d);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** `YYYY-MM` prefix of a `YYYY-MM-DD` string. */
export function monthKey(str: string): string {
  return str.slice(0, 7);
}

/** First calendar day of a month as `YYYY-MM-DD`. */
export function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Last calendar day of a month as `YYYY-MM-DD`. */
export function monthEnd(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
}

/** Inclusive `YYYY-MM-DD` bounds of a month, ready for a Prisma `gte`/`lte` filter. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  return { from: monthStart(year, month), to: monthEnd(year, month) };
}

/** Inclusive `YYYY-MM-DD` bounds of a whole year. */
export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

export const MONTH_NAMES_SHORT = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
] as const;

/** German month name for a 1-based month number. */
export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/**
 * The 12 months of a year, oldest first, ending with `month`. Used for the
 * rolling-window charts on the dashboard.
 */
export function trailingMonths(
  year: number,
  month: number,
  count = 12
): { year: number; month: number }[] {
  const result: { year: number; month: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const total = year * 12 + (month - 1) - i;
    result.push({ year: Math.floor(total / 12), month: (total % 12) + 1 });
  }
  return result;
}

/** Whole months between two `YYYY-MM-DD` dates (negative when `to` is earlier). */
export function monthsBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Weekday (0=So … 6=Sa), hour (0–23), minute (0–59), and calendar day
 * (`YYYY-MM-DD`) of a moment as seen in an IANA timezone — independent of
 * the server's own TZ.
 */
export function zonedParts(
  date: Date,
  timeZone: string
): { weekday: number; hour: number; minute: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** Today's calendar day (`YYYY-MM-DD`) in the app timezone. */
export function todayInZone(timeZone: string, now = new Date()): string {
  return zonedParts(now, timeZone).date;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
