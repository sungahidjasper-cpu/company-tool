"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, Globe, History, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import EmptyState from "@/components/dashboard/EmptyState";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { describeLlmError } from "@/lib/ai/providers/errors";
import {
  duplicateWebsiteAnalysisAction,
  getWebsiteAnalysisJobAction,
  retryWebsiteAnalysisAction,
  startWebsiteAnalysisAction,
} from "@/features/seo/actions/website-analysis.actions";
import SeoContentGapsTab from "@/features/seo/components/SeoContentGapsTab";
import SeoCrawledPagesTab from "@/features/seo/components/SeoCrawledPagesTab";
import SeoKeywordsTab from "@/features/seo/components/SeoKeywordsTab";
import SeoOverviewTab from "@/features/seo/components/SeoOverviewTab";
import SeoRecommendationsTab from "@/features/seo/components/SeoRecommendationsTab";
import SeoScoresTab from "@/features/seo/components/SeoScoresTab";
import SeoStructuredDataTab from "@/features/seo/components/SeoStructuredDataTab";
import { parseWebsiteAnalysisResult } from "@/features/seo/schemas/seo-audit.schema";
import type { WebsiteAnalysisJob } from "@/lib/generated/prisma/client";

const POLL_INTERVAL_MS = 3000;

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type HistoryItem = Pick<WebsiteAnalysisJob, "id" | "domain" | "status" | "overallScore" | "createdAt">;
type ClientOption = { id: string; name: string };

function getStageLabel(status: string, progress: number | null): string {
  if (status === "FAILED") return "Failed";
  if (status === "SUCCEEDED") return "Complete";
  if (status === "PENDING") return "Queued...";

  const p = progress ?? 0;
  if (p < 10) return "Starting...";
  if (p < 50) return "Crawling website...";
  if (p < 55) return "Scoring technical signals...";
  if (p < 70) return "Analyzing content with AI...";
  if (p < 95) return "Generating SEO audit...";
  return "Finalizing...";
}

function BadgeList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">None detected.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item} variant="secondary">
          {item}
        </Badge>
      ))}
    </div>
  );
}

type WebsiteAnalysisWorkspaceProps = {
  initialHistory: HistoryItem[];
  clientOptions: ClientOption[];
  /** Pre-loads a specific past analysis on mount — used when arriving from the Analysis History page ("reopen"). */
  initialJob?: WebsiteAnalysisJob | null;
};

