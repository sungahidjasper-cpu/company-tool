import { z } from "zod/v4";

import { isFallbackWorthy, LlmProviderError } from "@/lib/ai/providers/errors";
import { healthToErrorType, recordProviderFailure, recordProviderSuccess } from "@/lib/ai/providers/health-cache";
import { describeProviderConfiguration, getConfiguredProviders } from "@/lib/ai/providers/registry";
import type { TokenUsage } from "@/lib/ai/providers/types";
import type { AiTaskType, WebsiteAnalysisErrorType } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

type GenerateStructuredOutputInput = {
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** Which of the pipeline's independent AI tasks this call is (see AiTaskType) — required so AiUsageLog rows are attributable. */
  taskType: AiTaskType;
  /** Bumped whenever a prompt template changes; also the exact-match key for the crawl-hash cache in website-analysis.service.ts. */
  promptVersion: number;
  /** Optional provenance link to the job this call is for — omitted only when no job exists yet at call time. */
  websiteAnalysisJobId?: string;
};

/** Rough chars-per-token heuristic — good enough for a pre-flight "is this prompt clearly too big for this provider" filter, not exact token counting (providers don't expose a tokenizer here). */
const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateRequestTokens(input: GenerateStructuredOutputInput): number {
  const promptChars = (input.system?.length ?? 0) + input.prompt.length;
  return Math.ceil(promptChars / CHARS_PER_TOKEN_ESTIMATE) + (input.maxTokens ?? 4096);
}

/**
 * Analytics logging must never be able to break the actual AI call it's
 * describing — a write failure here is logged and swallowed, not thrown,
 * so a database hiccup on the analytics table can't turn a successful (or
 * already-classified-failed) AI attempt into an unrelated crash.
 */
