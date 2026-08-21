import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

const mockStream = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class MockAPIError extends Error {
    status?: number;
    type: string | null;
    constructor(message: string, type: string | null = null, status?: number) {
      super(message);
      this.type = type;
      this.status = status;
    }
  }
  class MockAPIConnectionError extends MockAPIError {}
  class MockAPIConnectionTimeoutError extends MockAPIConnectionError {}
  return {
    default: vi.fn().mockImplementation(function MockAnthropic() {
      return { messages: { stream: mockStream } };
    }),
    APIError: MockAPIError,
    APIConnectionError: MockAPIConnectionError,
    APIConnectionTimeoutError: MockAPIConnectionTimeoutError,
  };
});

import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { anthropicProvider, classifyError } from "@/lib/ai/providers/anthropic.provider";
import { LlmProviderError } from "@/lib/ai/providers/errors";

// After vi.mock, these imported bindings ARE the mock classes defined in the
// factory above — constructing real instances of them (rather than
// hand-rolled lookalikes) is what makes classifyError's instanceof checks
// exercise the exact same branching the real SDK classes would trigger.
const MockAPIError = APIError as unknown as new (message: string, type?: string | null, status?: number) => Error & {
  type: string | null;
  status?: number;
};
const MockAPIConnectionError = APIConnectionError as unknown as new (message: string) => Error;
const MockAPIConnectionTimeoutError = APIConnectionTimeoutError as unknown as new (message: string) => Error;

const testSchema = z.object({ value: z.string() });

describe("anthropic.provider classifyError", () => {
  it("classifies APIConnectionTimeoutError as TIMEOUT", () => {
    expect(classifyError(new MockAPIConnectionTimeoutError("timed out")).type).toBe("TIMEOUT");
  });

  it("classifies a plain APIConnectionError (not the timeout subclass) as SERVICE_UNAVAILABLE", () => {
    expect(classifyError(new MockAPIConnectionError("connection dropped")).type).toBe("SERVICE_UNAVAILABLE");
  });

  it.each([
    ["billing_error", "INSUFFICIENT_CREDITS"],
    ["timeout_error", "TIMEOUT"],
    ["overloaded_error", "SERVICE_UNAVAILABLE"],
    ["authentication_error", "AUTHENTICATION_ERROR"],
    ["permission_error", "AUTHENTICATION_ERROR"],
    ["rate_limit_error", "RATE_LIMIT"],
    ["invalid_request_error", "INVALID_REQUEST"],
    ["not_found_error", "MODEL_UNAVAILABLE"],
    ["api_error", "UNKNOWN"],
  ] as const)("maps APIError.type %s to %s", (anthropicType, expected) => {
    expect(classifyError(new MockAPIError("some error", anthropicType)).type).toBe(expected);
  });

  it("maps an unrecognized APIError.type to UNKNOWN", () => {
    expect(classifyError(new MockAPIError("something new", "some_future_error_type")).type).toBe("UNKNOWN");
  });

  it("overrides invalid_request_error to INSUFFICIENT_CREDITS when the message matches the credit-balance pattern (live-verified Anthropic quirk)", () => {
    expect(classifyError(new MockAPIError("Your credit balance is too low to access the API", "invalid_request_error")).type).toBe(
      "INSUFFICIENT_CREDITS"
    );
  });

  it("passes through an already-classified LlmProviderError unchanged", () => {
    const original = new LlmProviderError("already classified", "RATE_LIMIT", "anthropic");
    expect(classifyError(original)).toBe(original);
  });

  it("classifies a plain Error whose message matches the credit pattern as INSUFFICIENT_CREDITS", () => {
    expect(classifyError(new Error("out of credit")).type).toBe("INSUFFICIENT_CREDITS");
  });

  it("falls back to UNKNOWN for a completely unrecognized error shape", () => {
    expect(classifyError(new Error("something else entirely")).type).toBe("UNKNOWN");
  });
});

