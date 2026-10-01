import logger from "@/lib/logger";

/**
 * BTC/CHF rate from CoinGecko's public endpoint, cached in memory. Wallet
 * balances only need to be roughly current, and CoinGecko rate-limits
 * unauthenticated callers, so every page render fetching live would get us
 * throttled — a five-minute cache keeps well under that.
 *
 * The cache is served stale-while-revalidate: once a rate has been fetched,
 * no caller ever waits on the network again. This matters because both the
 * dashboard and the accounts page await this function inside their render
 * path, so a blocking refresh put a third-party API directly in front of the
 * app's main screen — a slow CoinGecko meant the whole page hung for the
 * length of the timeout, for a number that is decoration next to the account
 * balances.
 */

/** How long a rate counts as fresh. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * Timeout for the one fetch a caller actually waits on (empty cache).
 * Deliberately short: the page is blocked for this long, and an unknown rate
 * degrades to a hint in the UI rather than to a broken page.
 */
const COLD_FETCH_TIMEOUT_MS = 2_000;
/** Timeout for background refreshes, which block nobody and may take longer. */
const BACKGROUND_FETCH_TIMEOUT_MS = 10_000;

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=chf";

let cache: { rateChfPerBtc: number; fetchedAt: number } | null = null;
/**
 * The refresh currently in flight, if any. Without it the several callers a
 * single page render produces would each open their own request against an
 * endpoint that rate-limits by IP.
 */
let inFlight: Promise<number | null> | null = null;

/**
 * Sent with every request: CoinGecko answers Node's bare default User-Agent
 * (and some IP ranges) with 403 from its Cloudflare layer.
 */
const REQUEST_HEADERS = { "User-Agent": "budget-app/1.0 (self-hosted household budget)", Accept: "application/json" };

/** Live-rate sources, tried in order. Each returns CHF per BTC or throws. */
const RATE_SOURCES: { name: string; url: string; parse: (body: unknown) => unknown }[] = [
  {
    name: "CoinGecko",
    url: COINGECKO_URL,
    parse: (body) => (body as { bitcoin?: { chf?: number } }).bitcoin?.chf,
  },
  {
    name: "Kraken",
    url: "https://api.kraken.com/0/public/Ticker?pair=XBTCHF",
    parse: (body) => {
      const first = Object.values((body as { result?: Record<string, { c?: string[] }> }).result ?? {})[0];
      return Number(first?.c?.[0]);
    },
  },
  {
    name: "Coinbase",
    url: "https://api.coinbase.com/v2/prices/BTC-CHF/spot",
    parse: (body) => Number((body as { data?: { amount?: string } }).data?.amount),
  },
];

