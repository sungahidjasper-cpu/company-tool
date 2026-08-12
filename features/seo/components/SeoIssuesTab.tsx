"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import { toast } from "sonner";

import EmptyState from "@/components/dashboard/EmptyState";
import StatusBadge from "@/components/dashboard/StatusBadge";
import { updateIssueStatusAction } from "@/features/seo/actions/seo-issue.actions";
import type { WebsiteAnalysisIssue, WebsiteAnalysisIssueStatus } from "@/lib/generated/prisma/client";
import { formatEnumLabel } from "@/lib/utils";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "IGNORED"] as const;

type SeoIssuesTabProps = {
  jobId: string;
  issues: WebsiteAnalysisIssue[];
};

export default function SeoIssuesTab({ jobId, issues: sourceIssues }: SeoIssuesTabProps) {
  // Not copied into useState: the parent fetches issues asynchronously
  // (after this component's first render), so a one-time useState(prop)
  // snapshot would permanently miss that later update. Status edits are
  // tracked as a small override map instead, applied on top of the prop at
  // render time — always in sync with the parent, no staleness possible.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, WebsiteAnalysisIssueStatus>>({});
  const issues = sourceIssues.map((issue) =>
    statusOverrides[issue.id] ? { ...issue, status: statusOverrides[issue.id] } : issue
  );
  const [severityFilter, setSeverityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const issueTypes = Array.from(new Set(issues.map((issue) => issue.issueType))).sort();

  const filtered = issues.filter(
    (issue) =>
      (!severityFilter || issue.severity === severityFilter) &&
      (!typeFilter || issue.issueType === typeFilter) &&
      (!statusFilter || issue.status === statusFilter)
  );

  async function handleStatusChange(issueId: string, status: WebsiteAnalysisIssueStatus) {
    setUpdatingId(issueId);
    const result = await updateIssueStatusAction(issueId, jobId, status);
    setUpdatingId(null);

    if (!result.success) {
      toast.error(result.message);
      return;
    }
    setStatusOverrides((prev) => ({ ...prev, [issueId]: status }));
  }

  if (issues.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No issues detected"
        description="This analysis didn't turn up any itemized technical issues."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <select
          className={selectClassName + " max-w-40"}
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="">All severities</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {formatEnumLabel(severity)}
            </option>
          ))}
        </select>
        <select className={selectClassName + " max-w-56"} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All issue types</option>
          {issueTypes.map((type) => (
            <option key={type} value={type}>
              {formatEnumLabel(type)}
            </option>
          ))}
        </select>
        <select className={selectClassName + " max-w-40"} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {formatEnumLabel(status)}
            </option>
          ))}
        </select>
        <span className="flex items-center text-sm text-slate-500">
          {filtered.length} of {issues.length} issue{issues.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No issues match the current filters.</p>
        ) : (
          filtered.map((issue) => {
            const isExpanded = expandedId === issue.id;
            return (
              <div key={issue.id} className="rounded-lg border border-slate-200">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => setExpandedId(isExpanded ? null : issue.id)}
                >
                  {isExpanded ? <ChevronDown size={14} className="shrink-0 text-slate-400" /> : <ChevronRight size={14} className="shrink-0 text-slate-400" />}
                  <StatusBadge status={issue.severity} />
                  <span className="flex-1 font-medium">{formatEnumLabel(issue.issueType)}</span>
                  {issue.url && <span className="max-w-64 truncate text-slate-500">{issue.url}</span>}
                  <StatusBadge status={issue.status} />
                </button>

                {isExpanded && (
                  <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-700">What&apos;s wrong</p>
                      <p className="text-slate-600">{issue.explanation}</p>
                    </div>
                    <div>
                      <p className="font-medium text-slate-700">Recommended fix</p>
                      <p className="text-slate-600">{issue.recommendedFix}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label htmlFor={`status-${issue.id}`} className="font-medium text-slate-700">
                        Status
                      </label>
                      <select
                        id={`status-${issue.id}`}
                        className={selectClassName + " max-w-40"}
                        value={issue.status}
                        disabled={updatingId === issue.id}
                        onChange={(e) => handleStatusChange(issue.id, e.target.value as WebsiteAnalysisIssueStatus)}
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {formatEnumLabel(status)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
