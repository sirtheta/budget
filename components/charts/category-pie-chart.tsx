"use client";

import { useRouter } from "next/navigation";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CategorySlice } from "@/lib/analytics";
import { formatMoney, toFrancs } from "@/lib/money";
import { MoneyTooltip } from "./chart-tooltip";

/**
 * Category split as a donut with a legend that carries the actual numbers.
 *
 * Slices link through to the filtered transaction list — the question a
 * breakdown provokes is always "what exactly is in there", and making the user
 * rebuild that filter by hand is the difference between a chart that is used
 * and one that is looked at once.
 */
export function CategoryPieChart({
  slices,
  from,
  to,
  height = 260,
  limit = 8,
}: {
  slices: CategorySlice[];
  /** Date range carried into the drill-down link. */
  from: string;
  to: string;
  height?: number;
  limit?: number;
}) {
  const router = useRouter();

  // Everything past the top N becomes one "Übrige" slice: a donut with twenty
  // segments carries no information. The aggregate is marked so it is not
  // mistaken for the real "Ohne Kategorie" slice, which also has a null id.
  const top = slices.slice(0, limit);
  const rest = slices.slice(limit);
  const restTotal = rest.reduce((sum, slice) => sum + slice.amountCents, 0);
  const shown: (CategorySlice & { isAggregate?: boolean })[] =
    restTotal > 0
      ? [
          ...top,
          {
            categoryId: null,
            name: `Übrige (${rest.length})`,
            parentName: null,
            color: "#94a3b8",
            amountCents: restTotal,
            share: rest.reduce((sum, slice) => sum + slice.share, 0),
            transactionCount: rest.reduce((sum, slice) => sum + slice.transactionCount, 0),
            isAggregate: true,
          },
        ]
      : top;

  if (shown.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Keine Buchungen in diesem Zeitraum.
      </p>
    );
  }

  const chartData = shown.map((slice) => ({
    name: slice.name,
    value: toFrancs(slice.amountCents),
    color: slice.color,
  }));

  const drilldown = (categoryId: number | null) => {
    const params = new URLSearchParams({ from, to });
    if (categoryId !== null) params.set("categoryId", String(categoryId));
    else params.set("categoryId", "none");
    router.push(`/transactions?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="w-full sm:w-1/2">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={2}
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.color} stroke="none" />
              ))}
            </Pie>
            <Tooltip content={<MoneyTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="w-full sm:w-1/2 flex flex-col gap-1">
        {shown.map((slice, index) => (
          <li key={index}>
            <button
              type="button"
              onClick={() => drilldown(slice.categoryId)}
              disabled={slice.isAggregate}
              className="w-full flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent disabled:hover:bg-transparent disabled:cursor-default text-left"
            >
              <span
                className="size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: slice.color }}
                aria-hidden
              />
              <span className="truncate">{slice.name}</span>
              <span className="ml-auto shrink-0 tabular-nums font-medium">
                {formatMoney(slice.amountCents)}
              </span>
              <span className="shrink-0 w-12 text-right tabular-nums text-xs text-muted-foreground">
                {Math.round(slice.share * 100)} %
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
