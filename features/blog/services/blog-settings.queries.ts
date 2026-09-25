import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Phase 7 — the article settings the Blog Studio can legitimately offer.
 *
 * SERVER-ONLY, so the client bundle never pulls in Prisma — the same split the
 * content workspace and the social feature already use.
 *
 * Tags are a real, existing many-to-many on Content (`Content.tags Tag[]`),
 * owned by the company. The earlier Phase 7 note claiming they were not stored
 * was simply wrong; nothing had ever listed them, which is why they looked
 * absent. No new model is introduced here.
 */

export type TagOption = { id: string; name: string; color: string | null };

/** Every tag belonging to this company, for the article settings picker. */
export async function listCompanyTags(companyId: string): Promise<TagOption[]> {
  const rows = await prisma.tag.findMany({
    where: { companyId },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  });
  return rows;
}
