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
  return prisma.company.findUnique({ where: { id }, include: { brandProfile: true } });
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

/**
 * Phase 28 — Activity.companyId is the tenant-scoping field set on nearly
 * every activity row app-wide, not a "belongs to this record" FK the way
 * it is for every other entity's own `activities` relation. A plain
 * `where: {companyId}` would return the whole tenant's activity, not this
 * Company record's own history. Scoping to the `company.*` action prefix
 * (created/updated/archived/restored/ai_limits_updated — the only
 * activities actually about the Company record itself) keeps this
 * genuinely equivalent to what every other detail page's Activity
 * Timeline shows.
 */
export function getCompanyActivities(companyId: string) {
  return prisma.activity.findMany({
    where: { companyId, action: { startsWith: "company." } },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { actor: { select: { firstName: true, lastName: true } } },
  });
}
