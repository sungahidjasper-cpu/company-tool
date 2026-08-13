import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { ApiError } from "@google/genai";
import {
  APIConnectionError as OpenAiAPIConnectionError,
  APIConnectionTimeoutError as OpenAiAPIConnectionTimeoutError,
  APIError as OpenAiAPIError,
  RateLimitError as OpenAiRateLimitError,
} from "openai";
import { describe, expect, it } from "vitest";

import { describeLlmError, isFallbackWorthy, isRetryableTransient, LlmProviderError, type LlmErrorType } from "@/lib/ai/providers/errors";
import { classifyError } from "@/lib/ai/providers/anthropic.provider";
import { classifyApiError } from "@/lib/ai/providers/gemini.provider";
import { classifyError as classifyOpenAiError } from "@/lib/ai/providers/openai.provider";
import { classifyError as classifyOpenRouterError } from "@/lib/ai/providers/openrouter.provider";

describe("isFallbackWorthy", () => {
  it("treats availability-class errors as fallback-worthy", () => {
    const fallbackWorthy: LlmErrorType[] = ["AUTHENTICATION_ERROR", "INSUFFICIENT_CREDITS", "RATE_LIMIT", "TIMEOUT", "SERVICE_UNAVAILABLE", "UNKNOWN"];
    for (const type of fallbackWorthy) expect(isFallbackWorthy(type)).toBe(true);
  });

  it("never falls back on INVALID_REQUEST — every provider would fail the same way", () => {
    expect(isFallbackWorthy("INVALID_REQUEST")).toBe(false);
  });

  it("never falls back on NOT_CONFIGURED — there's nothing left to try", () => {
    expect(isFallbackWorthy("NOT_CONFIGURED")).toBe(false);
  });
});

describe("isRetryableTransient", () => {
  it("only treats RATE_LIMIT, TIMEOUT, and SERVICE_UNAVAILABLE as retryable", () => {
    const retryable: LlmErrorType[] = ["RATE_LIMIT", "TIMEOUT", "SERVICE_UNAVAILABLE"];
    for (const type of retryable) expect(isRetryableTransient(type)).toBe(true);
  });

  it("never retries AUTHENTICATION_ERROR, INSUFFICIENT_CREDITS, INVALID_REQUEST, NOT_CONFIGURED, or UNKNOWN", () => {
    const nonRetryable: LlmErrorType[] = ["AUTHENTICATION_ERROR", "INSUFFICIENT_CREDITS", "INVALID_REQUEST", "NOT_CONFIGURED", "UNKNOWN"];
    for (const type of nonRetryable) expect(isRetryableTransient(type)).toBe(false);
  });

  it("is strictly narrower than isFallbackWorthy — everything retryable is also fallback-worthy", () => {
    const allTypes: LlmErrorType[] = [
      "AUTHENTICATION_ERROR",
      "INSUFFICIENT_CREDITS",
      "RATE_LIMIT",
      "TIMEOUT",
      "SERVICE_UNAVAILABLE",
      "INVALID_REQUEST",
      "NOT_CONFIGURED",
      "UNKNOWN",
    ];
    for (const type of allTypes) {
      if (isRetryableTransient(type)) expect(isFallbackWorthy(type)).toBe(true);
    }
  });
});

describe("describeLlmError", () => {
  it("returns a distinct, human-readable description for every error type", () => {
    const types: LlmErrorType[] = [
      "AUTHENTICATION_ERROR",
      "INSUFFICIENT_CREDITS",
      "RATE_LIMIT",
      "TIMEOUT",
      "SERVICE_UNAVAILABLE",
      "INVALID_REQUEST",
      "NOT_CONFIGURED",
      "UNKNOWN",
    ];
    const seen = new Set<string>();
    for (const type of types) {
      const description = describeLlmError(type);
      expect(description.title).toBeTruthy();
      expect(description.message).toBeTruthy();
      expect(description.recommendedAction).toBeTruthy();
      // No two error types should render identical UI text — that would make them indistinguishable to a user.
      expect(seen.has(description.title)).toBe(false);
      seen.add(description.title);
    }
  });

  it("never mentions raw JSON/SDK-shaped text in any description", () => {
    const types: LlmErrorType[] = ["AUTHENTICATION_ERROR", "INSUFFICIENT_CREDITS", "RATE_LIMIT", "TIMEOUT", "SERVICE_UNAVAILABLE", "INVALID_REQUEST", "NOT_CONFIGURED", "UNKNOWN"];
    for (const type of types) {
      const description = describeLlmError(type);
      const combined = `${description.title} ${description.message} ${description.recommendedAction}`;
      expect(combined).not.toMatch(/"type":|invalid_request_error|billing_error|APIError/);
    }
  });
});

