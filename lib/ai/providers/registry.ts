import { anthropicProvider } from "@/lib/ai/providers/anthropic.provider";
import { geminiProvider } from "@/lib/ai/providers/gemini.provider";
import { ollamaProvider } from "@/lib/ai/providers/ollama.provider";
import { openaiProvider } from "@/lib/ai/providers/openai.provider";
import type { LlmProvider } from "@/lib/ai/providers/types";
import { logger } from "@/lib/logger";

const ALL_PROVIDERS: Record<string, LlmProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
};

/**
 * Gemini first: it's the primary configured provider for this deployment.
 * Ollama second: free/local, worth trying before paying for OpenAI. OpenAI
 * third. Anthropic last — kept in the chain (still useful once its account
 * has credits again) but no longer assumed to be the default.
 */
const DEFAULT_ORDER = ["gemini", "ollama", "openai", "anthropic"];

export type ProviderConfigurationStatus = {
  name: string;
  configured: boolean;
  reason: string;
};

/**
 * The single source of truth for "which providers exist and are they
 * configured" — both `getConfiguredProviders()` (used by the fallback
 * orchestrator) and `instrumentation.ts` (startup validation) call this
 * rather than duplicating the evaluation logic.
 */
export function describeProviderConfiguration(): ProviderConfigurationStatus[] {
  const orderEnv = process.env.LLM_PROVIDER_ORDER;
  const order = orderEnv ? orderEnv.split(",").map((name) => name.trim()) : DEFAULT_ORDER;

  return order.map((name) => {
    const provider = ALL_PROVIDERS[name];
    if (!provider) {
      return { name, configured: false, reason: `"${name}" is not a recognized provider name` };
    }
    return {
      name,
      configured: provider.isConfigured(),
      reason: provider.isConfigured() ? "required env vars are set" : "required env vars are missing",
    };
  });
}

/**
 * Providers to attempt, in order, filtered to only those with their
 * required env vars set — an unconfigured provider is skipped silently
 * rather than attempted and failed. Order is configurable via
 * LLM_PROVIDER_ORDER (comma-separated) to override DEFAULT_ORDER per
 * deployment without a code change.
 *
 * Every call logs the full available list, the enabled subset, and which
 * ones were disabled and why — this is the one place that decides which
 * providers exist at all, so it's the right place to make that decision
 * observable rather than relying on downstream fallback logs to imply it.
 */
export function getConfiguredProviders(): LlmProvider[] {
  const statuses = describeProviderConfiguration();
  const enabled = statuses.filter((s) => s.configured);
  const disabled = statuses.filter((s) => !s.configured);

  logger.info("Provider registry evaluated", {
    available: statuses.map((s) => s.name),
    enabled: enabled.map((s) => s.name),
    disabled: disabled.map((s) => ({ name: s.name, reason: s.reason })),
  });

  return enabled.map((s) => ALL_PROVIDERS[s.name]);
}
