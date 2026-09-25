"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { startCompetitorContentAnalysisAction } from "@/features/ai-workspace/actions/competitor-content-analysis.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import AiGenerationError from "@/features/ai-workspace/components/AiGenerationError";
import AiGenerationStatusNote from "@/features/ai-workspace/components/AiGenerationStatusNote";
import {
  competitorAnalysisResultSchema,
  competitorContentAnalysisInputSchema,
  MAX_COMPETITOR_URLS,
  type CompetitorAnalysisResult,
} from "@/features/ai-workspace/schemas/competitor-content-analysis.schema";
import { normalizeCompetitorUrl } from "@/features/ai-workspace/services/competitor-url";
import { buildCompetitorOpportunityBriefHandoff } from "@/features/ai-workspace/services/competitor-opportunity-to-brief";
import { buildBriefHandoffHref } from "@/features/ai-workspace/services/content-gap-to-brief";
import { type LlmErrorType } from "@/lib/ai/providers/errors";
import { cn } from "@/lib/utils";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const FORMAT_LABELS: Record<string, string> = {
  ARTICLE: "Article",
  GUIDE: "Guide",
  LANDING_PAGE: "Landing page",
  FAQ_PAGE: "FAQ page",
  CASE_STUDY: "Case study",
  COMPARISON: "Comparison",
  PRODUCT_PAGE: "Product page",
  OTHER: "Other",
};

const INTENT_LABELS: Record<string, string> = {
  INFORMATIONAL: "Informational",
  COMMERCIAL: "Commercial",
  TRANSACTIONAL: "Transactional",
  NAVIGATIONAL: "Navigational",
};

type SeoProjectOption = { id: string; name: string };

type CompetitorContentAnalysisPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  /** Competitor URLs already stored on the company's Brand Profile — offered, never mandatory. */
  brandProfileCompetitorUrls: string[];
};

/** Pure guard, directly unit-testable — matching every other AI Workspace picker's extracted-logic pattern. */
export function computeCanAnalyze(seoProjectId: string, competitorUrls: readonly string[]): boolean {
  if (seoProjectId.trim() === "") return false;
  return competitorUrls.some((url) => normalizeCompetitorUrl(url).ok);
}

/** Shown while no SEO project is chosen — a prompt to choose, never a claim that the project is invalid. */
export const SELECT_PROJECT_HINT = "Select an SEO project before analysing.";

export const COMPETITOR_EMPTY_RESULT_MESSAGE =
  "No analysis was returned — the AI response didn't meet our quality requirements this time. Please try generating again.";

/**
 * Review-only tool with no save step, so Copy is the only way to get the
 * analysis out. Keeps observation and recommendation separate in the copied
 * text exactly as they are on screen, and omits absent classifications rather
 * than printing them as "null".
 */
