"use server";

import { revalidatePath } from "next/cache";

import type { User as SessionUser } from "next-auth";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { hasMinimumRole, Permissions } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { brandProfileSchema, type BrandProfileInput } from "@/features/companies/schemas/brand-profile.schema";

/**
 * Same two-part rule as company.actions.ts's canEditCompany (SUPER_ADMIN, or
 * that company's own ADMIN) — deliberately NOT duplicated by importing it,
 * since company.actions.ts is a "use server" file and every one of its
 * exports must be an async function; canEditCompany is a plain sync helper
 * kept unexported there for that exact reason. Unlike
 * company-ai-limits.actions.ts's hard SUPER_ADMIN-only check, brand context
 * (name/voice/audience/products/country/language/competitors) is ordinary
 * business data a company's own admin should be able to maintain, not a
 * spend ceiling that must be hidden from them.
 */
function canEditBrandProfile(user: SessionUser, companyId: string) {
  return Permissions.manageCompanies(user.role) || (hasMinimumRole(user.role, "ADMIN") && user.companyId === companyId);
}

/**
 * Upsert, not separate create/update actions: BrandProfile is 1:1 with
 * Company (companyId @unique), so "the brand profile for this company"
 * either already exists or doesn't — there's no meaningful create-vs-update
 * distinction for the caller to express.
 */
export async function upsertBrandProfileAction(companyId: string, input: BrandProfileInput): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  if (!canEditBrandProfile(actor, companyId)) {
    return actionError("You do not have permission to edit this company's brand profile.");
  }

  const parsed = brandProfileSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const competitorUrls = parsed.data.competitorUrls
    ? parsed.data.competitorUrls.split(",").map((url) => url.trim()).filter(Boolean)
    : [];

  const data = {
    brandName: parsed.data.brandName ?? null,
    brandVoice: parsed.data.brandVoice ?? null,
    targetAudience: parsed.data.targetAudience ?? null,
    productsServices: parsed.data.productsServices ?? null,
    targetCountry: parsed.data.targetCountry ?? null,
    language: parsed.data.language ?? null,
    competitorUrls,
  };

  const brandProfile = await prisma.brandProfile.upsert({
    where: { companyId },
    update: data,
    create: { companyId, ...data },
  });

  await logActivity({
    actorId: actor.id,
    action: "company.brand_profile_updated",
    companyId,
    metadata: { brandName: data.brandName },
  });

  revalidatePath(`/companies/${companyId}`);
  return actionSuccess({ id: brandProfile.id });
}
