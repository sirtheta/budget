"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CategorySlice } from "@/lib/analytics";
import { formatMoney, toFrancs } from "@/lib/money";
import { MoneyTooltip } from "./chart-tooltip";

type Slice = CategorySlice & { isAggregate?: boolean };

/**
 * Category split as a donut with a legend that carries the actual numbers.
 *
 * Slices link through to the filtered transaction list — the question a
 * breakdown provokes is always "what exactly is in there", and making the user
 * rebuild that filter by hand is the difference between a chart that is used
 * and one that is looked at once. Both the segment and its legend row drill
 * down; a segment that only reacts to hover reads as broken.
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
  const [expanded, setExpanded] = useState(false);

  // Everything past the top N becomes one "Übrige" slice: a donut with twenty
  // segments carries no information. The aggregate is marked so it is not
  // mistaken for the real "Ohne Kategorie" slice, which also has a null id.
  const top = slices.slice(0, limit);
  const rest = slices.slice(limit);
  const restTotal = rest.reduce((sum, slice) => sum + slice.amountCents, 0);
  const aggregate: Slice | null =
    restTotal > 0
      ? {
          categoryId: null,
          name: `Übrige (${rest.length})`,
          parentName: null,
          color: "#94a3b8",
          amountCents: restTotal,
          share: rest.reduce((sum, slice) => sum + slice.share, 0),
          transactionCount: rest.reduce((sum, slice) => sum + slice.transactionCount, 0),
          isAggregate: true,
        }
      : null;

  // The donut keeps the capped set even while the legend is expanded — that cap
  // is what makes it readable, and re-slicing it on expand would move every
  // segment under the cursor that just clicked one.
  const shown: Slice[] = aggregate ? [...top, aggregate] : top;

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

  // The aggregate has no category of its own to filter by, so clicking it opens
  // the categories it stands for instead of navigating.
  const activate = (slice: Slice) => {
    if (slice.isAggregate) setExpanded((value) => !value);
    else drilldown(slice.categoryId);
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
              onClick={(_, index) => {
                const slice = shown[index];
                if (slice) activate(slice);
              }}
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.color} stroke="none" className="cursor-pointer" />
              ))}
            </Pie>
            <Tooltip content={<MoneyTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="w-full sm:w-1/2 flex flex-col gap-1">
        {top.map((slice) => (
          <li key={slice.categoryId ?? "none"}>
            <LegendRow slice={slice} onClick={() => drilldown(slice.categoryId)} />
          </li>
        ))}

        {aggregate && (
          <li>
            <LegendRow
              slice={aggregate}
              expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            />
            {expanded && (
              <ul className="mt-1 ml-3 flex max-h-48 flex-col gap-1 overflow-y-auto border-l pl-2">
                {rest.map((slice) => (
                  <li key={slice.categoryId ?? "none"}>
                    <LegendRow slice={slice} onClick={() => drilldown(slice.categoryId)} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}

function LegendRow({
  slice,
  expanded,
  onClick,
}: {
  slice: Slice;
  /** Only set for the expandable aggregate row. */
  expanded?: boolean;
  onClick: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;

  // `cursor-pointer` is explicit because Tailwind 4 dropped
  // `button { cursor: pointer }` from its preflight — without it the row reads
  // as inert next to the donut segment it mirrors.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="w-full flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent text-left cursor-pointer"
    >
      {expanded === undefined ? (
        <span
          className="size-2.5 rounded-full shrink-0"
          style={{ backgroundColor: slice.color }}
          aria-hidden
        />
      ) : (
        <Chevron className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="truncate">{slice.name}</span>
      <span className="ml-auto shrink-0 tabular-nums font-medium">
        {formatMoney(slice.amountCents)}
      </span>
      <span className="shrink-0 w-12 text-right tabular-nums text-xs text-muted-foreground">
        {Math.round(slice.share * 100)} %
      </span>
    </button>
  );
}
