"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { applyContentRewriteAction, startContentRewriteAction } from "@/features/ai-workspace/actions/content-rewriter.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import ContentRewriterReview from "@/features/ai-workspace/components/ContentRewriterReview";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import AiGenerationError from "@/features/ai-workspace/components/AiGenerationError";
import AiGenerationStatusNote from "@/features/ai-workspace/components/AiGenerationStatusNote";
import {
  contentRewriterInputSchema,
  contentRewriterJobResultSchema,
  type ContentRewriterJobResult,
} from "@/features/ai-workspace/schemas/content-rewriter.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type SeoProjectOption = { id: string; name: string };
type ContentOption = { id: string; title: string; url: string | null; wordCount: number };

type ContentRewriterPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  contentByProject: Record<string, ContentOption[]>;
};

/**
 * Pure guard for the Generate button's enabled state, extracted so it's
 * directly unit-testable without mounting the component (this repository
 * has no React component-rendering test setup — see
 * ContentRewriterPicker.logic.test.ts). The server (startContentRewriteAction)
 * is the real security boundary regardless — this only prevents the UI from
 * ever submitting a selection that isn't one of the eligible ids it was
 * actually given, e.g. a stale selection left over from switching SEO
 * projects.
 */
export function computeCanGenerate(selectedContentId: string | null, eligibleContentIds: readonly string[]): boolean {
  return selectedContentId !== null && eligibleContentIds.includes(selectedContentId);
}

/** Phase B B5.1 — shown while no SEO project is chosen. A prompt to choose, never a claim that the project is invalid (only the server can determine that). */
export const SELECT_PROJECT_HINT = "Select an SEO project before generating.";

/**
 * The seventh AI Workspace tool's UI. Deliberately single-selection (a
 * radio list, not checkboxes) — this tool rewrites one existing page at a
 * time, per the approved v1 workflow. Reuses the exact same
 * job→poll→stream generation lifecycle every other AI Workspace tool's
 * picker already uses; nothing new invented here. Owns the Apply
 * confirm-dialog/state (Stage E) — ContentRewriterReview only renders what
 * this component tells it to and calls back on click, never the server
 * action itself. Every eligible Content row this component ever
 * sees was already filtered server-side (owned by the user's company,
 * belongs to the selected SEO project, has a real non-empty body) — this
 * component never re-derives or second-guesses that eligibility, and never
 * trusts anything about a page beyond what the server already vetted.
 */
