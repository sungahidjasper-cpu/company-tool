import { z } from "zod/v4";

import { enforceCompanyAiLimits } from "@/lib/ai/ai-limit.service";
import { isFallbackWorthy, isRetryableTransient, LlmProviderError } from "@/lib/ai/providers/errors";
import { healthToErrorType, recordProviderFailure, recordProviderSuccess } from "@/lib/ai/providers/health-cache";
import { describeProviderConfiguration, getConfiguredProviders } from "@/lib/ai/providers/registry";
import { computeBackoffDelayMs, withRetry } from "@/lib/ai/providers/retry";
import type { StreamEvent, TokenUsage } from "@/lib/ai/providers/types";
import type { AiTaskType, WebsiteAnalysisErrorType } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Phase 17 — how many times a single provider's generateRaw() is attempted
 * for a transient failure (RATE_LIMIT/TIMEOUT/SERVICE_UNAVAILABLE) before
 * giving up on that provider and falling back to the next configured one.
 * Deliberately small (1 retry, not 2+): TIMEOUT alone means the first
 * attempt already spent the full REQUEST_TIMEOUT_MS (120s, see each
 * provider's own AbortController), so every additional attempt can add up
 * to another 120s of worst-case latency to one synchronous user action.
 */
const TRANSIENT_RETRY_MAX_ATTEMPTS = 2;
const TRANSIENT_RETRY_BASE_DELAY_MS = 500;
const TRANSIENT_RETRY_MAX_DELAY_MS = 4000;

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
  /** Phase 15 — company-scoping path for calls with no WebsiteAnalysisJob (e.g. CONTENT_BRIEF). Callers should supply exactly one of websiteAnalysisJobId/seoProjectId so the resulting AiUsageLog row stays company-scopable (see ai-usage.service.ts's buildWhere). */
  seoProjectId?: string;
  /** Phase 19 — required (unlike websiteAnalysisJobId/seoProjectId above) so enforceCompanyAiLimits can never be silently bypassed by a call site forgetting to supply it. Every caller already has this in scope; see ai-limit.service.ts. */
  companyId: string;
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
  seoProjectId: string | undefined;
  companyId: string;
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
        seoProjectId: params.seoProjectId,
        companyId: params.companyId,
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
 * excludes anything currently unhealthy). Phase 17 — a RATE_LIMIT/TIMEOUT/
 * SERVICE_UNAVAILABLE failure first gets one same-provider retry with a
 * short backoff+jitter delay (see withRetry/computeBackoffDelayMs) before
 * anything else happens; only once that's exhausted does the failure fall
 * through to the next configured provider — and get marked unhealthy in the
 * shared cache so the NEXT call skips it too. AUTHENTICATION_ERROR/
 * INSUFFICIENT_CREDITS/UNKNOWN are never retried this way (won't
 * self-resolve, or might be a real bug), and an INVALID_REQUEST failure
 * (our schema/prompt is malformed) stops immediately, since every provider
 * would fail the same way. Every provider-turn (success or failure, however
 * many attempts it took) writes exactly one AiUsageLog row for cost/usage
 * analytics.
 *
 * Callers are unaffected by taskType/promptVersion beyond supplying them —
 * this signature is otherwise identical to the pre-Phase-11C version.
 */
