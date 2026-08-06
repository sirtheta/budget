"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BtcHistoryDays, BtcPricePoint } from "@/lib/crypto-price";
import { CHART_PALETTE } from "@/lib/colors";
import { formatMoneyCompact } from "@/lib/money";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MoneyTooltip } from "./chart-tooltip";

const COLOR = CHART_PALETTE[0]; // Indigo — matches the app's primary

const RANGES: { days: BtcHistoryDays; label: string }[] = [
  { days: 7, label: "7 Tage" },
  { days: 30, label: "30 Tage" },
  { days: 365, label: "1 Jahr" },
];

function formatPoint(timestamp: number, days: BtcHistoryDays): string {
  const format: Intl.DateTimeFormatOptions =
    days === 365 ? { month: "short", year: "2-digit" } : { day: "2-digit", month: "2-digit" };
  return new Intl.DateTimeFormat("de-CH", format).format(new Date(timestamp));
}

/**
 * BTC/CHF price history with a range switcher. All three ranges are fetched
 * server-side up front (see dashboard/page.tsx) — switching tabs here only
 * changes which already-loaded series is rendered, no client-side fetch.
 */
export function BtcPriceChart({
  series,
  height = 260,
}: {
  series: Record<BtcHistoryDays, BtcPricePoint[] | null>;
  height?: number;
}) {
  const [days, setDays] = useState<BtcHistoryDays>(7);

  const chartData = useMemo(() => {
    const points = series[days];
    if (!points) return null;
    return points.map((point) => ({
      label: formatPoint(point.timestamp, days),
      // CoinGecko already returns plain CHF francs — no Rappen conversion needed.
      Kurs: point.price,
    }));
  }, [series, days]);

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={String(days)} onValueChange={(value) => setDays(Number(value) as BtcHistoryDays)}>
        <TabsList>
          {RANGES.map((range) => (
            <TabsTrigger key={range.days} value={String(range.days)}>
              {range.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {chartData ? (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="btcPriceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLOR} stopOpacity={0.35} />
                <stop offset="100%" stopColor={COLOR} stopOpacity={0.02} />
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
              domain={["auto", "auto"]}
              tickFormatter={(value: number) => formatMoneyCompact(value * 100)}
            />
            <Tooltip content={<MoneyTooltip />} />
            <Area
              type="monotone"
              dataKey="Kurs"
              stroke={COLOR}
              strokeWidth={2}
              fill="url(#btcPriceFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div
          style={{ height }}
          className="flex items-center justify-center text-sm text-muted-foreground"
        >
          Kurs momentan nicht verfügbar
        </div>
      )}
    </div>
  );
}
