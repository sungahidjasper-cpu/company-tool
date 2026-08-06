import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";

export async function listProjects(
  companyId: string,
  searchParams: ListSearchParams
) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    companyId,
    deletedAt: showArchived ? { not: null } : null,
    ...(status && !showArchived
      ? {
          status: status.toUpperCase() as
            | "PLANNING"
            | "IN_PROGRESS"
            | "ON_HOLD"
            | "COMPLETED"
            | "CANCELLED",
        }
      : {}),
    ...(q
      ? { name: { contains: q, mode: "insensitive" as const } }
      : {}),
  };

  const [projects, totalCount] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        client: { select: { id: true, name: true } },
        owner: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.project.count({ where }),
  ]);

  return { projects, totalCount, page, pageSize };
}

export function getProjectById(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      owner: { select: { id: true, firstName: true, lastName: true } },
      assignedUsers: { select: { id: true, firstName: true, lastName: true } },
      notes: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { firstName: true, lastName: true } } },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { actor: { select: { firstName: true, lastName: true } } },
      },
      tasks: { where: { deletedAt: null }, select: { id: true, status: true } },
    },
  });
}
