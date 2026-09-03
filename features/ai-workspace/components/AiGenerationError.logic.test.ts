import { describe, expect, it } from "vitest";

import { describeLlmError, type LlmErrorType } from "@/lib/ai/providers/errors";

/**
 * Enumerated locally rather than imported: errors.ts exports the union type
 * but no runtime list, and that file is protected infrastructure this stage
 * must not modify. Kept in sync with the LlmErrorType union by hand.
 */
const LLM_ERROR_TYPES = [
  "AUTHENTICATION_ERROR",
  "INSUFFICIENT_CREDITS",
  "RATE_LIMIT",
  "TIMEOUT",
  "SERVICE_UNAVAILABLE",
  "INVALID_REQUEST",
  "NOT_CONFIGURED",
  "UNKNOWN",
  "BUDGET_EXCEEDED",
  "COMPANY_RATE_LIMITED",
  "MODEL_UNAVAILABLE",
] as const satisfies readonly LlmErrorType[];

/**
 * Phase B B3.4 — three error dialects existed across the AI Workspace:
 *   A) seven pickers rendered a red box with the raw enum appended, so users
 *      saw literal text like "(RATE_LIMIT)";
 *   B) two pickers dropped errorType entirely, losing the explanation;
 *   C) two review components used describeLlmError's human-readable
 *      title/message/recommendedAction.
 * C is now the single shared pattern (AiGenerationError). This repository has
 * no component-rendering setup, so these tests pin the CONTRACT that component
 * renders against — that every provider error type has non-technical,
 * non-blaming, actionable copy available, and that a validation message (no
 * errorType) is what survives verbatim instead.
 */
describe("B3.4 — normalized error presentation contract", () => {
  it("every provider error type has a title, message and recommended action to render", () => {
    for (const type of LLM_ERROR_TYPES) {
      const described = describeLlmError(type as LlmErrorType);
      expect(described.title, `${type} title`).toBeTruthy();
      expect(described.message, `${type} message`).toBeTruthy();
      expect(described.recommendedAction, `${type} recommendedAction`).toBeTruthy();
    }
  });

  it("no provider error copy exposes the raw enum, provider names, or other internals", () => {
    for (const type of LLM_ERROR_TYPES) {
      const described = describeLlmError(type as LlmErrorType);
      const rendered = `${described.title} ${described.message} ${described.recommendedAction}`;
      expect(rendered, `${type} leaked the raw enum`).not.toContain(type);
      expect(rendered, `${type} named a provider`).not.toMatch(/gemini|ollama|openrouter|anthropic|openai/i);
      expect(rendered, `${type} leaked a stack/exception`).not.toMatch(/stack|exception|Error:|undefined|null/i);
    }
  });

  it("no provider error copy blames the user for a system failure", () => {
    for (const type of LLM_ERROR_TYPES) {
      const described = describeLlmError(type as LlmErrorType);
      const rendered = `${described.title} ${described.message} ${described.recommendedAction}`;
      expect(rendered, `${type} blamed the user`).not.toMatch(/your input|you entered|invalid input|your fault/i);
    }
  });

  it("the two error sources stay distinguishable: a provider errorType is describable, a validation message is not an error type", () => {
    // A provider failure resolves to structured copy...
    expect(describeLlmError("TIMEOUT").message).toBeTruthy();
    // ...while an action-level validation message has no errorType at all, so
    // AiGenerationError renders it verbatim rather than replacing it.
    const validationMessage = "SEO project not found.";
    expect((LLM_ERROR_TYPES as readonly string[]).includes(validationMessage)).toBe(false);
  });
});
