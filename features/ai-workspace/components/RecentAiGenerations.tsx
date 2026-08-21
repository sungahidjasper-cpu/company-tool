import Link from "next/link";

import StatusBadge from "@/components/dashboard/StatusBadge";
import { listRecentAiUsage } from "@/features/ai-usage/services/ai-usage.service";
import { formatEnumLabel } from "@/lib/utils";

type RecentAiGenerationsProps = {
  companyId: string;
};

/**
 * A small preview, not a rebuilt dashboard — reuses Phase 14's own
 * listRecentAiUsage (now company-scopable for CONTENT_BRIEF rows via
 * ai-usage.service.ts's seoProject-relation fix) rather than writing a new
 * query. Full history/filtering lives at /ai-usage; this just links there.
 *
 * Phase 23 Stage 4 — this widget covers both AI Workspace generation types
 * (CONTENT_BRIEF and CONTENT_DRAFT), not just briefs. AiUsageLog is a
 * shared table also used by Website Analysis's own AI calls (EXTRACTION,
 * SCORES, RECOMMENDATIONS, CONTENT_INTELLIGENCE, EXECUTIVE_SUMMARY —
 * AI_TASK_TYPES in ai-usage-filters.ts), and listRecentAiUsage's company
 * scope explicitly includes rows linked via websiteAnalysisJob.companyId
 * — so simply omitting the taskType filter would surface Website
 * Analysis activity on this AI Workspace page. listRecentAiUsage has no
 * "multiple specific task types" filter, so the two AI Workspace types
 * are fetched with two calls to the exact same, unmodified function and
 * merged here — no new query or service, no Website Analysis leakage.
 */
export default async function RecentAiGenerations({ companyId }: RecentAiGenerationsProps) {
  const [{ rows: briefRows }, { rows: draftRows }] = await Promise.all([
    listRecentAiUsage(companyId, { page: 1, taskType: "CONTENT_BRIEF" }, 1, 5),
    listRecentAiUsage(companyId, { page: 1, taskType: "CONTENT_DRAFT" }, 1, 5),
  ]);
  const rows = [...briefRows, ...draftRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 5);

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No generations yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-slate-600">
                <span className="text-xs font-medium text-slate-500">{formatEnumLabel(row.taskType)}</span>
                <span title={row.createdAt.toISOString()}>{row.createdAt.toLocaleString()}</span>
              </span>
              <span className="flex items-center gap-3">
                {row.estimatedCostUsd !== null && (
                  <span className="text-slate-500">${Number(row.estimatedCostUsd).toFixed(6)}</span>
                )}
                <StatusBadge status={row.succeeded ? "SUCCEEDED" : "FAILED"} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/ai-usage" className="text-sm font-medium text-primary hover:underline">
        View all in AI Usage →
      </Link>
    </div>
  );
}
