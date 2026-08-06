import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";

export async function listTasksForProject(
  projectId: string,
  searchParams: ListSearchParams
) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    projectId,
    parentTaskId: null,
    deletedAt: showArchived ? { not: null } : null,
    ...(status && !showArchived
      ? {
          status: status.toUpperCase() as
            | "TODO"
            | "IN_PROGRESS"
            | "IN_REVIEW"
            | "DONE"
            | "CANCELLED",
        }
      : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [tasks, totalCount] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        assignee: { select: { firstName: true, lastName: true } },
        _count: { select: { subtasks: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);

  return { tasks, totalCount, page, pageSize };
}

export function getTaskById(id: string) {
  return prisma.task.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true, companyId: true } },
      parentTask: { select: { id: true, title: true } },
      assignee: { select: { id: true, firstName: true, lastName: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      subtasks: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: { assignee: { select: { firstName: true, lastName: true } } },
      },
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
