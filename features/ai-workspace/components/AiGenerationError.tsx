"use client";

import { AlertTriangle } from "lucide-react";

import { describeLlmError, type LlmErrorType } from "@/lib/ai/providers/errors";

type AiGenerationErrorProps = {
  /** The action/job message. Shown verbatim when there is no provider errorType — this is how actionable validation messages survive normalization. */
  error: string | null;
  /** Set only when the failure came from a provider, never for a validation failure. */
  errorType: LlmErrorType | null;
};

/**
 * Phase B B3.4 — one presentation for AI Workspace generation failures.
 *
 * Three dialects existed before this: seven pickers rendered a red box with
 * the raw enum appended (users saw literal text like "(RATE_LIMIT)"), two
 * pickers dropped errorType entirely, and only the two review components used
 * describeLlmError's human-readable title/message/recommendedAction. This is
 * that third — best — pattern, lifted into one shared component so every tool
 * presents the same thing; describeLlmError itself is only called here, never
 * modified.
 *
 * A provider failure is described in plain language and never blamed on the
 * user. A validation failure (errorType null — e.g. "SEO project not found.")
 * keeps its own specific, actionable wording untouched. Raw enums, exception
 * text, and provider internals are never rendered.
 */
export default function AiGenerationError({ error, errorType }: AiGenerationErrorProps) {
  if (!errorType) {
    return error ? <p className="text-sm text-destructive">{error}</p> : null;
  }

  const description = describeLlmError(errorType);
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-destructive" />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-destructive">{description.title}</p>
        <p className="text-sm text-destructive/80">{description.message}</p>
        <p className="text-sm text-destructive/80">{description.recommendedAction}</p>
      </div>
    </div>
  );
}
