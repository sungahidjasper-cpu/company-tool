import { z } from "zod/v4";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/providers/registry", () => ({
  getConfiguredProviders: vi.fn(),
  describeProviderConfiguration: vi.fn(),
}));
vi.mock("@/lib/ai/providers/health-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/providers/health-cache")>();
  return {
    ...actual,
    recordProviderFailure: vi.fn(),
    recordProviderSuccess: vi.fn(),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: { aiUsageLog: { create: vi.fn() } } }));
// Phase 19 — a no-op mock for every test in this file except the dedicated
// "company AI limits" describe block below, which overrides this per-test
// to exercise the actual integration point. ai-limit.service.ts's own
// internal logic (the budget query, the rate-limit window) is unit-tested
// separately in ai-limit.service.test.ts, not re-tested here.
vi.mock("@/lib/ai/ai-limit.service", () => ({
  enforceCompanyAiLimits: vi.fn().mockResolvedValue(undefined),
  getCurrentPeriodSpendUsd: vi.fn(),
}));

import { getConfiguredProviders, describeProviderConfiguration } from "@/lib/ai/providers/registry";
import { recordProviderFailure, recordProviderSuccess } from "@/lib/ai/providers/health-cache";
import { enforceCompanyAiLimits } from "@/lib/ai/ai-limit.service";
import { LlmProviderError } from "@/lib/ai/providers/errors";
import { generateStructuredOutput } from "@/lib/ai/structured-output";
import { prisma } from "@/lib/prisma";

const mockGetConfigured = vi.mocked(getConfiguredProviders);
const mockDescribe = vi.mocked(describeProviderConfiguration);
const mockRecordFailure = vi.mocked(recordProviderFailure);
const mockRecordSuccess = vi.mocked(recordProviderSuccess);
const mockCreateLog = vi.mocked(prisma.aiUsageLog.create);
const mockEnforceLimits = vi.mocked(enforceCompanyAiLimits);

const schema = z.object({ value: z.string() });
const input = { prompt: "test prompt", taskType: "EXTRACTION" as const, promptVersion: 1, companyId: "company-1" };

/** Minimal LlmProvider fake — just enough for generateStructuredOutput's orchestration logic, not a real network call. */
function makeFakeProvider(name: string, generateRaw: ReturnType<typeof vi.fn>) {
  return {
    name,
    isConfigured: () => true,
    generateRaw,
    healthCheck: async () => "HEALTHY" as const,
    supportsJson: () => true,
    maxContext: () => 1_000_000,
    cost: () => 0.001,
  };
}

const SUCCESS_RESULT = { data: { value: "ok" }, usage: { promptTokens: 10, completionTokens: 5 }, model: "test-model", retried: false };

/**
 * Regression coverage for a real bug caught by live verification: once the
 * health cache marks the only configured provider unhealthy from a genuine
 * quota failure, getConfiguredProviders() correctly returns an empty list —
 * but the code used to always throw the generic NOT_CONFIGURED error for
 * an empty list, even though a provider IS configured (just temporarily
 * skipped). That produced the wrong user-facing banner ("No AI providers
 * are configured" — implying a setup problem) instead of the correct one
 * ("AI provider is out of credits" — a transient availability problem).
 */
describe("generateStructuredOutput — empty-provider-list error classification", () => {
  it("throws NOT_CONFIGURED when genuinely nothing is configured", async () => {
    mockGetConfigured.mockResolvedValue([]);
    mockDescribe.mockResolvedValue([
      { name: "gemini", configured: false, reason: "required env vars are missing", health: "DISABLED" },
    ]);

    await expect(generateStructuredOutput(schema, input)).rejects.toMatchObject({ type: "NOT_CONFIGURED" });
  });

  it("throws INSUFFICIENT_CREDITS (not NOT_CONFIGURED) when the only configured provider is cache-unhealthy from a quota failure", async () => {
    mockGetConfigured.mockResolvedValue([]);
    mockDescribe.mockResolvedValue([
      { name: "gemini", configured: true, reason: "configured but currently quota_exceeded", health: "QUOTA_EXCEEDED" },
    ]);

    await expect(generateStructuredOutput(schema, input)).rejects.toMatchObject({ type: "INSUFFICIENT_CREDITS", provider: "gemini" });
  });

  it("throws RATE_LIMIT when the only configured provider is cache-unhealthy from rate limiting", async () => {
    mockGetConfigured.mockResolvedValue([]);
    mockDescribe.mockResolvedValue([
      { name: "gemini", configured: true, reason: "configured but currently rate_limited", health: "RATE_LIMITED" },
    ]);

    await expect(generateStructuredOutput(schema, input)).rejects.toMatchObject({ type: "RATE_LIMIT" });
  });

  it("throws AUTHENTICATION_ERROR when the only configured provider is cache-unhealthy from a bad key", async () => {
    mockGetConfigured.mockResolvedValue([]);
    mockDescribe.mockResolvedValue([
      { name: "gemini", configured: true, reason: "configured but currently authentication_error", health: "AUTHENTICATION_ERROR" },
    ]);

    await expect(generateStructuredOutput(schema, input)).rejects.toMatchObject({ type: "AUTHENTICATION_ERROR" });
  });

  it("prefers a configured-but-unhealthy provider's reason over NOT_CONFIGURED even when other providers are simply unconfigured", async () => {
    mockGetConfigured.mockResolvedValue([]);
    mockDescribe.mockResolvedValue([
      { name: "gemini", configured: true, reason: "configured but currently quota_exceeded", health: "QUOTA_EXCEEDED" },
      { name: "ollama", configured: false, reason: "required env vars are missing", health: "DISABLED" },
    ]);

    await expect(generateStructuredOutput(schema, input)).rejects.toMatchObject({ type: "INSUFFICIENT_CREDITS" });
  });
});