export default function WebsiteAnalysisWorkspace({ initialHistory, clientOptions, initialJob }: WebsiteAnalysisWorkspaceProps) {
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<WebsiteAnalysisJob | null>(initialJob ?? null);
  const [history, setHistory] = useState<HistoryItem[]>(initialHistory);
  const [isLoadingHistoryItem, setIsLoadingHistoryItem] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (initialJob && (initialJob.status === "PENDING" || initialJob.status === "RUNNING")) {
      pollJob(initialJob.id);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount to pick up initialJob, matches this component's existing pattern of not re-running polling setup on prop changes
  }, []);

  function recordInHistory(job: WebsiteAnalysisJob) {
    setHistory((prev) =>
      [
        { id: job.id, domain: job.domain, status: job.status, overallScore: job.overallScore, createdAt: job.createdAt },
        ...prev.filter((entry) => entry.id !== job.id),
      ].slice(0, 10)
    );
  }

  function pollJob(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const result = await getWebsiteAnalysisJobAction(jobId);
      if (!result.success) {
        if (pollRef.current) clearInterval(pollRef.current);
        toast.error(result.message);
        return;
      }
      if (!result.data) return;
      setActiveJob(result.data);
      if (result.data.status === "SUCCEEDED" || result.data.status === "FAILED") {
        if (pollRef.current) clearInterval(pollRef.current);
        recordInHistory(result.data);
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const result = await startWebsiteAnalysisAction({ domain, clientId: clientId || undefined });
    setIsSubmitting(false);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success("Website analysis started");
    setDomain("");
    const initial = await getWebsiteAnalysisJobAction(result.data.id);
    if (initial.success && initial.data) setActiveJob(initial.data);
    pollJob(result.data.id);
  }

  async function handleRetry(jobId: string) {
    setIsRetrying(true);
    const result = await retryWebsiteAnalysisAction(jobId);
    setIsRetrying(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }

    const refreshed = await getWebsiteAnalysisJobAction(jobId);
    if (refreshed.success && refreshed.data) setActiveJob(refreshed.data);
    pollJob(jobId);
  }

  async function handleDuplicate(jobId: string) {
    setIsDuplicating(true);
    const result = await duplicateWebsiteAnalysisAction(jobId);
    setIsDuplicating(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }

    toast.success("Started a new analysis for this domain");
    const initial = await getWebsiteAnalysisJobAction(result.data.id);
    if (initial.success && initial.data) setActiveJob(initial.data);
    pollJob(result.data.id);
  }

  async function handleSelectHistory(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    setIsLoadingHistoryItem(id);
    const result = await getWebsiteAnalysisJobAction(id);
    setIsLoadingHistoryItem(null);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    if (result.data) setActiveJob(result.data);
  }

  const result = parseWebsiteAnalysisResult(activeJob);
  const isRunning = activeJob?.status === "PENDING" || activeJob?.status === "RUNNING";

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Analyze a website</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="domain" className="text-sm font-medium">
                Domain or URL
              </label>
              <div className="flex gap-2">
                <Input
                  id="domain"
                  placeholder="example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
                <Button type="submit" disabled={isSubmitting || !domain}>
                  {isSubmitting ? "Starting..." : "Analyze"}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="clientId" className="text-sm font-medium">
                Client <span className="text-slate-400">(optional)</span>
              </label>
              <select
                id="clientId"
                className={selectClassName}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">No client</option>
                {clientOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </form>
        </CardContent>
      </Card>

      {activeJob && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Globe size={16} className="text-slate-400" />
                {activeJob.domain}
              </span>
              <span className="flex items-center gap-2">
                {(activeJob.status === "SUCCEEDED" || activeJob.status === "FAILED") && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isDuplicating}
                    onClick={() => handleDuplicate(activeJob.id)}
                  >
                    <Copy size={14} /> {isDuplicating ? "Starting..." : "Duplicate analysis"}
                  </Button>
                )}
                <StatusBadge status={activeJob.status} />
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {isRunning && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm text-slate-600">
                  <span>{getStageLabel(activeJob.status, activeJob.progress)}</span>
                  <span>{activeJob.progress ?? 0}%</span>
                </div>
                <Progress value={activeJob.progress ?? 0} />
              </div>
            )}

            {activeJob.status === "FAILED" && (
              <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-destructive" />
                  <div className="flex flex-col gap-1">
                    {activeJob.errorType ? (
                      (() => {
                        const description = describeLlmError(activeJob.errorType);
                        return (
                          <>
                            <p className="font-medium text-destructive">{description.title}</p>
                            <p className="text-sm text-destructive/80">{description.message}</p>
                            <p className="text-sm text-destructive/80">{description.recommendedAction}</p>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <p className="font-medium text-destructive">Analysis failed</p>
                        <p className="text-sm text-destructive/80">
                          {activeJob.errorMessage ?? "An unknown error occurred."}
                        </p>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {activeJob.crawlResultJson && (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="w-fit"
                      disabled={isRetrying}
                      onClick={() => handleRetry(activeJob.id)}
                    >
                      <RotateCcw size={14} /> {isRetrying ? "Retrying..." : "Retry AI analysis"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => setActiveJob(null)}
                  >
                    Start new analysis
                  </Button>
                </div>
              </div>
            )}

            {result && (
              <div className="flex flex-col gap-5">
                {result.warnings.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <ul className="list-inside list-disc">
                      {result.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.audit ? (
                  <Tabs defaultValue="overview">
                    <TabsList>
                      <TabsTab value="overview">Overview</TabsTab>
                      <TabsTab value="scores">SEO Scores</TabsTab>
                      <TabsTab value="recommendations">Recommendations</TabsTab>
                      <TabsTab value="keywords">Keywords</TabsTab>
                      <TabsTab value="content-gaps">Content Opportunities</TabsTab>
                      <TabsTab value="structured-data">Structured Data</TabsTab>
                      <TabsTab value="crawled-pages">Crawled Pages</TabsTab>
                    </TabsList>

                    <TabsPanel value="overview">
                      <SeoOverviewTab
                        overallScore={result.audit.overallScore}
                        categoryScores={result.audit.categoryScores}
                        executiveSummary={result.audit.executiveSummary}
                      />
                    </TabsPanel>
                    <TabsPanel value="scores">
                      <SeoScoresTab
                        categoryScores={result.audit.categoryScores}
                        internalLinkingSuggestions={result.audit.internalLinkingSuggestions}
                        orphanPages={result.audit.orphanPages}
                      />
                    </TabsPanel>
                    <TabsPanel value="recommendations">
                      <SeoRecommendationsTab recommendations={result.audit.recommendations} />
                    </TabsPanel>
                    <TabsPanel value="keywords">
                      <SeoKeywordsTab keywordIntelligence={result.audit.keywordIntelligence} />
                    </TabsPanel>
                    <TabsPanel value="content-gaps">
                      <SeoContentGapsTab contentGaps={result.audit.contentGaps} />
                    </TabsPanel>
                    <TabsPanel value="structured-data">
                      <SeoStructuredDataTab
                        structuredDataRecommendations={result.audit.structuredDataRecommendations}
                        detectedSchemaTypes={result.audit.detectedSchemaTypes}
                      />
                    </TabsPanel>
                    <TabsPanel value="crawled-pages">
                      <SeoCrawledPagesTab
                        crawledPages={result.crawledPages}
                        sitemapUrlCount={result.sitemapUrlCount}
                      />
                    </TabsPanel>
                  </Tabs>
                ) : (
                  <div className="flex flex-col gap-5">
                    <p className="text-sm text-slate-500">
                      This analysis ran before SEO scoring was added — re-run it to see scores, recommendations,
                      and the rest of the audit.
                    </p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <Card size="sm">
                        <CardHeader>
                          <CardTitle className="text-sm">Business category</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm">{result.businessCategory}</p>
                        </CardContent>
                      </Card>
                      <Card size="sm">
                        <CardHeader>
                          <CardTitle className="text-sm">Locations served</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <BadgeList items={result.locations} />
                        </CardContent>
                      </Card>
                      <Card size="sm">
                        <CardHeader>
                          <CardTitle className="text-sm">Services &amp; products</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <BadgeList items={result.services} />
                        </CardContent>
                      </Card>
                      <Card size="sm">
                        <CardHeader>
                          <CardTitle className="text-sm">Primary topics</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <BadgeList items={result.topics} />
                        </CardContent>
                      </Card>
                    </div>
                    <SeoCrawledPagesTab crawledPages={result.crawledPages} sitemapUrlCount={result.sitemapUrlCount} />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History size={16} className="text-slate-400" />
            Recent analyses
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <EmptyState
              icon={Globe}
              title="No analyses yet"
              description="Run your first website analysis above."
            />
          ) : (
            <div className="flex flex-col gap-1">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handleSelectHistory(entry.id)}
                  disabled={isLoadingHistoryItem === entry.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  <span className="font-medium">{entry.domain}</span>
                  <span className="flex items-center gap-3 text-slate-500">
                    {entry.overallScore !== null && (
                      <span className="font-medium text-slate-700">{entry.overallScore}/100</span>
                    )}
                    {entry.createdAt.toLocaleDateString()}
                    <StatusBadge status={entry.status} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
