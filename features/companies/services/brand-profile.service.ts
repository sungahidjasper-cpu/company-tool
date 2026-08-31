import { prisma } from "@/lib/prisma";

/**
 * Looked up directly by companyId — not a foreign id needing an ownership
 * cross-check the way features/ai-workspace/actions/*.ts's getOwnedSeoProject
 * needs one. Callers must only ever pass an already-trusted companyId (e.g.
 * ContentBriefContext.companyId, itself derived from the authenticated
 * actor at job-creation time) — this function performs no authorization of
 * its own, matching getCompanyById's same minimal shape.
 */
export function getBrandProfileByCompanyId(companyId: string) {
  return prisma.brandProfile.findUnique({ where: { companyId } });
}
