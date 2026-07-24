import { cn } from "@/lib/utils";

/**
 * Budget progress bar. Values above 100 % are clamped for the bar width but
 * keep their status colour, so an overrun still reads as "full and red"
 * rather than silently overflowing the container.
 */
export function Progress({
  value,
  className,
  indicatorClassName,
}: {
  /** 0–1; values above 1 are clamped. */
  value: number;
  className?: string;
  indicatorClassName?: string;
}) {
  const percent = Math.min(100, Math.max(0, value * 100));
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full bg-primary transition-all", indicatorClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
