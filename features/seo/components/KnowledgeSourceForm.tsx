"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createKnowledgeSource,
  updateKnowledgeSource,
} from "@/features/seo/actions/knowledge-source.actions";
import {
  RECOMMENDED_SOURCE_TYPES,
  knowledgeSourceSchema,
  type KnowledgeSourceInput,
} from "@/features/seo/schemas/knowledge-source.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KnowledgeSource } from "@/lib/generated/prisma/client";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/** yyyy-MM-dd for an <input type="date">, or "" so the field starts blank rather than "Invalid Date". */
function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

type KnowledgeSourceFormProps = {
  knowledgeSource?: Pick<
    KnowledgeSource,
    "id" | "title" | "url" | "sourceType" | "description" | "content" | "publishedAt" | "lastVerifiedAt"
  >;
};

export default function KnowledgeSourceForm({ knowledgeSource }: KnowledgeSourceFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<KnowledgeSourceInput>({
    resolver: zodResolver(knowledgeSourceSchema),
    defaultValues: {
      title: knowledgeSource?.title ?? "",
      url: knowledgeSource?.url ?? "",
      sourceType: knowledgeSource?.sourceType ?? "",
      description: knowledgeSource?.description ?? "",
      content: knowledgeSource?.content ?? "",
      publishedAt: toDateInputValue(knowledgeSource?.publishedAt),
      lastVerifiedAt: toDateInputValue(knowledgeSource?.lastVerifiedAt),
    },
  });

  const onSubmit = async (data: KnowledgeSourceInput) => {
    setFormError(null);

    const result = knowledgeSource
      ? await updateKnowledgeSource(knowledgeSource.id, data)
      : await createKnowledgeSource(data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success(knowledgeSource ? "Knowledge source updated" : "Knowledge source created");
    router.push("/seo/knowledge-sources");
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
        <label htmlFor="url" className="text-sm font-medium">
          URL
        </label>
        <Input id="url" placeholder="https://example.com/article" {...register("url")} />
        {errors.url && <p className="text-sm text-destructive">{errors.url.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="sourceType" className="text-sm font-medium">
          Source type
        </label>
        <Input id="sourceType" list="source-type-suggestions" {...register("sourceType")} />
        <datalist id="source-type-suggestions">
          {RECOMMENDED_SOURCE_TYPES.map((type) => (
            <option key={type} value={type} />
          ))}
        </datalist>
        {errors.sourceType && (
          <p className="text-sm text-destructive">{errors.sourceType.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <textarea id="description" rows={2} className={textareaClassName} {...register("description")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="content" className="text-sm font-medium">
          Content
        </label>
        <textarea
          id="content"
          rows={5}
          placeholder="Optional — a verified excerpt this source supports."
          className={textareaClassName}
          {...register("content")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="publishedAt" className="text-sm font-medium">
            Published date
          </label>
          <Input id="publishedAt" type="date" {...register("publishedAt")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="lastVerifiedAt" className="text-sm font-medium">
            Last verified date
          </label>
          <Input id="lastVerifiedAt" type="date" {...register("lastVerifiedAt")} />
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : knowledgeSource ? "Save changes" : "Create knowledge source"}
      </Button>
    </form>
  );
}
