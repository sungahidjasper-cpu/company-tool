"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createCluster,
  updateCluster,
} from "@/features/seo/actions/keyword-cluster.actions";
import {
  keywordClusterSchema,
  type KeywordClusterInput,
} from "@/features/seo/schemas/keyword-cluster.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KeywordCluster } from "@/lib/generated/prisma/client";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type KeywordClusterFormProps = {
  seoProjectId: string;
  cluster?: Pick<KeywordCluster, "id" | "name" | "description">;
};

export default function KeywordClusterForm({
  seoProjectId,
  cluster,
}: KeywordClusterFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<KeywordClusterInput>({
    resolver: zodResolver(keywordClusterSchema),
    defaultValues: {
      name: cluster?.name ?? "",
      description: cluster?.description ?? "",
    },
  });

  const onSubmit = async (data: KeywordClusterInput) => {
    setFormError(null);

    const result = cluster
      ? await updateCluster(cluster.id, data)
      : await createCluster(seoProjectId, data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success(cluster ? "Cluster updated" : "Cluster created");
    router.push(`/seo/${seoProjectId}/clusters/${result.data.id}`);
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
          rows={3}
          className={textareaClassName}
          {...register("description")}
        />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : cluster ? "Save changes" : "Create cluster"}
      </Button>
    </form>
  );
}
