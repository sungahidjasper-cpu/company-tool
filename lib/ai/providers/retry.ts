import { logger } from "@/lib/logger";

/**
 * Small, shared retry loop for transient malformed/truncated JSON output —
 * live verification during Phase 10.5b found occasional non-deterministic
 * "unterminated string" style parse failures that are genuine run-to-run
 * model variance, not a systemic bug, and self-resolve on retry. Never
 * retries anything else — that's the caller's `isRetryable` predicate.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts: number; isRetryable: (error: unknown) => boolean; label?: string }
): Promise<T> {
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
      logger.warn("Retrying after transient failure", { label: opts.label, attempt, maxAttempts: opts.maxAttempts });
      lastError = error;
    }
  }

  throw lastError;
}
