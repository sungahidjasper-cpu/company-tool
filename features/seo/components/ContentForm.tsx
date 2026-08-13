"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createContent, updateContent } from "@/features/seo/actions/content.actions";
import {
  CONTENT_STATUSES,
  contentSchema,
  type ContentInput,
} from "@/features/seo/schemas/content.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEnumLabel } from "@/lib/utils";
import type { Content } from "@/lib/generated/prisma/client";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type UserOption = { id: string; firstName: string; lastName: string };
type KeywordOption = { id: string; term: string };

type ContentFormProps = {
  seoProjectId: string;
  content?: Pick<Content, "id" | "title" | "url" | "status" | "publishedAt" | "authorId" | "body"> & {
    keywords?: { id: string }[];
  };
  userOptions: UserOption[];
  keywordOptions: KeywordOption[];
};

export default function ContentForm({
  seoProjectId,
  content,
  userOptions,
  keywordOptions,
}: ContentFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<string[]>(
    content?.keywords?.map((k) => k.id) ?? []
  );

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ContentInput>({
    resolver: zodResolver(contentSchema),
    defaultValues: {
      title: content?.title ?? "",
      url: content?.url ?? "",
      status: content?.status ?? "DRAFT",
      publishedAt: content?.publishedAt
        ? new Date(content.publishedAt).toISOString().slice(0, 10)
        : "",
      authorId: content?.authorId ?? "",
      keywordIds: selectedKeywordIds,
      body: content?.body ?? "",
    },
  });

  const toggleKeyword = (id: string) => {
    setSelectedKeywordIds((current) => {
      const next = current.includes(id)
        ? current.filter((k) => k !== id)
        : [...current, id];
      setValue("keywordIds", next);
      return next;
    });
  };

  const onSubmit = async (data: ContentInput) => {
    setFormError(null);
    const payload = { ...data, keywordIds: selectedKeywordIds };

    const result = content
      ? await updateContent(content.id, payload)
      : await createContent(seoProjectId, payload);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success(content ? "Content updated" : "Content created");
    router.push(`/seo/${seoProjectId}/content/${result.data.id}`);
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
        <Input id="url" placeholder="https://" {...register("url")} />
        {errors.url && (
          <p className="text-sm text-destructive">{errors.url.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select id="status" className={selectClassName} {...register("status")}>
            {CONTENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatEnumLabel(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="publishedAt" className="text-sm font-medium">
            Published date
          </label>
          <Input id="publishedAt" type="date" {...register("publishedAt")} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="authorId" className="text-sm font-medium">
          Author
        </label>
        <select id="authorId" className={selectClassName} {...register("authorId")}>
          <option value="">Unassigned</option>
          {userOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.firstName} {option.lastName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Target keywords</label>
        {keywordOptions.length === 0 ? (
          <p className="text-sm text-slate-500">No keywords in this project yet.</p>
        ) : (
          <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-lg border border-input p-2.5">
            {keywordOptions.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedKeywordIds.includes(option.id)}
                  onChange={() => toggleKeyword(option.id)}
                />
                {option.term}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="body" className="text-sm font-medium">
          Body (Markdown)
        </label>
        <textarea id="body" rows={16} className={textareaClassName} {...register("body")} />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : content ? "Save changes" : "Create content"}
      </Button>
    </form>
  );
}
