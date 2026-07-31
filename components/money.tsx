import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

/**
 * Renders an amount in Rappen. Expenses are shown in the destructive colour
 * and income in emerald, so the direction of a row is readable without parsing
 * the sign — the single most repeated piece of information in the whole app.
 *
 * The colour is a second channel, never the only one: expenses always carry a
 * typographic minus, so the direction survives both colour blindness and a
 * monochrome print. The light-mode green is emerald-700 rather than the more
 * obvious emerald-600, which falls below the 4.5:1 contrast floor on this
 * background — caught by the axe checks in tests/e2e/a11y.spec.ts.
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
        colored && cents > 0 && "text-emerald-700 dark:text-emerald-400",
        colored && cents === 0 && "text-muted-foreground",
        className
      )}
    >
      {formatMoney(cents, { withCurrency, forceSign })}
    </span>
  );
}
