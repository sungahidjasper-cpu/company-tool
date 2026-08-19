import { anthropicProvider } from "@/lib/ai/providers/anthropic.provider";
import { geminiProvider } from "@/lib/ai/providers/gemini.provider";
import { ollamaProvider } from "@/lib/ai/providers/ollama.provider";
import { openaiProvider } from "@/lib/ai/providers/openai.provider";
import { openrouterProvider } from "@/lib/ai/providers/openrouter.provider";
import type { LlmProvider } from "@/lib/ai/providers/types";
import type { AiTaskType } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";

const ALL_PROVIDERS: Record<string, LlmProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
  openrouter: openrouterProvider,
};

/**
 * Gemini first: it's the primary configured provider for this deployment.
 * Ollama second: free/local, worth trying before paying for OpenAI. OpenAI
 * third. Anthropic fourth — kept in the chain (still useful once its account
 * has credits again) but no longer assumed to be the default. OpenRouter
 * last — a paid aggregator, the catch-all once every direct provider above
 * has failed.
 */
const DEFAULT_ORDER = ["gemini", "ollama", "openai", "anthropic", "openrouter"];

/**
 * A controlled Ollama-vs-OpenRouter comparison (same brief/settings/prompt/
 * code, provider as the only variable) showed llama3.2:1b's long-form/brief
 * output landing well short of the word-count target with thin sections and
 * self-contradictory invented figures, where OpenRouter (openai/gpt-4o-mini)
 * landed on-target with real depth and no invented figures. Content
 * generation is the one place in this app where a shallow/incoherent result
 * is a direct, user-visible quality problem — not just a slower or costlier
 * one — so CONTENT_BRIEF/CONTENT_DRAFT get OpenRouter promoted ahead of
 * Ollama. Every other task (extraction/scoring/recommendations/etc.) is
 * shorter and more mechanical and hasn't shown this depth/coherence gap, so
 * it keeps DEFAULT_ORDER — free local Ollama before the paid aggregator.
 */
const CONTENT_TASK_ORDER = ["gemini", "openrouter", "ollama", "openai", "anthropic"];
const CONTENT_TASK_TYPES = new Set<AiTaskType>(["CONTENT_BRIEF", "CONTENT_DRAFT"]);

function resolveDefaultOrder(taskType: AiTaskType | undefined): string[] {
  return taskType && CONTENT_TASK_TYPES.has(taskType) ? CONTENT_TASK_ORDER : DEFAULT_ORDER;
}

export type ProviderConfigurationStatus = {
  name: string;
  configured: boolean;
  reason: string;
  /** DISABLED means unconfigured; otherwise the shared health-cache's current status for this provider (see health-cache.ts). */
  health: Awaited<ReturnType<LlmProvider["healthCheck"]>>;
};

/**
 * The single source of truth for "which providers exist and are they
 * configured/healthy" — both `getConfiguredProviders()` (used by the
 * fallback orchestrator) and `instrumentation.ts` (startup validation) call
 * this rather than duplicating the evaluation logic. `taskType`, when
 * supplied, selects CONTENT_TASK_ORDER for CONTENT_BRIEF/CONTENT_DRAFT and
 * DEFAULT_ORDER for everything else (see resolveDefaultOrder) — omitted
 * entirely, this is unchanged, existing behavior. LLM_PROVIDER_ORDER still
 * overrides either default outright, exactly as before, for an operator
 * who needs to force a specific order regardless of task.
 */
export async function describeProviderConfiguration(taskType?: AiTaskType): Promise<ProviderConfigurationStatus[]> {
  const orderEnv = process.env.LLM_PROVIDER_ORDER;
  const order = orderEnv ? orderEnv.split(",").map((name) => name.trim()) : resolveDefaultOrder(taskType);

  return Promise.all(
    order.map(async (name) => {
      const provider = ALL_PROVIDERS[name];
      if (!provider) {
        return { name, configured: false, reason: `"${name}" is not a recognized provider name`, health: "DISABLED" as const };
      }
      const configured = provider.isConfigured();
      const health = await provider.healthCheck();
      return {
        name,
        configured,
        reason: configured ? (health === "HEALTHY" ? "required env vars are set" : `configured but currently ${health.toLowerCase()}`) : "required env vars are missing",
        health,
      };
    })
  );
}

/**
 * Providers to attempt, in order, filtered to those with their required env
 * vars set AND not currently marked unhealthy in the in-memory health cache
 * (see health-cache.ts) — a provider that just failed with a bad API key or
 * an active quota block isn't re-attempted on every subsequent job until its
 * TTL expires. Order is configurable via LLM_PROVIDER_ORDER (comma-separated)
 * to override DEFAULT_ORDER per deployment without a code change.
 *
 * Every call logs the full available list, the enabled subset, and which
 * ones were disabled/unhealthy and why — this is the one place that decides
 * which providers are attempted at all, so it's the right place to make
 * that decision observable rather than relying on downstream fallback logs
 * to imply it. `taskType` is forwarded to describeProviderConfiguration()
 * unchanged — see its doc comment.
 */
export async function getConfiguredProviders(taskType?: AiTaskType): Promise<LlmProvider[]> {
  const statuses = await describeProviderConfiguration(taskType);
  const enabled = statuses.filter((s) => s.configured && s.health === "HEALTHY");
  const skipped = statuses.filter((s) => !s.configured || s.health !== "HEALTHY");

  logger.info("Provider registry evaluated", {
    available: statuses.map((s) => s.name),
    enabled: enabled.map((s) => s.name),
    skipped: skipped.map((s) => ({ name: s.name, reason: s.reason, health: s.health })),
  });

  return enabled.map((s) => ALL_PROVIDERS[s.name]);
}