export function formatAnalysisAsText(result: CompetitorAnalysisResult): string {
  const lines: string[] = [];
  if (result.targetTopic) lines.push(`Focus (your input): ${result.targetTopic}`);

  for (const site of result.competitors) {
    lines.push("", `COMPETITOR: ${site.origin}`);
    lines.push(`Source: ${site.source === "BRAND_PROFILE" ? "Brand Profile competitor URL" : "User-provided competitor URL"}`);
    lines.push(`Pages analysed: ${site.pagesAnalyzed}`);
    if (site.warnings.length > 0) lines.push(`Crawl notes: ${site.warnings.join(" ")}`);

    for (const page of site.pages) {
      lines.push("", `  OBSERVED PAGE: ${page.url}`);
      if (page.title) lines.push(`  Title: ${page.title}`);
      if (page.observedTopic) lines.push(`  Observed topic: ${page.observedTopic}`);
      if (page.format) lines.push(`  Format: ${FORMAT_LABELS[page.format]}`);
      if (page.searchIntent) lines.push(`  Apparent intent: ${INTENT_LABELS[page.searchIntent]}`);
      if (page.keyCoverage.length > 0) lines.push(`  Covers: ${page.keyCoverage.join("; ")}`);
    }
  }

  if (result.opportunities.length > 0) {
    lines.push("", "CONTENT OPPORTUNITIES (recommendations, not observations)");
    for (const opportunity of result.opportunities) {
      lines.push("", `- ${opportunity.topic}`);
      if (opportunity.whyItMatters) lines.push(`  Why it matters: ${opportunity.whyItMatters}`);
      if (opportunity.suggestedContentType) lines.push(`  Suggested format: ${FORMAT_LABELS[opportunity.suggestedContentType]}`);
      if (opportunity.recommendedAction) lines.push(`  Recommended next step: ${opportunity.recommendedAction}`);
      if (opportunity.relatedKeywords.length > 0) lines.push(`  Related existing keywords: ${opportunity.relatedKeywords.join(", ")}`);
      lines.push(
        opportunity.existingCoverage.status === "POSSIBLE_MATCH"
          ? `  Potential existing coverage: "${opportunity.existingCoverage.matchedTitle}" (title match only)`
          : "  No obvious title match in your existing content."
      );
    }
  }

  return lines.join("\n").trim();
}

/**
 * The eleventh AI Workspace tool. Follows the exact generate→job→poll lifecycle
 * every other picker uses. Generate-and-display only: nothing is saved, no
 * crawl result is persisted, and no Brand Profile, Content or Keyword row is
 * ever created or modified.
 */
