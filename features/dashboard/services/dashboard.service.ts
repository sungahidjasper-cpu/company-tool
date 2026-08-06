import { unstable_cache } from "next/cache";

import { prisma } from "@/lib/prisma";

type MonthlyCount = { month: Date; count: bigint };
type DailyCount = { day: Date; count: bigint };

async function getTaskStatusCounts(companyId: string) {
  const rows = await prisma.task.groupBy({
    by: ["status"],
    where: { project: { companyId }, deletedAt: null },
    _count: true,
  });

  return rows.map((row) => ({ status: row.status, count: row._count }));
}

function getCompletedProjectsCount(companyId: string) {
  return prisma.project.count({
    where: { companyId, deletedAt: null, status: "COMPLETED" },
  });
}

function getTotalFileUploads(companyId: string) {
  return prisma.file.count({
    where: {
      deletedAt: null,
      OR: [
        { companyId },
        { client: { companyId } },
        { project: { companyId } },
        { task: { project: { companyId } } },
        { user: { companyId } },
      ],
    },
  });
}

/** Efficient DB-side month bucketing — pulls 12 aggregated rows, not every project. */
async function getProjectsCreatedPerMonth(companyId: string) {
  const rows = await prisma.$queryRaw<MonthlyCount[]>`
    SELECT date_trunc('month', "createdAt") AS month, COUNT(*)::bigint AS count
    FROM "Project"
    WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
      AND "createdAt" >= now() - interval '12 months'
    GROUP BY month
    ORDER BY month ASC
  `;

  return rows.map((row) => ({ month: row.month, count: Number(row.count) }));
}

/**
 * Uses Activity.companyId directly (populated going forward by every
 * logActivity() call as of Phase 6) rather than the multi-way relational
 * OR-join the recent-activity feed below still uses — much simpler and
 * cheaper for a 14-day trend. Rows logged before this column existed won't
 * be included; see the Phase 6 report.
 */
async function getActivityTrend(companyId: string) {
  const rows = await prisma.$queryRaw<DailyCount[]>`
    SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
    FROM "Activity"
    WHERE "companyId" = ${companyId}::uuid
      AND "createdAt" >= now() - interval '14 days'
    GROUP BY day
    ORDER BY day ASC
  `;

  return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
}

function getRecentTasksList(companyId: string) {
  return prisma.task.findMany({
    where: { project: { companyId }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { firstName: true, lastName: true } },
    },
  });
}

function getRecentUploadsList(companyId: string) {
  return prisma.file.findMany({
    where: {
      deletedAt: null,
      OR: [
        { companyId },
        { client: { companyId } },
        { project: { companyId } },
        { task: { project: { companyId } } },
        { user: { companyId } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { uploadedBy: { select: { firstName: true, lastName: true } } },
  });
}

function getRecentCommentsList(companyId: string) {
  return prisma.note.findMany({
    where: {
      OR: [
        { client: { companyId } },
        { project: { companyId } },
        { contact: { client: { companyId } } },
        { task: { project: { companyId } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { author: { select: { firstName: true, lastName: true } } },
  });
}

function getRecentUsersList(companyId: string) {
  return prisma.user.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, firstName: true, lastName: true, role: true, createdAt: true },
  });
}

/**
 * All dashboard aggregates in one cached call. Short, time-based TTL
 * (60s) rather than manual tag invalidation from every mutation — this is
 * the "lightweight" tradeoff: KPIs can lag up to a minute behind the very
 * latest write, while every list/detail page (which uses revalidatePath,
 * unaffected by this cache) stays fully live.
 *
 * unstable_cache is deprecated in favor of the `use cache` directive, but
 * that requires opting the whole app into Cache Components (cacheComponents
 * in next.config.ts), which forces every dynamic page — effectively all of
 * them here, since they all read the session — to be wrapped in Suspense
 * or the build fails. That's disproportionate for one dashboard's metrics
 * and would risk breaking Phases 1–5. unstable_cache is still shipped and
 * functional in this Next version; see the Phase 6 report.
 */
const getCachedDashboardData = unstable_cache(
  async (companyId: string, isSuperAdmin: boolean) => {
    const [
      companiesCount,
      usersCount,
      clientsCount,
      projectsCount,
      completedProjectsCount,
      taskStatusCounts,
      totalFileUploads,
      projectsCreatedPerMonth,
      activityTrend,
      recentActivity,
      recentProjects,
      recentClients,
      recentTasks,
      recentUploads,
      recentComments,
      recentUsers,
    ] = await Promise.all([
      isSuperAdmin
        ? prisma.company.count({ where: { deletedAt: null } })
        : Promise.resolve(null),
      prisma.user.count({ where: { companyId, deletedAt: null } }),
      prisma.client.count({ where: { companyId, deletedAt: null } }),
      prisma.project.count({ where: { companyId, deletedAt: null } }),
      getCompletedProjectsCount(companyId),
      getTaskStatusCounts(companyId),
      getTotalFileUploads(companyId),
      getProjectsCreatedPerMonth(companyId),
      getActivityTrend(companyId),
      // Relational OR-join: still correct for activity rows logged before
      // Phase 6 (no companyId column back then), unlike the trend query.
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
      getRecentTasksList(companyId),
      getRecentUploadsList(companyId),
      getRecentCommentsList(companyId),
      getRecentUsersList(companyId),
    ]);

    return {
      companiesCount,
      usersCount,
      clientsCount,
      projectsCount,
      completedProjectsCount,
      taskStatusCounts,
      totalFileUploads,
      projectsCreatedPerMonth,
      activityTrend,
      recentActivity,
      recentProjects,
      recentClients,
      recentTasks,
      recentUploads,
      recentComments,
      recentUsers,
    };
  },
  ["dashboard-summary"],
  { revalidate: 60 }
);

export async function getDashboardSummary(
  companyId: string,
  isSuperAdmin: boolean
) {
  return getCachedDashboardData(companyId, isSuperAdmin);
}
