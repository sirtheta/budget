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

async function fetchRate(timeoutMs: number): Promise<number | null> {
  try {
    const res = await fetch(COINGECKO_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
    const body = (await res.json()) as { bitcoin?: { chf?: number } };
    const rate = body.bitcoin?.chf;
    if (typeof rate !== "number") throw new Error("Unexpected CoinGecko response shape");
    cache = { rateChfPerBtc: rate, fetchedAt: Date.now() };
    return rate;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch BTC/CHF rate");
    // Stale cache beats no number at all — a five-minute-old rate is still
    // more useful than blanking the wallet balance out.
    return cache?.rateChfPerBtc ?? null;
  }
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

export type BtcHistoryDays = 7 | 30 | 365;

export interface BtcPricePoint {
  /** Milliseconds since epoch, as returned by CoinGecko. */
  timestamp: number;
  /** CHF, already a plain float — not Rappen. */
  price: number;
}

/**
 * Historical BTC/CHF series, one cache entry per range. A chart doesn't
 * visibly change minute to minute the way the displayed live rate does, and
 * the dashboard reloads on every navigation (`force-dynamic`) — a much
 * longer TTL than the live rate keeps well clear of CoinGecko's free-tier
 * rate limit without the chart ever looking stale to a user.
 */
const HISTORY_CACHE_TTL_MS = 30 * 60 * 1000;
/** market_chart payloads are bigger than the single-price call, hence the higher timeouts. */
const HISTORY_COLD_FETCH_TIMEOUT_MS = 3_000;
const HISTORY_BACKGROUND_FETCH_TIMEOUT_MS = 15_000;

function historyUrl(days: BtcHistoryDays): string {
  return `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=chf&days=${days}`;
}

const historyCache = new Map<BtcHistoryDays, { data: BtcPricePoint[]; fetchedAt: number }>();
/** One in-flight refresh per range, same dedup rationale as the live-rate `inFlight`. */
const historyInFlight = new Map<BtcHistoryDays, Promise<BtcPricePoint[] | null>>();

async function fetchHistory(days: BtcHistoryDays, timeoutMs: number): Promise<BtcPricePoint[] | null> {
  try {
    const res = await fetch(historyUrl(days), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
    const body = (await res.json()) as { prices?: [number, number][] };
    if (!Array.isArray(body.prices)) throw new Error("Unexpected CoinGecko response shape");
    const data = body.prices.map(([timestamp, price]) => ({ timestamp, price }));
    historyCache.set(days, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    logger.warn({ err, days }, "Failed to fetch BTC/CHF price history");
    // Stale series beats no chart at all, same reasoning as the live rate.
    return historyCache.get(days)?.data ?? null;
  }
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
  if (cached && Date.now() - cached.fetchedAt < HISTORY_CACHE_TTL_MS) return cached.data;

  if (cached) {
    void refreshHistory(days, HISTORY_BACKGROUND_FETCH_TIMEOUT_MS);
    return cached.data;
  }

  return refreshHistory(days, HISTORY_COLD_FETCH_TIMEOUT_MS);
}