/**
 * Mirrors the real MessageStream interface (node_modules/@anthropic-ai/sdk/lib/MessageStream.d.ts):
 * `.on("text", (delta, snapshot) => ...)` registers a listener that fires with
 * the running snapshot (not just the delta), and `.finalMessage()` is the
 * single awaited promise that resolves with the parsed final message or
 * rejects — attemptGenerateStreaming only ever touches these two members.
 */
function createMockStream(
  textEvents: Array<{ delta: string; snapshot: string }>,
  outcome: { resolve: unknown } | { reject: unknown }
) {
  let textListener: ((delta: string, snapshot: string) => void) | null = null;
  return {
    on(event: string, listener: (delta: string, snapshot: string) => void) {
      if (event === "text") textListener = listener;
      return this;
    },
    finalMessage: vi.fn(async () => {
      for (const e of textEvents) textListener?.(e.delta, e.snapshot);
      if ("reject" in outcome) throw outcome.reject;
      return outcome.resolve;
    }),
  };
}

describe("anthropic.provider generateRawStreaming", () => {
  beforeEach(() => {
    mockStream.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.ANTHROPIC_MODEL = "claude-test";
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
  });

  it("accumulates text-event snapshots, forwards each via onChunk, and reads usage/parsed_output from the final message", async () => {
    mockStream.mockReturnValue(
      createMockStream(
        [
          { delta: '{"value":', snapshot: '{"value":' },
          { delta: '"ok"}', snapshot: '{"value":"ok"}' },
        ],
        { resolve: { stop_reason: "end_turn", parsed_output: { value: "ok" }, usage: { input_tokens: 10, output_tokens: 5 } } }
      )
    );

    const onChunk = vi.fn();
    const result = await anthropicProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {}, zodSchema: testSchema } as never, onChunk);

    expect(onChunk.mock.calls.map((call) => call[0])).toEqual(['{"value":', '{"value":"ok"}']);
    expect(result.data).toEqual({ value: "ok" });
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it("rejects with INVALID_REQUEST when the model refuses the request (stop_reason: refusal) — the one Anthropic-specific safety branch this provider implements", async () => {
    mockStream.mockReturnValue(createMockStream([{ delta: "", snapshot: "" }], { resolve: { stop_reason: "refusal" } }));

    await expect(
      anthropicProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {}, zodSchema: testSchema } as never, vi.fn())
    ).rejects.toMatchObject({ type: "INVALID_REQUEST" });
  });

  it(
    "throws UNKNOWN when the final message has no parsed_output — the same check covers both a completely empty stream and one that " +
      "produced unparseable content, since attemptGenerateStreaming only has this single guard, not two separate ones — retried up to MAX_PARSE_ATTEMPTS, still fails every time",
    async () => {
      // mockImplementation (not mockReturnValue) gives each retry attempt its own
      // fresh stream object instead of replaying an already-resolved finalMessage.
      mockStream.mockImplementation(() => createMockStream([], { resolve: { stop_reason: "end_turn", parsed_output: undefined } }));

      await expect(
        anthropicProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {}, zodSchema: testSchema } as never, vi.fn())
      ).rejects.toMatchObject({ type: "UNKNOWN" });
      expect(mockStream).toHaveBeenCalledTimes(3);
    }
  );

  it("mid-stream failure: forwards the snapshot received before the failure, then rejects instead of returning a partial result", async () => {
    mockStream.mockReturnValue(createMockStream([{ delta: '{"partial":', snapshot: '{"partial":' }], { reject: new Error("connection dropped mid-stream") }));

    const onChunk = vi.fn();
    await expect(
      anthropicProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {}, zodSchema: testSchema } as never, onChunk)
    ).rejects.toThrow();
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('{"partial":');
  });

  it("does not implement generateRawStreaming any differently from generateRaw's error classification — a rejected SDK error is still classified", async () => {
    mockStream.mockReturnValue(createMockStream([], { reject: new MockAPIError("invalid API key", "authentication_error") }));

    await expect(
      anthropicProvider.generateRawStreaming!({ prompt: "test", jsonSchema: {}, zodSchema: testSchema } as never, vi.fn())
    ).rejects.toMatchObject({ provider: "anthropic", type: "AUTHENTICATION_ERROR" });
  });
});
