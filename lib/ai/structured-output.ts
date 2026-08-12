import { z } from "zod/v4";

import { isFallbackWorthy, LlmProviderError } from "@/lib/ai/providers/errors";
import { getConfiguredProviders } from "@/lib/ai/providers/registry";
import { logger } from "@/lib/logger";

type GenerateStructuredOutputInput = {
  system?: string;
  prompt: string;
  maxTokens?: number;
};

/**
 * Provider-agnostic structured-output generation: converts the caller's
 * zod/v4 schema to a plain JSON Schema once (zod v4's built-in
 * `z.toJSONSchema()`), then tries each configured provider in priority
 * order (see providers/registry.ts). A provider whose failure is
 * "unavailable right now" (auth/credits/rate-limit/timeout/service-down)
 * falls through to the next configured provider; an INVALID_REQUEST
 * failure (our schema/prompt is malformed) stops immediately, since every
 * provider would fail the same way.
 *
 * Callers are unaffected by the multi-provider change — this signature is
 * identical to the pre-existing Anthropic-only version.
 */
export async function generateStructuredOutput<T extends z.ZodType>(
  schema: T,
  input: GenerateStructuredOutputInput
): Promise<z.infer<T>> {
  const providers = getConfiguredProviders();

  if (providers.length === 0) {
    logger.error("No AI providers are configured — nothing to attempt");
    throw new LlmProviderError("No AI providers are configured.", "NOT_CONFIGURED", "none");
  }

  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  let lastError: LlmProviderError | null = null;
  let previousProvider: string | null = null;

  for (const provider of providers) {
    const attemptStartedAt = Date.now();
    try {
      const reason = previousProvider ? `falling back from "${previousProvider}"` : "first in configured fallback order";
      logger.info("Selected provider for this attempt", { provider: provider.name, reason });
      const raw = await provider.generateRaw({
        system: input.system,
        prompt: input.prompt,
        maxTokens: input.maxTokens,
        zodSchema: schema,
        jsonSchema,
      });
      const durationMs = Date.now() - attemptStartedAt;

      const parsed = schema.safeParse(raw);
      if (parsed.success) {
        logger.info("Structured output generation succeeded", { provider: provider.name, durationMs });
        return parsed.data;
      }

      lastError = new LlmProviderError(
        `AI response did not match the expected schema: ${parsed.error.message}`,
        "UNKNOWN",
        provider.name
      );
      logger.warn("Provider response failed schema validation", { provider: provider.name, durationMs, error: lastError.message });
      previousProvider = provider.name;
      continue;
    } catch (error) {
      const durationMs = Date.now() - attemptStartedAt;
      const providerError =
        error instanceof LlmProviderError
          ? error
          : new LlmProviderError(error instanceof Error ? error.message : String(error), "UNKNOWN", provider.name, {
              cause: error,
            });

      lastError = providerError;

      if (!isFallbackWorthy(providerError.type)) {
        logger.error("Provider failed with a non-fallback-worthy error, stopping", {
          provider: provider.name,
          errorType: providerError.type,
          durationMs,
          error: providerError.message,
        });
        throw providerError;
      }

      logger.warn("Provider failed, falling back to next configured provider", {
        provider: provider.name,
        errorType: providerError.type,
        durationMs,
        error: providerError.message,
      });
      previousProvider = provider.name;
    }
  }

  logger.error("All configured providers exhausted", { errorType: lastError?.type });
  throw lastError;
}
