import { prisma } from "@/lib/prisma";
import { isUuid } from "@/lib/utils";

export async function getKnowledgeSourceById(id: string) {
  if (!isUuid(id)) return null;

  return prisma.knowledgeSource.findUnique({
    where: { id },
    include: {
      addedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export function listKnowledgeSources(
  companyId: string,
  options: { includeArchived?: boolean } = {}
) {
  return prisma.knowledgeSource.findMany({
    where: {
      companyId,
      deletedAt: options.includeArchived ? undefined : null,
    },
    orderBy: { createdAt: "desc" },
    include: {
      addedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export function listKnowledgeSourceLinksForSeoProject(seoProjectId: string) {
  return prisma.knowledgeSourceLink.findMany({
    where: { seoProjectId },
    orderBy: { createdAt: "desc" },
    include: {
      knowledgeSource: true,
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

/** Case-insensitive, whitespace-normalized comparison — mirrors the CSV-import dedupe normalization already used elsewhere in this feature (e.g. keyword-cluster matching). */
export async function findDuplicateKnowledgeSourceByUrl(
  companyId: string,
  url: string
) {
  const normalized = url.trim().toLowerCase();
  const candidates = await prisma.knowledgeSource.findMany({
    where: { companyId, deletedAt: null, url: { not: null } },
    select: { id: true, url: true },
  });
  return candidates.find((c) => c.url?.trim().toLowerCase() === normalized) ?? null;
}
