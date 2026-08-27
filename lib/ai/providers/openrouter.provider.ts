import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, RateLimitError } from "openai";

import { LlmProviderError, type LlmErrorType } from "@/lib/ai/providers/errors";
import { getCachedHealth } from "@/lib/ai/providers/health-cache";
import { estimateOpenRouterCostUsd } from "@/lib/ai/providers/pricing";
import { withRetry } from "@/lib/ai/providers/retry";
import type { GeneratedOutput, GenerateRawResult, LlmProvider, StreamChunkCallback, StructuredOutputRequest, TokenUsage } from "@/lib/ai/providers/types";

/**
 * OpenRouter is an OpenAI-compatible aggregator (same chat/completions
 * shape, different base URL) that routes to whichever model OPENROUTER_MODEL
 * names — it's the last fallback in the default order (see registry.ts),
 * a paid catch-all for when every direct provider is unavailable.
 */
const MAX_PARSE_ATTEMPTS = 3;
/** Varies by whichever model OPENROUTER_MODEL routes to — this is a conservative rough default, not a per-model lookup. */
const MAX_CONTEXT_TOKENS = 128_000;

const globalForOpenRouter = globalThis as unknown as { openrouter?: OpenAI };

function getClient(): OpenAI {
  if (!globalForOpenRouter.openrouter) {
    globalForOpenRouter.openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }
  return globalForOpenRouter.openrouter;
}

/** Same reasoning as openai.provider.ts / anthropic.provider.ts: a credit-related 4xx isn't always reported via a dedicated status/code, so message text is checked too. */
const CREDIT_MESSAGE_PATTERN = /credit balance|insufficient credit|out of credit|billing/i;
/** OpenRouter proxies the OpenAI SDK's own RateLimitError shape, including its `code: "insufficient_quota"` convention — checked first, same as openai.provider.ts, before falling back to message text. */
const QUOTA_CODES = new Set(["insufficient_quota"]);

export function classifyError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) return error;

  if (error instanceof APIConnectionTimeoutError) {
    return new LlmProviderError(error.message, "TIMEOUT", "openrouter", { cause: error });
  }
  if (error instanceof RateLimitError) {
    const code = error.code ?? "";
    const type: LlmErrorType =
      QUOTA_CODES.has(code) || code.includes("spend_limit") || CREDIT_MESSAGE_PATTERN.test(error.message)
        ? "INSUFFICIENT_CREDITS"
        : "RATE_LIMIT";
    return new LlmProviderError(error.message, type, "openrouter", { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new LlmProviderError(error.message, "SERVICE_UNAVAILABLE", "openrouter", { cause: error });
  }
  if (error instanceof APIError) {
    const status = error.status;
    let type: LlmErrorType = "UNKNOWN";
    if (status === 401 || status === 403) type = "AUTHENTICATION_ERROR";
    // OpenRouter's documented status for "account or API key has insufficient
    // credits" — https://openrouter.ai/docs error codes. Distinct from the
    // RateLimitError branch above, which only ever fires for a 429; a 402
    // arrives as a plain APIError and previously fell through every branch
    // to UNKNOWN, hiding a real, actionable "add credits" failure behind the
    // generic unclassified error (confirmed live: a 402 "requires more
    // credits" response was misreported as UNKNOWN).
    else if (status === 402) type = "INSUFFICIENT_CREDITS";
    else if (status === 404) type = "MODEL_UNAVAILABLE"; // Phase 20 — the underlying model OPENROUTER_MODEL names is unknown/no longer routed.
    else if (status === 400 || status === 422) type = "INVALID_REQUEST";
    else if (status !== undefined && status >= 500) type = "SERVICE_UNAVAILABLE";
    if (type === "INVALID_REQUEST" && CREDIT_MESSAGE_PATTERN.test(error.message)) type = "INSUFFICIENT_CREDITS";
    return new LlmProviderError(error.message, type, "openrouter", { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  const type = CREDIT_MESSAGE_PATTERN.test(message) ? "INSUFFICIENT_CREDITS" : "UNKNOWN";
  return new LlmProviderError(message, type, "openrouter", { cause: error });
}

async function attemptGenerate(request: StructuredOutputRequest): Promise<GeneratedOutput> {
  const client = getClient();
  const model = process.env.OPENROUTER_MODEL!;

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
    throw new LlmProviderError("AI response contained no content.", "UNKNOWN", "openrouter");
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    throw new LlmProviderError("AI response could not be parsed as JSON.", "UNKNOWN", "openrouter", { cause: error });
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
 * Phase 22 Stage 2 — OpenRouter proxies the OpenAI SDK's chat-completions
 * shape exactly, including its streaming delta format — same
 * manual-accumulation pattern as openai.provider.ts's streaming variant.
 */
async function attemptGenerateStreaming(request: StructuredOutputRequest, onChunk: StreamChunkCallback): Promise<GeneratedOutput> {
  const client = getClient();
  const model = process.env.OPENROUTER_MODEL!;

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
    throw new LlmProviderError("AI response contained no content.", "UNKNOWN", "openrouter");
  }

  let data: unknown;
  try {
    data = JSON.parse(accumulated);
  } catch (error) {
    throw new LlmProviderError("AI response could not be parsed as JSON.", "UNKNOWN", "openrouter", { cause: error });
  }

  return { data, usage, model };
}

export const openrouterProvider: LlmProvider = {
  name: "openrouter",

  isConfigured() {
    return Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL);
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
          label: "openrouter",
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
          label: "openrouter-streaming",
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
    return this.isConfigured() ? getCachedHealth("openrouter") : "DISABLED";
  },

  supportsJson() {
    return true;
  },

  maxContext() {
    return MAX_CONTEXT_TOKENS;
  },

  cost(usage: TokenUsage) {
    return estimateOpenRouterCostUsd(usage);
  },
};