/**
 * Regression coverage for a real bug caught by live verification: Anthropic's
 * documented error.type union includes billing_error for insufficient
 * credits, but a real over-the-limit account actually returns
 * invalid_request_error with the balance message in the text. classifyError
 * must catch that via message-text matching, not just the type field.
 */
describe("anthropic.provider classifyError", () => {
  it("classifies the real-world insufficient-credits response (invalid_request_error + balance message)", () => {
    // Matches Anthropic's actual response body shape — APIError.makeMessage()
    // stringifies this whole object into `.message` when it has no top-level
    // `.message` field of its own (confirmed by reading core/error.js), so
    // the mock must nest the text under error.error.message like the real
    // API does, not pass it as a flat string.
    const error = new APIError(
      400,
      { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } },
      undefined,
      undefined,
      "invalid_request_error"
    );
    const result = classifyError(error);
    expect(result.type).toBe("INSUFFICIENT_CREDITS");
  });

  it("still classifies a genuine invalid_request_error (no credit wording) as INVALID_REQUEST", () => {
    const error = new APIError(400, { type: "error", error: { type: "invalid_request_error", message: "model: field required" } }, undefined, undefined, "invalid_request_error");
    const result = classifyError(error);
    expect(result.type).toBe("INVALID_REQUEST");
  });

  it("classifies the documented billing_error type as INSUFFICIENT_CREDITS too", () => {
    const error = new APIError(400, { type: "error", error: { type: "billing_error", message: "Billing issue." } }, undefined, undefined, "billing_error");
    expect(classifyError(error).type).toBe("INSUFFICIENT_CREDITS");
  });

  it("classifies authentication_error as AUTHENTICATION_ERROR", () => {
    const error = new APIError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, undefined, undefined, "authentication_error");
    expect(classifyError(error).type).toBe("AUTHENTICATION_ERROR");
  });

  it("classifies rate_limit_error as RATE_LIMIT", () => {
    const error = new APIError(429, { type: "error", error: { type: "rate_limit_error", message: "rate limited" } }, undefined, undefined, "rate_limit_error");
    expect(classifyError(error).type).toBe("RATE_LIMIT");
  });

  it("classifies overloaded_error as SERVICE_UNAVAILABLE", () => {
    const error = new APIError(529, { type: "error", error: { type: "overloaded_error", message: "overloaded" } }, undefined, undefined, "overloaded_error");
    expect(classifyError(error).type).toBe("SERVICE_UNAVAILABLE");
  });

  it("classifies APIConnectionTimeoutError as TIMEOUT, checked before the base APIConnectionError", () => {
    const error = new APIConnectionTimeoutError();
    expect(classifyError(error).type).toBe("TIMEOUT");
  });

  it("classifies a plain APIConnectionError (not a timeout) as SERVICE_UNAVAILABLE", () => {
    const error = new APIConnectionError({ message: "connection failed" });
    expect(classifyError(error).type).toBe("SERVICE_UNAVAILABLE");
  });

  it("passes through an already-classified LlmProviderError unchanged", () => {
    const original = new LlmProviderError("already classified", "RATE_LIMIT", "anthropic");
    expect(classifyError(original)).toBe(original);
  });

  it("falls back to UNKNOWN for a completely unrecognized error shape", () => {
    expect(classifyError(new Error("something else entirely")).type).toBe("UNKNOWN");
  });
});

/**
 * Regression coverage for a real bug caught by live verification: an
 * invalid Gemini API key comes back as HTTP 400 (INVALID_ARGUMENT, reason
 * API_KEY_INVALID) rather than 401/403, so status-code-only classification
 * mislabels it INVALID_REQUEST — which wrongly excludes a genuine
 * credential problem from provider fallback (INVALID_REQUEST is
 * deliberately non-fallback-worthy).
 */
