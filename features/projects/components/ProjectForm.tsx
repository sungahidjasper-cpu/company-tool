"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createProject,
  updateProject,
} from "@/features/projects/actions/project.actions";
import {
  projectSchema,
  type ProjectInput,
} from "@/features/projects/schemas/project.schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { Project } from "@/lib/generated/prisma/client";

const STATUS_OPTIONS = [
  "PLANNING",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
] as const;
const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type UserOption = { id: string; firstName: string; lastName: string };
type ClientOption = { id: string; name: string };

type ProjectFormProps = {
  project?: Pick<
    Project,
    | "id"
    | "name"
    | "description"
    | "status"
    | "priority"
    | "startDate"
    | "dueDate"
    | "clientId"
    | "ownerId"
  > & { assignedUsers: { id: string }[] };
  userOptions: UserOption[];
  clientOptions: ClientOption[];
};

function toDateInputValue(value: Date | null | undefined) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

export default function ProjectForm({
  project,
  userOptions,
  clientOptions,
}: ProjectFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: project?.name ?? "",
      description: project?.description ?? "",
      status: project?.status ?? "PLANNING",
      priority: project?.priority ?? "MEDIUM",
      startDate: toDateInputValue(project?.startDate),
      dueDate: toDateInputValue(project?.dueDate),
      clientId: project?.clientId ?? "",
      ownerId: project?.ownerId ?? "",
      assignedUserIds: project?.assignedUsers.map((u) => u.id) ?? [],
    },
  });

  const onSubmit = async (data: ProjectInput) => {
    setFormError(null);

    const result = project
      ? await updateProject(project.id, data)
      : await createProject(data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success(project ? "Project updated" : "Project created");
    router.push(`/projects/${result.data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <Input id="name" {...register("name")} />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
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
                {status.replace("_", " ")}
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
          <label htmlFor="startDate" className="text-sm font-medium">
            Start date
          </label>
          <Input id="startDate" type="date" {...register("startDate")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="dueDate" className="text-sm font-medium">
            End date
          </label>
          <Input id="dueDate" type="date" {...register("dueDate")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="clientId" className="text-sm font-medium">
            Client
          </label>
          <select id="clientId" className={selectClassName} {...register("clientId")}>
            <option value="">No client</option>
            {clientOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ownerId" className="text-sm font-medium">
            Owner
          </label>
          <select id="ownerId" className={selectClassName} {...register("ownerId")}>
            <option value="">Unassigned</option>
            {userOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.firstName} {option.lastName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Assigned users</span>
        <Controller
          name="assignedUserIds"
          control={control}
          render={({ field }) => (
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
              {userOptions.length === 0 && (
                <p className="text-sm text-slate-500">No users available.</p>
              )}
              {userOptions.map((option) => {
                const checked = field.value?.includes(option.id) ?? false;
                return (
                  <label
                    key={option.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(isChecked) => {
                        const current = field.value ?? [];
                        field.onChange(
                          isChecked
                            ? [...current, option.id]
                            : current.filter((id) => id !== option.id)
                        );
                      }}
                    />
                    {option.firstName} {option.lastName}
                  </label>
                );
              })}
            </div>
          )}
        />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting
          ? "Saving..."
          : project
            ? "Save changes"
            : "Create project"}
      </Button>
    </form>
  );
}
