"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { startContentGapAnalysisAction } from "@/features/ai-workspace/actions/content-gap-analysis.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import {
  contentGapAnalysisInputSchema,
  contentGapAnalysisResultSchema,
  type ContentGapAnalysisResult,
} from "@/features/ai-workspace/schemas/content-gap-analysis.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const CONTENT_TYPE_LABELS: Record<string, string> = {
  ARTICLE: "Article",
  FAQ_PAGE: "FAQ page",
  LANDING_PAGE: "Landing page",
  CASE_STUDY: "Case study",
};

type SeoProjectOption = { id: string; name: string };

type ContentGapAnalysisPickerProps = {
  seoProjectOptions: SeoProjectOption[];
};

/** Pure guard, directly unit-testable — matching every other AI Workspace picker's own extracted-logic pattern. */
export function computeCanGenerateGapAnalysis(seoProjectId: string): boolean {
  return seoProjectId.trim().length > 0;
}

/**
 * The ninth AI Workspace tool's UI. No contentId, no notes field — per
 * Stage A discovery, the only real user input this tool needs is which SEO
 * project to analyze; the underlying Website Analysis audit is resolved
 * server-side. Reuses the exact same job→poll→stream generation lifecycle
 * every other AI Workspace picker already uses. Generate-and-display only —
 * no Apply/Save, matching Schema Markup Generator's own precedent.
 */
export default function ContentGapAnalysisPicker({ seoProjectOptions }: ContentGapAnalysisPickerProps) {
  const [seoProjectId, setSeoProjectId] = useState(seoProjectOptions[0]?.id ?? "");

  const [result, setResult] = useState<ContentGapAnalysisResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  function applyResult(resultJson: unknown) {
    const wrapper = resultJson as { result?: unknown } | null | undefined;
    const parsed = contentGapAnalysisResultSchema.safeParse(wrapper?.result);
    if (!parsed.success) {
      setErrorType(null);
      setError("Received an unexpected result — please try regenerating.");
      return;
    }
    setResult(parsed.data);
  }

  const lifecycle = useAiGenerationLifecycle(resumeJob);

  /** Reattaches to the job named in ?jobId=, whatever its current status — same shape as every other picker's own resumeJob. */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "CONTENT_GAP_ANALYSIS") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = contentGapAnalysisInputSchema.safeParse(job.inputJson);
    if (parsedInput.success) {
      setSeoProjectId(parsedInput.data.seoProjectId);
    }

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

  async function runGenerate() {
    setError(null);
    setErrorType(null);
    setResult(null);
    setIsGenerating(true);
    const response = await startContentGapAnalysisAction({ seoProjectId });

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seoProjectId" className="text-sm font-medium">
          SEO project
        </label>
        <select id="seoProjectId" className={selectClassName} value={seoProjectId} onChange={(e) => setSeoProjectId(e.target.value)}>
          {seoProjectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
          {errorType && <span className="ml-1 text-xs text-red-500">({errorType})</span>}
        </div>
      )}

      {isGenerating && lifecycle.streamProgress !== null && <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />}

      <div className="flex gap-2">
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !computeCanGenerateGapAnalysis(seoProjectId)}>
          {isGenerating ? "Generating..." : "Find content opportunities"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {result && result.opportunities.length === 0 && !isGenerating && (
        <p className="text-sm text-slate-500">No content gap opportunities were found in the latest SEO audit for this project.</p>
      )}

      {result && result.opportunities.length > 0 && (
        <div className="flex flex-col gap-4">
          {result.opportunities.map((item, index) => (
            <div key={`${item.topic}-${index}`} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-800">{item.topic}</p>
                {item.suggestedContentType ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {CONTENT_TYPE_LABELS[item.suggestedContentType] ?? item.suggestedContentType}
                  </span>
                ) : (
                  <span className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-400">No format suggested</span>
                )}
              </div>
              <p className="text-sm text-slate-600">{item.opportunity}</p>
              <p className="text-sm text-slate-500">{item.reason}</p>
              {item.relatedCluster && <p className="text-xs text-slate-400">Related keyword cluster: {item.relatedCluster}</p>}
              {item.existingCoverageStatus === "POSSIBLE_MATCH" ? (
                <p className="text-xs text-amber-600">
                  Possible overlap with an existing page: &quot;{item.matchedExistingTitle}&quot; — based on a simple title-text match, not a full content review.{" "}
                  {item.recommendedNextAction === "UPDATE_EXISTING"
                    ? "Recommended: consider updating that page."
                    : item.recommendedNextAction === "CREATE_NEW"
                      ? "Recommended: still create new content."
                      : "No next-step recommendation was returned — review this one yourself."}
                </p>
              ) : (
                <p className="text-xs text-emerald-600">No matching existing page title found — nothing to update, so this would be new content.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
