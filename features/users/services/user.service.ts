import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";

export async function listUsers(
  companyId: string,
  searchParams: ListSearchParams
) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    companyId,
    deletedAt: showArchived ? { not: null } : null,
    ...(status && !showArchived
      ? { status: status.toUpperCase() as "ACTIVE" | "INVITED" | "SUSPENDED" }
      : {}),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, totalCount, page, pageSize };
}

export function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    include: {
      ownedProjects: { where: { deletedAt: null }, take: 5 },
      assignedProjects: { where: { deletedAt: null }, take: 5 },
    },
  });
}

/** Lightweight option list for owner/assignee pickers — shared by Client and Project forms. */
export function listUserOptions(companyId: string) {
  return prisma.user.findMany({
    where: { companyId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  });
}
