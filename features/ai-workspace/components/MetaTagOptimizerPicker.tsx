"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { startMetaTagOptimizerAction } from "@/features/ai-workspace/actions/meta-tag-optimizer.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import {
  MAX_SELECTED_CONTENT,
  metaTagOptimizerInputSchema,
  metaTagOptimizerResultSchema,
  type LengthGuidance,
  type MetaTagOptimizerResult,
} from "@/features/ai-workspace/schemas/meta-tag-optimizer.schema";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type SeoProjectOption = { id: string; name: string };
type ContentOption = { id: string; title: string; url: string | null; currentMetaTitle: string | null; currentMetaDescription: string | null };

type MetaTagOptimizerPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  contentByProject: Record<string, ContentOption[]>;
};

/**
 * Pure selection-toggle logic, extracted so it's directly unit-testable
 * without mounting the component (this repository has no React
 * component-rendering test setup — see MetaTagOptimizerPicker.logic.test.ts
 * for why). Enforces the same MAX_SELECTED_CONTENT cap the server-side
 * schema also enforces — this is a UI convenience, never the actual
 * security boundary (startMetaTagOptimizerAction's own Zod validation is).
 * Returns the EXACT SAME Set instance, unchanged, when the cap would be
 * exceeded (rather than an equal copy), so a caller can compare by
 * reference (=== ) to detect a no-op and show a "limit reached" message.
 */
export function computeSelectionAfterToggle(current: Set<string>, id: string, checked: boolean, max: number): Set<string> {
  if (checked) {
    if (current.has(id) || current.size < max) {
      const next = new Set(current);
      next.add(id);
      return next;
    }
    return current;
  }
  const next = new Set(current);
  next.delete(id);
  return next;
}

/** Pure "select all visible" logic — always caps at `max`, never silently selects more than the server would accept. */
export function computeSelectAllCapped(ids: readonly string[], max: number): string[] {
  return ids.slice(0, max);
}

/**
 * Pure partial-result computation: which selected pages have NO returned
 * suggestion. Never fabricates a placeholder for them — this function only
 * ever narrows the already-selected list down to the ones missing a match,
 * it never invents an entry that wasn't already in `selected`.
 */
export function computeOmittedContent<T extends { id: string }>(contentOptions: readonly T[], selectedIds: ReadonlySet<string>, suggestions: readonly { contentId: string }[]): T[] {
  const suggestedIds = new Set(suggestions.map((s) => s.contentId));
  return contentOptions.filter((c) => selectedIds.has(c.id) && !suggestedIds.has(c.id));
}

/** A small local badge — mirrors seo-checklist.service.ts's LengthCheck shape/status vocabulary (OK/TOO_SHORT/TOO_LONG), rendered here rather than importing that file's own component (which is Content-Brief-review-specific), per Stage B's own schema comment on why this tool computes its own guidance. */
function GuidanceBadge({ guidance }: { guidance: LengthGuidance }) {
  const style =
    guidance.status === "OK"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : guidance.status === "TOO_SHORT"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";
  const label = guidance.status === "OK" ? "Within guidance" : guidance.status === "TOO_SHORT" ? "Shorter than guidance" : "Longer than guidance";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}>
      {guidance.length.toLocaleString()} / {guidance.min}-{guidance.max} chars — {label}
    </span>
  );
}

/**
 * The sixth AI Workspace tool's UI — Stage D (generate + review only, no
 * apply). Deliberately does NOT reuse ContentListTable/BulkActionsBar (the
 * separate SEO content list feature) — this is a dedicated, self-contained
 * multi-select experience, matching how every other AI Workspace tool's
 * own component never shares code with a different feature area. The
 * generation side reuses the exact same job→poll→stream pattern every
 * other tool's picker already uses; nothing new was invented here.
 */
