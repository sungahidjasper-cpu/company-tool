import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";

export async function listClustersForProject(
  seoProjectId: string,
  searchParams: ListSearchParams
) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    seoProjectId,
    deletedAt: showArchived ? { not: null } : null,
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [clusters, totalCount] = await Promise.all([
    prisma.keywordCluster.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: { _count: { select: { keywords: true } } },
    }),
    prisma.keywordCluster.count({ where }),
  ]);

  return { clusters, totalCount, page, pageSize };
}

/** Lightweight option list scoped to one SEO project — for the Keyword form's cluster picker. */
export function listClusterOptions(seoProjectId: string) {
  return prisma.keywordCluster.findMany({
    where: { seoProjectId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export function getClusterById(id: string) {
  return prisma.keywordCluster.findUnique({
    where: { id },
    include: {
      seoProject: { select: { id: true, name: true, companyId: true } },
      keywords: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}
