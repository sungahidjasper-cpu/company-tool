"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { startInternalLinkAnalysisAction } from "@/features/ai-workspace/actions/internal-link-analyzer.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import { internalLinkAnalyzerInputSchema, internalLinkAnalysisResultSchema, type InternalLinkAnalysisResult } from "@/features/ai-workspace/schemas/internal-link-analyzer.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const PRIORITY_STYLES: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700 border-red-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-slate-50 text-slate-600 border-slate-200",
};

type SeoProjectOption = { id: string; name: string };
type ContentOption = { id: string; title: string };

type InternalLinkAnalyzerPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  contentByProject: Record<string, ContentOption[]>;
};

/**
 * The fourth AI Workspace tool, following the exact generate→job→poll shape
 * SchemaMarkupGeneratorPicker.tsx already uses — but contentId is REQUIRED
 * here, not optional: every recommendation is "add a link FROM this page,"
 * so there is always a source page to select. No save/apply step: this
 * tool's output is never persisted or auto-inserted into any Content row
 * (see internal-link-analyzer.service.ts's own comment on why).
 */
export default function InternalLinkAnalyzerPicker({ seoProjectOptions, contentByProject }: InternalLinkAnalyzerPickerProps) {
  const [seoProjectId, setSeoProjectId] = useState(seoProjectOptions[0]?.id ?? "");
  const contentOptions = useMemo(() => contentByProject[seoProjectId] ?? [], [contentByProject, seoProjectId]);
  const [contentId, setContentId] = useState(contentOptions[0]?.id ?? "");

  const [result, setResult] = useState<InternalLinkAnalysisResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  function applyResult(resultJson: unknown) {
    const parsed = internalLinkAnalysisResultSchema.safeParse(resultJson);
    if (!parsed.success) {
      setErrorType(null);
      setError("Received an unexpected result — please try regenerating.");
      return;
    }
    setResult(parsed.data);
  }

  const lifecycle = useAiGenerationLifecycle(resumeJob);

  /**
   * Reattaches to the job named in ?jobId=, whatever its current status —
   * same shape as SchemaMarkupGeneratorPicker.tsx's own resumeJob. Declared
   * AFTER `lifecycle` above (referenced there only by name, via hoisting)
   * so its own references to `lifecycle` inside are ordinary closures, not
   * forward references.
   */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "INTERNAL_LINK_ANALYSIS") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = internalLinkAnalyzerInputSchema.safeParse(job.inputJson);
    if (!parsedInput.success) {
      lifecycle.setActiveJob(null);
      return;
    }
    setSeoProjectId(parsedInput.data.seoProjectId);
    setContentId(parsedInput.data.contentId);

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
    const response = await startInternalLinkAnalysisAction({ seoProjectId, contentId });

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
        <select
          id="seoProjectId"
          className={selectClassName}
          value={seoProjectId}
          onChange={(e) => {
            setSeoProjectId(e.target.value);
            setContentId(contentByProject[e.target.value]?.[0]?.id ?? "");
          }}
        >
          {seoProjectOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contentId" className="text-sm font-medium">
          Page to analyze
        </label>
        <select id="contentId" className={selectClassName} value={contentId} onChange={(e) => setContentId(e.target.value)}>
          {contentOptions.length === 0 && <option value="">No pages in this project yet</option>}
          {contentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
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
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !seoProjectId || !contentId}>
          {isGenerating ? "Analyzing..." : "Analyze internal links"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {result && result.recommendations.length === 0 && !isGenerating && (
        <p className="text-sm text-slate-500">No strong internal-linking opportunities were found for this page. Try analyzing a different page, or add more content to this project first.</p>
      )}

      {result && result.recommendations.length > 0 && (
        <div className="flex flex-col gap-3">
          {result.recommendations.map((rec, index) => (
            <div key={`${rec.targetPage}-${index}`} className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-800">&ldquo;{rec.anchorText}&rdquo;</p>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[rec.priority] ?? PRIORITY_STYLES.LOW}`}>{rec.priority}</span>
              </div>
              <p className="text-sm text-slate-500">
                Link to: <span className="font-medium text-slate-700">{rec.targetPage}</span>
              </p>
              <p className="text-sm text-slate-500">{rec.reason}</p>
              <p className="text-xs text-slate-400">Placement: {rec.placement}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