async function fetchRate(timeoutMs: number): Promise<number | null> {
  for (const source of RATE_SOURCES) {
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(timeoutMs), headers: REQUEST_HEADERS });
      if (!res.ok) throw new Error(`${source.name} responded ${res.status}`);
      const rate = source.parse(await res.json());
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Unexpected ${source.name} response shape`);
      }
      cache = { rateChfPerBtc: rate, fetchedAt: Date.now() };
      return rate;
    } catch (err) {
      logger.warn({ err, source: source.name }, "Failed to fetch BTC/CHF rate");
    }
  }
  // Stale cache beats no number at all — a five-minute-old rate is still
  // more useful than blanking the wallet balance out.
  return cache?.rateChfPerBtc ?? null;
}

function refresh(timeoutMs: number): Promise<number | null> {
  // `fetchRate` never rejects, so neither does the shared promise — awaiting it
  // from one caller while another abandons it is safe.
  inFlight ??= fetchRate(timeoutMs).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Current BTC/CHF rate, or null if it could not be fetched and no cache exists. */
export async function btcChfRate(): Promise<number | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.rateChfPerBtc;

  if (cache) {
    // Stale but usable: hand it back now and let the refresh land for the next
    // caller rather than making this one pay for it.
    void refresh(BACKGROUND_FETCH_TIMEOUT_MS);
    return cache.rateChfPerBtc;
  }

  // Nothing cached, so this caller has no choice but to wait.
  return refresh(COLD_FETCH_TIMEOUT_MS);
}

/** BTC amount converted to Rappen at the given rate, or null if the rate is unknown. */
export function btcToCents(btcAmount: number, rateChfPerBtc: number | null): number | null {
  if (rateChfPerBtc === null) return null;
  return Math.round(btcAmount * rateChfPerBtc * 100);
}

export type BtcHistoryDays = 1 | 7 | 30 | 365;

export interface BtcPricePoint {
  /** Milliseconds since epoch. */
  timestamp: number;
  /** CHF, already a plain float — not Rappen. */
  price: number;
}

/**
 * Historical BTC/CHF series, one cache entry per range. Unlike the live rate
 * this is not served stale-while-revalidate: the dashboard's chart re-renders
 * when the user comes back to the app (see `BtcPriceChart`), and a stale-first
 * answer would show that user the old series again and only correct itself on
 * the *next* render — the exact "reload twice" symptom the refresh is meant to
 * cure. An expired entry is therefore awaited, bounded by the cold-fetch
 * timeout per source, and falls back to the stale series if every source is slow or down.
 *
 * The TTL grows with the range: a one-year chart visibly changes only by its
 * last point, so refetching it every few minutes buys nothing and, three
 * ranges per dashboard render, is what gets a home IP throttled by CoinGecko's
 * unauthenticated endpoint. Only the 1-day and 7-day series are kept close to live.
 */
const HISTORY_CACHE_TTL_MS: Record<BtcHistoryDays, number> = {
  1: 5 * 60 * 1000,
  7: 15 * 60 * 1000,
  30: 30 * 60 * 1000,
  365: 3 * 60 * 60 * 1000,
};
/** OHLC / market_chart payloads are bigger than the single-price call, hence the higher timeout. */
const HISTORY_FETCH_TIMEOUT_MS = 3_000;

/** Kraken candle size in minutes per chart range — all well under its 720-candle cap. */
const KRAKEN_INTERVAL_MINUTES: Record<BtcHistoryDays, number> = { 1: 5, 7: 60, 30: 240, 365: 1440 };

/**
 * History sources, tried in order. Kraken comes first because it is also the
 * live-rate source that works from restrictive IP ranges (CoinGecko answers
 * some with 403), and because the price tile and the chart's last point then
 * come from the same exchange. CoinGecko stays as the fallback.
 */
const HISTORY_SOURCES: {
  name: string;
  url: (days: BtcHistoryDays) => string;
  parse: (body: unknown) => BtcPricePoint[];
}[] = [
  {
    name: "Kraken",
    url: (days) => {
      const since = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
      return `https://api.kraken.com/0/public/OHLC?pair=XBTCHF&interval=${KRAKEN_INTERVAL_MINUTES[days]}&since=${since}`;
    },
    parse: (body) => {
      // The result holds one array of candles under the pair's name (which
      // Kraken may spell XBTCHF or XXBTZCHF) next to a numeric `last` cursor.
      const result = (body as { result?: Record<string, unknown> }).result ?? {};
      const candles = Object.entries(result).find(([key]) => key !== "last")?.[1];
      if (!Array.isArray(candles)) throw new Error("Unexpected Kraken response shape");
      // Candle: [time (s), open, high, low, close, ...] with prices as strings.
      return candles.map((candle: unknown[]) => ({ timestamp: Number(candle[0]) * 1000, price: Number(candle[4]) }));
    },
  },
  {
    name: "CoinGecko",
    url: (days) => `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=chf&days=${days}`,
    parse: (body) => {
      const prices = (body as { prices?: [number, number][] }).prices;
      if (!Array.isArray(prices)) throw new Error("Unexpected CoinGecko response shape");
      return prices.map(([timestamp, price]) => ({ timestamp, price }));
    },
  },
];

const historyCache = new Map<BtcHistoryDays, { data: BtcPricePoint[]; fetchedAt: number }>();
/** One in-flight refresh per range, same dedup rationale as the live-rate `inFlight`. */
const historyInFlight = new Map<BtcHistoryDays, Promise<BtcPricePoint[] | null>>();

async function fetchHistory(days: BtcHistoryDays, timeoutMs: number): Promise<BtcPricePoint[] | null> {
  for (const source of HISTORY_SOURCES) {
    try {
      const res = await fetch(source.url(days), { signal: AbortSignal.timeout(timeoutMs), headers: REQUEST_HEADERS });
      if (!res.ok) throw new Error(`${source.name} responded ${res.status}`);
      const data = source.parse(await res.json());
      if (data.length === 0 || data.some((p) => !Number.isFinite(p.timestamp) || !Number.isFinite(p.price) || p.price <= 0)) {
        throw new Error(`Unexpected ${source.name} price data`);
      }
      historyCache.set(days, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      logger.warn({ err, days, source: source.name }, "Failed to fetch BTC/CHF price history");
    }
  }
  // Stale series beats no chart at all, same reasoning as the live rate.
  return historyCache.get(days)?.data ?? null;
}

function refreshHistory(days: BtcHistoryDays, timeoutMs: number): Promise<BtcPricePoint[] | null> {
  let inFlightForRange = historyInFlight.get(days);
  if (!inFlightForRange) {
    inFlightForRange = fetchHistory(days, timeoutMs).finally(() => {
      historyInFlight.delete(days);
    });
    historyInFlight.set(days, inFlightForRange);
  }
  return inFlightForRange;
}

/** BTC/CHF price history for the given range, or null if it could not be fetched and no cache exists. */
export async function btcChfHistory(days: BtcHistoryDays): Promise<BtcPricePoint[] | null> {
  const cached = historyCache.get(days);
  if (cached && Date.now() - cached.fetchedAt < HISTORY_CACHE_TTL_MS[days]) return cached.data;

  // `fetchHistory` falls back to the stale series on failure, so awaiting an
  // expired entry costs at most the timeout and never loses the chart.
  return refreshHistory(days, HISTORY_FETCH_TIMEOUT_MS);
}

/** When the cached series for this range was last fetched (ms since epoch), or null if never. */
export function btcChfHistoryFetchedAt(days: BtcHistoryDays): number | null {
  return historyCache.get(days)?.fetchedAt ?? null;
}
