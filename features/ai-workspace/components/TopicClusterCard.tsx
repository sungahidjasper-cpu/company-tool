"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import type { TopicCluster, TopicExistingCoverage, TopicSupportingTopic } from "@/features/ai-workspace/schemas/topic-cluster-planner.schema";
import { clusterSelectionState, isTopicSelected } from "@/features/ai-workspace/services/topic-cluster-selection";

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

/** A classification badge, or an explicit "not suggested" marker — never a fabricated default. */
function Badges({ intent, contentType }: { intent: string | null; contentType: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {intent ? (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{INTENT_LABELS[intent] ?? intent}</span>
      ) : (
        <span className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-400">No intent suggested</span>
      )}
      {contentType ? (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{CONTENT_TYPE_LABELS[contentType] ?? contentType}</span>
      ) : (
        <span className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-400">No format suggested</span>
      )}
    </div>
  );
}

/** Deliberately hedged — this app has no semantic-coverage or ranking mechanism, so it must never imply one. */
function CoverageNote({ coverage }: { coverage: TopicExistingCoverage }) {
  if (coverage.status === "POSSIBLE_MATCH") {
    return (
      <p className="text-xs text-amber-600">
        Potential existing coverage: &quot;{coverage.matchedTitle}&quot; — title match only, not a full content review.
      </p>
    );
  }
  return <p className="text-xs text-emerald-600">No obvious title match in this project&apos;s existing content.</p>;
}

type TopicRowProps = {
  clusterName: string;
  topic: TopicSupportingTopic;
  selected: ReadonlySet<string>;
  onToggleTopic: (clusterName: string, topic: string) => void;
};

function TopicRow({ clusterName, topic, selected, onToggleTopic }: TopicRowProps) {
  const checked = isTopicSelected(selected, clusterName, topic.topic);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <span className="pt-0.5">
          <Checkbox
            checked={checked}
            onCheckedChange={() => onToggleTopic(clusterName, topic.topic)}
            aria-label={`Select supporting topic ${topic.topic}`}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium break-words text-slate-800">{topic.topic}</span>
            <Badges intent={topic.searchIntent} contentType={topic.suggestedContentType} />
          </span>
          {topic.relationshipToPillar && <span className="text-xs text-slate-600">{topic.relationshipToPillar}</span>}
          {topic.rationale && <span className="text-xs text-slate-500">{topic.rationale}</span>}
        </span>
      </label>

      {topic.subtopics.length > 0 && (
        <div className="mt-2 ml-7">
          <p className="text-xs font-medium text-slate-500">Subtopics to cover</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-slate-600">
            {topic.subtopics.map((subtopic) => (
              <li key={subtopic} className="break-words">
                {subtopic}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 ml-7 flex flex-col gap-1">
        {topic.relatedKeywords.length > 0 && <p className="text-xs text-slate-400">Related existing keywords: {topic.relatedKeywords.join(", ")}</p>}
        <CoverageNote coverage={topic.existingCoverage} />
        {topic.overlapNote && <p className="text-xs text-amber-600">{topic.overlapNote}</p>}
      </div>
    </li>
  );
}

export type TopicClusterCardProps = {
  cluster: TopicCluster;
  selected: ReadonlySet<string>;
  onToggleTopic: (clusterName: string, topic: string) => void;
  onToggleCluster: (clusterName: string, topics: readonly TopicSupportingTopic[], isSelected: boolean) => void;
  /** The first cluster opens by default so the result is never a wall of collapsed rows. */
  defaultExpanded?: boolean;
};

/**
 * One recommended cluster: collapsible, selectable, and showing the full
 * hierarchy (cluster → supporting topics → subtopics) rather than a flat
 * list. Progressive disclosure keeps the initial result readable when several
 * clusters come back.
 *
 * Selection is never indicated by colour alone — the checkbox state and the
 * "n of m selected" count both carry it.
 */
export default function TopicClusterCard({ cluster, selected, onToggleTopic, onToggleCluster, defaultExpanded = false }: TopicClusterCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const state = clusterSelectionState(selected, cluster.name, cluster.supportingTopics);
  const selectedCount = cluster.supportingTopics.filter((topic) => isTopicSelected(selected, cluster.name, topic.topic)).length;

  return (
    <div className={`flex flex-col gap-2 rounded-xl border bg-white p-4 ${state === "none" ? "border-slate-200" : "border-slate-400"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
          <span className="pt-0.5">
            <Checkbox
              checked={state === "all"}
              onCheckedChange={(value) => onToggleCluster(cluster.name, cluster.supportingTopics, value === true)}
              aria-label={`Select all supporting topics in ${cluster.name}`}
            />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-semibold break-words text-slate-800">{cluster.name}</span>
            {cluster.purpose && <span className="text-sm text-slate-600">{cluster.purpose}</span>}
          </span>
        </label>
        <Badges intent={cluster.searchIntent} contentType={cluster.suggestedContentType} />
      </div>

      {cluster.pillarRelationship && (
        <p className="text-xs text-slate-500">
          <span className="font-medium">How it supports the primary topic:</span> {cluster.pillarRelationship}
        </p>
      )}

      {cluster.relatedKeywords.length > 0 && <p className="text-xs text-slate-400">Related existing keywords: {cluster.relatedKeywords.join(", ")}</p>}
      <CoverageNote coverage={cluster.existingCoverage} />

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-fit items-center gap-1 rounded-lg px-1 py-1 text-sm font-medium text-slate-600 outline-none hover:text-slate-900 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {cluster.supportingTopics.length} supporting {cluster.supportingTopics.length === 1 ? "topic" : "topics"}
        <span className="font-normal text-slate-500">({selectedCount} selected)</span>
      </button>

      {expanded && (
        <>
          <ul className="flex list-none flex-col gap-2 pl-0">
            {cluster.supportingTopics.map((topic) => (
              <TopicRow key={topic.topic} clusterName={cluster.name} topic={topic} selected={selected} onToggleTopic={onToggleTopic} />
            ))}
          </ul>

          {cluster.contentIdeas.length > 0 && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">Further content ideas for this cluster</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-slate-600">
                {cluster.contentIdeas.map((idea) => (
                  <li key={idea} className="break-words">
                    {idea}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-slate-400">Ideas only — these are not selectable targets in this plan.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
