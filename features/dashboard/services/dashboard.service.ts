import { prisma } from "@/lib/prisma";

export async function getDashboardSummary(
  companyId: string,
  isSuperAdmin: boolean
) {
  const [
    companiesCount,
    usersCount,
    clientsCount,
    projectsCount,
    recentActivity,
    recentProjects,
    recentClients,
  ] = await Promise.all([
    isSuperAdmin
      ? prisma.company.count({ where: { deletedAt: null } })
      : Promise.resolve(null),
    prisma.user.count({ where: { companyId, deletedAt: null } }),
    prisma.client.count({ where: { companyId, deletedAt: null } }),
    prisma.project.count({ where: { companyId, deletedAt: null } }),
    // Activity has no direct companyId (Phase 2 chose to derive tenancy
    // through relations rather than duplicate it). Company/user-level
    // activities carry no client/project/contact/task anchor, so they're
    // intentionally not surfaced in this company-scoped feed.
    prisma.activity.findMany({
      where: {
        OR: [
          { client: { companyId } },
          { project: { companyId } },
          { contact: { client: { companyId } } },
          { task: { project: { companyId } } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { actor: { select: { firstName: true, lastName: true } } },
    }),
    prisma.project.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.client.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return {
    companiesCount,
    usersCount,
    clientsCount,
    projectsCount,
    recentActivity,
    recentProjects,
    recentClients,
  };
}
