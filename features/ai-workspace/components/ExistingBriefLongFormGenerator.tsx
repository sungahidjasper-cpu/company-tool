"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cancelAiGenerationJobAction, getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { startLongFormGenerationAction, updateLongFormContentAction } from "@/features/ai-workspace/actions/long-form-content.actions";
import LongFormContentReview, { type LongFormDraftExtras, type LongFormEditableFields } from "@/features/ai-workspace/components/LongFormContentReview";
import { validateLongFormJobInput } from "@/features/ai-workspace/schemas/ai-generation-job.schema";
import type { InternalLinkSuggestion } from "@/features/ai-workspace/schemas/content-brief-output-builder";
import type { ContentBriefSettings } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { formatLongFormContentAsMarkdown, longFormContentOutputSchema } from "@/features/ai-workspace/schemas/long-form-content.schema";
import { parsePreviewFields, type JsonValue } from "@/features/ai-workspace/services/partial-json-preview.service";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 5 * 60 * 1000;

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  // Phase 22 — same best-effort live preview as ContentBriefPicker.tsx; see
  // that file's openGenerationStream comment for the full rationale.
  const [streamCharCount, setStreamCharCount] = useState<number | null>(null);
  const [streamProgress, setStreamProgress] = useState<number | null>(null);
  const [isSwitchingProvider, setIsSwitchingProvider] = useState(false);
  // Phase 22 Stage 3 — a schema-agnostic scan of the same accumulated text,
  // exposing whichever fields are already fully written. Strictly cosmetic,
  // layered beneath the char-count line above; never a source of truth.
  const [previewFields, setPreviewFields] = useState<Record<string, JsonValue> | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  /** Phase 30 Stage 10 — same refresh-recovery/cancel mechanism as ContentBriefPicker.tsx; see that file's identical field for the full rationale. */
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  function setActiveJob(jobId: string | null) {
    setActiveJobId(jobId);
    const params = new URLSearchParams(searchParams.toString());
    if (jobId) params.set("jobId", jobId);
    else params.delete("jobId");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      streamRef.current?.close();
    };
  }, []);

  function closeGenerationStream() {
    streamRef.current?.close();
    streamRef.current = null;
    setStreamCharCount(null);
    setStreamProgress(null);
    setIsSwitchingProvider(false);
    setPreviewFields(null);
  }

  function openGenerationStream(jobId: string) {
    streamRef.current?.close();
    setStreamCharCount(null);
    setStreamProgress(null);
    setIsSwitchingProvider(false);
    setPreviewFields(null);

    const source = new EventSource(`/api/ai-workspace/jobs/${jobId}/stream`);
    streamRef.current = source;

    source.addEventListener("text", (event) => {
      try {
        const { text } = JSON.parse((event as MessageEvent).data);
        setIsSwitchingProvider(false);
        setStreamCharCount(typeof text === "string" ? text.length : null);
        setPreviewFields(typeof text === "string" ? parsePreviewFields(text) : null);
      } catch {
        // Malformed event — ignore, this is a cosmetic preview only.
      }
    });
    source.addEventListener("progress", (event) => {
      try {
        const { progress } = JSON.parse((event as MessageEvent).data);
        setStreamProgress(typeof progress === "number" ? progress : null);
      } catch {
        // Ignore — cosmetic only.
      }
    });
    source.addEventListener("reset", () => {
      setIsSwitchingProvider(true);
      setStreamCharCount(null);
      setPreviewFields(null);
    });
    source.addEventListener("done", () => source.close());
    source.onerror = () => source.close();
  }

  /** Phase 30 Stage 10 — factored out of runGenerate so resumeJob below can share the exact same polling behavior. */
  function pollGenerationJob(jobId: string, onSucceeded: (resultJson: unknown) => void, onSettled: () => void) {
    if (pollRef.current) clearInterval(pollRef.current);
    const startedAt = Date.now();

    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > MAX_POLL_MS) {
        if (pollRef.current) clearInterval(pollRef.current);
        onSettled();
        setErrorType(null);
        setError("This is taking longer than expected. Please check back shortly or try again.");
        return;
      }

      const poll = await getAiGenerationJobAction(jobId);
      if (!poll.success) {
        if (pollRef.current) clearInterval(pollRef.current);
        onSettled();
        setErrorType(null);
        setError(poll.message);
        return;
      }
      if (!poll.data) return;

      if (poll.data.status === "FAILED") {
        if (pollRef.current) clearInterval(pollRef.current);
        onSettled();
        setErrorType(poll.data.errorType);
        setError(poll.data.errorMessage ?? "Generation failed.");
        return;
      }

      if (poll.data.status === "SUCCEEDED") {
        if (pollRef.current) clearInterval(pollRef.current);
        onSettled();
        onSucceeded(poll.data.resultJson);
      }
    }, POLL_INTERVAL_MS);
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

    setActiveJob(result.data.jobId);
    openGenerationStream(result.data.jobId);
    pollGenerationJob(result.data.jobId, applyResult, () => {
      setIsGenerating(false);
      closeGenerationStream();
    });
  }

  /**
   * Phase 30 Stage 10 — reattaches to the job named in ?jobId=. Guards that
   * the job actually belongs to THIS content row (mode "fromContent" with a
   * matching contentId) before touching any state — a stale or manually-
   * edited jobId param must never resurrect an unrelated generation here.
   */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "CONTENT_DRAFT") {
      setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = validateLongFormJobInput(job.inputJson);
    if (!parsedInput.success || parsedInput.data.mode !== "fromContent" || parsedInput.data.contentId !== contentId) {
      setActiveJob(null);
      return;
    }
    setActiveJobId(jobId);

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
    openGenerationStream(jobId);
    pollGenerationJob(jobId, applyResult, () => {
      setIsGenerating(false);
      closeGenerationStream();
    });
  }

  useEffect(() => {
    const resumeJobId = searchParams.get("jobId");
    if (!resumeJobId) return;
    // Deferred via setTimeout — see ContentBriefPicker.tsx's identical
    // comment for why (mirrors this codebase's existing pollJob pattern).
    const timeoutId = setTimeout(() => {
      void resumeJob(resumeJobId);
    }, 0);
    return () => clearTimeout(timeoutId);
    // Only on mount — resumeJob itself drives every subsequent state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Phase 30 Stage 10 — a soft cancel; see cancelAiGenerationJob's comment for exactly what this does and doesn't stop. */
  async function handleCancel() {
    if (!activeJobId) return;
    const jobId = activeJobId;
    if (pollRef.current) clearInterval(pollRef.current);
    closeGenerationStream();
    setIsGenerating(false);
    setActiveJob(null);
    await cancelAiGenerationJobAction(jobId);
    toast.success("Generation cancelled.");
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
        streamCharCount={streamCharCount}
        streamProgress={streamProgress}
        isSwitchingProvider={isSwitchingProvider}
        previewFields={previewFields}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        This generates a full draft article from the brief already saved for &quot;{title}.&quot; Nothing is saved until you review it and click Save as Draft.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {isGenerating && (isSwitchingProvider || streamCharCount !== null) && (
        <p className="text-sm text-slate-500">
          {isSwitchingProvider
            ? "Switching to backup AI provider — restarting…"
            : `Generating… ${streamCharCount} characters so far${streamProgress !== null ? ` (~${streamProgress}%)` : ""}`}
        </p>
      )}
      {isGenerating && !isSwitchingProvider && streamCharCount !== null && streamProgress !== null && (
        <Progress value={streamProgress} aria-label="Generation progress" />
      )}
      {isGenerating && !isSwitchingProvider && previewFields && Object.keys(previewFields).length > 0 && (
        <div className="space-y-1 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          {typeof previewFields.introduction === "string" && (
            <p>
              <span className="font-medium text-slate-700">Introduction:</span> {previewFields.introduction}
            </p>
          )}
          {Array.isArray(previewFields.sections) && previewFields.sections.length > 0 && (
            <p>
              <span className="font-medium text-slate-700">Sections so far ({previewFields.sections.length}):</span>{" "}
              {previewFields.sections
                .map((section) => (typeof section === "object" && section && "heading" in section ? section.heading : null))
                .filter((heading): heading is string => typeof heading === "string")
                .join(", ")}
            </p>
          )}
          {typeof previewFields.conclusion === "string" && (
            <p>
              <span className="font-medium text-slate-700">Conclusion:</span> {previewFields.conclusion}
            </p>
          )}
          {Array.isArray(previewFields.faq) && previewFields.faq.length > 0 && (
            <p>
              <span className="font-medium text-slate-700">FAQ items so far:</span> {previewFields.faq.length}
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
