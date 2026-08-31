"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { startLongFormGenerationAction, updateLongFormContentAction } from "@/features/ai-workspace/actions/long-form-content.actions";
import LongFormContentReview, { type LongFormDraftExtras, type LongFormEditableFields } from "@/features/ai-workspace/components/LongFormContentReview";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import { validateLongFormJobInput } from "@/features/ai-workspace/schemas/ai-generation-job.schema";
import type { InternalLinkSuggestion } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import type { ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { formatLongFormContentAsMarkdown, longFormContentOutputSchema } from "@/features/ai-workspace/schemas/long-form-content.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

type ExistingBriefLongFormGeneratorProps = {
  contentId: string;
  seoProjectId: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  /** Phase 21 — the settings originally used to generate this content's brief, read back from Content.aiBriefDetails.briefSettings by the page. */
  settings: ContentBriefSettings;
};

/**
 * The "already-saved brief" entry point — for a Content row Phase 15's
 * saveContentBriefAction already created. Generation only ever starts on
 * an explicit click (never on page load/mount), and nothing is persisted
 * until "Save as Draft," which performs a scoped UPDATE on this exact
 * row (see updateLongFormContentAction) — never a new Content row.
 */
export default function ExistingBriefLongFormGenerator({
  contentId,
  seoProjectId,
  title,
  metaTitle,
  metaDescription,
  settings,
}: ExistingBriefLongFormGeneratorProps) {
  const router = useRouter();
  const [longFormFields, setLongFormFields] = useState<LongFormEditableFields | null>(null);
  const [linkSuggestions, setLinkSuggestions] = useState<InternalLinkSuggestion[]>([]);
  const [draftExtras, setDraftExtras] = useState<LongFormDraftExtras | undefined>(undefined);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Phase 23 Stage 2 — set alongside `error` only when a job's own poll
   * result carries a classified `errorType`; cleared to null everywhere
   * `error` is cleared or set from a non-job source, so it never lingers
   * stale across a fresh attempt.
   */
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  /** Shared by runGenerate's poll success handler and resumeJob — no state dependency, so no stale-closure risk. */
  function applyResult(resultJson: unknown) {
    const parsed = longFormContentOutputSchema.safeParse(resultJson);
    if (!parsed.success) {
      setErrorType(null);
      setError("Received an unexpected result — please try regenerating.");
      return;
    }
    setLinkSuggestions(parsed.data.internalLinkPlacementSuggestions);
    setDraftExtras({
      imagePlaceholders: parsed.data.imagePlaceholders,
      altTextSuggestions: parsed.data.altTextSuggestions,
      featuredImagePrompt: parsed.data.featuredImagePrompt,
      socialSnippets: parsed.data.socialSnippets,
      excerpt: parsed.data.excerpt,
    });
    setLongFormFields({
      title,
      metaTitle,
      metaDescription,
      body: formatLongFormContentAsMarkdown(parsed.data, settings.sections.cta ? settings.cta : undefined),
    });
  }

  const lifecycle = useAiGenerationLifecycle(resumeJob);

  /**
   * Reattaches to the job named in ?jobId=. Guards that the job actually
   * belongs to THIS content row (mode "fromContent" with a matching
   * contentId) before touching any state — a stale or manually-edited
   * jobId param must never resurrect an unrelated generation here.
   */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "CONTENT_DRAFT") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = validateLongFormJobInput(job.inputJson);
    if (!parsedInput.success || parsedInput.data.mode !== "fromContent" || parsedInput.data.contentId !== contentId) {
      lifecycle.setActiveJob(null);
      return;
    }
    lifecycle.setActiveJob(jobId);

    if (job.status === "SUCCEEDED") {
      applyResult(job.resultJson);
      return;
    }
    if (job.status === "FAILED") {
      setErrorType(job.errorType);
      setError(job.errorMessage ?? "Generation failed.");
      return;
    }
    if (job.status === "CANCELLED") {
      return;
    }
    setIsGenerating(true);
    lifecycle.openGenerationStream(jobId);
    lifecycle.pollGenerationJob(jobId, {
      onSucceeded: applyResult,
      onFailed: (type, message) => {
        setErrorType(type);
        setError(message);
      },
      onSettled: () => {
        setIsGenerating(false);
        lifecycle.closeGenerationStream();
      },
    });
  }

  async function runGenerate() {
    setError(null);
    setErrorType(null);
    setIsGenerating(true);
    const result = await startLongFormGenerationAction({ mode: "fromContent", contentId });

    if (!result.success) {
      setIsGenerating(false);
      setErrorType(null);
      setError(result.message);
      return;
    }

    lifecycle.setActiveJob(result.data.jobId);
    lifecycle.openGenerationStream(result.data.jobId);
    lifecycle.pollGenerationJob(result.data.jobId, {
      onSucceeded: applyResult,
      onFailed: (type, message) => {
        setErrorType(type);
        setError(message);
      },
      onSettled: () => {
        setIsGenerating(false);
        lifecycle.closeGenerationStream();
      },
    });
  }

  async function handleCancel() {
    await lifecycle.cancel(() => setIsGenerating(false));
  }

  async function handleSave() {
    if (!longFormFields) return;
    setError(null);
    setErrorType(null);
    setIsSaving(true);
    const result = await updateLongFormContentAction({ contentId, ...longFormFields });
    setIsSaving(false);

    if (!result.success) {
      setError(result.message);
      return;
    }
    toast.success("Draft saved");
    router.push(`/seo/${seoProjectId}/content/${contentId}`);
  }

  if (longFormFields) {
    return (
      <LongFormContentReview
        fields={longFormFields}
        onChange={setLongFormFields}
        internalLinkPlacementSuggestions={linkSuggestions}
        draftExtras={draftExtras}
        targetWordCount={settings.wordCount}
        onRegenerate={runGenerate}
        onSave={handleSave}
        isRegenerating={isGenerating}
        isSaving={isSaving}
        error={error}
        errorType={errorType}
        streamCharCount={lifecycle.streamCharCount}
        streamProgress={lifecycle.streamProgress}
        isSwitchingProvider={lifecycle.isSwitchingProvider}
        previewFields={lifecycle.previewFields}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        This generates a full draft article from the brief already saved for &quot;{title}.&quot; Nothing is saved until you review it and click Save as Draft.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {isGenerating && (lifecycle.isSwitchingProvider || lifecycle.streamCharCount !== null) && (
        <p className="text-sm text-slate-500">
          {lifecycle.isSwitchingProvider
            ? "Switching to backup AI provider — restarting…"
            : `Generating… ${lifecycle.streamCharCount} characters so far${lifecycle.streamProgress !== null ? ` (~${lifecycle.streamProgress}%)` : ""}`}
        </p>
      )}
      {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.streamCharCount !== null && lifecycle.streamProgress !== null && (
        <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />
      )}
      {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.previewFields && Object.keys(lifecycle.previewFields).length > 0 && (
        <div className="space-y-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          {typeof lifecycle.previewFields.introduction === "string" && (
            <p>
              <span className="font-medium text-slate-700">Introduction:</span> {lifecycle.previewFields.introduction}
            </p>
          )}
          {Array.isArray(lifecycle.previewFields.sections) && lifecycle.previewFields.sections.length > 0 && (
            <p>
              <span className="font-medium text-slate-700">Sections so far ({lifecycle.previewFields.sections.length}):</span>{" "}
              {lifecycle.previewFields.sections
                .map((section) => (typeof section === "object" && section && "heading" in section ? section.heading : null))
                .filter((heading): heading is string => typeof heading === "string")
                .join(", ")}
            </p>
          )}
          {typeof lifecycle.previewFields.conclusion === "string" && (
            <p>
              <span className="font-medium text-slate-700">Conclusion:</span> {lifecycle.previewFields.conclusion}
            </p>
          )}
          {Array.isArray(lifecycle.previewFields.faq) && lifecycle.previewFields.faq.length > 0 && (
            <p>
              <span className="font-medium text-slate-700">FAQ items so far:</span> {lifecycle.previewFields.faq.length}
            </p>
          )}
        </div>
      )}
      <div className="flex gap-3">
        <Button type="button" onClick={runGenerate} disabled={isGenerating}>
          {isGenerating ? "Generating..." : "Generate Long-Form Content"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
