import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

/**
 * Renders an amount in Rappen. Expenses are shown in the destructive colour
 * and income in emerald, so the direction of a row is readable without parsing
 * the sign — the single most repeated piece of information in the whole app.
 */
export function Money({
  cents,
  colored = false,
  withCurrency = false,
  forceSign = false,
  className,
}: {
  cents: number;
  /** Colour by sign instead of inheriting the surrounding text colour. */
  colored?: boolean;
  withCurrency?: boolean;
  forceSign?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "tabular-nums",
        colored && cents < 0 && "text-destructive",
        colored && cents > 0 && "text-emerald-600 dark:text-emerald-400",
        colored && cents === 0 && "text-muted-foreground",
        className
      )}
    >
      {formatMoney(cents, { withCurrency, forceSign })}
    </span>
  );
}
