import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";

type ListKeywordsParams = ListSearchParams & { clusterId?: string };

export async function listKeywordsForProject(
  seoProjectId: string,
  searchParams: ListKeywordsParams
) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    seoProjectId,
    deletedAt: showArchived ? { not: null } : null,
    ...(searchParams.clusterId ? { clusterId: searchParams.clusterId } : {}),
    ...(q ? { term: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [keywords, totalCount] = await Promise.all([
    prisma.keyword.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        cluster: { select: { id: true, name: true } },
        owner: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.keyword.count({ where }),
  ]);

  return { keywords, totalCount, page, pageSize };
}

/** Lightweight option list scoped to one SEO project — for the Content form's keyword multi-select. */
export function listKeywordOptions(seoProjectId: string) {
  return prisma.keyword.findMany({
    where: { seoProjectId, deletedAt: null },
    select: { id: true, term: true },
    orderBy: { term: "asc" },
  });
}

export function getKeywordById(id: string) {
  return prisma.keyword.findUnique({
    where: { id },
    include: {
      seoProject: { select: { id: true, name: true, companyId: true } },
      cluster: { select: { id: true, name: true } },
      owner: { select: { id: true, firstName: true, lastName: true } },
      content: { select: { id: true, title: true, status: true } },
    },
  });
}
