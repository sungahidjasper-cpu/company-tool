"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateCompanyAiLimitsAction } from "@/features/companies/actions/company-ai-limits.actions";
import { companyAiLimitsSchema, type CompanyAiLimitsInput } from "@/features/companies/schemas/company-ai-limits.schema";

type CompanyAiLimitsFormProps = {
  companyId: string;
  aiMonthlyBudgetUsd: number | null;
  aiRateLimitPerMinute: number | null;
  /** This month's spend so far — same query the enforcement gate itself uses (lib/ai/ai-limit.service.ts's getCurrentPeriodSpendUsd), shown here so a cap can be set against real recent burn. */
  currentPeriodSpendUsd: number;
};

/** SUPER_ADMIN-only — rendered by the company detail page only when the viewer passes Permissions.manageCompanies; updateCompanyAiLimitsAction re-checks regardless. */
export default function CompanyAiLimitsForm({ companyId, aiMonthlyBudgetUsd, aiRateLimitPerMinute, currentPeriodSpendUsd }: CompanyAiLimitsFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CompanyAiLimitsInput>({
    resolver: zodResolver(companyAiLimitsSchema),
    defaultValues: {
      aiMonthlyBudgetUsd: aiMonthlyBudgetUsd !== null ? String(aiMonthlyBudgetUsd) : "",
      aiRateLimitPerMinute: aiRateLimitPerMinute !== null ? String(aiRateLimitPerMinute) : "",
    },
  });

  const onSubmit = async (data: CompanyAiLimitsInput) => {
    setFormError(null);
    const result = await updateCompanyAiLimitsAction(companyId, data);

    if (!result.success) {
      setFormError(result.message);
      return;
    }
    toast.success("AI limits updated");
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">
        Spend this month: <span className="font-medium text-slate-900 dark:text-slate-100">${currentPeriodSpendUsd.toFixed(2)}</span>
      </p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="aiMonthlyBudgetUsd" className="text-sm font-medium">
          Monthly AI budget (USD)
        </label>
        <Input id="aiMonthlyBudgetUsd" {...register("aiMonthlyBudgetUsd")} placeholder="No limit" />
        {errors.aiMonthlyBudgetUsd && <p className="text-sm text-destructive">{errors.aiMonthlyBudgetUsd.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="aiRateLimitPerMinute" className="text-sm font-medium">
          AI requests per minute limit
        </label>
        <Input id="aiRateLimitPerMinute" {...register("aiRateLimitPerMinute")} placeholder="No limit" />
        {errors.aiRateLimitPerMinute && <p className="text-sm text-destructive">{errors.aiRateLimitPerMinute.message}</p>}
      </div>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Save AI limits"}
      </Button>
    </form>
  );
}
