import type { z } from "zod/v4";

import type { ProviderHealthStatus } from "@/lib/ai/providers/health-cache";

/**
 * `zodSchema` is needed only by the Anthropic provider (its
 * `zodOutputFormat()` helper requires the actual zod/v4 schema object).
 * Every other provider uses `jsonSchema`, derived once from `zodSchema` via
 * `z.toJSONSchema()` by the orchestrator in structured-output.ts, so the
 * conversion doesn't repeat per provider attempt.
 */
export type StructuredOutputRequest = {
  system?: string;
  prompt: string;
  maxTokens?: number;
  zodSchema: z.ZodType;
  jsonSchema: Record<string, unknown>;
};

export type TokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
};

/** What a provider's attemptGenerate() produces before the generateRaw() wrapper adds retry bookkeeping. */
export type GeneratedOutput = {
  /** The raw parsed JSON value — not yet validated against the zod schema; the orchestrator does that once, provider-agnostically. */
  data: unknown;
  /** Null fields mean the provider's SDK response didn't report usage for this call — not every SDK always includes it. */
  usage: TokenUsage;
  /** The exact model string that served this request, for AiUsageLog's provenance/prompt-versioning record. */
  model: string | null;
};

export type GenerateRawResult = GeneratedOutput & {
  /** True if withRetry() needed more than one attempt (a transient malformed-JSON retry) to produce this result. */
  retried: boolean;
};

export interface LlmProvider {
  readonly name: string;
  /** Whether this provider has the env vars it needs to be attempted at all. */
  isConfigured(): boolean;
  /**
   * Returns the raw parsed JSON value plus token usage (not yet validated
   * against the zod schema — the orchestrator does that once, provider-
   * agnostically). Throws LlmProviderError on any failure.
   */
  generateRaw(request: StructuredOutputRequest): Promise<GenerateRawResult>;
  /**
   * Never makes a network call — DISABLED if unconfigured, otherwise the
   * shared in-memory health-cache's current status for this provider (see
   * health-cache.ts), which is populated reactively by real generateRaw()
   * failures, not by a separate live probe.
   */
  healthCheck(): Promise<ProviderHealthStatus>;
  /** Every provider here only ever produces JSON structured output today — a real, callable capability check, not a hypothetical one. */
  supportsJson(): boolean;
  /** Approximate context window (tokens) for the configured model — used to pre-filter a provider whose context is clearly too small for the request. */
  maxContext(): number;
  /** Approximate USD cost for the given token usage, using this provider's currently configured model — for AiUsageLog analytics, never for billing. */
  cost(usage: TokenUsage): number;
}
