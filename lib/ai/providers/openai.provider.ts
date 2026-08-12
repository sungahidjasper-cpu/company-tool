import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, RateLimitError } from "openai";

import { LlmProviderError, type LlmErrorType } from "@/lib/ai/providers/errors";
import { withRetry } from "@/lib/ai/providers/retry";
import type { LlmProvider, StructuredOutputRequest } from "@/lib/ai/providers/types";

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

function classifyError(error: unknown): LlmProviderError {
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
    else if (status === 400 || status === 422) type = "INVALID_REQUEST";
    else if (status !== undefined && status >= 500) type = "SERVICE_UNAVAILABLE";
    if (type === "INVALID_REQUEST" && CREDIT_MESSAGE_PATTERN.test(error.message)) type = "INSUFFICIENT_CREDITS";
    return new LlmProviderError(error.message, type, "openai", { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  const type = CREDIT_MESSAGE_PATTERN.test(message) ? "INSUFFICIENT_CREDITS" : "UNKNOWN";
  return new LlmProviderError(message, type, "openai", { cause: error });
}

async function attemptGenerate(request: StructuredOutputRequest): Promise<unknown> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL!,
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

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new LlmProviderError("AI response could not be parsed as JSON.", "UNKNOWN", "openai", { cause: error });
  }
}

export const openaiProvider: LlmProvider = {
  name: "openai",

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
  },

  async generateRaw(request: StructuredOutputRequest): Promise<unknown> {
    try {
      return await withRetry(() => attemptGenerate(request), {
        maxAttempts: MAX_PARSE_ATTEMPTS,
        label: "openai",
        isRetryable: (error) =>
          error instanceof LlmProviderError && error.type === "UNKNOWN" && /could not be parsed as JSON/i.test(error.message),
      });
    } catch (error) {
      throw classifyError(error);
    }
  },
};
