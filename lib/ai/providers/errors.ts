/**
 * Provider-agnostic error taxonomy for the multi-provider LLM layer. Every
 * provider file classifies its own SDK's errors into one of these types;
 * callers (structured-output.ts's fallback loop, website-analysis.service.ts)
 * only ever deal with this shared shape, never a raw provider error.
 */
export type LlmErrorType =
  | "AUTHENTICATION_ERROR"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "SERVICE_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

/**
 * "Unavailable right now" types — the fallback orchestrator moves on to the
 * next configured provider for these. INVALID_REQUEST is deliberately
 * excluded: it means our request/schema is malformed, which fails
 * identically on every provider, so retrying elsewhere just wastes calls.
 */
const FALLBACK_WORTHY: ReadonlySet<LlmErrorType> = new Set([
  "AUTHENTICATION_ERROR",
  "INSUFFICIENT_CREDITS",
  "RATE_LIMIT",
  "TIMEOUT",
  "SERVICE_UNAVAILABLE",
  "UNKNOWN",
]);

export function isFallbackWorthy(type: LlmErrorType): boolean {
  return FALLBACK_WORTHY.has(type);
}

/**
 * Phase 17 — the subset of FALLBACK_WORTHY that also gets a same-provider
 * retry-with-backoff attempt (see structured-output.ts) before falling
 * back to the next configured provider. Deliberately narrower than
 * FALLBACK_WORTHY: AUTHENTICATION_ERROR/INSUFFICIENT_CREDITS won't
 * self-resolve within a request's lifetime (matches their 10-minute
 * health-cache TTL), and UNKNOWN is an unclassified catch-all that could be
 * a genuine code bug — retrying it blindly risks wasting cost/latency on
 * something that will never succeed. Only RATE_LIMIT/TIMEOUT/
 * SERVICE_UNAVAILABLE are well-understood, genuinely transient failures.
 */
const RETRYABLE_TRANSIENT: ReadonlySet<LlmErrorType> = new Set(["RATE_LIMIT", "TIMEOUT", "SERVICE_UNAVAILABLE"]);

export function isRetryableTransient(type: LlmErrorType): boolean {
  return RETRYABLE_TRANSIENT.has(type);
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly type: LlmErrorType,
    public readonly provider: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "LlmProviderError";
  }
}

export type LlmErrorDescription = {
  title: string;
  message: string;
  recommendedAction: string;
};

const DESCRIPTIONS: Record<LlmErrorType, LlmErrorDescription> = {
  AUTHENTICATION_ERROR: {
    title: "AI provider authentication failed",
    message: "The configured AI provider rejected the request due to an invalid or missing API key.",
    recommendedAction: "Check the API key configuration for this provider, then retry.",
  },
  INSUFFICIENT_CREDITS: {
    title: "AI provider is out of credits",
    message: "The configured AI provider account has run out of credits or hit its spending limit.",
    recommendedAction: "Add credits to the provider account, or configure a different provider, then retry the analysis.",
  },
  RATE_LIMIT: {
    title: "AI provider rate limit reached",
    message: "The configured AI provider is temporarily rejecting requests due to rate limiting.",
    recommendedAction: "Wait a few minutes and retry.",
  },
  TIMEOUT: {
    title: "AI provider request timed out",
    message: "The request to the AI provider took too long to complete.",
    recommendedAction: "This is often transient — retry the analysis.",
  },
  SERVICE_UNAVAILABLE: {
    title: "AI provider unavailable",
    message: "The configured AI provider appears to be experiencing an outage or is unreachable.",
    recommendedAction: "Retry shortly. If this persists, check the provider's status page.",
  },
  INVALID_REQUEST: {
    title: "AI request could not be processed",
    message: "The AI provider rejected the request as malformed.",
    recommendedAction: "This is likely a bug — contact support if it persists.",
  },
  NOT_CONFIGURED: {
    title: "No AI providers are configured",
    message: "No AI providers are configured.",
    recommendedAction: "Set at least one provider's API key (and model, for non-Anthropic providers) in the environment, then retry.",
  },
  UNKNOWN: {
    title: "AI analysis failed",
    message: "An unexpected error occurred while generating the AI analysis.",
    recommendedAction: "Retry the analysis. If this persists, contact support.",
  },
};

export function describeLlmError(type: LlmErrorType): LlmErrorDescription {
  return DESCRIPTIONS[type];
}
