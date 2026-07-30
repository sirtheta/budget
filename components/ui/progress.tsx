import { cn } from "@/lib/utils";

/**
 * Budget progress bar. Values above 100 % are clamped for the bar width but
 * keep their status colour, so an overrun still reads as "full and red"
 * rather than silently overflowing the container.
 */
export function Progress({
  value,
  label,
  className,
  indicatorClassName,
}: {
  /** 0–1; values above 1 are clamped. */
  value: number;
  /**
   * What the bar measures, e.g. the category name. Without it a screen reader
   * announces a bare percentage with nothing to attach it to — and the budget
   * page renders one of these per category.
   */
  label?: string;
  className?: string;
  indicatorClassName?: string;
}) {
  const percent = Math.min(100, Math.max(0, value * 100));
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={label ? `${Math.round(percent)} % von ${label}` : undefined}
    >
      <div
        className={cn("h-full rounded-full bg-primary transition-all", indicatorClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