export async function generateStructuredOutput<T extends z.ZodType>(
  schema: T,
  input: GenerateStructuredOutputInput
): Promise<z.infer<T>> {
  // Phase 19 — runs before anything else, including provider configuration
  // checks below. Throws (never retried, never falls back to another
  // provider — see ai-limit.service.ts) or resolves as a no-op for a
  // company with no limits configured.
  await enforceCompanyAiLimits(input.companyId, input.taskType);

  const allProviders = await getConfiguredProviders(input.taskType);

  if (allProviders.length === 0) {
    // Distinguish "nothing is configured at all" from "something IS
    // configured but every configured provider is currently cache-
    // unhealthy" (e.g. a real quota failure a few minutes ago) — the
    // latter is a materially different, more specific failure than
    // NOT_CONFIGURED, and should surface as the health reason (e.g.
    // INSUFFICIENT_CREDITS → "AI provider is out of credits") rather than
    // the generic "no providers configured" message, which wrongly implies
    // a setup problem rather than a transient availability one.
    const statuses = await describeProviderConfiguration(input.taskType);
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
    /**
     * Phase 17 — how many times generateRaw() was actually invoked for this
     * provider's turn (1 = no retry needed). Declared outside the try block
     * so the catch branch below can also see it, since a fully-exhausted
     * retry sequence still needs to report `retried: true` for logUsage.
     */
    let transientAttempts = 0;
    try {
      const reason = previousProvider ? `falling back from "${previousProvider}"` : "first in configured fallback order";
      logger.info("Selected provider for this attempt", { provider: provider.name, reason, taskType: input.taskType });
      const result = await withRetry(
        () => {
          transientAttempts++;
          return provider.generateRaw({
            system: input.system,
            prompt: input.prompt,
            maxTokens: input.maxTokens,
            zodSchema: schema,
            jsonSchema,
          });
        },
        {
          maxAttempts: TRANSIENT_RETRY_MAX_ATTEMPTS,
          isRetryable: (error) => error instanceof LlmProviderError && isRetryableTransient(error.type),
          label: `${provider.name}:${input.taskType}`,
          delayMs: (attempt) => computeBackoffDelayMs(attempt, TRANSIENT_RETRY_BASE_DELAY_MS, TRANSIENT_RETRY_MAX_DELAY_MS),
        }
      );
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
          retried: result.retried || transientAttempts > 1,
        });
        await logUsage({
          provider: provider.name,
          taskType: input.taskType,
          promptVersion: input.promptVersion,
          model: result.model,
          websiteAnalysisJobId: input.websiteAnalysisJobId,
          seoProjectId: input.seoProjectId,
          companyId: input.companyId,
          usage: result.usage,
          estimatedCostUsd,
          succeeded: true,
          errorType: null,
          latencyMs: durationMs,
          // Phase 17 — true if EITHER the provider's own internal JSON-parse
          // retry needed >1 try, OR this orchestrator-level transient-error
          // retry (429/503/timeout) needed >1 attempt. Same boolean column,
          // now covering both retry mechanisms.
          retried: result.retried || transientAttempts > 1,
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
        seoProjectId: input.seoProjectId,
        companyId: input.companyId,
        usage: result.usage,
        estimatedCostUsd,
        succeeded: false,
        errorType: "UNKNOWN",
        latencyMs: durationMs,
        retried: result.retried || transientAttempts > 1,
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
        seoProjectId: input.seoProjectId,
        companyId: input.companyId,
        usage: { promptTokens: null, completionTokens: null },
        estimatedCostUsd: null,
        succeeded: false,
        errorType: providerError.type,
        latencyMs: durationMs,
        // Phase 17 — true if the new transient-error retry made more than
        // one attempt before ultimately still failing (e.g. RATE_LIMIT on
        // both attempts). recordProviderFailure below still fires only
        // once, after this retry sequence is fully exhausted — not once
        // per attempt.
        retried: transientAttempts > 1,
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

/**
 * Phase 22 — a separate, self-contained streaming counterpart to
 * generateStructuredOutput() above, added alongside it rather than as a
 * parameterized branch of it: generateStructuredOutput is Phase 15-20's
 * well-tested, production orchestration path and is deliberately left
 * byte-for-byte untouched. This function duplicates its provider-
 * resolution/retry/fallback/AiUsageLog-logging structure rather than
 * sharing it, so a bug here can never regress the non-streaming path.
 *
 * `onChunk`, if provided, is called with the accumulating raw text of
 * whichever provider attempt is currently in flight (via that provider's
 * generateRawStreaming, or — for a provider without one — once with the
 * whole response after generateRaw() resolves, so every provider degrades
 * gracefully to "no visible streaming, but still works"). Immediately
 * before any same-provider retry or cross-provider fallback re-attempt,
 * `onChunk` is called with a `reset` event so a caller showing partial
 * output knows to discard it rather than splice it with the next attempt's
 * — different providers/attempts phrase things differently, and a retry
 * means the just-shown output is being fully redone, not continued.
 *
 * The only validation gate is, as ever, schema.safeParse() once a
 * provider's full result is back — nothing streamed is ever treated as
 * final or written anywhere before that.
 */
export async function generateStructuredOutputStreaming<T extends z.ZodType>(
  schema: T,
  input: GenerateStructuredOutputInput,
  onChunk?: (event: StreamEvent) => void
): Promise<z.infer<T>> {
  await enforceCompanyAiLimits(input.companyId, input.taskType);

  const allProviders = await getConfiguredProviders(input.taskType);

  if (allProviders.length === 0) {
    const statuses = await describeProviderConfiguration(input.taskType);
    const configuredButUnhealthy = statuses.find((status) => status.configured && status.health !== "HEALTHY");

    if (configuredButUnhealthy) {
      const errorType = healthToErrorType(configuredButUnhealthy.health as Exclude<typeof configuredButUnhealthy.health, "HEALTHY" | "DISABLED">);
      logger.error("Every configured provider is currently unhealthy — nothing to attempt (streaming)", {
        provider: configuredButUnhealthy.name,
        health: configuredButUnhealthy.health,
      });
      throw new LlmProviderError(
        `The configured AI provider ("${configuredButUnhealthy.name}") is currently unavailable: ${configuredButUnhealthy.reason}.`,
        errorType,
        configuredButUnhealthy.name
      );
    }

    logger.error("No AI providers are configured — nothing to attempt (streaming)");
    throw new LlmProviderError("No AI providers are configured.", "NOT_CONFIGURED", "none");
  }

  const estimatedTokens = estimateRequestTokens(input);
  const providers = allProviders.filter((provider) => provider.maxContext() >= estimatedTokens);
  const tooSmall = allProviders.filter((provider) => provider.maxContext() < estimatedTokens);
  if (tooSmall.length > 0) {
    logger.warn("Skipped provider(s) whose context window is smaller than this request's estimated size (streaming)", {
      skipped: tooSmall.map((provider) => provider.name),
      estimatedTokens,
    });
  }
  if (providers.length === 0) {
    logger.error("Every configured, healthy provider's context window is too small for this request (streaming)", { estimatedTokens });
    throw new LlmProviderError(
      "No configured AI provider has a large enough context window for this request.",
      "INVALID_REQUEST",
      "none"
    );
  }

  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  let lastError: LlmProviderError | null = null;
  let previousProvider: string | null = null;
  let isFirstAttemptOverall = true;

  for (const provider of providers) {
    const attemptStartedAt = Date.now();
    let transientAttempts = 0;
    try {
      const reason = previousProvider ? `falling back from "${previousProvider}"` : "first in configured fallback order";
      logger.info("Selected provider for this attempt (streaming)", { provider: provider.name, reason, taskType: input.taskType });

      const result = await withRetry(
        () => {
          transientAttempts++;
          if (isFirstAttemptOverall) {
            isFirstAttemptOverall = false;
          } else {
            onChunk?.({ type: "reset" });
          }

          if (provider.generateRawStreaming) {
            return provider.generateRawStreaming(
              { system: input.system, prompt: input.prompt, maxTokens: input.maxTokens, zodSchema: schema, jsonSchema },
              (accumulatedText) => onChunk?.({ type: "text", text: accumulatedText })
            );
          }

          return provider.generateRaw({ system: input.system, prompt: input.prompt, maxTokens: input.maxTokens, zodSchema: schema, jsonSchema }).then(
            (rawResult) => {
              onChunk?.({ type: "text", text: JSON.stringify(rawResult.data) });
              return rawResult;
            }
          );
        },
        {
          maxAttempts: TRANSIENT_RETRY_MAX_ATTEMPTS,
          isRetryable: (error) => error instanceof LlmProviderError && isRetryableTransient(error.type),
          label: `${provider.name}:${input.taskType}:streaming`,
          delayMs: (attempt) => computeBackoffDelayMs(attempt, TRANSIENT_RETRY_BASE_DELAY_MS, TRANSIENT_RETRY_MAX_DELAY_MS),
        }
      );
      const durationMs = Date.now() - attemptStartedAt;
      const estimatedCostUsd = provider.cost(result.usage);

      const parsed = schema.safeParse(result.data);
      if (parsed.success) {
        recordProviderSuccess(provider.name);
        logger.info("Structured output generation succeeded (streaming)", {
          provider: provider.name,
          taskType: input.taskType,
          durationMs,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          estimatedCostUsd,
          retried: result.retried || transientAttempts > 1,
        });
        await logUsage({
          provider: provider.name,
          taskType: input.taskType,
          promptVersion: input.promptVersion,
          model: result.model,
          websiteAnalysisJobId: input.websiteAnalysisJobId,
          seoProjectId: input.seoProjectId,
          companyId: input.companyId,
          usage: result.usage,
          estimatedCostUsd,
          succeeded: true,
          errorType: null,
          latencyMs: durationMs,
          retried: result.retried || transientAttempts > 1,
        });
        return parsed.data;
      }

      lastError = new LlmProviderError(
        `AI response did not match the expected schema: ${parsed.error.message}`,
        "UNKNOWN",
        provider.name
      );
      logger.warn("Provider response failed schema validation (streaming)", { provider: provider.name, durationMs, error: lastError.message });
      await logUsage({
        provider: provider.name,
        taskType: input.taskType,
        promptVersion: input.promptVersion,
        model: result.model,
        websiteAnalysisJobId: input.websiteAnalysisJobId,
        seoProjectId: input.seoProjectId,
        companyId: input.companyId,
        usage: result.usage,
        estimatedCostUsd,
        succeeded: false,
        errorType: "UNKNOWN",
        latencyMs: durationMs,
        retried: result.retried || transientAttempts > 1,
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
        seoProjectId: input.seoProjectId,
        companyId: input.companyId,
        usage: { promptTokens: null, completionTokens: null },
        estimatedCostUsd: null,
        succeeded: false,
        errorType: providerError.type,
        latencyMs: durationMs,
        retried: transientAttempts > 1,
      });

      if (!isFallbackWorthy(providerError.type)) {
        logger.error("Provider failed with a non-fallback-worthy error, stopping (streaming)", {
          provider: provider.name,
          errorType: providerError.type,
          durationMs,
          error: providerError.message,
        });
        throw providerError;
      }

      recordProviderFailure(provider.name, providerError.type);
      logger.warn("Provider failed, falling back to next configured provider (streaming)", {
        provider: provider.name,
        errorType: providerError.type,
        durationMs,
        error: providerError.message,
      });
      previousProvider = provider.name;
    }
  }

  logger.error("All configured providers exhausted (streaming)", { errorType: lastError?.type });
  throw lastError;
}
