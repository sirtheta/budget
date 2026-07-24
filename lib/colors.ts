/**
 * Chart palette. Categorical hues are spaced far enough apart in hue and
 * lightness to stay distinguishable in both light and dark mode and under the
 * common forms of colour-vision deficiency.
 *
 * Categories and accounts may override these with their own `color` column;
 * `colorFor` falls back to a stable palette slot derived from the row id, so
 * the same category keeps its colour across pages and reloads.
 */
export const CHART_PALETTE = [
  "#6366f1", // Indigo — matches the app's primary
  "#0ea5e9", // Sky
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ef4444", // Red
  "#8b5cf6", // Violet
  "#14b8a6", // Teal
  "#ec4899", // Pink
  "#84cc16", // Lime
  "#f97316", // Orange
  "#06b6d4", // Cyan
  "#a855f7", // Purple
] as const;

/** Positive/negative semantics, used for income vs. expense series. */
export const INCOME_COLOR = "#10b981";
export const EXPENSE_COLOR = "#ef4444";
export const NEUTRAL_COLOR = "#94a3b8";

/** Stable palette colour for an entity, honouring an explicit override. */
export function colorFor(id: number, override?: string | null): string {
  if (override) return override;
  return CHART_PALETTE[Math.abs(id) % CHART_PALETTE.length];
}
