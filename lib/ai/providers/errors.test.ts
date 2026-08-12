import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { describeLlmError, isFallbackWorthy, LlmProviderError, type LlmErrorType } from "@/lib/ai/providers/errors";
import { classifyError } from "@/lib/ai/providers/anthropic.provider";

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
