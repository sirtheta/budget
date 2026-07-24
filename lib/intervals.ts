/**
 * Recurrence interval labels.
 *
 * Deliberately its own module rather than part of lib/recurring.ts: the form
 * dialogs are Client Components, and importing them from the scheduler would
 * drag node-cron and the Prisma client into the browser bundle.
 */
export const INTERVAL_LABELS: Record<number, string> = {
  1: "Monatlich",
  2: "Alle 2 Monate",
  3: "Quartalsweise",
  6: "Halbjährlich",
  12: "Jährlich",
};

export function intervalLabel(months: number): string {
  return INTERVAL_LABELS[months] ?? `Alle ${months} Monate`;
}
