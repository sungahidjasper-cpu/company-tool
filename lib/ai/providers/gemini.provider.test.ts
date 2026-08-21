import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerateContentStream = vi.fn();
vi.mock("@google/genai", () => {
  class MockApiError extends Error {
    status: number;
    constructor({ message, status }: { message: string; status: number }) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError: MockApiError,
    GoogleGenAI: vi.fn().mockImplementation(function MockGoogleGenAI() {
      return { models: { generateContentStream: mockGenerateContentStream } };
    }),
  };
});

import { ApiError } from "@google/genai";
import { classifyApiError, geminiProvider } from "@/lib/ai/providers/gemini.provider";

// After vi.mock, this imported binding IS the mock class from the factory
// above — real instances of it exercise classifyApiError with the exact
// shape (status + message, Error subclass) the real SDK class has.
const MockApiError = ApiError as unknown as new (info: { message: string; status: number }) => Error & { status: number };

describe("gemini.provider classifyApiError", () => {
  it.each([
    [401, "irrelevant message", "AUTHENTICATION_ERROR"],
    [403, "irrelevant message", "AUTHENTICATION_ERROR"],
    [429, "you have exceeded your rate limit", "RATE_LIMIT"],
    [404, "model not found", "MODEL_UNAVAILABLE"],
    [503, "service unavailable", "SERVICE_UNAVAILABLE"],
    [418, "teapot", "UNKNOWN"],
  ] as const)("maps status %s (%s) to %s", (status, message, expected) => {
    expect(classifyApiError(new MockApiError({ message, status }) as never).type).toBe(expected);
  });

  it("classifies a 429 whose message matches the credit/quota pattern as INSUFFICIENT_CREDITS instead of RATE_LIMIT — Gemini uses the same status for both", () => {
    expect(classifyApiError(new MockApiError({ message: "You have exceeded your quota", status: 429 }) as never).type).toBe(
      "INSUFFICIENT_CREDITS"
    );
  });

  it("overrides a plain 400 to INSUFFICIENT_CREDITS when the message matches the credit pattern", () => {
    expect(classifyApiError(new MockApiError({ message: "billing account is closed", status: 400 }) as never).type).toBe(
      "INSUFFICIENT_CREDITS"
    );
  });

  it("overrides a plain 400 to AUTHENTICATION_ERROR when the message is the live-verified invalid-API-key shape (confirmed: Gemini 400s, not 401s, for a bad key)", () => {
    expect(
      classifyApiError(new MockApiError({ message: "API key not valid. Please pass a valid API key.", status: 400 }) as never).type
    ).toBe("AUTHENTICATION_ERROR");
  });

  it("classifies an ordinary 400 with no special message pattern as INVALID_REQUEST", () => {
    expect(classifyApiError(new MockApiError({ message: "missing required field", status: 400 }) as never).type).toBe(
      "INVALID_REQUEST"
    );
  });
});

/** Mirrors the real SDK's streamed-chunk shape: each chunk carries only its own delta in `.text`, plus an optional `.usageMetadata`. */
async function* chunksOf(...chunks: unknown[]) {
  for (const chunk of chunks) yield chunk;
}

describe("gemini.provider generateRawStreaming", () => {
  beforeEach(() => {
    mockGenerateContentStream.mockReset();
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-test";
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  it("accumulates delta chunks, forwards each running total via onChunk, and reads usage from the chunk carrying usageMetadata", async () => {
    mockGenerateContentStream.mockResolvedValue(
      chunksOf(
        { text: '{"value":' },
        { text: '"ok"}', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }
      )
    );

    const onChunk = vi.fn();
    const result = await geminiProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, onChunk);

    expect(onChunk.mock.calls.map((call) => call[0])).toEqual(['{"value":', '{"value":"ok"}']);
    expect(result.data).toEqual({ value: "ok" });
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it("throws UNKNOWN when the stream produces chunks with no text content at all", async () => {
    mockGenerateContentStream.mockResolvedValue(chunksOf({ usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 0 } }));

    await expect(geminiProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, vi.fn())).rejects.toMatchObject({
      type: "UNKNOWN",
    });
  });

  it("throws UNKNOWN when the accumulated content isn't valid JSON (retried up to MAX_PARSE_ATTEMPTS, still fails every time)", async () => {
    // mockImplementation (not mockResolvedValue) gives each retry attempt its own
    // fresh generator instead of replaying an already-exhausted one.
    mockGenerateContentStream.mockImplementation(() => Promise.resolve(chunksOf({ text: "not json" })));

    await expect(geminiProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, vi.fn())).rejects.toMatchObject({
      type: "UNKNOWN",
    });
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(3);
  });

  it("mid-stream failure: forwards the chunks received before the failure, then rejects instead of returning a partial result", async () => {
    async function* failsPartway() {
      yield { text: '{"partial":' };
      throw new Error("connection dropped mid-stream");
    }
    mockGenerateContentStream.mockResolvedValue(failsPartway());

    const onChunk = vi.fn();
    await expect(geminiProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, onChunk)).rejects.toThrow();
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('{"partial":');
  });

  it("classifies a rejected ApiError the same way generateRaw would — error-classification parity between the streaming and non-streaming paths", async () => {
    async function* failsWithApiError() {
      yield { text: '{"partial":' };
      throw new MockApiError({ message: "API key not valid. Please pass a valid API key.", status: 400 });
    }
    mockGenerateContentStream.mockResolvedValue(failsWithApiError());

    await expect(geminiProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, vi.fn())).rejects.toMatchObject({
      provider: "gemini",
      type: "AUTHENTICATION_ERROR",
    });
  });

  it("classifies an AbortError (the REQUEST_TIMEOUT_MS abort-signal path) as TIMEOUT", async () => {
    async function* failsWithAbort() {
      yield { text: '{"partial":' };
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      throw error;
    }
    mockGenerateContentStream.mockResolvedValue(failsWithAbort());

    await expect(geminiProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, vi.fn())).rejects.toMatchObject({
      provider: "gemini",
      type: "TIMEOUT",
    });
  });
});
