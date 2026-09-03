"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { startContentGapAnalysisAction } from "@/features/ai-workspace/actions/content-gap-analysis.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import AiGenerationError from "@/features/ai-workspace/components/AiGenerationError";
import AiGenerationStatusNote from "@/features/ai-workspace/components/AiGenerationStatusNote";
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

/** Phase B B5.1 — shown while no SEO project is chosen. A prompt to choose, never a claim that the project is invalid (only the server can determine that). */
export const SELECT_PROJECT_HINT = "Select an SEO project before generating.";

/**
 * Phase B B5.3 — this tool is review-only and never saves anything, so
 * without a Copy action the user had no way to get the output out. Mirrors
 * what the cards actually display, in the same order, as plain text: no
 * internal ids, no provider details, no debug fields. Omitted lines are
 * omitted rather than printed as "null" — a missing AI format suggestion
 * stays absent instead of being rendered as a value.
 */
export function formatOpportunitiesAsText(result: ContentGapAnalysisResult): string {
  return result.opportunities
    .map((item) => {
      const lines = [item.topic, item.opportunity, item.reason];
      if (item.relatedCluster) lines.push(`Related keyword cluster: ${item.relatedCluster}`);
      if (item.suggestedContentType) lines.push(`Suggested format: ${CONTENT_TYPE_LABELS[item.suggestedContentType] ?? item.suggestedContentType}`);
      lines.push(
        item.existingCoverageStatus === "POSSIBLE_MATCH"
          ? `Possible overlap with an existing page: "${item.matchedExistingTitle}" (title-text match only, not a full content review)`
          : "No matching existing page title found"
      );
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
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
  // Phase B B5.1 — deliberately unselected. Auto-selecting the first project
  // let a user generate against a project they never consciously chose; the
  // server still re-derives and enforces ownership regardless of this value.
  const [seoProjectId, setSeoProjectId] = useState("");

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

  /** Clipboard access can be denied (permissions, insecure context) — a failure is reported, never thrown at the user as an unhandled rejection. */
  async function copyOpportunities(current: ContentGapAnalysisResult) {
    try {
      await navigator.clipboard.writeText(formatOpportunitiesAsText(current));
      toast.success("Copied content opportunities to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seoProjectId" className="text-sm font-medium">
          SEO project
        </label>
        <select id="seoProjectId" className={selectClassName} value={seoProjectId} onChange={(e) => setSeoProjectId(e.target.value)}>
          <option value="">Select an SEO project…</option>
          {seoProjectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        {!seoProjectId && <p className="text-xs text-slate-500">{SELECT_PROJECT_HINT}</p>}
      </div>

      <AiGenerationError error={error} errorType={errorType} />

      <AiGenerationStatusNote isSwitchingProvider={lifecycle.isSwitchingProvider} />
      {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.streamProgress !== null && (
        <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />
      )}

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
        <div className="flex items-center justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => copyOpportunities(result)}>
            Copy opportunities
          </Button>
        </div>
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