export default function MetaTagOptimizerPicker({ seoProjectOptions, contentByProject }: MetaTagOptimizerPickerProps) {
  const [seoProjectId, setSeoProjectId] = useState(seoProjectOptions[0]?.id ?? "");
  const contentOptions = useMemo(() => contentByProject[seoProjectId] ?? [], [contentByProject, seoProjectId]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [result, setResult] = useState<MetaTagOptimizerResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  function applyResult(resultJson: unknown) {
    const parsed = metaTagOptimizerResultSchema.safeParse(resultJson);
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
   * same shape as every other AI Workspace picker's own resumeJob. Declared
   * AFTER `lifecycle` above (referenced there only by name, via hoisting)
   * so its own references to `lifecycle` inside are ordinary closures, not
   * forward references.
   */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "META_TAG_OPTIMIZATION") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = metaTagOptimizerInputSchema.safeParse(job.inputJson);
    if (!parsedInput.success) {
      lifecycle.setActiveJob(null);
      return;
    }
    setSeoProjectId(parsedInput.data.seoProjectId);
    setSelectedIds(new Set(parsedInput.data.contentIds));

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

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = computeSelectionAfterToggle(current, id, checked, MAX_SELECTED_CONTENT);
      if (checked && next === current) {
        toast.error(`You can select at most ${MAX_SELECTED_CONTENT} pages at once.`);
      }
      return next;
    });
  }

  function selectAllVisible() {
    const capped = computeSelectAllCapped(
      contentOptions.map((c) => c.id),
      MAX_SELECTED_CONTENT
    );
    if (contentOptions.length > MAX_SELECTED_CONTENT) {
      toast(`Selected the first ${MAX_SELECTED_CONTENT} pages — that's the limit per generation.`);
    }
    setSelectedIds(new Set(capped));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function runGenerate() {
    setError(null);
    setErrorType(null);
    setResult(null);
    setIsGenerating(true);
    const response = await startMetaTagOptimizerAction({ seoProjectId, contentIds: Array.from(selectedIds) });

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

  // Partial-result awareness (never fabricated): whichever selected pages
  // are absent from the returned suggestions simply have no card below —
  // this just names them so the user isn't left guessing why.
  const omittedContent = useMemo(() => (result ? computeOmittedContent(contentOptions, selectedIds, result.suggestions) : []), [result, contentOptions, selectedIds]);

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
            setSelectedIds(new Set());
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
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Pages to optimize</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {selectedIds.size} / {MAX_SELECTED_CONTENT} selected
            </span>
            <Button type="button" variant="outline" size="sm" onClick={selectAllVisible} disabled={contentOptions.length === 0}>
              Select all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={selectedIds.size === 0}>
              Clear
            </Button>
          </div>
        </div>

        {contentOptions.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">No pages in this project yet.</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {contentOptions.map((option) => {
              const checked = selectedIds.has(option.id);
              const disabled = !checked && selectedIds.size >= MAX_SELECTED_CONTENT;
              return (
                <label key={option.id} className={`flex items-start gap-3 rounded-lg border border-transparent p-2 hover:bg-slate-50 ${disabled ? "opacity-50" : ""}`}>
                  <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => toggleOne(option.id, value === true)} className="mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium text-slate-800">{option.title}</p>
                    <p className="text-xs text-slate-400">{option.url ?? "No URL set"}</p>
                    <p className="text-xs text-slate-500">
                      Current title: {option.currentMetaTitle ? `"${option.currentMetaTitle}"` : <span className="italic text-slate-400">none set</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      Current description: {option.currentMetaDescription ? `"${option.currentMetaDescription}"` : <span className="italic text-slate-400">none set</span>}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
          {errorType && <span className="ml-1 text-xs text-red-500">({errorType})</span>}
        </div>
      )}

      {isGenerating && lifecycle.streamProgress !== null && <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />}

      <div className="flex gap-2">
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !seoProjectId || selectedIds.size === 0}>
          {isGenerating ? "Generating..." : "Generate suggestions"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {result && result.suggestions.length === 0 && !isGenerating && (
        <p className="text-sm text-slate-500">No suggestions were generated for the selected pages. Try a different selection.</p>
      )}

      {omittedContent.length > 0 && !isGenerating && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          No suggestion was generated for {omittedContent.length === 1 ? "this page" : `these ${omittedContent.length} pages`}: {omittedContent.map((c) => c.title).join(", ")}.
        </p>
      )}

      {result && result.suggestions.length > 0 && (
        <div className="flex flex-col gap-4">
          {result.suggestions.map((suggestion) => (
            <div key={suggestion.contentId} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-800">{contentOptions.find((c) => c.id === suggestion.contentId)?.title ?? suggestion.contentId}</p>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">Suggested metadata — not applied</span>
              </div>
              {suggestion.url && <p className="text-xs text-slate-400">{suggestion.url}</p>}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Current meta title</p>
                  <p className="text-sm text-slate-600">{suggestion.currentMetaTitle ?? <span className="italic text-slate-400">none set</span>}</p>
                </div>
                <div className="flex flex-col gap-1 rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Suggested meta title</p>
                  <p className="text-sm text-slate-800">{suggestion.suggestedMetaTitle}</p>
                  <GuidanceBadge guidance={suggestion.titleLengthGuidance} />
                </div>

                <div className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Current meta description</p>
                  <p className="text-sm text-slate-600">{suggestion.currentMetaDescription ?? <span className="italic text-slate-400">none set</span>}</p>
                </div>
                <div className="flex flex-col gap-1 rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Suggested meta description</p>
                  <p className="text-sm text-slate-800">{suggestion.suggestedMetaDescription}</p>
                  <GuidanceBadge guidance={suggestion.descriptionLengthGuidance} />
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Why this change</p>
                <p className="text-sm text-slate-600">{suggestion.reasoning}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
