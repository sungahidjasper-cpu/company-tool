import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { logger } from "@/lib/logger";
import {
  estimateAnthropicCostUsd,
  estimateGeminiCostUsd,
  estimateOllamaCostUsd,
  estimateOpenAiCostUsd,
  estimateOpenRouterCostUsd,
  getAnthropicMaxContext,
  getGeminiMaxContext,
  getOpenAiMaxContext,
  isKnownModel,
} from "@/lib/ai/providers/pricing";

const mockWarn = vi.mocked(logger.warn);

beforeEach(() => {
  mockWarn.mockClear();
});

describe("cost estimation — known models", () => {
  it("computes Gemini cost from its known per-model rate", () => {
    const cost = estimateGeminiCostUsd("gemini-2.5-flash", { promptTokens: 1_000_000, completionTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.3 + 2.5);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("computes OpenAI cost from its known per-model rate", () => {
    const cost = estimateOpenAiCostUsd("gpt-4o", { promptTokens: 1_000_000, completionTokens: 1_000_000 });
    expect(cost).toBeCloseTo(2.5 + 10);
  });

  it("computes Anthropic cost from its known per-model rate", () => {
    const cost = estimateAnthropicCostUsd("claude-opus-5", { promptTokens: 1_000_000, completionTokens: 1_000_000 });
    expect(cost).toBeCloseTo(5 + 25);
  });

  it("Ollama is always free — no per-token billing", () => {
    expect(estimateOllamaCostUsd()).toBe(0);
  });

  it("OpenRouter uses its single blended rate regardless of the underlying routed model", () => {
    const cost = estimateOpenRouterCostUsd({ promptTokens: 1_000_000, completionTokens: 1_000_000 });
    expect(cost).toBeCloseTo(1 + 3);
  });
});

describe("cost estimation — unrecognized/unavailable models degrade gracefully", () => {
  it("falls back to the provider's default rate and logs a warning for an unrecognized model", () => {
    const cost = estimateGeminiCostUsd("some-future-gemini-model", { promptTokens: 1_000_000, completionTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.3 + 2.5); // GEMINI_DEFAULT === gemini-2.5-flash's rate
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("fallback pricing rate"), expect.objectContaining({ provider: "gemini", model: "some-future-gemini-model" }));
  });

  it("falls back gracefully (no throw) when no model is configured at all", () => {
    const cost = estimateAnthropicCostUsd(undefined, { promptTokens: 1000, completionTokens: 1000 });
    expect(Number.isFinite(cost)).toBe(true);
    expect(mockWarn).toHaveBeenCalled();
  });
});

describe("context-window lookup — known models", () => {
  it("returns Gemini's known context window", () => {
    expect(getGeminiMaxContext("gemini-2.5-flash")).toBe(1_000_000);
  });

  it("returns OpenAI's known context window", () => {
    expect(getOpenAiMaxContext("gpt-4o-mini")).toBe(128_000);
  });

  it("returns Anthropic's known context window, distinguishing models with different windows", () => {
    expect(getAnthropicMaxContext("claude-opus-5")).toBe(1_000_000);
    expect(getAnthropicMaxContext("claude-haiku-4-5")).toBe(200_000);
  });
});

describe("context-window lookup — unrecognized/unavailable models fail gracefully with sensible defaults", () => {
  it("falls back to the provider's default context window and logs a warning for an unrecognized model", () => {
    const window = getOpenAiMaxContext("some-future-gpt-model");
    expect(window).toBe(128_000); // OPENAI_DEFAULT === gpt-4o-mini's window
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("fallback"), expect.objectContaining({ provider: "openai", model: "some-future-gpt-model" }));
  });

  it("falls back gracefully (no throw) when no model is configured at all", () => {
    expect(() => getAnthropicMaxContext(undefined)).not.toThrow();
    expect(Number.isFinite(getAnthropicMaxContext(undefined))).toBe(true);
  });
});

describe("isKnownModel — startup model-recognition check", () => {
  it("returns true for a recognized model on a provider with a known-models table", () => {
    expect(isKnownModel("gemini", "gemini-2.5-flash")).toBe(true);
    expect(isKnownModel("anthropic", "claude-sonnet-5")).toBe(true);
  });

  it("returns false for an unrecognized model — never throws, this is a warning signal not a validator", () => {
    expect(isKnownModel("gemini", "not-a-real-model")).toBe(false);
    expect(isKnownModel("gemini", undefined)).toBe(false);
  });

  it("returns false for a provider with no fixed model catalog (Ollama/OpenRouter) — nothing to check against", () => {
    expect(isKnownModel("ollama", "llama3")).toBe(false);
    expect(isKnownModel("openrouter", "anything")).toBe(false);
  });
});
