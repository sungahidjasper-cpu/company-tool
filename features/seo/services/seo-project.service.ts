import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";
import type { ReportData } from "@/features/reports/services/report.service";

export async function listSeoProjects(
  companyId: string,
  searchParams: ListSearchParams
) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    companyId,
    deletedAt: showArchived ? { not: null } : null,
    ...(status && !showArchived
      ? { status: status.toUpperCase() as "ACTIVE" | "PAUSED" | "COMPLETED" }
      : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { domain: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [seoProjects, totalCount] = await Promise.all([
    prisma.sEOProject.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        owner: { select: { firstName: true, lastName: true } },
        client: { select: { id: true, name: true } },
        _count: { select: { keywords: true, content: true } },
      },
    }),
    prisma.sEOProject.count({ where }),
  ]);

  return { seoProjects, totalCount, page, pageSize };
}

export async function getSeoProjectById(id: string) {
  return prisma.sEOProject.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      owner: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { keywordClusters: true, keywords: true, content: true } },
      keywordClusters: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { _count: { select: { keywords: true } } },
      },
      keywords: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      content: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
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

/** Lightweight option list for pickers (e.g. Reports' SEO Performance scope picker). */
export function listSeoProjectOptions(companyId: string) {
  return prisma.sEOProject.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

function bucketRank(rank: number | null): string {
  if (rank === null) return "Unranked";
  if (rank <= 3) return "Top 3";
  if (rank <= 10) return "Top 10";
  if (rank <= 50) return "Top 50";
  return "Beyond 50";
}

const RANK_BUCKET_ORDER = ["Top 3", "Top 10", "Top 50", "Beyond 50", "Unranked"];

/** Shared by the dashboard card and the SEO_PERFORMANCE report — one aggregation, two consumers. */
async function computeSeoStats(companyId: string, seoProjectId?: string) {
  const projectScope = seoProjectId ? { id: seoProjectId } : { companyId };

  const [activeSeoProjects, keywords, contentStatusCounts, totalContent] = await Promise.all([
    prisma.sEOProject.count({ where: { ...projectScope, deletedAt: null, status: "ACTIVE" } }),
    prisma.keyword.findMany({
      where: { seoProject: projectScope, deletedAt: null },
      select: { searchVolume: true, difficulty: true, currentRank: true },
    }),
    prisma.content.groupBy({
      by: ["status"],
      where: { seoProject: projectScope, deletedAt: null },
      _count: true,
    }),
    prisma.content.count({ where: { seoProject: projectScope, deletedAt: null } }),
  ]);

  const totalKeywords = keywords.length;
  const avg = (values: number[]) =>
    values.length > 0 ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : 0;

  const avgSearchVolume = avg(
    keywords.map((k) => k.searchVolume).filter((v): v is number => v !== null)
  );
  const avgDifficulty = avg(
    keywords.map((k) => k.difficulty).filter((v): v is number => v !== null)
  );

  const rankBuckets = new Map(RANK_BUCKET_ORDER.map((bucket) => [bucket, 0]));
  for (const keyword of keywords) {
    const bucket = bucketRank(keyword.currentRank);
    rankBuckets.set(bucket, (rankBuckets.get(bucket) ?? 0) + 1);
  }

  const publishedContent =
    contentStatusCounts.find((row) => row.status === "PUBLISHED")?._count ?? 0;

  return {
    activeSeoProjects,
    totalKeywords,
    avgSearchVolume,
    avgDifficulty,
    publishedContent,
    totalContent,
    rankBuckets: RANK_BUCKET_ORDER.map((bucket) => ({
      status: bucket,
      count: rankBuckets.get(bucket) ?? 0,
    })),
    contentStatusBreakdown: contentStatusCounts.map((row) => ({
      status: row.status,
      count: row._count,
    })),
  };
}

/** Feeds the dashboard's three SEO stat cards + ranking-distribution chart. */
export async function getSeoDashboardStats(companyId: string) {
  const stats = await computeSeoStats(companyId);
  return {
    activeSeoProjects: stats.activeSeoProjects,
    totalKeywords: stats.totalKeywords,
    contentPublished: stats.publishedContent,
    keywordRankDistribution: stats.rankBuckets,
  };
}

/** Feeds the dashboard's "Recent SEO Projects" card. */
export function getRecentSeoProjectsList(companyId: string) {
  return prisma.sEOProject.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

/** Reports' SEO_PERFORMANCE compute function — reuses the same aggregation as the dashboard KPIs. */
export async function getSeoPerformanceData(
  companyId: string,
  seoProjectId?: string
): Promise<ReportData> {
  const stats = await computeSeoStats(companyId, seoProjectId);

  return {
    summaryCards: [
      { label: "Active SEO Projects", value: String(stats.activeSeoProjects) },
      { label: "Total Keywords", value: String(stats.totalKeywords) },
      { label: "Avg Search Volume", value: stats.avgSearchVolume.toLocaleString() },
      { label: "Avg Difficulty", value: String(stats.avgDifficulty) },
      { label: "Content Published", value: `${stats.publishedContent} / ${stats.totalContent}` },
    ],
    chart: stats.rankBuckets,
    columns: ["Content Status", "Count"],
    rows: stats.contentStatusBreakdown.map((row) => [row.status, row.count]),
  };
}
