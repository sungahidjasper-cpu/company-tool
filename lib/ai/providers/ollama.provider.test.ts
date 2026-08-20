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

/** Mirrors ollama-js's real streamed-chunk shape: each chunk carries only its own delta in `message.content`; the final chunk has `done: true` plus the count-based usage stats. */
async function* chunksOf(...chunks: unknown[]) {
  for (const chunk of chunks) yield chunk;
}

describe("ollama.provider generateRawStreaming", () => {
  beforeEach(() => {
    mockChat.mockReset();
    process.env.OLLAMA_HOST = "http://localhost:11434";
    process.env.OLLAMA_MODEL = "llama3";
  });

  afterEach(() => {
    delete process.env.OLLAMA_HOST;
    delete process.env.OLLAMA_MODEL;
    vi.useRealTimers();
  });

  it("accumulates delta chunks, forwards each running total via onChunk, and reads usage from the final done chunk", async () => {
    mockChat.mockResolvedValue(
      chunksOf(
        { message: { content: '{"value":' }, done: false },
        { message: { content: '"ok"}' }, done: false },
        { message: { content: "" }, done: true, prompt_eval_count: 6, eval_count: 9 }
      )
    );

    const onChunk = vi.fn();
    const result = await ollamaProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, onChunk);

    expect(onChunk.mock.calls.map((call) => call[0])).toEqual(['{"value":', '{"value":"ok"}']);
    expect(result.data).toEqual({ value: "ok" });
    expect(result.usage).toEqual({ promptTokens: 6, completionTokens: 9 });
  });

  it("throws UNKNOWN when the stream never produces any content", async () => {
    mockChat.mockResolvedValue(chunksOf({ message: { content: "" }, done: true, prompt_eval_count: 1, eval_count: 0 }));

    await expect(ollamaProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, vi.fn())).rejects.toMatchObject({
      type: "UNKNOWN",
    });
  });

  it("throws UNKNOWN when the accumulated content isn't valid JSON (retried up to MAX_PARSE_ATTEMPTS, still fails every time)", async () => {
    mockChat.mockImplementation(() => Promise.resolve(chunksOf({ message: { content: "not json" }, done: true })));

    await expect(ollamaProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, vi.fn())).rejects.toMatchObject({
      type: "UNKNOWN",
    });
    expect(mockChat).toHaveBeenCalledTimes(3);
  });

  it("mid-stream failure: forwards the chunks received before the failure, then rejects instead of returning a partial result", async () => {
    async function* failsPartway() {
      yield { message: { content: '{"partial":' }, done: false };
      throw new Error("connection dropped mid-stream");
    }
    mockChat.mockResolvedValue(failsPartway());

    const onChunk = vi.fn();
    await expect(ollamaProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, onChunk)).rejects.toThrow();
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('{"partial":');
  });

  it("stops forwarding further chunks once this attempt has already timed out (the abandoned guard)", async () => {
    vi.useFakeTimers();
    let releaseSecondChunk: () => void = () => {};
    const secondChunkGate = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });

    async function* hangingChunks() {
      yield { message: { content: '{"a":1' }, done: false };
      await secondChunkGate;
      yield { message: { content: "}" }, done: true, prompt_eval_count: 1, eval_count: 1 };
    }
    mockChat.mockResolvedValue(hangingChunks());

    const onChunk = vi.fn();
    const promise = ollamaProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {} } as never, onChunk);
    // Attach a handler synchronously, in the same tick the promise is
    // created — the real assertion is the `rejects.toMatchObject` below;
    // this just stops Node from ever seeing an instant where no handler is
    // attached yet, which is otherwise flagged as a (harmless, timing-only)
    // "handled asynchronously" warning once the fake-timer advance below
    // causes the actual rejection.
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    expect(onChunk).toHaveBeenCalledTimes(1);

    // Advance past the internal request timeout — the outer race rejects
    // with an AbortError, which classifyError maps to TIMEOUT (not
    // retryable via the parse-failure predicate, so no further attempts).
    await vi.advanceTimersByTimeAsync(130_000);
    await expect(promise).rejects.toMatchObject({ type: "TIMEOUT" });

    // Now let the paused generator continue — its second chunk must be
    // suppressed by the `abandoned` guard, never reaching onChunk.
    releaseSecondChunk();
    await vi.advanceTimersByTimeAsync(0);
    expect(onChunk).toHaveBeenCalledTimes(1);
  });
});
