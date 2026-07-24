"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlySummary } from "@/lib/analytics";
import { EXPENSE_COLOR, INCOME_COLOR } from "@/lib/colors";
import { formatMoneyCompact, toFrancs } from "@/lib/money";
import { MoneyTooltip } from "./chart-tooltip";

/**
 * Income vs. expenses per month, with the resulting balance as a line on top.
 *
 * The balance is what the household actually cares about, but it is only
 * meaningful next to the two bars it is derived from — hence one combined
 * chart rather than three.
 */
export function MonthlyBarChart({
  data,
  showBalance = true,
  height = 280,
}: {
  data: MonthlySummary[];
  showBalance?: boolean;
  height?: number;
}) {
  // Recharts plots plain numbers; francs keep the axis labels readable.
  const chartData = data.map((month) => ({
    label: month.label,
    Einnahmen: toFrancs(month.incomeCents),
    Ausgaben: toFrancs(month.expenseCents),
    Saldo: toFrancs(month.balanceCents),
  }));

  const Chart = showBalance ? ComposedChart : BarChart;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
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
        <Tooltip content={<MoneyTooltip />} cursor={{ className: "fill-muted/40" }} />
        <Legend
          wrapperStyle={{ fontSize: "0.75rem" }}
          formatter={(value) => <span className="text-muted-foreground">{value}</span>}
        />
        <Bar dataKey="Einnahmen" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="Ausgaben" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
        {showBalance && (
          <Line
            type="monotone"
            dataKey="Saldo"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        )}
      </Chart>
    </ResponsiveContainer>
  );
}
