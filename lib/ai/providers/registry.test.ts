import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAnthropic, mockOpenAi, mockGemini, mockOllama, mockOpenRouter } = vi.hoisted(() => {
  /** Minimal controllable stand-in for a real LlmProvider — enough for registry.ts's own selection logic, not a real network call. */
  function makeMockProvider(name: string) {
    return {
      name,
      isConfigured: vi.fn().mockReturnValue(false),
      healthCheck: vi.fn().mockResolvedValue("DISABLED"),
      generateRaw: vi.fn(),
      supportsJson: () => true,
      maxContext: () => 1_000_000,
      cost: () => 0,
    };
  }

  return {
    mockAnthropic: makeMockProvider("anthropic"),
    mockOpenAi: makeMockProvider("openai"),
    mockGemini: makeMockProvider("gemini"),
    mockOllama: makeMockProvider("ollama"),
    mockOpenRouter: makeMockProvider("openrouter"),
  };
});

vi.mock("@/lib/ai/providers/anthropic.provider", () => ({ anthropicProvider: mockAnthropic }));
vi.mock("@/lib/ai/providers/openai.provider", () => ({ openaiProvider: mockOpenAi }));
vi.mock("@/lib/ai/providers/gemini.provider", () => ({ geminiProvider: mockGemini }));
vi.mock("@/lib/ai/providers/ollama.provider", () => ({ ollamaProvider: mockOllama }));
vi.mock("@/lib/ai/providers/openrouter.provider", () => ({ openrouterProvider: mockOpenRouter }));

import { describeProviderConfiguration, getConfiguredProviders } from "@/lib/ai/providers/registry";

function resetAllMocks() {
  for (const p of [mockAnthropic, mockOpenAi, mockGemini, mockOllama, mockOpenRouter]) {
    p.isConfigured.mockReturnValue(false);
    p.healthCheck.mockResolvedValue("DISABLED");
  }
}

beforeEach(() => {
  delete process.env.LLM_PROVIDER_ORDER;
  resetAllMocks();
});

afterEach(() => {
  delete process.env.LLM_PROVIDER_ORDER;
});

describe("describeProviderConfiguration — provider selection", () => {
  it("returns the default fallback order when LLM_PROVIDER_ORDER is unset", async () => {
    const statuses = await describeProviderConfiguration();
    expect(statuses.map((s) => s.name)).toEqual(["gemini", "ollama", "openai", "anthropic", "openrouter"]);
  });

  it("respects LLM_PROVIDER_ORDER when set, overriding the default order without a code change", async () => {
    process.env.LLM_PROVIDER_ORDER = "openai,anthropic";
    const statuses = await describeProviderConfiguration();
    expect(statuses.map((s) => s.name)).toEqual(["openai", "anthropic"]);
  });

  it("marks an unrecognized provider name as configured:false, health DISABLED, with a clear reason — invalid provider", async () => {
    process.env.LLM_PROVIDER_ORDER = "not-a-real-provider";
    const statuses = await describeProviderConfiguration();
    expect(statuses).toEqual([
      { name: "not-a-real-provider", configured: false, reason: '"not-a-real-provider" is not a recognized provider name', health: "DISABLED" },
    ]);
  });

  it("reports 'required env vars are missing' when isConfigured() is false", async () => {
    process.env.LLM_PROVIDER_ORDER = "gemini";
    const [status] = await describeProviderConfiguration();
    expect(status.configured).toBe(false);
    expect(status.reason).toBe("required env vars are missing");
  });

  it("reports a configured-but-unhealthy provider's specific health reason", async () => {
    mockGemini.isConfigured.mockReturnValue(true);
    mockGemini.healthCheck.mockResolvedValue("RATE_LIMITED");
    process.env.LLM_PROVIDER_ORDER = "gemini";
    const [status] = await describeProviderConfiguration();
    expect(status.configured).toBe(true);
    expect(status.reason).toBe("configured but currently rate_limited");
  });

  it("reports 'required env vars are set' for a configured and healthy provider", async () => {
    mockGemini.isConfigured.mockReturnValue(true);
    mockGemini.healthCheck.mockResolvedValue("HEALTHY");
    process.env.LLM_PROVIDER_ORDER = "gemini";
    const [status] = await describeProviderConfiguration();
    expect(status.reason).toBe("required env vars are set");
    expect(status.health).toBe("HEALTHY");
  });
});

describe("getConfiguredProviders — fallback-order filtering", () => {
  it("returns an empty array when nothing is configured", async () => {
    expect(await getConfiguredProviders()).toEqual([]);
  });

  it("filters to only configured AND healthy providers, in fallback order — unavailable model / unhealthy provider excluded", async () => {
    mockGemini.isConfigured.mockReturnValue(true);
    mockGemini.healthCheck.mockResolvedValue("HEALTHY");
    mockOpenAi.isConfigured.mockReturnValue(true);
    mockOpenAi.healthCheck.mockResolvedValue("HEALTHY");
    // Ollama is configured but currently unhealthy — must be excluded, not just deprioritized.
    mockOllama.isConfigured.mockReturnValue(true);
    mockOllama.healthCheck.mockResolvedValue("UNAVAILABLE");

    const providers = await getConfiguredProviders();
    expect(providers.map((p) => p.name)).toEqual(["gemini", "openai"]);
  });

  it("excludes a configured provider that's currently cache-unhealthy — fallback behavior", async () => {
    mockAnthropic.isConfigured.mockReturnValue(true);
    mockAnthropic.healthCheck.mockResolvedValue("QUOTA_EXCEEDED");
    expect(await getConfiguredProviders()).toEqual([]);
  });

  it("respects LLM_PROVIDER_ORDER for the returned order — configuration validation", async () => {
    process.env.LLM_PROVIDER_ORDER = "openai,gemini";
    mockOpenAi.isConfigured.mockReturnValue(true);
    mockOpenAi.healthCheck.mockResolvedValue("HEALTHY");
    mockGemini.isConfigured.mockReturnValue(true);
    mockGemini.healthCheck.mockResolvedValue("HEALTHY");

    const providers = await getConfiguredProviders();
    expect(providers.map((p) => p.name)).toEqual(["openai", "gemini"]);
  });

  it("silently drops an unrecognized LLM_PROVIDER_ORDER name rather than throwing — invalid provider doesn't break selection", async () => {
    process.env.LLM_PROVIDER_ORDER = "gemini,not-a-real-provider";
    mockGemini.isConfigured.mockReturnValue(true);
    mockGemini.healthCheck.mockResolvedValue("HEALTHY");

    const providers = await getConfiguredProviders();
    expect(providers.map((p) => p.name)).toEqual(["gemini"]);
  });
});
