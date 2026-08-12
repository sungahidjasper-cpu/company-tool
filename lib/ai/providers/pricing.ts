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

const GEMINI_PRICING: Record<string, PricingRate> = {
  "gemini-2.5-flash": { promptPerMillion: 0.3, completionPerMillion: 2.5 },
  "gemini-2.5-pro": { promptPerMillion: 1.25, completionPerMillion: 10 },
};
const GEMINI_DEFAULT: PricingRate = GEMINI_PRICING["gemini-2.5-flash"];

const OPENAI_PRICING: Record<string, PricingRate> = {
  "gpt-4o": { promptPerMillion: 2.5, completionPerMillion: 10 },
  "gpt-4o-mini": { promptPerMillion: 0.15, completionPerMillion: 0.6 },
};
const OPENAI_DEFAULT: PricingRate = OPENAI_PRICING["gpt-4o-mini"];

const ANTHROPIC_PRICING: Record<string, PricingRate> = {
  "claude-opus-5": { promptPerMillion: 5, completionPerMillion: 25 },
  "claude-sonnet-5": { promptPerMillion: 3, completionPerMillion: 15 },
  "claude-haiku-4-5": { promptPerMillion: 1, completionPerMillion: 5 },
};
const ANTHROPIC_DEFAULT: PricingRate = ANTHROPIC_PRICING["claude-sonnet-5"];

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
