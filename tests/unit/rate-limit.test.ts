import { describe, expect, it } from "vitest";
import {
  checkRateLimit,
  isRateLimited,
  recordFailedAttempt,
  resetRateLimit,
} from "@/lib/rate-limit";

let counter = 0;
/** A fresh key per test so buckets from other tests never interfere. */
function key() {
  return `test-key-${counter++}`;
}

describe("checkRateLimit", () => {
  it("allows attempts up to the limit, then blocks", () => {
    const k = key();
    expect(checkRateLimit(k, { maxAttempts: 2 })).toBe(true);
    expect(checkRateLimit(k, { maxAttempts: 2 })).toBe(true);
    expect(checkRateLimit(k, { maxAttempts: 2 })).toBe(false);
  });

  it("tracks separate keys independently", () => {
    const a = key();
    const b = key();
    expect(checkRateLimit(a, { maxAttempts: 1 })).toBe(true);
    expect(checkRateLimit(a, { maxAttempts: 1 })).toBe(false);
    expect(checkRateLimit(b, { maxAttempts: 1 })).toBe(true);
  });

  it("resets the count once the window has elapsed", () => {
    const k = key();
    expect(checkRateLimit(k, { maxAttempts: 1, windowMs: 10 })).toBe(true);
    expect(checkRateLimit(k, { maxAttempts: 1, windowMs: 10 })).toBe(false);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(checkRateLimit(k, { maxAttempts: 1, windowMs: 10 })).toBe(true);
        resolve();
      }, 20);
    });
  });
});

describe("resetRateLimit", () => {
  it("clears an existing bucket so the next attempt starts fresh", () => {
    const k = key();
    expect(checkRateLimit(k, { maxAttempts: 1 })).toBe(true);
    expect(checkRateLimit(k, { maxAttempts: 1 })).toBe(false);
    resetRateLimit(k);
    expect(checkRateLimit(k, { maxAttempts: 1 })).toBe(true);
  });

  it("is a no-op for a key that was never set", () => {
    expect(() => resetRateLimit(key())).not.toThrow();
  });
});

describe("isRateLimited / recordFailedAttempt", () => {
  it("reports over-limit without itself counting as an attempt", () => {
    const k = key();
    recordFailedAttempt(k, { maxAttempts: 1 });
    expect(isRateLimited(k, { maxAttempts: 1 })).toBe(true);
    // Checking again does not consume anything further.
    expect(isRateLimited(k, { maxAttempts: 1 })).toBe(true);
  });

  it("is false for a key with no recorded attempts", () => {
    expect(isRateLimited(key())).toBe(false);
  });

  it("is false once the window has elapsed even without a reset", () => {
    const k = key();
    recordFailedAttempt(k, { maxAttempts: 1, windowMs: 10 });
    expect(isRateLimited(k, { maxAttempts: 1, windowMs: 10 })).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(isRateLimited(k, { maxAttempts: 1, windowMs: 10 })).toBe(false);
        resolve();
      }, 20);
    });
  });
});

describe("bucket cap", () => {
  it("evicts the oldest bucket instead of growing without bound", () => {
    const LARGE_WINDOW = 10_000_000;
    const evictee = key();

    // First in, and already at its limit.
    expect(checkRateLimit(evictee, { maxAttempts: 1, windowMs: LARGE_WINDOW })).toBe(true);
    expect(checkRateLimit(evictee, { maxAttempts: 1, windowMs: LARGE_WINDOW })).toBe(false);

    // Fill the map up to (but not over) the 10,000-bucket cap with distinct,
    // non-expiring keys so the next insert forces a sweep/eviction.
    for (let i = 0; i < 9999; i++) {
      checkRateLimit(`fill-${i}`, { windowMs: LARGE_WINDOW });
    }

    // This insert pushes the map over the cap, evicting the oldest bucket.
    checkRateLimit(key(), { windowMs: LARGE_WINDOW });

    // The evicted bucket is gone, so the "blocked" key is treated as fresh again.
    expect(checkRateLimit(evictee, { maxAttempts: 1, windowMs: LARGE_WINDOW })).toBe(true);
  });
});
