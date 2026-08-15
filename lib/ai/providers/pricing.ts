import { logger } from "@/lib/logger";

/**
 * Approximate published per-1M-token USD pricing, used only for internal
 * cost-estimate analytics (AiUsageLog) — never for billing. Each provider
 * changes pricing independently of this codebase, so this table WILL drift;
 * update PRICING_LAST_VERIFIED when you revise it. An unrecognized model
 * falls back to its provider's documented default rate (logged, not silent)
 * rather than returning null, so estimatedCostUsd stays populated even for
 * a model this table hasn't been updated for yet.
 */
export const PRICING_LAST_VERIFIED = "2026-08-12";

export type TokenUsage = { promptTokens: number | null; completionTokens: number | null };

type PricingRate = { promptPerMillion: number; completionPerMillion: number };

/**
 * Phase 20 — pairs each model's cost rate with its documented context
 * window, so `maxContext()` follows whatever model is actually configured
 * instead of a static per-provider constant. Only Gemini/OpenAI/Anthropic
 * get this (they already have real per-model tables); Ollama/OpenRouter
 * keep their own single hardcoded constant unchanged — neither has a fixed
 * model catalog to build a table from (Ollama routes to whatever local
 * model is configured, OpenRouter to whatever it's pointed at).
 */
type ModelProfile = PricingRate & { contextWindow: number };

function estimateFromTable(
  provider: string,
  model: string | undefined,
  table: Record<string, PricingRate>,
  defaultRate: PricingRate,
  usage: TokenUsage
): number {
  const rate = (model && table[model]) || defaultRate;
  if (!model || !table[model]) {
    logger.warn("AI cost estimate used a fallback pricing rate — table may be stale", { provider, model });
  }
  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  return (promptTokens / 1_000_000) * rate.promptPerMillion + (completionTokens / 1_000_000) * rate.completionPerMillion;
}

/** Mirrors estimateFromTable's exact fallback-with-logged-warning shape, for context-window lookups instead of cost. */
function getContextWindow(
  provider: string,
  model: string | undefined,
  table: Record<string, ModelProfile>,
  defaultProfile: ModelProfile
): number {
  const profile = (model && table[model]) || defaultProfile;
  if (!model || !table[model]) {
    logger.warn("AI context-window lookup used a fallback — table may be stale", { provider, model });
  }
  return profile.contextWindow;
}

const GEMINI_PRICING: Record<string, ModelProfile> = {
  "gemini-2.5-flash": { promptPerMillion: 0.3, completionPerMillion: 2.5, contextWindow: 1_000_000 },
  "gemini-2.5-pro": { promptPerMillion: 1.25, completionPerMillion: 10, contextWindow: 1_000_000 },
};
const GEMINI_DEFAULT: ModelProfile = GEMINI_PRICING["gemini-2.5-flash"];

const OPENAI_PRICING: Record<string, ModelProfile> = {
  "gpt-4o": { promptPerMillion: 2.5, completionPerMillion: 10, contextWindow: 128_000 },
  "gpt-4o-mini": { promptPerMillion: 0.15, completionPerMillion: 0.6, contextWindow: 128_000 },
};
const OPENAI_DEFAULT: ModelProfile = OPENAI_PRICING["gpt-4o-mini"];

const ANTHROPIC_PRICING: Record<string, ModelProfile> = {
  "claude-opus-5": { promptPerMillion: 5, completionPerMillion: 25, contextWindow: 1_000_000 },
  "claude-sonnet-5": { promptPerMillion: 3, completionPerMillion: 15, contextWindow: 1_000_000 },
  "claude-haiku-4-5": { promptPerMillion: 1, completionPerMillion: 5, contextWindow: 200_000 },
};
const ANTHROPIC_DEFAULT: ModelProfile = ANTHROPIC_PRICING["claude-sonnet-5"];

/**
 * OpenRouter routes to whichever underlying model is configured — its real
 * per-model pricing varies far more than the other 4 providers' own small
 * model lineups. Without querying OpenRouter's live pricing endpoint (a
 * network call this cost-estimate helper deliberately avoids), a single
 * rough blended rate is the honest option here, not a per-model table.
 */
const OPENROUTER_DEFAULT: PricingRate = { promptPerMillion: 1, completionPerMillion: 3 };

export function estimateGeminiCostUsd(model: string | undefined, usage: TokenUsage): number {
  return estimateFromTable("gemini", model, GEMINI_PRICING, GEMINI_DEFAULT, usage);
}

export function estimateOpenAiCostUsd(model: string | undefined, usage: TokenUsage): number {
  return estimateFromTable("openai", model, OPENAI_PRICING, OPENAI_DEFAULT, usage);
}

export function estimateAnthropicCostUsd(model: string | undefined, usage: TokenUsage): number {
  return estimateFromTable("anthropic", model, ANTHROPIC_PRICING, ANTHROPIC_DEFAULT, usage);
}

export function estimateOpenRouterCostUsd(usage: TokenUsage): number {
  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  return (promptTokens / 1_000_000) * OPENROUTER_DEFAULT.promptPerMillion + (completionTokens / 1_000_000) * OPENROUTER_DEFAULT.completionPerMillion;
}

/** Self-hosted — no per-token billing. */
export function estimateOllamaCostUsd(): number {
  return 0;
}

export function getGeminiMaxContext(model: string | undefined): number {
  return getContextWindow("gemini", model, GEMINI_PRICING, GEMINI_DEFAULT);
}

export function getOpenAiMaxContext(model: string | undefined): number {
  return getContextWindow("openai", model, OPENAI_PRICING, OPENAI_DEFAULT);
}

export function getAnthropicMaxContext(model: string | undefined): number {
  return getContextWindow("anthropic", model, ANTHROPIC_PRICING, ANTHROPIC_DEFAULT);
}

const KNOWN_MODEL_TABLES: Record<string, Record<string, ModelProfile>> = {
  gemini: GEMINI_PRICING,
  openai: OPENAI_PRICING,
  anthropic: ANTHROPIC_PRICING,
};

/**
 * Used by lib/startup.ts to warn — never to block — when a configured
 * model isn't in this table. An unrecognized model still works at runtime
 * (cost/context-window estimates just use a fallback default); rejecting it
 * outright would defeat the whole point of models being env-configurable, a
 * genuinely new model that hasn't been added here yet must keep working.
 * Ollama/OpenRouter are deliberately excluded — neither has a fixed model
 * catalog to check a configured value against.
 */
export function isKnownModel(provider: string, model: string | undefined): boolean {
  const table = KNOWN_MODEL_TABLES[provider];
  return Boolean(table && model && table[model]);
}
