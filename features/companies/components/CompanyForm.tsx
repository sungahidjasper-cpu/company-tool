"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createCompany,
  updateCompany,
} from "@/features/companies/actions/company.actions";
import {
  companySchema,
  type CompanyInput,
} from "@/features/companies/schemas/company.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Company } from "@/lib/generated/prisma/client";

type CompanyFormProps = {
  company?: Pick<
    Company,
    "id" | "name" | "slug" | "industry" | "website" | "timezone"
  >;
};

export default function CompanyForm({ company }: CompanyFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CompanyInput>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: company?.name ?? "",
      slug: company?.slug ?? "",
      industry: company?.industry ?? "",
      website: company?.website ?? "",
      timezone: company?.timezone ?? "",
    },
  });

  const onSubmit = async (data: CompanyInput) => {
    setFormError(null);

    const result = company
      ? await updateCompany(company.id, data)
      : await createCompany(data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success(company ? "Company updated" : "Company created");
    router.push(`/companies/${result.data.id}`);
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
        <label htmlFor="slug" className="text-sm font-medium">
          Slug
        </label>
        <Input id="slug" {...register("slug")} />
        {errors.slug && (
          <p className="text-sm text-destructive">{errors.slug.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="industry" className="text-sm font-medium">
          Industry
        </label>
        <Input id="industry" {...register("industry")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="website" className="text-sm font-medium">
          Website
        </label>
        <Input id="website" {...register("website")} placeholder="https://" />
        {errors.website && (
          <p className="text-sm text-destructive">{errors.website.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="timezone" className="text-sm font-medium">
          Timezone
        </label>
        <Input
          id="timezone"
          {...register("timezone")}
          placeholder="e.g. Asia/Manila"
        />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting
          ? "Saving..."
          : company
            ? "Save changes"
            : "Create company"}
      </Button>
    </form>
  );
}