describe("gemini.provider classifyApiError", () => {
  it("classifies the real-world invalid-API-key response (400 + API_KEY_INVALID message) as AUTHENTICATION_ERROR, not INVALID_REQUEST", () => {
    const error = new ApiError({ status: 400, message: "API key not valid. Please pass a valid API key." });
    expect(classifyApiError(error).type).toBe("AUTHENTICATION_ERROR");
  });

  it("still classifies a genuine 400 (no auth/credit wording) as INVALID_REQUEST", () => {
    const error = new ApiError({ status: 400, message: "Invalid value for field 'temperature'." });
    expect(classifyApiError(error).type).toBe("INVALID_REQUEST");
  });

  it("classifies a real 401/403 as AUTHENTICATION_ERROR directly via status code", () => {
    expect(classifyApiError(new ApiError({ status: 401, message: "unauthorized" })).type).toBe("AUTHENTICATION_ERROR");
    expect(classifyApiError(new ApiError({ status: 403, message: "forbidden" })).type).toBe("AUTHENTICATION_ERROR");
  });

  it("classifies 429 with quota wording as INSUFFICIENT_CREDITS, otherwise RATE_LIMIT", () => {
    expect(classifyApiError(new ApiError({ status: 429, message: "quota exceeded" })).type).toBe("INSUFFICIENT_CREDITS");
    expect(classifyApiError(new ApiError({ status: 429, message: "too many requests" })).type).toBe("RATE_LIMIT");
  });

  it("classifies 503 as SERVICE_UNAVAILABLE", () => {
    expect(classifyApiError(new ApiError({ status: 503, message: "overloaded" })).type).toBe("SERVICE_UNAVAILABLE");
  });
});

/**
 * Phase 11C — OpenRouter reuses the `openai` SDK pointed at a different
 * base URL, so it raises the exact same error classes as the OpenAI
 * provider; both are tested against the same constructor shapes here.
 */
describe.each([
  ["openai.provider", classifyOpenAiError],
  ["openrouter.provider", classifyOpenRouterError],
])("%s classifyError", (_name, classify) => {
  it("classifies a quota-coded 429 as INSUFFICIENT_CREDITS", () => {
    const error = new OpenAiRateLimitError(
      429,
      { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" },
      undefined,
      new Headers()
    );
    expect(classify(error).type).toBe("INSUFFICIENT_CREDITS");
  });

  it("classifies a plain 429 (no quota code/wording) as RATE_LIMIT", () => {
    const error = new OpenAiRateLimitError(429, { message: "Rate limit reached", type: "requests", code: null }, undefined, new Headers());
    expect(classify(error).type).toBe("RATE_LIMIT");
  });

  it("classifies 401 as AUTHENTICATION_ERROR", () => {
    const error = new OpenAiAPIError(401, { message: "Invalid API key", type: "invalid_request_error" }, undefined, undefined);
    expect(classify(error).type).toBe("AUTHENTICATION_ERROR");
  });

  it("classifies a genuine 400 (no credit wording) as INVALID_REQUEST", () => {
    const error = new OpenAiAPIError(400, { message: "model: field required", type: "invalid_request_error" }, undefined, undefined);
    expect(classify(error).type).toBe("INVALID_REQUEST");
  });

  it("classifies a credit-balance-worded 400 as INSUFFICIENT_CREDITS via message text, not just status", () => {
    const error = new OpenAiAPIError(400, { message: "Your credit balance is too low", type: "invalid_request_error" }, undefined, undefined);
    expect(classify(error).type).toBe("INSUFFICIENT_CREDITS");
  });

  it("classifies a 5xx as SERVICE_UNAVAILABLE", () => {
    const error = new OpenAiAPIError(503, { message: "The server had an error", type: "server_error" }, undefined, undefined);
    expect(classify(error).type).toBe("SERVICE_UNAVAILABLE");
  });

  it("classifies APIConnectionTimeoutError as TIMEOUT, checked before the base APIConnectionError", () => {
    expect(classify(new OpenAiAPIConnectionTimeoutError()).type).toBe("TIMEOUT");
  });

  it("classifies a plain APIConnectionError (not a timeout) as SERVICE_UNAVAILABLE", () => {
    expect(classify(new OpenAiAPIConnectionError({ message: "connection failed" })).type).toBe("SERVICE_UNAVAILABLE");
  });

  it("falls back to UNKNOWN for a completely unrecognized error shape", () => {
    expect(classify(new Error("something else entirely")).type).toBe("UNKNOWN");
  });
});
