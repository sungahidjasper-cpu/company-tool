"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { applyMetaTagSuggestionAction, startMetaTagOptimizerAction } from "@/features/ai-workspace/actions/meta-tag-optimizer.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import AiGenerationError from "@/features/ai-workspace/components/AiGenerationError";
import AiGenerationStatusNote from "@/features/ai-workspace/components/AiGenerationStatusNote";
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

/**
 * Decides what the "why this change" area may safely show, given only the
 * two deterministic change flags — never the reasoning text itself, which
 * this function never reads. The AI's `reasoning` is a single combined
 * blob that can (and, live, does) make claims about BOTH fields regardless
 * of which one actually changed — so it is only safe to show verbatim when
 * BOTH fields changed, since then nothing it says about either field can be
 * a false claim about an unchanged one. When only one field changed, the
 * combined reasoning cannot be safely attributed to just that field (it may
 * still describe the other, unchanged one), so this returns a plain,
 * deterministic statement of WHAT changed instead — never a fabricated or
 * inferred WHY, just the same titleChanged/descriptionChanged facts already
 * computed server-side, restated in words. This is not "rewriting" the AI's
 * reasoning — the reasoning text itself is never touched, edited, or
 * partially shown; it is either displayed exactly as returned, or not
 * displayed at all.
 */
export type ReasoningDisplay = "AI_REASONING" | "TITLE_ONLY" | "DESCRIPTION_ONLY" | "NO_CHANGE";

export function computeReasoningDisplay(titleChanged: boolean, descriptionChanged: boolean): ReasoningDisplay {
  if (titleChanged && descriptionChanged) return "AI_REASONING";
  if (titleChanged) return "TITLE_ONLY";
  if (descriptionChanged) return "DESCRIPTION_ONLY";
  return "NO_CHANGE";
}

/**
 * Whether the "Apply this suggestion" control should be shown at all. A
 * suggestion with neither field changed has nothing to apply (applying it
 * would be a literal no-op write), and a suggestion already applied this
 * session shouldn't offer to be applied again — the user would need to
 * regenerate to get a fresh suggestion. The server's own no-op detection
 * (see applyMetaTagSuggestionAction) is the real safety net regardless; this
 * only controls whether the button is worth showing.
 */