export default function CompetitorContentAnalysisPicker({ seoProjectOptions, brandProfileCompetitorUrls }: CompetitorContentAnalysisPickerProps) {
  // Deliberately unselected — auto-selecting the first project would let a user
  // analyse against one they never consciously chose. The server re-derives and
  // enforces ownership regardless of this value.
  const [seoProjectId, setSeoProjectId] = useState("");
  const [competitorUrls, setCompetitorUrls] = useState<string[]>([""]);
  const [targetTopic, setTargetTopic] = useState("");
  const [notes, setNotes] = useState("");

  const [result, setResult] = useState<CompetitorAnalysisResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  function applyResult(resultJson: unknown) {
    const wrapper = resultJson as { result?: unknown } | null | undefined;
    const parsed = competitorAnalysisResultSchema.safeParse(wrapper?.result);
    if (!parsed.success) {
      setErrorType(null);
      setError("Received an unexpected result — please try generating again.");
      return;
    }
    setResult(parsed.data);
  }

  const lifecycle = useAiGenerationLifecycle(resumeJob);

  /** Reattaches to the job named in ?jobId=, whatever its status — same shape as every other picker's resumeJob. */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "COMPETITOR_CONTENT_ANALYSIS") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const stored = job.inputJson as { seoProjectId?: string; competitors?: { origin: string }[]; targetTopic?: string; notes?: string } | null;
    if (stored?.seoProjectId) setSeoProjectId(stored.seoProjectId);
    if (Array.isArray(stored?.competitors) && stored.competitors.length > 0) {
      setCompetitorUrls(stored.competitors.map((c) => c.origin));
    }
    setTargetTopic(stored?.targetTopic ?? "");
    setNotes(stored?.notes ?? "");

    if (job.status === "SUCCEEDED") {
      applyResult(job.resultJson);
      return;
    }
    if (job.status === "FAILED") {
      setErrorType(job.errorType);
      setError(job.errorMessage ?? "Analysis failed.");
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

  function updateUrl(index: number, value: string) {
    setCompetitorUrls((prev) => prev.map((url, i) => (i === index ? value : url)));
  }

  function addUrlField() {
    setCompetitorUrls((prev) => (prev.length >= MAX_COMPETITOR_URLS ? prev : [...prev, ""]));
  }

  function removeUrlField(index: number) {
    setCompetitorUrls((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  /** Fills the first empty field, so using a Brand Profile URL never overwrites something typed. */
  function applyBrandProfileUrl(url: string) {
    setCompetitorUrls((prev) => {
      if (prev.some((existing) => existing.trim() === url.trim())) return prev;
      const emptyIndex = prev.findIndex((existing) => existing.trim() === "");
      if (emptyIndex >= 0) return prev.map((existing, i) => (i === emptyIndex ? url : existing));
      if (prev.length >= MAX_COMPETITOR_URLS) return prev;
      return [...prev, url];
    });
  }

  async function runGenerate() {
    setError(null);
    setErrorType(null);
    setResult(null);
    setIsGenerating(true);

    const urls = competitorUrls.map((url) => url.trim()).filter((url) => url !== "");
    const validated = competitorContentAnalysisInputSchema.safeParse({
      seoProjectId,
      competitorUrls: urls,
      targetTopic: targetTopic.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    if (!validated.success) {
      setIsGenerating(false);
      setError(validated.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }

    const response = await startCompetitorContentAnalysisAction(validated.data);
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

  /** Clipboard access can be denied (permissions, insecure context) — reported, never thrown as an unhandled rejection. */
  async function copyAnalysis(current: CompetitorAnalysisResult) {
    try {
      await navigator.clipboard.writeText(formatAnalysisAsText(current));
      toast.success("Copied competitor analysis to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  const hasResult = result !== null && result.competitors.length > 0;

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

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Competitor URLs</span>
        {competitorUrls.map((url, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              id={index === 0 ? "competitorUrl" : undefined}
              className="min-w-0 flex-1"
              value={url}
              onChange={(e) => updateUrl(index, e.target.value)}
              placeholder="https://competitor.com"
              aria-label={`Competitor URL ${index + 1}`}
            />
            {competitorUrls.length > 1 && (
              <Button type="button" variant="outline" size="sm" onClick={() => removeUrlField(index)} aria-label={`Remove competitor URL ${index + 1}`}>
                Remove
              </Button>
            )}
          </div>
        ))}
        {competitorUrls.length < MAX_COMPETITOR_URLS && (
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addUrlField}>
            Add another competitor
          </Button>
        )}
        <p className="text-xs text-slate-500">
          Public https addresses only. Compass reads a sample of pages from each site using the same crawler as Website Analysis, respecting robots.txt.
        </p>
      </div>

      {brandProfileCompetitorUrls.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 p-3">
          <span className="text-sm font-medium">From your Brand Profile</span>
          <p className="text-xs text-slate-500">Competitor URLs already saved for your company. Using one is optional.</p>
          <div className="flex flex-wrap gap-2">
            {brandProfileCompetitorUrls.map((url) => (
              <Button key={url} type="button" variant="outline" size="sm" onClick={() => applyBrandProfileUrl(url)}>
                {url}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="targetTopic" className="text-sm font-medium">
          Focus topic (optional)
        </label>
        <Input id="targetTopic" value={targetTopic} onChange={(e) => setTargetTopic(e.target.value)} placeholder="e.g. self storage investing" maxLength={200} />
        <p className="text-xs text-slate-500">Narrows the analysis to one subject. Leave blank to review the pages as they come.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          className={textareaClassName}
          value={notes}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything else that should shape the analysis."
        />
      </div>

      <AiGenerationError error={error} errorType={errorType} />

      <AiGenerationStatusNote isSwitchingProvider={lifecycle.isSwitchingProvider} />
      {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.streamProgress !== null && (
        <Progress value={lifecycle.streamProgress} aria-label="Analysis progress" />
      )}
      {isGenerating && <p className="text-xs text-slate-500">Reading competitor pages, then analysing. This can take a minute.</p>}

      <div className="flex gap-2">
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !computeCanAnalyze(seoProjectId, competitorUrls)}>
          {isGenerating ? "Analysing..." : "Analyse competitor content"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {result && !hasResult && !isGenerating && <p className="text-sm text-slate-500">{COMPETITOR_EMPTY_RESULT_MESSAGE}</p>}

      {result && hasResult && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Competitor analysis</p>
              {result.targetTopic && (
                <p className="text-xs text-slate-500">
                  Focus (your input): <span className="font-medium text-slate-700">{result.targetTopic}</span>
                </p>
              )}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => copyAnalysis(result)}>
              Copy analysis
            </Button>
          </div>

          {result.competitors.map((site) => (
            <div key={site.origin} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold break-all text-slate-800">{site.origin}</p>
                  <p className="text-xs text-slate-500">
                    {site.source === "BRAND_PROFILE" ? "Brand Profile competitor URL" : "User-provided competitor URL"} · {site.pagesAnalyzed}{" "}
                    {site.pagesAnalyzed === 1 ? "page" : "pages"} read
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Observed</span>
              </div>

              {site.warnings.length > 0 && (
                <p className="text-xs text-amber-600">
                  Crawl notes: {site.warnings.join(" ")} Only the pages listed below were read — this is a sample, not the whole site.
                </p>
              )}

              <ul className="flex list-none flex-col gap-2 pl-0">
                {site.pages.map((page) => (
                  <li key={page.url} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-medium break-words text-slate-800">{page.title ?? "(no title)"}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {page.format ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{FORMAT_LABELS[page.format]}</span>
                        ) : (
                          <span className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-400">
                            No format classified
                          </span>
                        )}
                        {page.searchIntent && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{INTENT_LABELS[page.searchIntent]}</span>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs break-all text-slate-400">{page.url}</p>
                    {page.observedTopic && <p className="mt-1 text-sm text-slate-600">{page.observedTopic}</p>}
                    {page.keyCoverage.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-xs text-slate-600">
                        {page.keyCoverage.map((item) => (
                          <li key={item} className="break-words">
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {result.opportunities.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">Content opportunities</p>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">Recommendations</span>
              </div>
              {result.opportunities.map((opportunity) => (
                <div key={opportunity.topic} className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-medium break-words text-slate-800">{opportunity.topic}</p>
                    {opportunity.suggestedContentType && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {FORMAT_LABELS[opportunity.suggestedContentType]}
                      </span>
                    )}
                  </div>
                  {opportunity.whyItMatters && <p className="text-sm text-slate-600">{opportunity.whyItMatters}</p>}
                  {opportunity.recommendedAction && <p className="text-sm text-slate-500">{opportunity.recommendedAction}</p>}
                  {opportunity.relatedKeywords.length > 0 && (
                    <p className="text-xs text-slate-400">Related existing keywords: {opportunity.relatedKeywords.join(", ")}</p>
                  )}
                  {opportunity.existingCoverage.status === "POSSIBLE_MATCH" ? (
                    <p className="text-xs text-amber-600">
                      Potential existing coverage: &quot;{opportunity.existingCoverage.matchedTitle}&quot; — title match only, not a full content review.
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-600">No obvious title match in your existing content.</p>
                  )}
                  {(() => {
                    /*
                     * Hand-off into the existing Content Brief workflow. Rendered only when
                     * the opportunity actually yields one, so a malformed item can never
                     * start a brief from nothing. The href carries ids and editable text
                     * only — the Brief's own action re-derives the company from the
                     * authenticated actor and re-verifies the project.
                     */
                    const handoff = buildCompetitorOpportunityBriefHandoff(
                      seoProjectId,
                      opportunity,
                      result.competitors.map((site) => site.origin)
                    );
                    if (!handoff) return null;
                    return (
                      <div className="pt-1">
                        <Link href={buildBriefHandoffHref(handoff)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                          <Sparkles size={16} /> Create Content Brief
                        </Link>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-400">
            Competitor pages above were read from the sites you named. Opportunities are AI recommendations. Compass has no ranking, traffic or backlink data
            for any site, so none is shown. Nothing has been saved.
          </p>
        </>
      )}
    </div>
  );
}
