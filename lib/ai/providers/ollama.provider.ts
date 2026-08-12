import { Ollama } from "ollama";

import { LlmProviderError } from "@/lib/ai/providers/errors";
import { withRetry } from "@/lib/ai/providers/retry";
import type { LlmProvider, StructuredOutputRequest } from "@/lib/ai/providers/types";

const MAX_PARSE_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 120_000;

const globalForOllama = globalThis as unknown as { ollama?: Ollama };

function getClient(): Ollama {
  if (!globalForOllama.ollama) {
    globalForOllama.ollama = new Ollama({ host: process.env.OLLAMA_HOST });
  }
  return globalForOllama.ollama;
}

/**
 * ollama-js doesn't export its ResponseError class from the package root
 * (confirmed — it's internal to src/utils.ts), so it's identified
 * structurally rather than via `instanceof`.
 */
function isOllamaResponseError(error: unknown): error is Error & { status_code: number } {
  return (
    error instanceof Error &&
    error.name === "ResponseError" &&
    typeof (error as { status_code?: unknown }).status_code === "number"
  );
}

/** Ollama not running at all throws a plain fetch failure wrapping an ECONNREFUSED cause, not a ResponseError. */
function isConnectionRefused(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message === "fetch failed" &&
    (error as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED"
  );
}

function classifyError(error: unknown): LlmProviderError {
  if (error instanceof LlmProviderError) return error;

  if (isConnectionRefused(error)) {
    return new LlmProviderError("Could not connect to the local Ollama server.", "SERVICE_UNAVAILABLE", "ollama", {
      cause: error,
    });
  }
  if (isOllamaResponseError(error)) {
    const type = error.status_code >= 500 ? "SERVICE_UNAVAILABLE" : "INVALID_REQUEST";
    return new LlmProviderError(error.message, type, "ollama", { cause: error });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new LlmProviderError("Request to Ollama timed out.", "TIMEOUT", "ollama", { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new LlmProviderError(message, "UNKNOWN", "ollama", { cause: error });
}

/**
 * ollama-js's non-streaming chat() takes no per-call abort signal (its only
 * abort support is stream-specific, via the client's own internal
 * AbortController for `ongoingStreamedRequests`), so a timeout is enforced
 * by racing the call instead of cancelling it — this stops us from waiting
 * forever on a hung local server, even though it can't cancel the in-flight
 * request itself.
 */
function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const error = new Error("Request to Ollama timed out.");
      error.name = "AbortError";
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

async function attemptGenerate(request: StructuredOutputRequest): Promise<unknown> {
  const client = getClient();

  const response = await raceTimeout(
    client.chat({
      model: process.env.OLLAMA_MODEL!,
      messages: [
        ...(request.system ? [{ role: "system", content: request.system }] : []),
        { role: "user", content: request.prompt },
      ],
      format: request.jsonSchema,
      stream: false,
      options: { num_predict: request.maxTokens ?? 4096 },
    }),
    REQUEST_TIMEOUT_MS
  );

  const content = response.message?.content;
  if (!content) {
    throw new LlmProviderError("AI response contained no content.", "UNKNOWN", "ollama");
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new LlmProviderError("AI response could not be parsed as JSON.", "UNKNOWN", "ollama", { cause: error });
  }
}

export const ollamaProvider: LlmProvider = {
  name: "ollama",

  isConfigured() {
    return Boolean(process.env.OLLAMA_HOST && process.env.OLLAMA_MODEL);
  },

  async generateRaw(request: StructuredOutputRequest): Promise<unknown> {
    try {
      return await withRetry(() => attemptGenerate(request), {
        maxAttempts: MAX_PARSE_ATTEMPTS,
        label: "ollama",
        isRetryable: (error) =>
          error instanceof LlmProviderError && error.type === "UNKNOWN" && /could not be parsed as JSON/i.test(error.message),
      });
    } catch (error) {
      throw classifyError(error);
    }
  },
};
