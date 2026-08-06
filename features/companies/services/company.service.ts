import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";

export async function listCompanies(searchParams: ListSearchParams) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    deletedAt: showArchived ? { not: null } : null,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { slug: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [companies, totalCount] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.company.count({ where }),
  ]);

  return { companies, totalCount, page, pageSize };
}

export function getCompanyById(id: string) {
  return prisma.company.findUnique({ where: { id } });
}

export async function getCompanyCounts(companyId: string) {
  const [
    activeUsers,
    activeProjects,
    activeClients,
    totalUsers,
    totalProjects,
    totalClients,
  ] = await Promise.all([
    prisma.user.count({
      where: { companyId, status: "ACTIVE", deletedAt: null },
    }),
    prisma.project.count({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ["PLANNING", "IN_PROGRESS", "ON_HOLD"] },
      },
    }),
    prisma.client.count({
      where: { companyId, status: "ACTIVE", deletedAt: null },
    }),
    prisma.user.count({ where: { companyId, deletedAt: null } }),
    prisma.project.count({ where: { companyId, deletedAt: null } }),
    prisma.client.count({ where: { companyId, deletedAt: null } }),
  ]);

  return {
    activeUsers,
    activeProjects,
    activeClients,
    totalUsers,
    totalProjects,
    totalClients,
  };
}

export function getCompanyUsers(companyId: string) {
  return prisma.user.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

export function getCompanyClients(companyId: string) {
  return prisma.client.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

export function getCompanyProjects(companyId: string) {
  return prisma.project.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}