async function logUsage(params: {
  provider: string;
  taskType: AiTaskType;
  promptVersion: number;
  model: string | null;
  websiteAnalysisJobId: string | undefined;
  usage: TokenUsage;
  estimatedCostUsd: number | null;
  succeeded: boolean;
  errorType: WebsiteAnalysisErrorType | null;
  latencyMs: number;
  retried: boolean;
}): Promise<void> {
  try {
    await prisma.aiUsageLog.create({
      data: {
        websiteAnalysisJobId: params.websiteAnalysisJobId,
        provider: params.provider,
        taskType: params.taskType,
        promptVersion: params.promptVersion,
        model: params.model,
        promptTokens: params.usage.promptTokens,
        completionTokens: params.usage.completionTokens,
        estimatedCostUsd: params.estimatedCostUsd,
        succeeded: params.succeeded,
        errorType: params.errorType,
        latencyMs: params.latencyMs,
        retried: params.retried,
      },
    });
  } catch (error) {
    logger.error("Failed to write AiUsageLog row — the AI attempt itself is unaffected", {
      provider: params.provider,
      taskType: params.taskType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Provider-agnostic structured-output generation: converts the caller's
 * zod/v4 schema to a plain JSON Schema once (zod v4's built-in
 * `z.toJSONSchema()`), pre-filters providers whose context window is
 * clearly too small for this request, then tries each remaining configured
 * provider in priority order (see providers/registry.ts, which already
 * excludes anything currently unhealthy). A provider whose failure is
 * "unavailable right now" (auth/credits/rate-limit/timeout/service-down)
 * falls through to the next configured provider — and is marked unhealthy
 * in the shared cache so the NEXT call skips it too — while an
 * INVALID_REQUEST failure (our schema/prompt is malformed) stops
 * immediately, since every provider would fail the same way. Every attempt
 * (success or failure) writes one AiUsageLog row for cost/usage analytics.
 *
 * Callers are unaffected by taskType/promptVersion beyond supplying them —
 * this signature is otherwise identical to the pre-Phase-11C version.
 */
export async function generateStructuredOutput<T extends z.ZodType>(
  schema: T,
  input: GenerateStructuredOutputInput
): Promise<z.infer<T>> {
  const allProviders = await getConfiguredProviders();

  if (allProviders.length === 0) {
    // Distinguish "nothing is configured at all" from "something IS
    // configured but every configured provider is currently cache-
    // unhealthy" (e.g. a real quota failure a few minutes ago) — the
    // latter is a materially different, more specific failure than
    // NOT_CONFIGURED, and should surface as the health reason (e.g.
    // INSUFFICIENT_CREDITS → "AI provider is out of credits") rather than
    // the generic "no providers configured" message, which wrongly implies
    // a setup problem rather than a transient availability one.
    const statuses = await describeProviderConfiguration();
    const configuredButUnhealthy = statuses.find((status) => status.configured && status.health !== "HEALTHY");

    if (configuredButUnhealthy) {
      const errorType = healthToErrorType(configuredButUnhealthy.health as Exclude<typeof configuredButUnhealthy.health, "HEALTHY" | "DISABLED">);
      logger.error("Every configured provider is currently unhealthy — nothing to attempt", {
        provider: configuredButUnhealthy.name,
        health: configuredButUnhealthy.health,
      });
      throw new LlmProviderError(
        `The configured AI provider ("${configuredButUnhealthy.name}") is currently unavailable: ${configuredButUnhealthy.reason}.`,
        errorType,
        configuredButUnhealthy.name
      );
    }

    logger.error("No AI providers are configured — nothing to attempt");
    throw new LlmProviderError("No AI providers are configured.", "NOT_CONFIGURED", "none");
  }

  const estimatedTokens = estimateRequestTokens(input);
  const providers = allProviders.filter((provider) => provider.maxContext() >= estimatedTokens);
  const tooSmall = allProviders.filter((provider) => provider.maxContext() < estimatedTokens);
  if (tooSmall.length > 0) {
    logger.warn("Skipped provider(s) whose context window is smaller than this request's estimated size", {
      skipped: tooSmall.map((provider) => provider.name),
      estimatedTokens,
    });
  }
  if (providers.length === 0) {
    logger.error("Every configured, healthy provider's context window is too small for this request", { estimatedTokens });
    throw new LlmProviderError(
      "No configured AI provider has a large enough context window for this request.",
      "INVALID_REQUEST",
      "none"
    );
  }

  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  let lastError: LlmProviderError | null = null;
  let previousProvider: string | null = null;

  for (const provider of providers) {
    const attemptStartedAt = Date.now();
    try {
      const reason = previousProvider ? `falling back from "${previousProvider}"` : "first in configured fallback order";
      logger.info("Selected provider for this attempt", { provider: provider.name, reason, taskType: input.taskType });
      const result = await provider.generateRaw({
        system: input.system,
        prompt: input.prompt,
        maxTokens: input.maxTokens,
        zodSchema: schema,
        jsonSchema,
      });
      const durationMs = Date.now() - attemptStartedAt;
      const estimatedCostUsd = provider.cost(result.usage);

      const parsed = schema.safeParse(result.data);
      if (parsed.success) {
        recordProviderSuccess(provider.name);
        logger.info("Structured output generation succeeded", {
          provider: provider.name,
          taskType: input.taskType,
          durationMs,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          estimatedCostUsd,
          retried: result.retried,
        });
        await logUsage({
          provider: provider.name,
          taskType: input.taskType,
          promptVersion: input.promptVersion,
          model: result.model,
          websiteAnalysisJobId: input.websiteAnalysisJobId,
          usage: result.usage,
          estimatedCostUsd,
          succeeded: true,
          errorType: null,
          latencyMs: durationMs,
          retried: result.retried,
        });
        return parsed.data;
      }

      lastError = new LlmProviderError(
        `AI response did not match the expected schema: ${parsed.error.message}`,
        "UNKNOWN",
        provider.name
      );
      logger.warn("Provider response failed schema validation", { provider: provider.name, durationMs, error: lastError.message });
      await logUsage({
        provider: provider.name,
        taskType: input.taskType,
        promptVersion: input.promptVersion,
        model: result.model,
        websiteAnalysisJobId: input.websiteAnalysisJobId,
        usage: result.usage,
        estimatedCostUsd,
        succeeded: false,
        errorType: "UNKNOWN",
        latencyMs: durationMs,
        retried: result.retried,
      });
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

      await logUsage({
        provider: provider.name,
        taskType: input.taskType,
        promptVersion: input.promptVersion,
        model: null,
        websiteAnalysisJobId: input.websiteAnalysisJobId,
        usage: { promptTokens: null, completionTokens: null },
        estimatedCostUsd: null,
        succeeded: false,
        errorType: providerError.type,
        latencyMs: durationMs,
        retried: false,
      });

      if (!isFallbackWorthy(providerError.type)) {
        logger.error("Provider failed with a non-fallback-worthy error, stopping", {
          provider: provider.name,
          errorType: providerError.type,
          durationMs,
          error: providerError.message,
        });
        throw providerError;
      }

      recordProviderFailure(provider.name, providerError.type);
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
