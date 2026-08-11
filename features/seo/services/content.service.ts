import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";

export async function listContentForProject(
  seoProjectId: string,
  searchParams: ListSearchParams
) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    seoProjectId,
    deletedAt: showArchived ? { not: null } : null,
    ...(status && !showArchived
      ? {
          status: status.toUpperCase() as
            | "DRAFT"
            | "IN_REVIEW"
            | "APPROVED"
            | "PUBLISHED"
            | "ARCHIVED",
        }
      : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [content, totalCount] = await Promise.all([
    prisma.content.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        author: { select: { firstName: true, lastName: true } },
        _count: { select: { keywords: true } },
      },
    }),
    prisma.content.count({ where }),
  ]);

  return { content, totalCount, page, pageSize };
}

export function getContentById(id: string) {
  return prisma.content.findUnique({
    where: { id },
    include: {
      seoProject: { select: { id: true, name: true, companyId: true } },
      author: { select: { id: true, firstName: true, lastName: true } },
      keywords: { select: { id: true, term: true } },
      notes: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { firstName: true, lastName: true } } },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { actor: { select: { firstName: true, lastName: true } } },
      },
    },
  });
}
