import { logger } from "@/lib/logger";

export type WithRetryOptions = {
  maxAttempts: number;
  isRetryable: (error: unknown) => boolean;
  label?: string;
  /**
   * Phase 17 — delay (ms) to wait before the given upcoming attempt number
   * (2, 3, ...). Omitted means no delay, preserving the original
   * immediate-retry behavior byte-for-byte for every existing caller (the
   * JSON-parse retry in every provider file, below). Only
   * structured-output.ts's new transient-failure retry passes this, via
   * computeBackoffDelayMs.
   */
  delayMs?: (attempt: number) => number;
};

/**
 * Small, shared retry loop — originally built for transient malformed/
 * truncated JSON output (live verification during Phase 10.5b found
 * occasional non-deterministic "unterminated string" style parse failures
 * that are genuine run-to-run model variance, not a systemic bug, and
 * self-resolve on retry; every provider still uses it this way, with no
 * `delayMs`, so that behavior is unchanged). Phase 17 reuses this same
 * primitive for transient provider-level failures (429/503/timeout) in
 * structured-output.ts, this time with a `delayMs` backoff. Never retries
 * anything else — that's the caller's `isRetryable` predicate.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: WithRetryOptions): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        logger.info("Retry succeeded", { label: opts.label, attempt, maxAttempts: opts.maxAttempts });
      }
      return result;
    } catch (error) {
      if (!opts.isRetryable(error) || attempt === opts.maxAttempts) {
        if (attempt > 1) {
          logger.warn("Retry exhausted", { label: opts.label, attempts: attempt, maxAttempts: opts.maxAttempts });
        }
        throw error;
      }

      const delay = opts.delayMs?.(attempt + 1) ?? 0;
      logger.warn("Retrying after transient failure", {
        label: opts.label,
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs: Math.round(delay),
      });
      lastError = error;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Exponential backoff with full jitter: delay = random(0, min(maxDelayMs,
 * baseDelayMs * 2^(attempt-1))), where `attempt` is the upcoming attempt
 * number (2 for the first retry, 3 for the second, ...). Full jitter (not a
 * fixed multiplier) avoids synchronized retry storms across concurrent
 * requests failing at the same moment.
 */
export function computeBackoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const cap = Math.min(maxDelayMs, exponential);
  return Math.random() * cap;
}
