import { z } from "zod/v4";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/providers/registry", () => ({
  getConfiguredProviders: vi.fn(),
  describeProviderConfiguration: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { aiUsageLog: { create: vi.fn() } } }));

import { getConfiguredProviders, describeProviderConfiguration } from "@/lib/ai/providers/registry";
import { generateStructuredOutput } from "@/lib/ai/structured-output";

const mockGetConfigured = vi.mocked(getConfiguredProviders);
const mockDescribe = vi.mocked(describeProviderConfiguration);

const schema = z.object({ value: z.string() });
const input = { prompt: "test prompt", taskType: "EXTRACTION" as const, promptVersion: 1 };

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
