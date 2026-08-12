import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCachedHealth, isCurrentlyHealthy, recordProviderFailure, recordProviderSuccess } from "@/lib/ai/providers/health-cache";

/**
 * The cache is a module-level singleton (globalThis, matching each
 * provider's own SDK-client cache pattern) — cleared between tests by
 * expiring every provider name used here via recordProviderSuccess, since
 * there's no exported reset hook (deliberately: production code never
 * needs one).
 */
function reset(...providers: string[]) {
  providers.forEach((name) => recordProviderSuccess(name));
}

describe("health-cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    reset("gemini", "openai", "anthropic", "ollama", "openrouter");
    vi.useRealTimers();
  });

  it("reports HEALTHY for a provider with no recorded failures", () => {
    expect(getCachedHealth("gemini")).toBe("HEALTHY");
    expect(isCurrentlyHealthy("gemini")).toBe(true);
  });

  it("marks a provider unhealthy with the mapped status after a fallback-worthy failure", () => {
    recordProviderFailure("openai", "RATE_LIMIT");
    expect(getCachedHealth("openai")).toBe("RATE_LIMITED");
    expect(isCurrentlyHealthy("openai")).toBe(false);
  });

  it("maps INSUFFICIENT_CREDITS to QUOTA_EXCEEDED and AUTHENTICATION_ERROR to itself", () => {
    recordProviderFailure("anthropic", "INSUFFICIENT_CREDITS");
    expect(getCachedHealth("anthropic")).toBe("QUOTA_EXCEEDED");

    recordProviderFailure("ollama", "AUTHENTICATION_ERROR");
    expect(getCachedHealth("ollama")).toBe("AUTHENTICATION_ERROR");
  });

  it("does not mark a provider unhealthy for INVALID_REQUEST or NOT_CONFIGURED — those aren't provider-health signals", () => {
    recordProviderFailure("openrouter", "INVALID_REQUEST");
    expect(getCachedHealth("openrouter")).toBe("HEALTHY");
    recordProviderFailure("openrouter", "NOT_CONFIGURED");
    expect(getCachedHealth("openrouter")).toBe("HEALTHY");
  });

  it("becomes HEALTHY again once the TTL expires — a short TTL (rate limit) clears within a minute", () => {
    recordProviderFailure("openai", "RATE_LIMIT");
    expect(getCachedHealth("openai")).toBe("RATE_LIMITED");

    vi.advanceTimersByTime(61_000);
    expect(getCachedHealth("openai")).toBe("HEALTHY");
  });

  it("keeps a long-TTL failure (auth/credits) unhealthy well past a minute", () => {
    recordProviderFailure("anthropic", "AUTHENTICATION_ERROR");
    vi.advanceTimersByTime(61_000);
    expect(getCachedHealth("anthropic")).toBe("AUTHENTICATION_ERROR");

    vi.advanceTimersByTime(10 * 60_000);
    expect(getCachedHealth("anthropic")).toBe("HEALTHY");
  });

  it("clears an unhealthy mark immediately on a real success, without waiting out the TTL", () => {
    recordProviderFailure("gemini", "SERVICE_UNAVAILABLE");
    expect(getCachedHealth("gemini")).toBe("UNAVAILABLE");

    recordProviderSuccess("gemini");
    expect(getCachedHealth("gemini")).toBe("HEALTHY");
  });

  it("tracks each provider's health independently", () => {
    recordProviderFailure("gemini", "RATE_LIMIT");
    expect(getCachedHealth("gemini")).toBe("RATE_LIMITED");
    expect(getCachedHealth("openai")).toBe("HEALTHY");
  });
});
