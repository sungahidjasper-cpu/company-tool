import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();
vi.mock("openai", () => {
  class MockAPIError extends Error {
    status?: number;
    constructor(message?: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  class MockAPIConnectionError extends MockAPIError {}
  class MockAPIConnectionTimeoutError extends MockAPIConnectionError {}
  class MockRateLimitError extends MockAPIError {
    code?: string;
    constructor(message?: string, code?: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    default: vi.fn().mockImplementation(function MockOpenAI() {
      return { chat: { completions: { create: mockCreate } } };
    }),
    APIError: MockAPIError,
    APIConnectionError: MockAPIConnectionError,
    APIConnectionTimeoutError: MockAPIConnectionTimeoutError,
    RateLimitError: MockRateLimitError,
  };
});

import { APIError, RateLimitError } from "openai";
import { classifyError, openrouterProvider } from "@/lib/ai/providers/openrouter.provider";

// After vi.mock, these imported bindings ARE the mock classes from the
// factory above — real instances exercise classifyError with the exact
// shape (status/code + message, Error subclass) the real SDK classes have.
const MockAPIError = APIError as unknown as new (message?: string, status?: number) => Error & { status?: number };
const MockRateLimitError = RateLimitError as unknown as new (message?: string, code?: string) => Error & { code?: string };

describe("openrouter.provider classifyError", () => {
  it.each([
    [401, "irrelevant message", "AUTHENTICATION_ERROR"],
    [403, "irrelevant message", "AUTHENTICATION_ERROR"],
    [404, "model not found", "MODEL_UNAVAILABLE"],
    [400, "missing required field", "INVALID_REQUEST"],
    [422, "missing required field", "INVALID_REQUEST"],
    [503, "service unavailable", "SERVICE_UNAVAILABLE"],
    [418, "teapot", "UNKNOWN"],
  ] as const)("maps status %s (%s) to %s", (status, message, expected) => {
    expect(classifyError(new MockAPIError(message, status)).type).toBe(expected);
  });

  /**
   * Confirmed live against storagemoguls.com's actual Website Analysis run:
   * OpenRouter returns a plain (non-RateLimitError) APIError with status 402
   * and a "requires more credits" message when the account balance can't
   * cover the request. Before this fix, 402 fell through every status
   * branch to UNKNOWN — a real, actionable "add credits" failure was
   * reported as an unclassified error, and masked with the generic "AI
   * analysis failed" UI message instead of "AI provider is out of credits."
   */
  it("maps a 402 (OpenRouter's documented insufficient-credits status) to INSUFFICIENT_CREDITS, not UNKNOWN", () => {
    expect(
      classifyError(
        new MockAPIError(
          "This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens, but can only afford 2571.",
          402
        )
      ).type
    ).toBe("INSUFFICIENT_CREDITS");
  });

  it("overrides a plain 400 to INSUFFICIENT_CREDITS when the message matches the credit pattern", () => {
    expect(classifyError(new MockAPIError("billing account is closed", 400)).type).toBe("INSUFFICIENT_CREDITS");
  });

  it("classifies a RateLimitError with an insufficient_quota code as INSUFFICIENT_CREDITS instead of RATE_LIMIT", () => {
    expect(classifyError(new MockRateLimitError("you have exceeded your quota", "insufficient_quota")).type).toBe(
      "INSUFFICIENT_CREDITS"
    );
  });

  it("classifies an ordinary RateLimitError with no credit signal as RATE_LIMIT", () => {
    expect(classifyError(new MockRateLimitError("too many requests", "rate_limited")).type).toBe("RATE_LIMIT");
  });
});

/** OpenRouter proxies the OpenAI SDK's chat-completions shape exactly, including its streamed-delta format. */
async function* chunksOf(...chunks: unknown[]) {
  for (const chunk of chunks) yield chunk;
}

describe("openrouter.provider generateRawStreaming", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.OPENROUTER_MODEL = "test/model";
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  });

  it("accumulates delta chunks, forwards each running total via onChunk, and reads usage from the final usage-only chunk", async () => {
    mockCreate.mockResolvedValue(
      chunksOf(
        { choices: [{ delta: { content: '{"value":' } }] },
        { choices: [{ delta: { content: '"ok"}' } }] },
        { choices: [], usage: { prompt_tokens: 8, completion_tokens: 4 } }
      )
    );

    const onChunk = vi.fn();
    const result = await openrouterProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, onChunk);

    expect(onChunk.mock.calls.map((call) => call[0])).toEqual(['{"value":', '{"value":"ok"}']);
    expect(result.data).toEqual({ value: "ok" });
    expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 4 });
  });

  it("throws UNKNOWN when the stream never produces any content", async () => {
    mockCreate.mockResolvedValue(chunksOf({ choices: [], usage: { prompt_tokens: 2, completion_tokens: 0 } }));

    await expect(openrouterProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, vi.fn())).rejects.toMatchObject({
      type: "UNKNOWN",
    });
  });

  it("throws UNKNOWN when the accumulated content isn't valid JSON (retried up to MAX_PARSE_ATTEMPTS, still fails every time)", async () => {
    mockCreate.mockImplementation(() => Promise.resolve(chunksOf({ choices: [{ delta: { content: "not json" } }] })));

    await expect(openrouterProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, vi.fn())).rejects.toMatchObject({
      type: "UNKNOWN",
    });
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("mid-stream failure: forwards the chunks received before the failure, then rejects instead of returning a partial result", async () => {
    async function* failsPartway() {
      yield { choices: [{ delta: { content: '{"partial":' } }] };
      throw new Error("connection dropped mid-stream");
    }
    mockCreate.mockResolvedValue(failsPartway());

    const onChunk = vi.fn();
    await expect(openrouterProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, onChunk)).rejects.toThrow();
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('{"partial":');
  });

  it("classifies a thrown SDK error the same way generateRaw already does", async () => {
    mockCreate.mockRejectedValue(new Error("network down"));
    await expect(openrouterProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, vi.fn())).rejects.toMatchObject({
      provider: "openrouter",
    });
  });
});
