"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { NetWorthPoint } from "@/lib/analytics";
import { formatMoneyCompact, toFrancs } from "@/lib/money";
import { MoneyTooltip } from "./chart-tooltip";

/**
 * Net worth over time across every account, transfers included — the one
 * chart that answers "is it going in the right direction".
 */
export function NetWorthChart({
  data,
  height = 260,
}: {
  data: NetWorthPoint[];
  height?: number;
}) {
  const chartData = data.map((point) => ({
    label: point.label,
    Vermögen: toFrancs(point.netWorthCents),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
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
        <Area
          type="monotone"
          dataKey="Vermögen"
          stroke="#6366f1"
          strokeWidth={2}
          fill="url(#netWorthFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
