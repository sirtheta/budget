"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { NetWorthPoint } from "@/lib/analytics";
import { CHART_PALETTE } from "@/lib/colors";
import { formatMoneyCompact, toFrancs } from "@/lib/money";
import { MoneyTooltip } from "./chart-tooltip";

const LIQUID_COLOR = CHART_PALETTE[0]; // Indigo — matches the app's primary
const ILLIQUID_COLOR = CHART_PALETTE[3]; // Amber — tied up, not spendable today

/**
 * Net worth over time across every account, transfers included — the one
 * chart that answers "is it going in the right direction". Stacked so the
 * top of the area is always total net worth, split into what's spendable
 * within days (liquid) and what's tied up in investments (illiquid).
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
    Flüssig: toFrancs(point.liquidCents),
    "Nicht flüssig": toFrancs(point.illiquidCents),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="netWorthLiquidFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LIQUID_COLOR} stopOpacity={0.35} />
            <stop offset="100%" stopColor={LIQUID_COLOR} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="netWorthIlliquidFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ILLIQUID_COLOR} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ILLIQUID_COLOR} stopOpacity={0.02} />
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
        <Legend
          wrapperStyle={{ fontSize: "0.75rem" }}
          formatter={(value) => <span className="text-muted-foreground">{value}</span>}
        />
        <Area
          type="monotone"
          dataKey="Flüssig"
          stackId="networth"
          stroke={LIQUID_COLOR}
          strokeWidth={2}
          fill="url(#netWorthLiquidFill)"
        />
        <Area
          type="monotone"
          dataKey="Nicht flüssig"
          stackId="networth"
          stroke={ILLIQUID_COLOR}
          strokeWidth={2}
          fill="url(#netWorthIlliquidFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
