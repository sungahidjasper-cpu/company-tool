"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import {
  createLeadTask,
  updateLeadTaskStatus,
} from "@/features/leads/actions/lead.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEnumLabel } from "@/lib/utils";

const STATUS_OPTIONS = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const;

const selectClassName =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

type LeadTaskItem = {
  id: string;
  title: string;
  status: string;
  assignee: { firstName: string; lastName: string } | null;
};

type LeadTaskListProps = {
  leadId: string;
  tasks: LeadTaskItem[];
};

export default function LeadTaskList({ leadId, tasks }: LeadTaskListProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (title.trim().length < 2) {
      setError("Title must be at least 2 characters.");
      return;
    }

    setIsSubmitting(true);
    const result = await createLeadTask(leadId, title.trim());
    setIsSubmitting(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setTitle("");
    toast.success("Task added");
    router.refresh();
  };

  const handleStatusChange = (taskId: string, status: string) => {
    startTransition(async () => {
      const result = await updateLeadTaskStatus(taskId, status);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task..."
        />
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Adding..." : "Add"}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {tasks.length === 0 ? (
        <p className="text-sm text-slate-500">No tasks yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5"
            >
              <div className="flex flex-col">
                <span className="text-sm">{task.title}</span>
                <span className="text-xs text-slate-500">
                  {task.assignee
                    ? `${task.assignee.firstName} ${task.assignee.lastName}`
                    : "Unassigned"}
                </span>
              </div>
              <select
                value={task.status}
                disabled={isPending}
                onChange={(event) => handleStatusChange(task.id, event.target.value)}
                className={selectClassName}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {formatEnumLabel(option)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
