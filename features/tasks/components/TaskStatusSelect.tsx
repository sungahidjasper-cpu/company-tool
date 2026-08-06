"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { updateTaskStatus } from "@/features/tasks/actions/task.actions";
import { formatEnumLabel } from "@/lib/utils";

const STATUS_OPTIONS = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "DONE",
  "CANCELLED",
] as const;

const selectClassName =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

type TaskStatusSelectProps = {
  taskId: string;
  status: string;
};

export default function TaskStatusSelect({
  taskId,
  status,
}: TaskStatusSelectProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (nextStatus: string) => {
    startTransition(async () => {
      const result = await updateTaskStatus(taskId, nextStatus);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success("Status updated");
      router.refresh();
    });
  };

  return (
    <select
      value={status}
      disabled={isPending}
      onChange={(event) => handleChange(event.target.value)}
      className={selectClassName}
    >
      {STATUS_OPTIONS.map((option) => (
        <option key={option} value={option}>
          {formatEnumLabel(option)}
        </option>
      ))}
    </select>
  );
}
