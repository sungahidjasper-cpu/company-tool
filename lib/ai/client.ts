import Anthropic from "@anthropic-ai/sdk";

const globalForAnthropic = globalThis as unknown as {
  anthropic?: Anthropic;
};

/**
 * Lazily constructed so importing this module never throws when
 * ANTHROPIC_API_KEY isn't set yet (e.g. before it's added to .env) — the
 * error only surfaces when an AI call actually happens.
 */
export function getAnthropicClient(): Anthropic {
  if (!globalForAnthropic.anthropic) {
    globalForAnthropic.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return globalForAnthropic.anthropic;
}

export const AI_MODEL = "claude-opus-5";