/**
 * Phase 17 — same-provider retry-with-backoff for RATE_LIMIT/TIMEOUT/
 * SERVICE_UNAVAILABLE, added ahead of the existing cross-provider fallback.
 * Fake timers avoid these tests actually waiting out the real backoff delay.
 */
describe("generateStructuredOutput — Phase 17 transient-error retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCreateLog.mockClear();
    mockRecordFailure.mockClear();
    mockRecordSuccess.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a RATE_LIMIT failure once and succeeds — logs one row with retried: true, never marks the provider unhealthy", async () => {
    const generateRaw = vi
      .fn()
      .mockRejectedValueOnce(new LlmProviderError("rate limited", "RATE_LIMIT", "A"))
      .mockResolvedValue(SUCCESS_RESULT);
    mockGetConfigured.mockResolvedValue([makeFakeProvider("A", generateRaw)] as never);

    const promise = generateStructuredOutput(schema, input);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ value: "ok" });
    expect(generateRaw).toHaveBeenCalledTimes(2);
    expect(mockCreateLog).toHaveBeenCalledTimes(1);
    expect(mockCreateLog).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ succeeded: true, retried: true }) }));
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(mockRecordSuccess).toHaveBeenCalledWith("A");
  });

  it("retries TIMEOUT the same way as RATE_LIMIT/SERVICE_UNAVAILABLE", async () => {
    const generateRaw = vi
      .fn()
      .mockRejectedValueOnce(new LlmProviderError("timed out", "TIMEOUT", "A"))
      .mockResolvedValue(SUCCESS_RESULT);
    mockGetConfigured.mockResolvedValue([makeFakeProvider("A", generateRaw)] as never);

    const promise = generateStructuredOutput(schema, input);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ value: "ok" });
    expect(generateRaw).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries on sustained SERVICE_UNAVAILABLE, then falls back to the next provider — marks the failed provider unhealthy exactly once, not once per attempt", async () => {
    const generateRawA = vi.fn().mockRejectedValue(new LlmProviderError("overloaded", "SERVICE_UNAVAILABLE", "A"));
    const generateRawB = vi.fn().mockResolvedValue(SUCCESS_RESULT);
    mockGetConfigured.mockResolvedValue([makeFakeProvider("A", generateRawA), makeFakeProvider("B", generateRawB)] as never);

    const promise = generateStructuredOutput(schema, input);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ value: "ok" });
    // maxAttempts = 2 for the transient retry — A is tried twice, not more, before falling back.
    expect(generateRawA).toHaveBeenCalledTimes(2);
    expect(generateRawB).toHaveBeenCalledTimes(1);
    expect(mockRecordFailure).toHaveBeenCalledTimes(1);
    expect(mockRecordFailure).toHaveBeenCalledWith("A", "SERVICE_UNAVAILABLE");
    expect(mockCreateLog).toHaveBeenCalledTimes(2);
    expect(mockCreateLog).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ succeeded: false, retried: true, errorType: "SERVICE_UNAVAILABLE" }) }));
    expect(mockCreateLog).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ succeeded: true, retried: false }) }));
  });

  it("never retries AUTHENTICATION_ERROR — falls back to the next provider after exactly one attempt", async () => {
    const generateRawA = vi.fn().mockRejectedValue(new LlmProviderError("bad key", "AUTHENTICATION_ERROR", "A"));
    const generateRawB = vi.fn().mockResolvedValue(SUCCESS_RESULT);
    mockGetConfigured.mockResolvedValue([makeFakeProvider("A", generateRawA), makeFakeProvider("B", generateRawB)] as never);

    const result = await generateStructuredOutput(schema, input);

    expect(result).toEqual({ value: "ok" });
    expect(generateRawA).toHaveBeenCalledTimes(1);
    expect(mockCreateLog).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ retried: false, errorType: "AUTHENTICATION_ERROR" }) }));
    expect(mockRecordFailure).toHaveBeenCalledWith("A", "AUTHENTICATION_ERROR");
  });

  it("never retries MODEL_UNAVAILABLE on the same provider, but DOES fall back to the next configured provider — a bad model on A says nothing about B", async () => {
    const generateRawA = vi.fn().mockRejectedValue(new LlmProviderError("model not found", "MODEL_UNAVAILABLE", "A"));
    const generateRawB = vi.fn().mockResolvedValue(SUCCESS_RESULT);
    mockGetConfigured.mockResolvedValue([makeFakeProvider("A", generateRawA), makeFakeProvider("B", generateRawB)] as never);

    const result = await generateStructuredOutput(schema, input);

    expect(result).toEqual({ value: "ok" });
    expect(generateRawA).toHaveBeenCalledTimes(1);
    expect(mockCreateLog).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ retried: false, errorType: "MODEL_UNAVAILABLE" }) }));
    expect(mockRecordFailure).toHaveBeenCalledWith("A", "MODEL_UNAVAILABLE");
  });

  it("never retries INSUFFICIENT_CREDITS or UNKNOWN either", async () => {
    for (const errorType of ["INSUFFICIENT_CREDITS", "UNKNOWN"] as const) {
      const generateRaw = vi.fn().mockRejectedValue(new LlmProviderError("nope", errorType, "A"));
      mockGetConfigured.mockResolvedValue([makeFakeProvider("A", generateRaw)] as never);

      await expect(generateStructuredOutput(schema, input)).rejects.toMatchObject({ type: errorType });
      expect(generateRaw).toHaveBeenCalledTimes(1);
    }
  });

  it("stops immediately on INVALID_REQUEST — never retries, never falls back to another provider", async () => {
    const generateRawA = vi.fn().mockRejectedValue(new LlmProviderError("malformed", "INVALID_REQUEST", "A"));
    const generateRawB = vi.fn().mockResolvedValue(SUCCESS_RESULT);
    mockGetConfigured.mockResolvedValue([makeFakeProvider("A", generateRawA), makeFakeProvider("B", generateRawB)] as never);

    await expect(generateStructuredOutput(schema, input)).rejects.toMatchObject({ type: "INVALID_REQUEST" });
    expect(generateRawA).toHaveBeenCalledTimes(1);
    expect(generateRawB).not.toHaveBeenCalled();
  });

  it("a schema-validation failure (provider responded, but the JSON didn't match) is not treated as a transient-retryable error at this layer", async () => {
    const generateRaw = vi.fn().mockResolvedValue({ data: { wrongField: 123 }, usage: { promptTokens: 10, completionTokens: 5 }, model: "test-model", retried: false });
    mockGetConfigured.mockResolvedValue([makeFakeProvider("A", generateRaw)] as never);

    await expect(generateStructuredOutput(schema, input)).rejects.toMatchObject({ type: "UNKNOWN" });
    // Schema-validation failure doesn't throw from generateRaw, so the new retry wrapper never even sees it as a rejection — exactly one call, matching pre-Phase-17 behavior.
    expect(generateRaw).toHaveBeenCalledTimes(1);
  });
});

