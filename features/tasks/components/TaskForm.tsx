"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createTask, updateTask } from "@/features/tasks/actions/task.actions";
import { taskSchema, type TaskInput } from "@/features/tasks/schemas/task.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Task } from "@/lib/generated/prisma/client";
import { formatEnumLabel } from "@/lib/utils";

const STATUS_OPTIONS = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "DONE",
  "CANCELLED",
] as const;
const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type UserOption = { id: string; firstName: string; lastName: string };

type TaskFormProps = {
  projectId: string;
  task?: Pick<
    Task,
    "id" | "title" | "description" | "status" | "priority" | "dueDate" | "assigneeId"
  >;
  userOptions: UserOption[];
};

function toDateInputValue(value: Date | null | undefined) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

export default function TaskForm({ projectId, task, userOptions }: TaskFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TaskInput>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      status: task?.status ?? "TODO",
      priority: task?.priority ?? "MEDIUM",
      dueDate: toDateInputValue(task?.dueDate),
      assigneeId: task?.assigneeId ?? "",
    },
  });

  const onSubmit = async (data: TaskInput) => {
    setFormError(null);

    const result = task
      ? await updateTask(task.id, data)
      : await createTask(projectId, data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success(task ? "Task updated" : "Task created");
    router.push(`/projects/${projectId}/tasks/${result.data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-sm font-medium">
          Title
        </label>
        <Input id="title" {...register("title")} />
        {errors.title && (
          <p className="text-sm text-destructive">{errors.title.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          {...register("description")}
          className="min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select id="status" className={selectClassName} {...register("status")}>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {formatEnumLabel(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="priority" className="text-sm font-medium">
            Priority
          </label>
          <select
            id="priority"
            className={selectClassName}
            {...register("priority")}
          >
            {PRIORITY_OPTIONS.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dueDate" className="text-sm font-medium">
            Due date
          </label>
          <Input id="dueDate" type="date" {...register("dueDate")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="assigneeId" className="text-sm font-medium">
            Assignee
          </label>
          <select
            id="assigneeId"
            className={selectClassName}
            {...register("assigneeId")}
          >
            <option value="">Unassigned</option>
            {userOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.firstName} {option.lastName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : task ? "Save changes" : "Create task"}
      </Button>
    </form>
  );
}
