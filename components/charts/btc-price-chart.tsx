"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BtcHistoryDays, BtcPricePoint } from "@/lib/crypto-price";
import { CHART_PALETTE } from "@/lib/colors";
import { formatMoneyCompact } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MoneyTooltip } from "./chart-tooltip";

const COLOR = CHART_PALETTE[0]; // Indigo — matches the app's primary

const RANGES: { days: BtcHistoryDays; label: string }[] = [
  { days: 1, label: "1 Tag" },
  { days: 7, label: "7 Tage" },
  { days: 30, label: "30 Tage" },
  { days: 365, label: "1 Jahr" },
];

/** Data older than this is re-fetched when the user returns to the app (matches the server's 7-day cache TTL). */
const STALE_AFTER_MS = 15 * 60 * 1000;

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatPoint(timestamp: number, days: BtcHistoryDays): string {
  const format: Intl.DateTimeFormatOptions =
    days === 1
      ? { hour: "2-digit", minute: "2-digit" }
      : days === 365
        ? { month: "short", year: "2-digit" }
        : { day: "2-digit", month: "2-digit" };
  return new Intl.DateTimeFormat("de-CH", format).format(new Date(timestamp));
}

/**
 * BTC/CHF price history with a range switcher. All four ranges are fetched
 * server-side up front (see dashboard/page.tsx) — switching tabs here only
 * changes which already-loaded series is rendered, no client-side fetch.
 *
 * The series is a snapshot of the server render, and a phone keeps the page
 * alive in memory (installed PWA, bfcache) with no reload button. So the chart
 * asks the router for fresh server data when the app becomes visible again and
 * the snapshot is stale, and offers a manual refresh button.
 */
export function BtcPriceChart({
  series,
  updatedAt,
  height = 260,
}: {
  series: Record<BtcHistoryDays, BtcPricePoint[] | null>;
  /** When the server last fetched the series (ms since epoch), if known. */
  updatedAt: number | null;
  height?: number;
}) {
  const [days, setDays] = useState<BtcHistoryDays>(1);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const refresh = useCallback(() => {
    startRefresh(() => router.refresh());
  }, [router]);

  // The listeners are registered once; the ref gives them the current value.
  const updatedAtRef = useRef(updatedAt);
  useEffect(() => {
    updatedAtRef.current = updatedAt;
  }, [updatedAt]);

  useEffect(() => {
    function refreshIfStale() {
      if (document.visibilityState !== "visible") return;
      const last = updatedAtRef.current;
      if (last === null || Date.now() - last > STALE_AFTER_MS) refresh();
    }
    document.addEventListener("visibilitychange", refreshIfStale);
    // Restoring from the back/forward cache fires no visibilitychange.
    window.addEventListener("pageshow", refreshIfStale);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfStale);
      window.removeEventListener("pageshow", refreshIfStale);
    };
  }, [refresh]);

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
      <div className="flex items-center justify-between gap-2">
        <Tabs value={String(days)} onValueChange={(value) => setDays(Number(value) as BtcHistoryDays)}>
          <TabsList>
            {RANGES.map((range) => (
              <TabsTrigger key={range.days} value={String(range.days)}>
                {range.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={refresh}
          disabled={refreshing}
          aria-label="Kurs aktualisieren"
        >
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
        </Button>
      </div>

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

      {updatedAt !== null && (
        // Rendered in the viewer's timezone, which the server cannot know.
        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
          Stand: {formatUpdatedAt(updatedAt)}
        </p>
      )}
    </div>
  );
}