/**
 * Phase 19 — enforceCompanyAiLimits is called before anything else in
 * generateStructuredOutput. This block tests only the INTEGRATION point
 * (that a rejection from the gate short-circuits the whole function before
 * any provider is even looked up, and that a resolved gate is a true
 * no-op) — ai-limit.service.ts's own internal logic (the budget query, the
 * rate-limit window) is unit-tested in ai-limit.service.test.ts.
 */
describe("generateStructuredOutput — company AI limits gate", () => {
  beforeEach(() => {
    mockGetConfigured.mockClear();
    mockCreateLog.mockClear();
  });

  it("proceeds normally when the gate resolves (no limits configured)", async () => {
    mockEnforceLimits.mockResolvedValueOnce(undefined);
    const generateRaw = vi.fn().mockResolvedValue(SUCCESS_RESULT);
    mockGetConfigured.mockResolvedValue([makeFakeProvider("A", generateRaw)] as never);

    const result = await generateStructuredOutput(schema, input);

    expect(result).toEqual({ value: "ok" });
    expect(mockEnforceLimits).toHaveBeenCalledWith("company-1", "EXTRACTION");
  });

  it("rejects with BUDGET_EXCEEDED before ever looking up a configured provider", async () => {
    mockEnforceLimits.mockRejectedValueOnce(new LlmProviderError("budget exceeded", "BUDGET_EXCEEDED", "none"));

    await expect(generateStructuredOutput(schema, input)).rejects.toMatchObject({ type: "BUDGET_EXCEEDED" });
    expect(mockGetConfigured).not.toHaveBeenCalled();
    expect(mockCreateLog).not.toHaveBeenCalled();
  });

  it("rejects with COMPANY_RATE_LIMITED before ever looking up a configured provider", async () => {
    mockEnforceLimits.mockRejectedValueOnce(new LlmProviderError("rate limited", "COMPANY_RATE_LIMITED", "none"));

    await expect(generateStructuredOutput(schema, input)).rejects.toMatchObject({ type: "COMPANY_RATE_LIMITED" });
    expect(mockGetConfigured).not.toHaveBeenCalled();
    expect(mockCreateLog).not.toHaveBeenCalled();
  });
});
