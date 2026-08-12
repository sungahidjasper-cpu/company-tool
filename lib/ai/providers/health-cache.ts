import type { LlmErrorType } from "@/lib/ai/providers/errors";
import { logger } from "@/lib/logger";

export type ProviderHealthStatus =
  | "HEALTHY"
  | "UNAVAILABLE"
  | "AUTHENTICATION_ERROR"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "DISABLED";

/**
 * How long a provider stays skipped after a fallback-worthy failure, before
 * the next attempt is allowed to prove it's healthy again. Auth/credits
 * problems don't self-resolve within a minute (someone has to fix a key or
 * add funds), so they get a much longer TTL than rate limits/timeouts/
 * outages, which frequently do clear within seconds.
 */
type UnhealthyStatus = Exclude<ProviderHealthStatus, "HEALTHY" | "DISABLED">;

const TTL_MS: Record<UnhealthyStatus, number> = {
  AUTHENTICATION_ERROR: 10 * 60_000,
  QUOTA_EXCEEDED: 10 * 60_000,
  RATE_LIMITED: 60_000,
  UNAVAILABLE: 60_000,
};

const ERROR_TYPE_TO_HEALTH: Partial<Record<LlmErrorType, UnhealthyStatus>> = {
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  INSUFFICIENT_CREDITS: "QUOTA_EXCEEDED",
  RATE_LIMIT: "RATE_LIMITED",
  TIMEOUT: "UNAVAILABLE",
  SERVICE_UNAVAILABLE: "UNAVAILABLE",
  UNKNOWN: "UNAVAILABLE",
};

/**
 * The reverse of the map above, for the case where every configured
 * provider is currently cache-unhealthy: the caller needs a representative
 * LlmErrorType to classify the resulting failure as (e.g. "AI provider is
 * out of credits", not the generic "no providers configured" — a
 * cache-unhealthy provider IS configured, it's just temporarily skipped).
 * UNAVAILABLE is lossy on the way back (TIMEOUT/SERVICE_UNAVAILABLE/UNKNOWN
 * all collapse to it) — SERVICE_UNAVAILABLE is the closest, most honest
 * single description of "this provider is currently unreachable."
 */
const HEALTH_TO_ERROR_TYPE: Record<UnhealthyStatus, LlmErrorType> = {
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  QUOTA_EXCEEDED: "INSUFFICIENT_CREDITS",
  RATE_LIMITED: "RATE_LIMIT",
  UNAVAILABLE: "SERVICE_UNAVAILABLE",
};

export function healthToErrorType(health: UnhealthyStatus): LlmErrorType {
  return HEALTH_TO_ERROR_TYPE[health];
}

type CacheEntry = { status: UnhealthyStatus; until: number };

/**
 * Module-level singleton, same pattern as each provider's own SDK-client
 * cache (globalForGemini/globalForOpenAi/...) — in-memory only, reset on
 * server restart, per Objective 4's "maintain in-memory health cache."
 */
const globalForHealthCache = globalThis as unknown as { llmProviderHealth?: Map<string, CacheEntry> };

function getCache(): Map<string, CacheEntry> {
  if (!globalForHealthCache.llmProviderHealth) {
    globalForHealthCache.llmProviderHealth = new Map();
  }
  return globalForHealthCache.llmProviderHealth;
}

/** Called after a real fallback-worthy failure — never for INVALID_REQUEST/NOT_CONFIGURED, which aren't provider-health signals. */
export function recordProviderFailure(provider: string, errorType: LlmErrorType): void {
  const status = ERROR_TYPE_TO_HEALTH[errorType];
  if (!status) return;

  const until = Date.now() + TTL_MS[status];
  getCache().set(provider, { status, until });
  logger.warn("Provider marked unhealthy", { provider, status, unhealthyForMs: TTL_MS[status] });
}

/** Called after a real success — clears any stale unhealthy mark immediately rather than waiting out its TTL. */
export function recordProviderSuccess(provider: string): void {
  if (getCache().delete(provider)) {
    logger.info("Provider marked healthy again", { provider });
  }
}

/** Never makes a network call — reports the cached state from the last real attempt, or HEALTHY if there's no unexpired record. */
export function getCachedHealth(provider: string): Exclude<ProviderHealthStatus, "DISABLED"> {
  const entry = getCache().get(provider);
  if (!entry) return "HEALTHY";
  if (entry.until <= Date.now()) {
    getCache().delete(provider);
    return "HEALTHY";
  }
  return entry.status;
}

export function isCurrentlyHealthy(provider: string): boolean {
  return getCachedHealth(provider) === "HEALTHY";
}
