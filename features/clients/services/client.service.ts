import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";

/** Lightweight option list for the Project form's client picker. */
export function listClientOptions(companyId: string) {
  return prisma.client.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function listClients(
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
            | "LEAD"
            | "ACTIVE"
            | "INACTIVE"
            | "CHURNED",
        }
      : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [clients, totalCount] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: { owner: { select: { firstName: true, lastName: true } } },
    }),
    prisma.client.count({ where }),
  ]);

  return { clients, totalCount, page, pageSize };
}

export function getClientById(id: string) {
  return prisma.client.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, firstName: true, lastName: true } },
      contacts: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
      },
      notes: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
      },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { actor: { select: { firstName: true, lastName: true } } },
      },
      projects: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}