export function computeIsApplyEligible(titleChanged: boolean, descriptionChanged: boolean, alreadyApplied: boolean): boolean {
  if (alreadyApplied) return false;
  return titleChanged || descriptionChanged;
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
 * Renders a suggested title/description field, honoring the deterministic
 * titleChanged/descriptionChanged the service computed (a real string
 * comparison, never the AI's own reasoning) — discovered live: the AI can
 * return the exact current text back while its `reasoning` still claims a
 * change was made. When unchanged, this shows "No change suggested"
 * instead of repeating the identical text next to "Current," so nothing
 * here implies a change happened when it didn't. The guidance badge is
 * still shown either way — it's accurate, harmless information about the
 * text's length regardless of whether it was actually changed.
 */
function SuggestedField({ label, changed, text, guidance }: { label: string; changed: boolean; text: string; guidance: LengthGuidance }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-slate-200 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      {changed ? <p className="text-sm text-slate-800">{text}</p> : <p className="text-sm italic text-slate-500">No change suggested</p>}
      <GuidanceBadge guidance={guidance} />
    </div>
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
/**
 * Phase B B3.1 — shown when generation completes but yields nothing usable.
 * Deliberately neutral: an empty result almost always means the AI response
 * failed our deterministic quality checks (often after a fallback to a weaker
 * provider), not that the user chose the wrong page, project or platforms.
 * Wording matches PRESS_RELEASE_NULL_RESULT_MESSAGE, which fixed this same
 * defect class. Genuine validation failures keep their own specific messages.
 */
export const META_TAG_EMPTY_RESULT_MESSAGE = "No suggestions were returned — the AI response didn't meet our quality requirements this time. Please try generating again.";

/** Phase B B5.1 — shown while no SEO project is chosen. A prompt to choose, never a claim that the project is invalid (only the server can determine that). */
export const SELECT_PROJECT_HINT = "Select an SEO project before generating.";

export default function MetaTagOptimizerPicker({ seoProjectOptions, contentByProject }: MetaTagOptimizerPickerProps) {
  // Phase B B5.1 — deliberately unselected. Auto-selecting the first project
  // let a user generate against a project they never consciously chose; the
  // server still re-derives and enforces ownership regardless of this value.
  const [seoProjectId, setSeoProjectId] = useState("");
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

  const [appliedContentIds, setAppliedContentIds] = useState<Set<string>>(new Set());
  const [applyingContentId, setApplyingContentId] = useState<string | null>(null);
  const [isApplyPending, startApplyTransition] = useTransition();

  /**
   * The approval gate, client side: requires an explicit click AND an
   * explicit confirm — never triggered by generation completing, never by
   * any automatic effect. Sends only the two literal suggested strings plus
   * the ids needed to re-verify ownership server-side; the server never
   * trusts that the suggestion itself is still valid (see
   * applyMetaTagSuggestionAction).
   */
  function handleApplySuggestion(contentId: string, pageTitle: string, metaTitle: string, metaDescription: string) {
    const confirmed = window.confirm(`Apply this suggestion to "${pageTitle}"? The current meta title and description will be saved as a revision first, so this can be undone later.`);
    if (!confirmed) return;

    setApplyingContentId(contentId);
    startApplyTransition(async () => {
      const response = await applyMetaTagSuggestionAction({ seoProjectId, contentId, metaTitle, metaDescription });
      setApplyingContentId(null);
      if (!response.success) {
        toast.error(response.message);
        return;
      }
      toast.success(response.data.noOp ? "This page's meta title and description already match this suggestion." : "Applied — the previous version was saved so this can be undone later.");
      setAppliedContentIds((current) => new Set(current).add(contentId));
    });
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
            setSelectedIds(new Set());
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

      <AiGenerationError error={error} errorType={errorType} />

      <AiGenerationStatusNote isSwitchingProvider={lifecycle.isSwitchingProvider} />
      {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.streamProgress !== null && (
        <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />
      )}

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
        <p className="text-sm text-slate-500">{META_TAG_EMPTY_RESULT_MESSAGE}</p>
      )}

      {omittedContent.length > 0 && !isGenerating && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          No suggestion was generated for {omittedContent.length === 1 ? "this page" : `these ${omittedContent.length} pages`}: {omittedContent.map((c) => c.title).join(", ")}.
        </p>
      )}

      {result && result.suggestions.length > 0 && (
        <div className="flex flex-col gap-4">
          {result.suggestions.map((suggestion) => {
            const pageTitle = contentOptions.find((c) => c.id === suggestion.contentId)?.title ?? suggestion.contentId;
            const isApplied = appliedContentIds.has(suggestion.contentId);
            return (
            <div key={suggestion.contentId} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-800">{pageTitle}</p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${isApplied ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}
                >
                  {isApplied ? "Applied" : "Suggested metadata — not applied"}
                </span>
              </div>
              {suggestion.url && <p className="text-xs text-slate-400">{suggestion.url}</p>}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Current meta title</p>
                  <p className="text-sm text-slate-600">{suggestion.currentMetaTitle ?? <span className="italic text-slate-400">none set</span>}</p>
                </div>
                <SuggestedField label="Suggested meta title" changed={suggestion.titleChanged} text={suggestion.suggestedMetaTitle} guidance={suggestion.titleLengthGuidance} />

                <div className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Current meta description</p>
                  <p className="text-sm text-slate-600">{suggestion.currentMetaDescription ?? <span className="italic text-slate-400">none set</span>}</p>
                </div>
                <SuggestedField label="Suggested meta description" changed={suggestion.descriptionChanged} text={suggestion.suggestedMetaDescription} guidance={suggestion.descriptionLengthGuidance} />
              </div>

              {(() => {
                const display = computeReasoningDisplay(suggestion.titleChanged, suggestion.descriptionChanged);
                if (display === "AI_REASONING") {
                  return (
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Why this change</p>
                      <p className="text-sm text-slate-600">{suggestion.reasoning}</p>
                    </div>
                  );
                }
                if (display === "NO_CHANGE") {
                  return (
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-sm italic text-slate-500">No change suggested for this page — the AI returned the same title and description already in place.</p>
                    </div>
                  );
                }
                // Only one field changed — the AI's reasoning is one combined
                // blob that may describe BOTH fields, so it can't be safely
                // attributed to just the one that actually changed. Never
                // shown here; only the already-computed, deterministic fact
                // of which field changed is stated.
                return (
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-sm italic text-slate-500">
                      {display === "TITLE_ONLY"
                        ? "Only the meta title changed for this page — see the suggested title above. The meta description is unchanged."
                        : "Only the meta description changed for this page — see the suggested description above. The meta title is unchanged."}
                    </p>
                  </div>
                );
              })()}

              {computeIsApplyEligible(suggestion.titleChanged, suggestion.descriptionChanged, isApplied) && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isApplyPending}
                    onClick={() => handleApplySuggestion(suggestion.contentId, pageTitle, suggestion.suggestedMetaTitle, suggestion.suggestedMetaDescription)}
                  >
                    {isApplyPending && applyingContentId === suggestion.contentId ? "Applying…" : "Apply this suggestion"}
                  </Button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
