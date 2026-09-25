"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { startTopicClusterPlannerAction } from "@/features/ai-workspace/actions/topic-cluster-planner.actions";
import { getAiGenerationJobAction } from "@/features/ai-workspace/actions/ai-generation-job.actions";
import { useAiGenerationLifecycle } from "@/features/ai-workspace/hooks/use-ai-generation-lifecycle";
import AiGenerationError from "@/features/ai-workspace/components/AiGenerationError";
import AiGenerationStatusNote from "@/features/ai-workspace/components/AiGenerationStatusNote";
import {
  parseTopicClusterPlanResult,
  topicClusterPlannerInputSchema,
  type TopicClusterPlanResult,
  type TopicSupportingTopic,
} from "@/features/ai-workspace/schemas/topic-cluster-planner.schema";
import TopicClusterCard from "@/features/ai-workspace/components/TopicClusterCard";
import TopicClusterSelectionSummary from "@/features/ai-workspace/components/TopicClusterSelectionSummary";
import {
  canGenerateContent,
  setClusterSelected,
  summarizeSelection,
  toggleTopic,
} from "@/features/ai-workspace/services/topic-cluster-selection";
import { type LlmErrorType } from "@/lib/ai/providers/errors";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const INTENT_LABELS: Record<string, string> = {
  INFORMATIONAL: "Informational",
  COMMERCIAL: "Commercial",
  TRANSACTIONAL: "Transactional",
  NAVIGATIONAL: "Navigational",
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  ARTICLE: "Article",
  GUIDE: "Guide",
  LANDING_PAGE: "Landing page",
  FAQ_PAGE: "FAQ page",
  CASE_STUDY: "Case study",
  COMPARISON: "Comparison",
};

type SeoProjectOption = { id: string; name: string };
type KeywordOption = { id: string; term: string };

type TopicClusterPlannerPickerProps = {
  seoProjectOptions: SeoProjectOption[];
  /** The actor's own project keywords, already company-scoped and non-soft-deleted server-side. */
  keywordsByProject: Record<string, KeywordOption[]>;
};

/** Pure guard, directly unit-testable — matching every other AI Workspace picker's extracted-logic pattern. */
export function computeCanGeneratePlan(seoProjectId: string, seedTopic: string): boolean {
  return seoProjectId.trim().length > 0 && seedTopic.trim().length >= 3;
}

/** Shown while no SEO project is chosen — a prompt to choose, never a claim that the project is invalid. */
export const SELECT_PROJECT_HINT = "Select an SEO project before generating.";

export const TOPIC_CLUSTER_EMPTY_RESULT_MESSAGE =
  "No topic cluster was returned — the AI response didn't meet our quality requirements this time. Please try generating again.";

/**
 * Review-only tool with no save step, so Copy is the only way to get the plan
 * out. Mirrors exactly what the cards display, in the same order, as plain
 * text: no internal ids, no provider details. Absent classifications are
 * omitted rather than printed as "null", and the seed topic is labelled as
 * the user's own input so a pasted plan stays honest about its provenance.
 */
