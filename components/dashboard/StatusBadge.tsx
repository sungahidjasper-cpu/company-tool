import { Badge } from "@/components/ui/badge";
import { formatEnumLabel } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  ACTIVE: "default",
  INVITED: "secondary",
  SUSPENDED: "destructive",
  LEAD: "secondary",
  INACTIVE: "outline",
  CHURNED: "destructive",
  PLANNING: "secondary",
  IN_PROGRESS: "default",
  ON_HOLD: "outline",
  COMPLETED: "default",
  CANCELLED: "destructive",
  ARCHIVED: "outline",
  // Phase 27 Stage 3 — a soft-deleted Content row's synthetic status label.
  // Distinct from ARCHIVED, which is also a real, independent ContentStatus
  // enum value (a live, still-active publishing stage) — reusing "ARCHIVED"
  // for both made a deleted row indistinguishable from a merely-archived
  // one. Content-only; every other entity's "Archived" has no such
  // collision and is left unchanged.
  TRASHED: "outline",
  NEW: "secondary",
  CONTACTED: "outline",
  QUALIFIED: "default",
  PROPOSAL_SENT: "default",
  NEGOTIATION: "secondary",
  WON: "default",
  LOST: "destructive",
  PENDING: "secondary",
  GENERATING: "secondary",
  FAILED: "destructive",
  PAUSED: "outline",
  DRAFT: "secondary",
  IN_REVIEW: "outline",
  APPROVED: "default",
  PUBLISHED: "default",
  NOT_STARTED: "secondary",
  RANKING: "default",
  ACHIEVED: "default",
  ABANDONED: "destructive",
  RUNNING: "outline",
  SUCCEEDED: "default",
  // WebsiteAnalysisIssue status + severity (Phase 11B)
  OPEN: "destructive",
  ACKNOWLEDGED: "secondary",
  RESOLVED: "default",
  IGNORED: "outline",
  CRITICAL: "destructive",
  // HIGH/MEDIUM/LOW fall through to the "outline" default below — Badge has
  // no fifth variant to distinguish them further than CRITICAL vs. the rest.
};

type StatusBadgeProps = {
  status: string;
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const variant = STATUS_VARIANTS[status] ?? "outline";

  return <Badge variant={variant}>{formatEnumLabel(status)}</Badge>;
}
