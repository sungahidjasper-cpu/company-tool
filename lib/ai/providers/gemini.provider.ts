import { ApiError, GoogleGenAI } from "@google/genai";

import { LlmProviderError, type LlmErrorType } from "@/lib/ai/providers/errors";
import { getCachedHealth } from "@/lib/ai/providers/health-cache";
import { estimateGeminiCostUsd, getGeminiMaxContext } from "@/lib/ai/providers/pricing";
import { withRetry } from "@/lib/ai/providers/retry";
import type { GeneratedOutput, GenerateRawResult, LlmProvider, StreamChunkCallback, StructuredOutputRequest, TokenUsage } from "@/lib/ai/providers/types";

const MAX_PARSE_ATTEMPTS = 3;
/** Gemini's Node SDK has no reliably-respected request timeout — enforced ourselves. */
const REQUEST_TIMEOUT_MS = 120_000;

const globalForGemini = globalThis as unknown as { gemini?: GoogleGenAI };

function getClient(): GoogleGenAI {
  if (!globalForGemini.gemini) {
    globalForGemini.gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return globalForGemini.gemini;
}

/**
 * Gemini returns 429 for both true rate limiting and quota exhaustion — no
 * separate status, so the message text is the primary signal there. The
 * same check is also applied to a 400 as defensive redundancy: live
 * verification against Anthropic found its documented error-type taxonomy
 * didn't match its actual response for an out-of-credits account (it came
 * back as invalid_request_error, not billing_error), so a provider's status
 * code alone isn't fully trusted here either.
 */
const CREDIT_MESSAGE_PATTERN = /credit balance|insufficient credit|out of credit|quota|billing/i;
/**
 * Confirmed live: an invalid Gemini API key comes back as HTTP 400
 * (INVALID_ARGUMENT, reason API_KEY_INVALID) — not 401/403 — so status
 * code alone misclassifies it as INVALID_REQUEST, which wrongly excludes a
 * genuine credential problem from provider fallback (INVALID_REQUEST is
 * deliberately non-fallback-worthy; AUTHENTICATION_ERROR is). Same
 * "don't fully trust the status code" lesson as the credits check above.
 */
const AUTH_MESSAGE_PATTERN = /api key not valid|api_key_invalid|invalid api key/i;

export function classifyApiError(error: ApiError): LlmProviderError {
  const status = error.status;
  let type: LlmErrorType = "UNKNOWN";

  if (status === 401 || status === 403) type = "AUTHENTICATION_ERROR";
  else if (status === 429) type = CREDIT_MESSAGE_PATTERN.test(error.message) ? "INSUFFICIENT_CREDITS" : "RATE_LIMIT";
  else if (status === 400) type = "INVALID_REQUEST";
  else if (status === 404) type = "MODEL_UNAVAILABLE"; // Phase 20 — a deprecated/unknown GEMINI_MODEL name (confirmed live in an earlier phase: a retired model 404s, not 400).
  else if (status === 503) type = "SERVICE_UNAVAILABLE";

  if (type === "INVALID_REQUEST" && CREDIT_MESSAGE_PATTERN.test(error.message)) type = "INSUFFICIENT_CREDITS";
  else if (type === "INVALID_REQUEST" && AUTH_MESSAGE_PATTERN.test(error.message)) type = "AUTHENTICATION_ERROR";

  return new LlmProviderError(error.message, type, "gemini", { cause: error });
}

function classifyError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) return error;
  if (error instanceof ApiError) return classifyApiError(error);
  if (error instanceof Error && error.name === "AbortError") {
    return new LlmProviderError("Request to Gemini timed out.", "TIMEOUT", "gemini", { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new LlmProviderError(message, "UNKNOWN", "gemini", { cause: error });
}

async function attemptGenerate(request: StructuredOutputRequest): Promise<GeneratedOutput> {
  const client = getClient();
  const model = process.env.GEMINI_MODEL!;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await client.models.generateContent({
      model,
      contents: request.prompt,
      config: {
        systemInstruction: request.system,
        maxOutputTokens: request.maxTokens ?? 4096,
        responseMimeType: "application/json",
        // Full JSON Schema (from zod's toJSONSchema) goes through
        // responseJsonSchema, not responseSchema — the latter only accepts
        // Gemini's own restricted OpenAPI-3.0-subset schema format.
        responseJsonSchema: request.jsonSchema,
        abortSignal: controller.signal,
      },
    });

    const text = response.text;
    if (!text) {
      throw new LlmProviderError("AI response contained no content.", "UNKNOWN", "gemini");
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new LlmProviderError("AI response could not be parsed as JSON.", "UNKNOWN", "gemini", { cause: error });
    }

    return {
      data,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount ?? null,
        completionTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      },
      model,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Phase 22 — generateContentStream() accepts the identical `config` already
 * built for the non-streaming call above (same responseJsonSchema/
 * responseMimeType/abortSignal). Unlike Anthropic's snapshot-style "text"
 * event, each chunk here carries only its own delta, so the accumulated
 * text is built up manually before being handed to onChunk.
 */
async function attemptGenerateStreaming(request: StructuredOutputRequest, onChunk: StreamChunkCallback): Promise<GeneratedOutput> {
  const client = getClient();
  const model = process.env.GEMINI_MODEL!;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const stream = await client.models.generateContentStream({
      model,
      contents: request.prompt,
      config: {
        systemInstruction: request.system,
        maxOutputTokens: request.maxTokens ?? 4096,
        responseMimeType: "application/json",
        responseJsonSchema: request.jsonSchema,
        abortSignal: controller.signal,
      },
    });

    let accumulated = "";
    let usage: TokenUsage = { promptTokens: null, completionTokens: null };
    for await (const chunk of stream) {
      if (chunk.text) {
        accumulated += chunk.text;
        onChunk(accumulated);
      }
      if (chunk.usageMetadata) {
        usage = {
          promptTokens: chunk.usageMetadata.promptTokenCount ?? null,
          completionTokens: chunk.usageMetadata.candidatesTokenCount ?? null,
        };
      }
    }

    if (!accumulated) {
      throw new LlmProviderError("AI response contained no content.", "UNKNOWN", "gemini");
    }

    let data: unknown;
    try {
      data = JSON.parse(accumulated);
    } catch (error) {
      throw new LlmProviderError("AI response could not be parsed as JSON.", "UNKNOWN", "gemini", { cause: error });
    }

    return { data, usage, model };
  } finally {
    clearTimeout(timeout);
  }
}

export const geminiProvider: LlmProvider = {
  name: "gemini",

  isConfigured() {
    return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);
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
          label: "gemini",
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
          label: "gemini-streaming",
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
    return this.isConfigured() ? getCachedHealth("gemini") : "DISABLED";
  },

  supportsJson() {
    return true;
  },

  maxContext() {
    return getGeminiMaxContext(process.env.GEMINI_MODEL);
  },

  cost(usage: TokenUsage) {
    return estimateGeminiCostUsd(process.env.GEMINI_MODEL, usage);
  },
};
