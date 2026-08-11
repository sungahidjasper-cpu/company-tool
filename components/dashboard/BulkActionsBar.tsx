"use client";

import { Button } from "@/components/ui/button";
import type { buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

type BulkAction = {
  label: string;
  pendingLabel?: string;
  onClick: () => void;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  isPending?: boolean;
};

type BulkActionsBarProps = {
  selectedCount: number;
  actions: BulkAction[];
  onClear: () => void;
};

/**
 * Generic "N selected" toolbar — shared by any list page that adds
 * checkbox multi-select (Keywords, Content). Not a new pattern per list;
 * one component, reused.
 */
export default function BulkActionsBar({
  selectedCount,
  actions,
  onClear,
}: BulkActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <div className="flex items-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            type="button"
            size="sm"
            variant={action.variant ?? "outline"}
            disabled={action.isPending}
            onClick={action.onClick}
          >
            {action.isPending ? (action.pendingLabel ?? "Working...") : action.label}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