export function formatPlanAsText(result: TopicClusterPlanResult): string {
  const lines: string[] = [`Primary topic (your input): ${result.seedTopic}`];

  if (result.existingClusterNames.length > 0) {
    lines.push(`Existing keyword clusters in this project: ${result.existingClusterNames.join(", ")}`);
  }

  for (const cluster of result.clusters) {
    lines.push("", `CLUSTER: ${cluster.name}`);
    if (cluster.purpose) lines.push(cluster.purpose);
    if (cluster.pillarRelationship) lines.push(`How it supports the primary topic: ${cluster.pillarRelationship}`);
    if (cluster.searchIntent) lines.push(`Search intent: ${INTENT_LABELS[cluster.searchIntent]}`);
    if (cluster.suggestedContentType) lines.push(`Suggested format: ${CONTENT_TYPE_LABELS[cluster.suggestedContentType]}`);
    if (cluster.relatedKeywords.length > 0) lines.push(`Related existing keywords: ${cluster.relatedKeywords.join(", ")}`);
    if (cluster.existingCoverage.status === "POSSIBLE_MATCH") {
      lines.push(`Potential existing coverage: "${cluster.existingCoverage.matchedTitle}" (title match only)`);
    }

    for (const topic of cluster.supportingTopics) {
      lines.push("", `  SUPPORTING TOPIC: ${topic.topic}`);
      if (topic.relationshipToPillar) lines.push(`  Relationship: ${topic.relationshipToPillar}`);
      if (topic.rationale) lines.push(`  Why: ${topic.rationale}`);
      if (topic.searchIntent) lines.push(`  Search intent: ${INTENT_LABELS[topic.searchIntent]}`);
      if (topic.suggestedContentType) lines.push(`  Suggested format: ${CONTENT_TYPE_LABELS[topic.suggestedContentType]}`);
      if (topic.subtopics.length > 0) lines.push(`  Subtopics: ${topic.subtopics.join("; ")}`);
      if (topic.relatedKeywords.length > 0) lines.push(`  Related existing keywords: ${topic.relatedKeywords.join(", ")}`);
      if (topic.existingCoverage.status === "POSSIBLE_MATCH") {
        lines.push(`  Potential existing coverage: "${topic.existingCoverage.matchedTitle}" (title match only)`);
      }
      if (topic.overlapNote) lines.push(`  ${topic.overlapNote}`);
    }

    if (cluster.contentIdeas.length > 0) lines.push("", `  Further content ideas: ${cluster.contentIdeas.join("; ")}`);
  }

  return lines.join("\n");
}

/**
 * The tenth AI Workspace tool. Follows the exact generate→job→poll lifecycle
 * every other picker uses. Generate-and-display only: nothing is saved, and
 * no Keyword, KeywordCluster or Content record is ever created or modified.
 */
