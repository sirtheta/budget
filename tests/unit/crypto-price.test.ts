import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The module keeps its cache in module scope, so every test imports a fresh
 * copy — otherwise a rate cached by one test would satisfy the next one.
 */
async function loadModule() {
  vi.resetModules();
  return import("@/lib/crypto-price");
}

function priceResponse(chf: number) {
  return { ok: true, json: async () => ({ bitcoin: { chf } }) } as Response;
}

describe("btcToCents", () => {
  it("converts BTC to Rappen at the given rate", async () => {
    const { btcToCents } = await loadModule();
    expect(btcToCents(0.5, 80_000)).toBe(4_000_000);
  });

  it("rounds to whole Rappen", async () => {
    const { btcToCents } = await loadModule();
    expect(btcToCents(0.000_001_23, 81_234.56)).toBe(10);
  });

  it("returns null when the rate is unknown", async () => {
    const { btcToCents } = await loadModule();
    expect(btcToCents(1, null)).toBeNull();
  });
});

describe("btcChfRate", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fetches the rate when nothing is cached", async () => {
    fetchMock.mockResolvedValue(priceResponse(90_000));
    const { btcChfRate } = await loadModule();

    expect(await btcChfRate()).toBe(90_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves a fresh rate from cache without hitting the network again", async () => {
    fetchMock.mockResolvedValue(priceResponse(90_000));
    const { btcChfRate } = await loadModule();

    await btcChfRate();
    expect(await btcChfRate()).toBe(90_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the first fetch fails and there is nothing cached", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const { btcChfRate } = await loadModule();

    expect(await btcChfRate()).toBeNull();
  });

  it("keeps serving the last known rate when a refresh fails", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(priceResponse(90_000));
    const { btcChfRate } = await loadModule();
    expect(await btcChfRate()).toBe(90_000);

    vi.advanceTimersByTime(6 * 60 * 1000);
    fetchMock.mockRejectedValue(new Error("CoinGecko down"));

    expect(await btcChfRate()).toBe(90_000);
  });

  it("serves the stale rate immediately instead of waiting for the refresh", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(priceResponse(90_000));
    const { btcChfRate } = await loadModule();
    await btcChfRate();

    vi.advanceTimersByTime(6 * 60 * 1000);

    // A refresh that never settles must not hold the caller up — this await
    // would hang if the stale path waited on the network.
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    expect(await btcChfRate()).toBe(90_000);

    // …and the refresh it kicked off did go out.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("picks up the refreshed rate once it lands", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(priceResponse(90_000));
    const { btcChfRate } = await loadModule();
    await btcChfRate();

    vi.advanceTimersByTime(6 * 60 * 1000);
    fetchMock.mockResolvedValue(priceResponse(95_000));

    expect(await btcChfRate()).toBe(90_000); // stale, refresh triggered
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await btcChfRate()).toBe(95_000);
  });

  it("collapses concurrent cold callers into a single request", async () => {
    let resolveFetch: (res: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    );
    const { btcChfRate } = await loadModule();

    const pending = Promise.all([btcChfRate(), btcChfRate(), btcChfRate()]);
    resolveFetch(priceResponse(90_000));

    expect(await pending).toEqual([90_000, 90_000, 90_000]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a non-ok response as a failure", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 } as Response);
    const { btcChfRate } = await loadModule();

    expect(await btcChfRate()).toBeNull();
  });

  it("treats an unexpected response shape as a failure", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    const { btcChfRate } = await loadModule();

    expect(await btcChfRate()).toBeNull();
  });
});
