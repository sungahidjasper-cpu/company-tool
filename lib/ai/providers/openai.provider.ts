import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, RateLimitError } from "openai";

import { LlmProviderError, type LlmErrorType } from "@/lib/ai/providers/errors";
import { getCachedHealth } from "@/lib/ai/providers/health-cache";
import { estimateOpenAiCostUsd, getOpenAiMaxContext } from "@/lib/ai/providers/pricing";
import { withRetry } from "@/lib/ai/providers/retry";
import type { GeneratedOutput, GenerateRawResult, LlmProvider, StreamChunkCallback, StructuredOutputRequest, TokenUsage } from "@/lib/ai/providers/types";

const MAX_PARSE_ATTEMPTS = 3;

const globalForOpenAi = globalThis as unknown as { openai?: OpenAI };

function getClient(): OpenAI {
  if (!globalForOpenAi.openai) {
    globalForOpenAi.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return globalForOpenAi.openai;
}

/** RateLimitError (429) covers both true rate limiting and quota exhaustion — disambiguate via error.code. */
const QUOTA_CODES = new Set(["insufficient_quota"]);

/**
 * Belt-and-suspenders message check, same reasoning as anthropic.provider.ts:
 * live verification found Anthropic's documented error-type taxonomy didn't
 * match its actual response for an out-of-credits account (came back as
 * invalid_request_error, not billing_error) — so a credit-related 400/422
 * here is treated as INSUFFICIENT_CREDITS rather than trusted to always be
 * a genuine malformed-request error.
 */
const CREDIT_MESSAGE_PATTERN = /credit balance|insufficient credit|out of credit|billing/i;

export function classifyError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) return error;

  if (error instanceof APIConnectionTimeoutError) {
    return new LlmProviderError(error.message, "TIMEOUT", "openai", { cause: error });
  }
  if (error instanceof RateLimitError) {
    const code = error.code ?? "";
    const type: LlmErrorType =
      QUOTA_CODES.has(code) || code.includes("spend_limit") || CREDIT_MESSAGE_PATTERN.test(error.message)
        ? "INSUFFICIENT_CREDITS"
        : "RATE_LIMIT";
    return new LlmProviderError(error.message, type, "openai", { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new LlmProviderError(error.message, "SERVICE_UNAVAILABLE", "openai", { cause: error });
  }
  if (error instanceof APIError) {
    const status = error.status;
    let type: LlmErrorType = "UNKNOWN";
    if (status === 401 || status === 403) type = "AUTHENTICATION_ERROR";
    else if (status === 404) type = "MODEL_UNAVAILABLE"; // Phase 20 — OpenAI's real "model not found" response for a deprecated/unknown OPENAI_MODEL.
    else if (status === 400 || status === 422) type = "INVALID_REQUEST";
    else if (status !== undefined && status >= 500) type = "SERVICE_UNAVAILABLE";
    if (type === "INVALID_REQUEST" && CREDIT_MESSAGE_PATTERN.test(error.message)) type = "INSUFFICIENT_CREDITS";
    return new LlmProviderError(error.message, type, "openai", { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  const type = CREDIT_MESSAGE_PATTERN.test(message) ? "INSUFFICIENT_CREDITS" : "UNKNOWN";
  return new LlmProviderError(message, type, "openai", { cause: error });
}

async function attemptGenerate(request: StructuredOutputRequest): Promise<GeneratedOutput> {
  const client = getClient();
  const model = process.env.OPENAI_MODEL!;

  const response = await client.chat.completions.create({
    model,
    max_completion_tokens: request.maxTokens ?? 4096,
    messages: [
      ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
      { role: "user" as const, content: request.prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "structured_output", schema: request.jsonSchema, strict: true },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new LlmProviderError("AI response contained no content.", "UNKNOWN", "openai");
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    throw new LlmProviderError("AI response could not be parsed as JSON.", "UNKNOWN", "openai", { cause: error });
  }

  return {
    data,
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? null,
      completionTokens: response.usage?.completion_tokens ?? null,
    },
    model,
  };
}

/**
 * Phase 22 Stage 2 — the OpenAI SDK's streamed chat-completion chunks each
 * carry only their own delta (`choices[0].delta.content`), not a running
 * snapshot like Anthropic's — same manual-accumulation shape gemini.provider.ts
 * already uses. `stream_options.include_usage` asks the API to attach a
 * final usage-only chunk (no `choices`), matching how the non-streaming call
 * already reports usage; if a chunk has no delta and no usage, it's skipped.
 */
async function attemptGenerateStreaming(request: StructuredOutputRequest, onChunk: StreamChunkCallback): Promise<GeneratedOutput> {
  const client = getClient();
  const model = process.env.OPENAI_MODEL!;

  const stream = await client.chat.completions.create({
    model,
    max_completion_tokens: request.maxTokens ?? 4096,
    messages: [
      ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
      { role: "user" as const, content: request.prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "structured_output", schema: request.jsonSchema, strict: true },
    },
    stream: true,
    stream_options: { include_usage: true },
  });

  let accumulated = "";
  let usage: TokenUsage = { promptTokens: null, completionTokens: null };
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      accumulated += delta;
      onChunk(accumulated);
    }
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens ?? null,
        completionTokens: chunk.usage.completion_tokens ?? null,
      };
    }
  }

  if (!accumulated) {
    throw new LlmProviderError("AI response contained no content.", "UNKNOWN", "openai");
  }

  let data: unknown;
  try {
    data = JSON.parse(accumulated);
  } catch (error) {
    throw new LlmProviderError("AI response could not be parsed as JSON.", "UNKNOWN", "openai", { cause: error });
  }

  return { data, usage, model };
}

export const openaiProvider: LlmProvider = {
  name: "openai",

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
  },

  async generateRaw(request: StructuredOutputRequest): Promise<GenerateRawResult> {
    let attempts = 0;
    try {
      const result = await withRetry(
        () => {
          attempts++;
          return attemptGenerate(request);
        },
        {
          maxAttempts: MAX_PARSE_ATTEMPTS,
          label: "openai",
          isRetryable: (error) =>
            error instanceof LlmProviderError && error.type === "UNKNOWN" && /could not be parsed as JSON/i.test(error.message),
        }
      );
      return { ...result, retried: attempts > 1 };
    } catch (error) {
      throw classifyError(error);
    }
  },

  async generateRawStreaming(request: StructuredOutputRequest, onChunk: StreamChunkCallback): Promise<GenerateRawResult> {
    let attempts = 0;
    try {
      const result = await withRetry(
        () => {
          attempts++;
          return attemptGenerateStreaming(request, onChunk);
        },
        {
          maxAttempts: MAX_PARSE_ATTEMPTS,
          label: "openai-streaming",
          isRetryable: (error) =>
            error instanceof LlmProviderError && error.type === "UNKNOWN" && /could not be parsed as JSON/i.test(error.message),
        }
      );
      return { ...result, retried: attempts > 1 };
    } catch (error) {
      throw classifyError(error);
    }
  },

  async healthCheck() {
    return this.isConfigured() ? getCachedHealth("openai") : "DISABLED";
  },

  supportsJson() {
    return true;
  },

  maxContext() {
    return getOpenAiMaxContext(process.env.OPENAI_MODEL);
  },

  cost(usage: TokenUsage) {
    return estimateOpenAiCostUsd(process.env.OPENAI_MODEL, usage);
  },
};
