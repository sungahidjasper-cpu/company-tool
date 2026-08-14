"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { companyAiLimitsSchema, type CompanyAiLimitsInput } from "@/features/companies/schemas/company-ai-limits.schema";

/**
 * A hard, unconditional SUPER_ADMIN check with no ADMIN carve-out —
 * deliberately unlike company.actions.ts's canEditCompany, which lets a
 * company's own ADMIN edit that company's other fields (name, industry,
 * etc.). A company's own admin must never be able to see or raise its own
 * AI spending cap, so this lives in its own action/schema/component rather
 * than extending the shared updateCompany flow.
 */
export async function updateCompanyAiLimitsAction(companyId: string, input: CompanyAiLimitsInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!Permissions.manageCompanies(actor.role)) {
    return actionError("Only a Super Admin can configure AI limits.");
  }

  const parsed = companyAiLimitsSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const company = await prisma.company.update({
    where: { id: companyId },
    data: {
      aiMonthlyBudgetUsd: parsed.data.aiMonthlyBudgetUsd ? Number(parsed.data.aiMonthlyBudgetUsd) : null,
      aiRateLimitPerMinute: parsed.data.aiRateLimitPerMinute ? Number(parsed.data.aiRateLimitPerMinute) : null,
    },
  });

  await logActivity({
    actorId: actor.id,
    action: "company.ai_limits_updated",
    companyId: company.id,
    metadata: {
      aiMonthlyBudgetUsd: parsed.data.aiMonthlyBudgetUsd ?? null,
      aiRateLimitPerMinute: parsed.data.aiRateLimitPerMinute ?? null,
    },
  });

  revalidatePath(`/companies/${companyId}`);
  return actionSuccess({ id: company.id });
}
