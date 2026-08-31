"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { upsertBrandProfileAction } from "@/features/companies/actions/brand-profile.actions";
import { brandProfileSchema, type BrandProfileInput } from "@/features/companies/schemas/brand-profile.schema";
import { BRAND_VOICES } from "@/features/ai-workspace/schemas/content-brief-settings.schema";
import { formatEnumLabel } from "@/lib/utils";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const textareaClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export type BrandProfileFormValues = {
  brandName: string | null;
  brandVoice: string | null;
  targetAudience: string | null;
  productsServices: string | null;
  targetCountry: string | null;
  language: string | null;
  competitorUrls: string[];
};

type BrandProfileFormProps = {
  companyId: string;
  brandProfile: BrandProfileFormValues | null;
};

/**
 * Follows CompanyAiLimitsForm.tsx's exact pattern (react-hook-form +
 * zodResolver, one flat schema, no manual useState) since this form is the
 * same shape — a handful of flat, optional company-level fields. Rendered
 * only when the viewer can edit this company (see the company detail
 * page's canManageBrandProfile gate) — upsertBrandProfileAction re-checks
 * regardless, same defense-in-depth as every other company-scoped form.
 *
 * Foundation stage only: nothing here feeds AI generation yet — see
 * buildSharedContextClauses' own comment (content-brief-settings.schema.ts)
 * for the integration point a future, separately-authorized stage will use.
 */
export default function BrandProfileForm({ companyId, brandProfile }: BrandProfileFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BrandProfileInput>({
    resolver: zodResolver(brandProfileSchema),
    defaultValues: {
      brandName: brandProfile?.brandName ?? "",
      brandVoice: brandProfile?.brandVoice ?? "",
      targetAudience: brandProfile?.targetAudience ?? "",
      productsServices: brandProfile?.productsServices ?? "",
      targetCountry: brandProfile?.targetCountry ?? "",
      language: brandProfile?.language ?? "",
      competitorUrls: brandProfile?.competitorUrls.join(", ") ?? "",
    },
  });

  const onSubmit = async (data: BrandProfileInput) => {
    setFormError(null);
    const result = await upsertBrandProfileAction(companyId, data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }
    toast.success("Brand profile saved");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        Reused as a default for AI generation across the workspace once wired in — a future, separately-authorized stage. Every field is optional.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="brandName" className="text-sm font-medium">
            Brand name
          </label>
          <Input id="brandName" {...register("brandName")} />
          {errors.brandName && <p className="text-sm text-destructive">{errors.brandName.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="brandVoice" className="text-sm font-medium">
            Brand voice
          </label>
          <select id="brandVoice" className={selectClassName} {...register("brandVoice")}>
            <option value="">Not set</option>
            {BRAND_VOICES.map((voice) => (
              <option key={voice} value={voice}>
                {formatEnumLabel(voice)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="targetAudience" className="text-sm font-medium">
          Target audience
        </label>
        <textarea id="targetAudience" rows={2} className={textareaClassName} {...register("targetAudience")} />
        {errors.targetAudience && <p className="text-sm text-destructive">{errors.targetAudience.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="productsServices" className="text-sm font-medium">
          Products/services
        </label>
        <textarea id="productsServices" rows={2} className={textareaClassName} {...register("productsServices")} />
        {errors.productsServices && <p className="text-sm text-destructive">{errors.productsServices.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="targetCountry" className="text-sm font-medium">
            Target country
          </label>
          <Input id="targetCountry" {...register("targetCountry")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="language" className="text-sm font-medium">
            Language
          </label>
          <Input id="language" {...register("language")} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="competitorUrls" className="text-sm font-medium">
          Competitor URLs (comma-separated)
        </label>
        <Input id="competitorUrls" {...register("competitorUrls")} />
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save brand profile"}
      </Button>
    </form>
  );
}
