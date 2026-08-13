import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeBackoffDelayMs, withRetry } from "@/lib/ai/providers/retry";

describe("withRetry — existing immediate-retry behavior (no delayMs), unchanged", () => {
  it("returns the result immediately on first-attempt success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, isRetryable: () => true });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries immediately (no delay) and succeeds on a later attempt", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValue("ok");
    const start = Date.now();
    const result = await withRetry(fn, { maxAttempts: 3, isRetryable: () => true });
    const elapsed = Date.now() - start;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeLessThan(50); // no delayMs passed — must not wait
  });

  it("throws the original error, unmodified, once maxAttempts is exhausted", async () => {
    const originalError = new Error("always fails");
    const fn = vi.fn().mockRejectedValue(originalError);
    await expect(withRetry(fn, { maxAttempts: 3, isRetryable: () => true })).rejects.toBe(originalError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops immediately (no retry) when isRetryable returns false, even with attempts remaining", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("non-retryable"));
    await expect(withRetry(fn, { maxAttempts: 3, isRetryable: () => false })).rejects.toThrow("non-retryable");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withRetry — new delayMs backoff (Phase 17)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls delayMs with the upcoming attempt number and actually waits before retrying", async () => {
    const delayMs = vi.fn().mockReturnValue(1000);
    const fn = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValue("ok");

    const promise = withRetry(fn, { maxAttempts: 3, isRetryable: () => true, delayMs });

    // First attempt has failed synchronously; the retry should not have fired yet.
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delayMs).toHaveBeenCalledWith(2);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not wait at all when delayMs returns 0", async () => {
    const delayMs = vi.fn().mockReturnValue(0);
    const fn = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValue("ok");

    const result = await withRetry(fn, { maxAttempts: 3, isRetryable: () => true, delayMs });
    expect(result).toBe("ok");
  });

  it("never calls delayMs when the error is not retryable", async () => {
    const delayMs = vi.fn().mockReturnValue(1000);
    const fn = vi.fn().mockRejectedValue(new Error("non-retryable"));

    await expect(withRetry(fn, { maxAttempts: 3, isRetryable: () => false, delayMs })).rejects.toThrow();
    expect(delayMs).not.toHaveBeenCalled();
  });
});

describe("computeBackoffDelayMs", () => {
  it("caps the delay at min(maxDelayMs, baseDelayMs * 2^(attempt-1)) — verified at the Math.random()=1 boundary", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(1);
    try {
      expect(computeBackoffDelayMs(2, 500, 4000)).toBeCloseTo(1000); // 500 * 2^1
      expect(computeBackoffDelayMs(3, 500, 4000)).toBeCloseTo(2000); // 500 * 2^2
      expect(computeBackoffDelayMs(4, 500, 4000)).toBeCloseTo(4000); // 500 * 2^3 = 4000, at the cap
      expect(computeBackoffDelayMs(5, 500, 4000)).toBeCloseTo(4000); // 500 * 2^4 = 8000, capped to 4000
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("returns 0 at the Math.random()=0 boundary — full jitter allows a zero delay", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(computeBackoffDelayMs(2, 500, 4000)).toBe(0);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("applies real jitter — repeated calls for the same attempt are not always identical", () => {
    const samples = new Set(Array.from({ length: 20 }, () => computeBackoffDelayMs(3, 500, 4000)));
    expect(samples.size).toBeGreaterThan(1);
  });

  it("never exceeds maxDelayMs even for a very large attempt number", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(1);
    try {
      expect(computeBackoffDelayMs(20, 500, 4000)).toBe(4000);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
