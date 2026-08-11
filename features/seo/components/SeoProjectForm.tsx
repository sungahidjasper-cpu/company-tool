"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createSeoProject,
  updateSeoProject,
} from "@/features/seo/actions/seo-project.actions";
import {
  SEO_PROJECT_STATUSES,
  seoProjectSchema,
  type SeoProjectInput,
} from "@/features/seo/schemas/seo-project.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEnumLabel } from "@/lib/utils";
import type { SEOProject } from "@/lib/generated/prisma/client";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type EntityOption = { id: string; name: string };
type UserOption = { id: string; firstName: string; lastName: string };

type SeoProjectFormProps = {
  seoProject?: Pick<
    SEOProject,
    "id" | "name" | "domain" | "clientId" | "ownerId" | "status" | "startDate"
  >;
  clientOptions: EntityOption[];
  userOptions: UserOption[];
};

export default function SeoProjectForm({
  seoProject,
  clientOptions,
  userOptions,
}: SeoProjectFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SeoProjectInput>({
    resolver: zodResolver(seoProjectSchema),
    defaultValues: {
      name: seoProject?.name ?? "",
      domain: seoProject?.domain ?? "",
      clientId: seoProject?.clientId ?? "",
      ownerId: seoProject?.ownerId ?? "",
      status: seoProject?.status ?? "ACTIVE",
      startDate: seoProject?.startDate
        ? new Date(seoProject.startDate).toISOString().slice(0, 10)
        : "",
    },
  });

  const onSubmit = async (data: SeoProjectInput) => {
    setFormError(null);

    const result = seoProject
      ? await updateSeoProject(seoProject.id, data)
      : await createSeoProject(data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success(seoProject ? "SEO project updated" : "SEO project created");
    router.push(`/seo/${result.data.id}`);
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
        <label htmlFor="domain" className="text-sm font-medium">
          Domain
        </label>
        <Input id="domain" placeholder="example.com" {...register("domain")} />
        {errors.domain && (
          <p className="text-sm text-destructive">{errors.domain.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select id="status" className={selectClassName} {...register("status")}>
            {SEO_PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatEnumLabel(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="startDate" className="text-sm font-medium">
            Start date
          </label>
          <Input id="startDate" type="date" {...register("startDate")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="clientId" className="text-sm font-medium">
            Client
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

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : seoProject ? "Save changes" : "Create SEO project"}
      </Button>
    </form>
  );
}