export default function ContentRewriterPicker({ seoProjectOptions, contentByProject }: ContentRewriterPickerProps) {
  // Phase B B5.1 — deliberately unselected. Auto-selecting the first project
  // let a user generate against a project they never consciously chose; the
  // server still re-derives and enforces ownership regardless of this value.
  const [seoProjectId, setSeoProjectId] = useState("");
  const contentOptions = useMemo(() => contentByProject[seoProjectId] ?? [], [contentByProject, seoProjectId]);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);

  const [jobResult, setJobResult] = useState<ContentRewriterJobResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  const [hasApplied, setHasApplied] = useState(false);
  const [isApplying, startApplyTransition] = useTransition();

  function applyResult(resultJson: unknown) {
    const parsed = contentRewriterJobResultSchema.safeParse(resultJson);
    if (!parsed.success) {
      setErrorType(null);
      setError("Received an unexpected result — please try regenerating.");
      return;
    }
    setJobResult(parsed.data);
    setHasApplied(false);
  }

  const lifecycle = useAiGenerationLifecycle(resumeJob);

  /**
   * Reattaches to the job named in ?jobId=, whatever its current status —
   * same shape as every other AI Workspace picker's own resumeJob. Guards
   * that the job actually belongs to THIS tool and matches the currently
   * selected content — a stale or manually-edited jobId param must never
   * resurrect an unrelated generation here (same discipline
   * ExistingBriefLongFormGenerator's own resumeJob already established).
   */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "CONTENT_REWRITE") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = contentRewriterInputSchema.safeParse(job.inputJson);
    if (!parsedInput.success) {
      lifecycle.setActiveJob(null);
      return;
    }
    setSeoProjectId(parsedInput.data.seoProjectId);
    setSelectedContentId(parsedInput.data.contentId);

    if (job.status === "SUCCEEDED") {
      applyResult(job.resultJson);
      return;
    }
    if (job.status === "FAILED") {
      setErrorType(job.errorType);
      setError(job.errorMessage ?? "Generation failed.");
      return;
    }
    if (job.status === "PENDING" || job.status === "RUNNING") {
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
  }

  function selectContent(id: string) {
    setSelectedContentId(id);
  }

  async function runGenerate() {
    if (!selectedContentId) return;
    setError(null);
    setErrorType(null);
    setJobResult(null);
    setHasApplied(false);
    setIsGenerating(true);
    const response = await startContentRewriteAction({ seoProjectId, contentId: selectedContentId });

    if (!response.success) {
      setIsGenerating(false);
      setError(response.message);
      return;
    }

    lifecycle.setActiveJob(response.data.jobId);
    lifecycle.openGenerationStream(response.data.jobId);
    lifecycle.pollGenerationJob(response.data.jobId, {
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

  function handleCancel() {
    lifecycle.cancel(() => setIsGenerating(false));
  }

  /**
   * The approval gate, client side: requires an explicit click AND an
   * explicit confirm — never triggered by generation completing, never by
   * any automatic effect. Sends only the four literal rewritten strings
   * plus the ids needed to re-verify ownership server-side; the server
   * never trusts that the rewrite itself is still valid (see
   * applyContentRewriteAction).
   */
  function handleApplyRewrite() {
    if (!jobResult?.result) return;
    const result = jobResult.result;
    const confirmed = window.confirm(`Apply this rewrite to "${result.currentTitle}"? The current version will be saved as a revision first, so this can be undone later.`);
    if (!confirmed) return;

    startApplyTransition(async () => {
      const response = await applyContentRewriteAction({
        seoProjectId,
        contentId: result.contentId,
        title: result.rewrittenTitle,
        metaTitle: result.rewrittenMetaTitle,
        metaDescription: result.rewrittenMetaDescription,
        body: result.rewrittenBody,
      });
      if (!response.success) {
        toast.error(response.message);
        return;
      }
      toast.success(response.data.noOp ? "This page already matches this rewrite." : "Applied — the previous version was saved so this can be undone later.");
      setHasApplied(true);
    });
  }

  const eligibleContentIds = useMemo(() => contentOptions.map((c) => c.id), [contentOptions]);
  const canGenerate = computeCanGenerate(selectedContentId, eligibleContentIds);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seoProjectId" className="text-sm font-medium">
          SEO project
        </label>
        <select
          id="seoProjectId"
          className={selectClassName}
          value={seoProjectId}
          onChange={(e) => {
            setSeoProjectId(e.target.value);
            setSelectedContentId(null);
            setJobResult(null);
            setHasApplied(false);
          }}
        >
          <option value="">Select an SEO project…</option>
          {seoProjectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        {!seoProjectId && <p className="text-xs text-slate-500">{SELECT_PROJECT_HINT}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Page to rewrite</p>
        <p className="text-xs text-slate-500">Only pages with existing body content are shown — a brief-only page has nothing to rewrite yet.</p>

        {contentOptions.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">No eligible pages in this project yet.</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {contentOptions.map((option) => {
              const checked = selectedContentId === option.id;
              return (
                <label key={option.id} className="flex items-start gap-3 rounded-lg border border-transparent p-2 hover:bg-slate-50">
                  <input
                    type="radio"
                    name="contentId"
                    className="mt-1"
                    checked={checked}
                    onChange={() => selectContent(option.id)}
                  />
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium text-slate-800">{option.title}</p>
                    <p className="text-xs text-slate-400">{option.url ?? "No URL set"}</p>
                    <p className="text-xs text-slate-500">{option.wordCount.toLocaleString()} words currently</p>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <AiGenerationError error={error} errorType={errorType} />

      <AiGenerationStatusNote isSwitchingProvider={lifecycle.isSwitchingProvider} />
      {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.streamProgress !== null && (
        <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />
      )}

      <div className="flex gap-2">
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !seoProjectId || !canGenerate}>
          {isGenerating ? "Generating..." : "Generate rewrite"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {jobResult && jobResult.result === null && !isGenerating && (
        <p className="text-sm text-slate-500">No valid rewrite could be generated for this page. Try regenerating.</p>
      )}

      {jobResult && jobResult.result && (
        <ContentRewriterReview result={jobResult.result} isApplied={hasApplied} isApplying={isApplying} onApply={handleApplyRewrite} />
      )}
    </div>
  );
}
