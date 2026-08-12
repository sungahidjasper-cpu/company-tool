import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { AI_MODEL, getAnthropicClient } from "@/lib/ai/client";
import { LlmProviderError, type LlmErrorType } from "@/lib/ai/providers/errors";
import { withRetry } from "@/lib/ai/providers/retry";
import type { LlmProvider, StructuredOutputRequest } from "@/lib/ai/providers/types";

const MAX_PARSE_ATTEMPTS = 3;

/**
 * Anthropic's documented `error.type` union (resources/shared.d.ts) includes
 * `billing_error` for INSUFFICIENT_CREDITS — but live verification against a
 * real over-the-limit account found the actual response for "credit balance
 * too low" comes back as a 400 with `error.type: "invalid_request_error"`,
 * not `billing_error`. The documented type is kept as the primary signal;
 * the message-text check below is what actually catches the real case.
 */
const ERROR_TYPE_MAP: Record<string, LlmErrorType> = {
  billing_error: "INSUFFICIENT_CREDITS",
  timeout_error: "TIMEOUT",
  overloaded_error: "SERVICE_UNAVAILABLE",
  authentication_error: "AUTHENTICATION_ERROR",
  permission_error: "AUTHENTICATION_ERROR",
  rate_limit_error: "RATE_LIMIT",
  invalid_request_error: "INVALID_REQUEST",
  not_found_error: "INVALID_REQUEST",
  api_error: "UNKNOWN",
};

const CREDIT_MESSAGE_PATTERN = /credit balance|insufficient credit|out of credit/i;

export function classifyError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) return error;

  // Check subclasses before their parent (APIConnectionTimeoutError extends
  // APIConnectionError extends APIError) — instanceof on the base class
  // would otherwise match every one of them.
  if (error instanceof APIConnectionTimeoutError) {
    return new LlmProviderError(error.message, "TIMEOUT", "anthropic", { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new LlmProviderError(error.message, "SERVICE_UNAVAILABLE", "anthropic", { cause: error });
  }
  if (error instanceof APIError) {
    const mappedType = (error.type && ERROR_TYPE_MAP[error.type]) || "UNKNOWN";
    const type = mappedType === "INVALID_REQUEST" && CREDIT_MESSAGE_PATTERN.test(error.message) ? "INSUFFICIENT_CREDITS" : mappedType;
    return new LlmProviderError(error.message, type, "anthropic", { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  const type = CREDIT_MESSAGE_PATTERN.test(message) ? "INSUFFICIENT_CREDITS" : "UNKNOWN";
  return new LlmProviderError(message, type, "anthropic", { cause: error });
}

async function attemptGenerate(request: StructuredOutputRequest): Promise<unknown> {
  const client = getAnthropicClient();

  const message = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: request.maxTokens ?? 4096,
    system: request.system,
    output_config: { format: zodOutputFormat(request.zodSchema) },
    messages: [{ role: "user", content: request.prompt }],
  });

  if (message.stop_reason === "refusal") {
    throw new LlmProviderError("The AI declined to process this request.", "INVALID_REQUEST", "anthropic");
  }
  if (!message.parsed_output) {
    throw new LlmProviderError("AI response could not be parsed against the expected schema.", "UNKNOWN", "anthropic");
  }

  return message.parsed_output;
}

export const anthropicProvider: LlmProvider = {
  name: "anthropic",

  isConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  async generateRaw(request: StructuredOutputRequest): Promise<unknown> {
    try {
      return await withRetry(() => attemptGenerate(request), {
        maxAttempts: MAX_PARSE_ATTEMPTS,
        label: "anthropic",
        isRetryable: (error) =>
          error instanceof LlmProviderError &&
          error.type === "UNKNOWN" &&
          /could not be parsed against the expected schema/i.test(error.message),
      });
    } catch (error) {
      throw classifyError(error);
    }
  },
};
