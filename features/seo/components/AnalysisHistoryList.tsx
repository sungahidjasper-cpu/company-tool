"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, History, Minus } from "lucide-react";

import EmptyState from "@/components/dashboard/EmptyState";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { Button } from "@/components/ui/button";
import type { WebsiteAnalysisJob } from "@/lib/generated/prisma/client";

type HistoryEntry = Pick<WebsiteAnalysisJob, "id" | "domain" | "status" | "overallScore" | "createdAt">;

type AnalysisHistoryListProps = {
  seoProjectId: string;
  history: HistoryEntry[];
};

function ScoreDelta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  if (diff === 0) {
    return (
      <span className="flex items-center gap-0.5 text-xs text-slate-400">
        <Minus size={12} /> 0
      </span>
    );
  }
  const isUp = diff > 0;
  return (
    <span className={`flex items-center gap-0.5 text-xs ${isUp ? "text-emerald-600" : "text-destructive"}`}>
      {isUp ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {Math.abs(diff)}
    </span>
  );
}

/** History is ordered newest-first — each entry's "previous" for delta purposes is the next (older) entry in the array. */
export default function AnalysisHistoryList({ seoProjectId, history }: AnalysisHistoryListProps) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((entryId) => entryId !== id);
      if (prev.length < 2) return [...prev, id];
      return [prev[1], id];
    });
  }

  if (history.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No analyses yet"
        description="Run a website analysis for this project to see its history here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {selected.length === 2 && (
        <div className="flex items-center justify-end">
          <Link
            href={`/seo/${seoProjectId}/analysis-history/compare?a=${selected[0]}&b=${selected[1]}`}
            className="inline-flex"
          >
            <Button type="button" size="sm">
              Compare selected
            </Button>
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {history.map((entry, index) => {
          const previous = history[index + 1] ?? null;
          return (
            <div
              key={entry.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                aria-label={`Select ${entry.domain} run from ${entry.createdAt.toLocaleDateString()} for comparison`}
                checked={selected.includes(entry.id)}
                onChange={() => toggleSelect(entry.id)}
                className="size-4 rounded border-input"
              />
              <span className="w-32 shrink-0 text-slate-500">{entry.createdAt.toLocaleString()}</span>
              <span className="flex-1 font-medium">{entry.domain}</span>
              {entry.overallScore !== null && (
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  {entry.overallScore}/100
                  <ScoreDelta current={entry.overallScore} previous={previous?.overallScore ?? null} />
                </span>
              )}
              <StatusBadge status={entry.status} />
              <Link
                href={`/seo/website-analysis?jobId=${entry.id}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                Reopen
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
