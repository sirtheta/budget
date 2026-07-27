"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { NetWorthForecastPoint } from "@/lib/analytics";
import { formatMoneyCompact, toFrancs } from "@/lib/money";
import { MoneyTooltip } from "./chart-tooltip";

/**
 * Net worth history plus a linear forward projection, drawn as a dashed
 * continuation past "heute" so it reads clearly as an estimate rather than a
 * booked fact. History and projection are split into two data keys that share
 * the boundary point, which is what lets the line change from solid to
 * dashed at exactly the right spot.
 */
export function NetWorthForecastChart({
  data,
  height = 280,
}: {
  data: NetWorthForecastPoint[];
  height?: number;
}) {
  const boundaryIndex = data.findIndex((point) => point.projected);
  const boundaryLabel = boundaryIndex > 0 ? data[boundaryIndex - 1].label : undefined;

  const chartData = data.map((point, index) => {
    const nextProjected = data[index + 1]?.projected ?? false;
    const isBoundary = !point.projected && nextProjected;
    return {
      label: point.label,
      Vermögen: point.projected ? undefined : toFrancs(point.netWorthCents),
      Prognose: point.projected || isBoundary ? toFrancs(point.netWorthCents) : undefined,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="netWorthForecastFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          className="text-xs fill-muted-foreground"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          className="text-xs fill-muted-foreground"
          tickFormatter={(value: number) => formatMoneyCompact(value * 100)}
        />
        <Tooltip content={<MoneyTooltip />} />
        {boundaryLabel && (
          <ReferenceLine
            x={boundaryLabel}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            label={{
              value: "heute",
              position: "insideTopRight",
              className: "fill-muted-foreground text-xs",
            }}
          />
        )}
        <Area
          type="monotone"
          dataKey="Vermögen"
          stroke="#6366f1"
          strokeWidth={2}
          fill="url(#netWorthForecastFill)"
        />
        <Area
          type="monotone"
          dataKey="Prognose"
          stroke="#6366f1"
          strokeWidth={2}
          strokeDasharray="6 4"
          fill="url(#netWorthForecastFill)"
          fillOpacity={0.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
