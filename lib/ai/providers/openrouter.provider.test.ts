import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();
vi.mock("openai", () => {
  class MockAPIError extends Error {}
  class MockAPIConnectionError extends MockAPIError {}
  class MockAPIConnectionTimeoutError extends MockAPIConnectionError {}
  class MockRateLimitError extends MockAPIError {}
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

import { openrouterProvider } from "@/lib/ai/providers/openrouter.provider";

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
