import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockChat = vi.fn();
vi.mock("ollama", () => ({
  // A regular function, not an arrow function — the real Ollama SDK client is
  // constructed with `new`, and arrow functions can't be invoked that way.
  Ollama: vi.fn().mockImplementation(function MockOllama() {
    return { chat: mockChat };
  }),
}));

import { LlmProviderError } from "@/lib/ai/providers/errors";
import { classifyError, ollamaProvider } from "@/lib/ai/providers/ollama.provider";

/** Ollama-js doesn't export its ResponseError class from the package root, so classifyError identifies it structurally — matched here the same way. */
function responseError(message: string, statusCode: number): Error & { status_code: number } {
  const error = new Error(message) as Error & { status_code: number };
  error.name = "ResponseError";
  error.status_code = statusCode;
  return error;
}

/** Ollama not running at all throws a plain fetch failure wrapping an ECONNREFUSED cause, not a ResponseError. */
function connectionRefused(): TypeError {
  const error = new TypeError("fetch failed");
  (error as unknown as { cause: { code: string } }).cause = { code: "ECONNREFUSED" };
  return error;
}

describe("ollama.provider classifyError", () => {
  it("classifies a structural ResponseError with status 404 as MODEL_UNAVAILABLE — OLLAMA_MODEL not pulled locally", () => {
    const error = responseError('model "llama3" not found, try pulling it first', 404);
    expect(classifyError(error).type).toBe("MODEL_UNAVAILABLE");
  });

  it("classifies a structural ResponseError with a 5xx status as SERVICE_UNAVAILABLE", () => {
    expect(classifyError(responseError("internal server error", 500)).type).toBe("SERVICE_UNAVAILABLE");
  });

  it("classifies a structural ResponseError with a generic 4xx (not 404) as INVALID_REQUEST", () => {
    expect(classifyError(responseError("invalid request", 400)).type).toBe("INVALID_REQUEST");
  });

  it("classifies a plain fetch-failed/ECONNREFUSED error as SERVICE_UNAVAILABLE — Ollama offline", () => {
    expect(classifyError(connectionRefused()).type).toBe("SERVICE_UNAVAILABLE");
  });

  it("classifies an AbortError (the raceTimeout timeout path) as TIMEOUT", () => {
    const error = new Error("timed out");
    error.name = "AbortError";
    expect(classifyError(error).type).toBe("TIMEOUT");
  });

  it("passes through an already-classified LlmProviderError unchanged", () => {
    const original = new LlmProviderError("already classified", "RATE_LIMIT", "ollama");
    expect(classifyError(original)).toBe(original);
  });

  it("falls back to UNKNOWN for a completely unrecognized error shape", () => {
    expect(classifyError(new Error("something else entirely")).type).toBe("UNKNOWN");
  });
});

describe("ollama.provider generateRaw — usage-field shape", () => {
  beforeEach(() => {
    mockChat.mockReset();
    process.env.OLLAMA_HOST = "http://localhost:11434";
    process.env.OLLAMA_MODEL = "llama3";
  });

  afterEach(() => {
    delete process.env.OLLAMA_HOST;
    delete process.env.OLLAMA_MODEL;
  });

  it("reads usage from the response root (prompt_eval_count/eval_count) — not nested under `usage` like every other provider", async () => {
    mockChat.mockResolvedValue({
      message: { content: JSON.stringify({ value: "ok" }) },
      prompt_eval_count: 12,
      eval_count: 34,
    });

    const result = await ollamaProvider.generateRaw({ prompt: "test", jsonSchema: {} } as never);
    expect(result.data).toEqual({ value: "ok" });
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 34 });
  });
});
