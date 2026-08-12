import { ApiError, GoogleGenAI } from "@google/genai";

import { LlmProviderError, type LlmErrorType } from "@/lib/ai/providers/errors";
import { withRetry } from "@/lib/ai/providers/retry";
import type { LlmProvider, StructuredOutputRequest } from "@/lib/ai/providers/types";

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

function classifyApiError(error: ApiError): LlmProviderError {
  const status = error.status;
  let type: LlmErrorType = "UNKNOWN";

  if (status === 401 || status === 403) type = "AUTHENTICATION_ERROR";
  else if (status === 429) type = CREDIT_MESSAGE_PATTERN.test(error.message) ? "INSUFFICIENT_CREDITS" : "RATE_LIMIT";
  else if (status === 400) type = "INVALID_REQUEST";
  else if (status === 503) type = "SERVICE_UNAVAILABLE";

  if (type === "INVALID_REQUEST" && CREDIT_MESSAGE_PATTERN.test(error.message)) type = "INSUFFICIENT_CREDITS";
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

async function attemptGenerate(request: StructuredOutputRequest): Promise<unknown> {
  const client = getClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await client.models.generateContent({
      model: process.env.GEMINI_MODEL!,
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

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new LlmProviderError("AI response could not be parsed as JSON.", "UNKNOWN", "gemini", { cause: error });
    }
  } finally {
    clearTimeout(timeout);
  }
}

export const geminiProvider: LlmProvider = {
  name: "gemini",

  isConfigured() {
    return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);
  },

  async generateRaw(request: StructuredOutputRequest): Promise<unknown> {
    try {
      return await withRetry(() => attemptGenerate(request), {
        maxAttempts: MAX_PARSE_ATTEMPTS,
        label: "gemini",
        isRetryable: (error) =>
          error instanceof LlmProviderError && error.type === "UNKNOWN" && /could not be parsed as JSON/i.test(error.message),
      });
    } catch (error) {
      throw classifyError(error);
    }
  },
};
