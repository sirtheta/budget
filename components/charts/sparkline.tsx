"use client";

import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { CHART_PALETTE } from "@/lib/colors";
import { toFrancs } from "@/lib/money";

const LINE_COLOR = CHART_PALETTE[0]; // Indigo — matches the app's primary

/**
 * A trend line without axes, grid, legend or tooltip, sized to sit inside a
 * summary tile: it answers "up or down" at a glance and leaves the exact
 * figures to the chart on the analytics page.
 *
 * The Y axis is hidden but present and unbounded, so the curve fills the
 * available height instead of hugging a zero baseline it shares with a
 * six-figure net worth.
 */
export function Sparkline({
  values,
  label,
  height = 40,
}: {
  /** Amounts in Rappen, oldest first. */
  values: number[];
  /** Described for screen readers, which get nothing out of the curve itself. */
  label: string;
  height?: number;
}) {
  if (values.length < 2) return null;

  const data = values.map((cents, index) => ({ index, value: toFrancs(cents) }));

  return (
    <div role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sparklineFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE_COLOR} stopOpacity={0.3} />
              <stop offset="100%" stopColor={LINE_COLOR} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={LINE_COLOR}
            strokeWidth={1.5}
            fill="url(#sparklineFill)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
