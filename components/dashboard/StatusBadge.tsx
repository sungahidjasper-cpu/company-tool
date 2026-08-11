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
};

type StatusBadgeProps = {
  status: string;
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const variant = STATUS_VARIANTS[status] ?? "outline";

  return <Badge variant={variant}>{formatEnumLabel(status)}</Badge>;
}
