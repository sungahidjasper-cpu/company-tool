import type { z } from "zod/v4";

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

export interface LlmProvider {
  readonly name: string;
  /** Whether this provider has the env vars it needs to be attempted at all. */
  isConfigured(): boolean;
  /**
   * Returns the raw parsed JSON value (not yet validated against the zod
   * schema — the orchestrator does that once, provider-agnostically).
   * Throws LlmProviderError on any failure.
   */
  generateRaw(request: StructuredOutputRequest): Promise<unknown>;
}
