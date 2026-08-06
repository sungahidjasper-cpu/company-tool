"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";
import { Button, type buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

type RecordActionButtonProps = {
  id: string;
  action: (id: string) => Promise<ActionResult>;
  label: string;
  pendingLabel?: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  confirmMessage?: string;
  successMessage?: string;
};

/**
 * Every archive/restore/activate/suspend control across Companies, Users,
 * Clients, and Projects goes through this one component instead of each
 * module re-implementing pending/error/success handling.
 */
export default function RecordActionButton({
  id,
  action,
  label,
  pendingLabel = "Working...",
  variant = "outline",
  confirmMessage,
  successMessage,
}: RecordActionButtonProps) {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }

    startTransition(async () => {
      const result = await action(id);
      if (result.success) {
        toast.success(successMessage ?? "Done");
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={isPending}
      onClick={handleClick}
    >
      {isPending ? pendingLabel : label}
    </Button>
  );
}
