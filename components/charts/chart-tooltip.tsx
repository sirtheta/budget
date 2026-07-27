"use client";

import { formatMoney } from "@/lib/money";

export interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

/**
 * Shared tooltip for every chart.
 *
 * Recharts hands values back in francs (what the axes plot), so they are
 * converted to Rappen before formatting — keeping one money formatter for the
 * whole app instead of a second, subtly different one for charts.
 */
export function MoneyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}) {
  const entries = payload?.filter((entry) => entry.value !== undefined && entry.value !== null);
  if (!active || !entries?.length) return null;

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md text-sm">
      {label !== undefined && <p className="font-medium mb-1">{label}</p>}
      <ul className="flex flex-col gap-0.5">
        {entries.map((entry, index) => (
          <li key={index} className="flex items-center gap-2">
            <span
              className="size-2 rounded-full shrink-0"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-medium tabular-nums">
              {formatMoney(Math.round(Number(entry.value ?? 0) * 100), { withCurrency: true })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