export default function TopicClusterPlannerPicker({ seoProjectOptions, keywordsByProject }: TopicClusterPlannerPickerProps) {
  // Deliberately unselected — auto-selecting the first project would let a
  // user generate against one they never consciously chose. The server
  // re-derives and enforces ownership regardless of this value.
  const [seoProjectId, setSeoProjectId] = useState("");
  const [seedTopic, setSeedTopic] = useState("");
  const [keywordIds, setKeywordIds] = useState<string[]>([]);
  const [audience, setAudience] = useState("");
  const [notes, setNotes] = useState("");

  const [result, setResult] = useState<TopicClusterPlanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<LlmErrorType | null>(null);

  const keywordOptions = useMemo(() => keywordsByProject[seoProjectId] ?? [], [keywordsByProject, seoProjectId]);

  function applyResult(resultJson: unknown) {
    const wrapper = resultJson as { result?: unknown } | null | undefined;
    // Handles both the current multi-cluster shape and a plan generated before
    // the enhancement (presented as one cluster rather than discarded).
    const parsed = parseTopicClusterPlanResult(wrapper?.result);
    if (!parsed) {
      setErrorType(null);
      setError("Received an unexpected result — please try regenerating.");
      return;
    }
    setSelected(new Set());
    setResult(parsed);
  }

  const lifecycle = useAiGenerationLifecycle(resumeJob);

  /** Reattaches to the job named in ?jobId=, whatever its status — same shape as every other picker's resumeJob. */
  async function resumeJob(jobId: string) {
    const poll = await getAiGenerationJobAction(jobId);
    if (!poll.success || !poll.data || poll.data.taskType !== "TOPIC_CLUSTER_PLANNING") {
      lifecycle.setActiveJob(null);
      return;
    }
    const job = poll.data;
    const parsedInput = topicClusterPlannerInputSchema.safeParse(job.inputJson);
    if (parsedInput.success) {
      setSeoProjectId(parsedInput.data.seoProjectId);
      setSeedTopic(parsedInput.data.seedTopic);
      setKeywordIds(parsedInput.data.keywordIds);
      setAudience(parsedInput.data.audience ?? "");
      setNotes(parsedInput.data.notes ?? "");
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

  function toggleKeyword(id: string, checked: boolean) {
    setKeywordIds((prev) => (checked ? [...prev, id] : prev.filter((k) => k !== id)));
  }

  function selectProject(id: string) {
    setSeoProjectId(id);
    // Keyword ids belong to a specific project; carrying a stale selection
    // across a project change would submit ids the new project cannot own.
    setKeywordIds([]);
  }

  async function runGenerate() {
    setError(null);
    setErrorType(null);
    setResult(null);
    setSelected(new Set());
    setIsGenerating(true);

    const response = await startTopicClusterPlannerAction({
      seoProjectId,
      seedTopic: seedTopic.trim(),
      keywordIds,
      audience: audience.trim() || undefined,
      notes: notes.trim() || undefined,
    });

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
  async function copyPlan(current: TopicClusterPlanResult) {
    try {
      await navigator.clipboard.writeText(formatPlanAsText(current));
      toast.success("Copied topic cluster plan to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function handleToggleTopic(clusterName: string, topic: string) {
    setSelected((prev) => toggleTopic(prev, clusterName, topic));
  }

  function handleToggleCluster(clusterName: string, topics: readonly TopicSupportingTopic[], isSelected: boolean) {
    setSelected((prev) => setClusterSelected(prev, clusterName, topics, isSelected));
  }

  const summary = summarizeSelection(result, selected);
  const hasPlan = result !== null && result.clusters.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seoProjectId" className="text-sm font-medium">
          SEO project
        </label>
        <select id="seoProjectId" className={selectClassName} value={seoProjectId} onChange={(e) => selectProject(e.target.value)}>
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
        <label htmlFor="seedTopic" className="text-sm font-medium">
          Primary topic
        </label>
        <Input
          id="seedTopic"
          value={seedTopic}
          onChange={(e) => setSeedTopic(e.target.value)}
          placeholder="e.g. self storage investing"
          maxLength={200}
        />
        <p className="text-xs text-slate-500">
          Your starting topic. Recommendations are built around this topic and available project data — it is your input, not a keyword discovered from your
          data.
        </p>
      </div>

      {seoProjectId && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Include existing keywords (optional)</span>
          {keywordOptions.length === 0 ? (
            <p className="text-xs text-slate-500">This project has no tracked keywords yet — the plan will be built from your primary topic alone.</p>
          ) : (
            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3">
              {keywordOptions.map((keyword) => (
                <label key={keyword.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={keywordIds.includes(keyword.id)} onCheckedChange={(value) => toggleKeyword(keyword.id, value === true)} />
                  <span>{keyword.term}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="audience" className="text-sm font-medium">
          Target audience (optional)
        </label>
        <Input id="audience" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. first-time commercial property investors" />
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
          placeholder="Anything else that should shape the cluster."
        />
      </div>

      <AiGenerationError error={error} errorType={errorType} />

      <AiGenerationStatusNote isSwitchingProvider={lifecycle.isSwitchingProvider} />
      {isGenerating && !lifecycle.isSwitchingProvider && lifecycle.streamProgress !== null && (
        <Progress value={lifecycle.streamProgress} aria-label="Generation progress" />
      )}

      <div className="flex gap-2">
        <Button type="button" onClick={runGenerate} disabled={isGenerating || !computeCanGeneratePlan(seoProjectId, seedTopic)}>
          {isGenerating ? "Generating..." : "Plan topic cluster"}
        </Button>
        {isGenerating && (
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {result && !hasPlan && !isGenerating && <p className="text-sm text-slate-500">{TOPIC_CLUSTER_EMPTY_RESULT_MESSAGE}</p>}

      {result && hasPlan && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Recommended clusters</p>
              <p className="text-xs text-slate-500">
                Primary topic (your input): <span className="font-medium text-slate-700">{result.seedTopic}</span>
                {result.existingClusterNames.length > 0 && <> · Existing keyword clusters: {result.existingClusterNames.join(", ")}</>}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => copyPlan(result)}>
              Copy plan
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            {result.clusters.map((cluster, index) => (
              <TopicClusterCard
                key={cluster.name}
                cluster={cluster}
                selected={selected}
                onToggleTopic={handleToggleTopic}
                onToggleCluster={handleToggleCluster}
                defaultExpanded={index === 0}
              />
            ))}
          </div>

          <TopicClusterSelectionSummary
            seoProjectId={seoProjectId}
            primaryTopic={result.seedTopic}
            audience={audience.trim() || undefined}
            summary={summary}
            onClearSelection={() => setSelected(new Set())}
          />

          <p className="text-xs text-slate-400">
            These clusters are AI recommendations. Nothing has been saved — no keywords, clusters, or content were created or changed.
            {canGenerateContent(summary) ? " Creating a brief opens the existing Content Brief form; content is only created when you generate and save it." : ""}
          </p>
        </>
      )}
    </div>
  );
}
