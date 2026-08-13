import Link from "next/link";

import StatusBadge from "@/components/dashboard/StatusBadge";
import { listRecentAiUsage } from "@/features/ai-usage/services/ai-usage.service";

type RecentAiGenerationsProps = {
  companyId: string;
};

/**
 * A small preview, not a rebuilt dashboard — reuses Phase 14's own
 * listRecentAiUsage (now company-scopable for CONTENT_BRIEF rows via
 * ai-usage.service.ts's seoProject-relation fix) rather than writing a new
 * query. Full history/filtering lives at /ai-usage; this just links there.
 */
export default async function RecentAiGenerations({ companyId }: RecentAiGenerationsProps) {
  const { rows } = await listRecentAiUsage(companyId, { page: 1, taskType: "CONTENT_BRIEF" }, 1, 5);

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No content briefs generated yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className="text-slate-600" title={row.createdAt.toISOString()}>
                {row.createdAt.toLocaleString()}
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
      <Link href="/ai-usage?taskType=CONTENT_BRIEF" className="text-sm font-medium text-primary hover:underline">
        View all in AI Usage →
      </Link>
    </div>
  );
}
