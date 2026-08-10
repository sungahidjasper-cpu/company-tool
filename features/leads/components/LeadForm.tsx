"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createLead, updateLead } from "@/features/leads/actions/lead.actions";
import {
  LEAD_STATUSES,
  leadSchema,
  type LeadInput,
} from "@/features/leads/schemas/lead.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEnumLabel } from "@/lib/utils";
import type { Lead } from "@/lib/generated/prisma/client";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type UserOption = { id: string; firstName: string; lastName: string };
type ClientOption = { id: string; name: string };
type ProjectOption = { id: string; name: string };

type LeadFormProps = {
  lead?: Pick<
    Lead,
    | "id"
    | "name"
    | "companyName"
    | "email"
    | "phone"
    | "source"
    | "status"
    | "value"
    | "assignedUserId"
    | "clientId"
    | "projectId"
  >;
  userOptions: UserOption[];
  clientOptions: ClientOption[];
  projectOptions: ProjectOption[];
};

export default function LeadForm({
  lead,
  userOptions,
  clientOptions,
  projectOptions,
}: LeadFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LeadInput>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      name: lead?.name ?? "",
      companyName: lead?.companyName ?? "",
      email: lead?.email ?? "",
      phone: lead?.phone ?? "",
      source: lead?.source ?? "",
      status: lead?.status ?? "NEW",
      value: lead?.value ? String(lead.value) : "",
      assignedUserId: lead?.assignedUserId ?? "",
      clientId: lead?.clientId ?? "",
      projectId: lead?.projectId ?? "",
    },
  });

  const onSubmit = async (data: LeadInput) => {
    setFormError(null);

    const result = lead
      ? await updateLead(lead.id, data)
      : await createLead(data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success(lead ? "Lead updated" : "Lead created");
    router.push(`/leads/${result.data.id}`);
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

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="companyName" className="text-sm font-medium">
            Company
          </label>
          <Input id="companyName" {...register("companyName")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="source" className="text-sm font-medium">
            Source
          </label>
          <Input id="source" {...register("source")} placeholder="e.g. Referral" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input id="email" type="email" {...register("email")} />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="text-sm font-medium">
            Phone
          </label>
          <Input id="phone" {...register("phone")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select id="status" className={selectClassName} {...register("status")}>
            {LEAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatEnumLabel(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="value" className="text-sm font-medium">
            Deal value
          </label>
          <Input id="value" type="number" step="0.01" {...register("value")} placeholder="0.00" />
          {errors.value && (
            <p className="text-sm text-destructive">{errors.value.message}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="assignedUserId" className="text-sm font-medium">
          Assigned user
        </label>
        <select
          id="assignedUserId"
          className={selectClassName}
          {...register("assignedUserId")}
        >
          <option value="">Unassigned</option>
          {userOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.firstName} {option.lastName}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="clientId" className="text-sm font-medium">
            Related client
          </label>
          <select id="clientId" className={selectClassName} {...register("clientId")}>
            <option value="">None</option>
            {clientOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="projectId" className="text-sm font-medium">
            Related project
          </label>
          <select id="projectId" className={selectClassName} {...register("projectId")}>
            <option value="">None</option>
            {projectOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : lead ? "Save changes" : "Create lead"}
      </Button>
    </form>
  );
}
