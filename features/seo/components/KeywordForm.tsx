"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createKeyword, updateKeyword } from "@/features/seo/actions/keyword.actions";
import {
  KEYWORD_INTENTS,
  KEYWORD_PRIORITIES,
  KEYWORD_STATUSES,
  keywordSchema,
  type KeywordFormInput,
  type KeywordInput,
} from "@/features/seo/schemas/keyword.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEnumLabel } from "@/lib/utils";
import type { Keyword } from "@/lib/generated/prisma/client";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type EntityOption = { id: string; name: string };
type UserOption = { id: string; firstName: string; lastName: string };

type KeywordFormProps = {
  seoProjectId: string;
  keyword?: Pick<
    Keyword,
    | "id"
    | "term"
    | "clusterId"
    | "ownerId"
    | "searchVolume"
    | "difficulty"
    | "currentRank"
    | "targetUrl"
    | "intent"
    | "priority"
    | "status"
  >;
  clusterOptions: EntityOption[];
  userOptions: UserOption[];
};

export default function KeywordForm({
  seoProjectId,
  keyword,
  clusterOptions,
  userOptions,
}: KeywordFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<KeywordFormInput>({
    resolver: zodResolver(keywordSchema),
    defaultValues: {
      term: keyword?.term ?? "",
      clusterId: keyword?.clusterId ?? "",
      ownerId: keyword?.ownerId ?? "",
      searchVolume: keyword?.searchVolume?.toString() ?? "",
      difficulty: keyword?.difficulty?.toString() ?? "",
      currentRank: keyword?.currentRank?.toString() ?? "",
      targetUrl: keyword?.targetUrl ?? "",
      intent: keyword?.intent ?? undefined,
      priority: keyword?.priority ?? "MEDIUM",
      status: keyword?.status ?? "NOT_STARTED",
    },
  });

  const onSubmit = async (data: KeywordFormInput) => {
    setFormError(null);

    const result = keyword
      ? await updateKeyword(keyword.id, data)
      : await createKeyword(seoProjectId, data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }

    toast.success(keyword ? "Keyword updated" : "Keyword created");
    router.push(`/seo/${seoProjectId}/keywords/${result.data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="term" className="text-sm font-medium">
          Term
        </label>
        <Input id="term" {...register("term")} />
        {errors.term && (
          <p className="text-sm text-destructive">{errors.term.message}</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="searchVolume" className="text-sm font-medium">
            Search volume
          </label>
          <Input id="searchVolume" type="number" {...register("searchVolume")} />
          {errors.searchVolume && (
            <p className="text-sm text-destructive">{errors.searchVolume.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="difficulty" className="text-sm font-medium">
            Difficulty
          </label>
          <Input id="difficulty" type="number" {...register("difficulty")} />
          {errors.difficulty && (
            <p className="text-sm text-destructive">{errors.difficulty.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="currentRank" className="text-sm font-medium">
            Current rank
          </label>
          <Input id="currentRank" type="number" {...register("currentRank")} />
          {errors.currentRank && (
            <p className="text-sm text-destructive">{errors.currentRank.message}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="targetUrl" className="text-sm font-medium">
          Target URL
        </label>
        <Input id="targetUrl" placeholder="https://" {...register("targetUrl")} />
        {errors.targetUrl && (
          <p className="text-sm text-destructive">{errors.targetUrl.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="clusterId" className="text-sm font-medium">
            Cluster
          </label>
          <select id="clusterId" className={selectClassName} {...register("clusterId")}>
            <option value="">None</option>
            {clusterOptions.map((option) => (
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

      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="intent" className="text-sm font-medium">
            Intent
          </label>
          <select id="intent" className={selectClassName} {...register("intent")}>
            <option value="">Unspecified</option>
            {KEYWORD_INTENTS.map((intent) => (
              <option key={intent} value={intent}>
                {formatEnumLabel(intent)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="priority" className="text-sm font-medium">
            Priority
          </label>
          <select id="priority" className={selectClassName} {...register("priority")}>
            {KEYWORD_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {formatEnumLabel(priority)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select id="status" className={selectClassName} {...register("status")}>
            {KEYWORD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {formatEnumLabel(status)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : keyword ? "Save changes" : "Create keyword"}
      </Button>
    </form>
  );
}
