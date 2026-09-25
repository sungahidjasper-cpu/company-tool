"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildBriefHandoffHref } from "@/features/ai-workspace/services/content-gap-to-brief";
import { buildTopicBriefHandoff } from "@/features/ai-workspace/services/topic-cluster-to-brief";
import type { SelectionSummary } from "@/features/ai-workspace/services/topic-cluster-selection";

export type TopicClusterSelectionSummaryProps = {
  seoProjectId: string;
  primaryTopic: string;
  audience?: string;
  summary: SelectionSummary;
  onClearSelection: () => void;
};

/**
 * The review-before-generate step: what the user has actually chosen, and the
 * one action that carries it forward.
 *
 * Content generation deliberately goes through the EXISTING Content Brief
 * workflow rather than a second generation path. Compass's canonical route is
 * Brief → Content → Long-Form, and a brief describes exactly one page — so
 * each selected supporting topic gets its own "Create brief" link rather than
 * being bundled into one page that tries to be several.
 *
 * Nothing here writes anything. Following a link only prefills the Brief form;
 * the user still reviews it and explicitly generates, and the Brief's own
 * action re-derives company ownership and re-verifies the project.
 */
export default function TopicClusterSelectionSummary({ seoProjectId, primaryTopic, audience, summary, onClearSelection }: TopicClusterSelectionSummaryProps) {
  if (summary.topicCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-4">
        <p className="text-sm text-slate-500">
          Select the supporting topics you want to write. Nothing is created until you choose to create a brief.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
        <p className="text-sm font-semibold text-slate-800">Selected content plan</p>
        <p className="mt-1 text-xs text-slate-600">
          Primary topic: <span className="font-medium text-slate-800">{primaryTopic}</span>
        </p>
        <p className="text-xs text-slate-600">
          {summary.clusterCount} {summary.clusterCount === 1 ? "cluster" : "clusters"} · {summary.topicCount}{" "}
          {summary.topicCount === 1 ? "supporting topic" : "supporting topics"} selected
        </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClearSelection}>
          Clear selection
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {summary.byCluster.map((group) => (
          <div key={group.clusterName} className="flex flex-col gap-2">
            <p className="text-xs font-medium text-slate-500">{group.clusterName}</p>
            <ul className="flex list-none flex-col gap-2 pl-0">
              {group.topics.map((topic) => {
                const handoff = buildTopicBriefHandoff(seoProjectId, {
                  primaryTopic,
                  clusterName: group.clusterName,
                  topic,
                  audience,
                });
                return (
                  <li key={topic.topic} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <span className="min-w-0 flex-1 text-sm break-words text-slate-700">{topic.topic}</span>
                    {handoff ? (
                      <Link
                        href={buildBriefHandoffHref(handoff)}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                        aria-label={`Create a content brief for ${topic.topic}`}
                      >
                        <FileText size={14} /> Create brief
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400">Not enough detail to start a brief</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Each brief opens the existing Content Brief form with this topic&apos;s context prefilled. You review it there, and content is only created when you
        generate and save it.
      </p>
    </div>
  );
}
