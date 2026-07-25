import logger from "@/lib/logger";

/**
 * BTC/CHF rate from CoinGecko's public endpoint, cached in memory. Wallet
 * balances only need to be roughly current, and CoinGecko rate-limits
 * unauthenticated callers, so every page render fetching live would get us
 * throttled — a five-minute cache keeps well under that.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=chf";

let cache: { rateChfPerBtc: number; fetchedAt: number } | null = null;

/** Current BTC/CHF rate, or null if it could not be fetched and no cache exists. */
export async function btcChfRate(): Promise<number | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.rateChfPerBtc;

  try {
    const res = await fetch(COINGECKO_URL, { signal: AbortSignal.timeout(5000) });
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

/** BTC amount converted to Rappen at the given rate, or null if the rate is unknown. */
export function btcToCents(btcAmount: number, rateChfPerBtc: number | null): number | null {
  if (rateChfPerBtc === null) return null;
  return Math.round(btcAmount * rateChfPerBtc * 100);
}
