import { prisma } from "@/lib/prisma";
import { parseListParams, type ListSearchParams } from "@/lib/pagination";
import {
  getLeadFunnelStats,
  getLeadsByStage,
} from "@/features/leads/services/lead.service";
import { getCompletedProjectsCount } from "@/features/projects/services/project.service";
import type { Recommendation } from "@/features/seo/schemas/seo-audit.schema";
import { getSeoPerformanceData } from "@/features/seo/services/seo-project.service";
import { getSeoAuditReportData } from "@/features/seo/services/website-analysis.service";
import type { SupportedReportType } from "@/features/reports/schemas/report.schema";
import { getTaskStatusCounts } from "@/features/tasks/services/task.service";

export type ReportChartRow = { status: string; count: number };

export type ReportData = {
  summaryCards: { label: string; value: string }[];
  chart?: ReportChartRow[];
  columns: string[];
  rows: (string | number)[][];
  /** Phase 13 (SEO_AUDIT only) — every other report type leaves these unset; the detail page only renders them when present. */
  executiveSummary?: string | null;
  recommendations?: Recommendation[];
};

function toPlainNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

async function getProjectSummaryData(
  companyId: string,
  projectId?: string
): Promise<ReportData> {
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { client: { select: { name: true } } },
    });
    if (!project || project.companyId !== companyId) {
      throw new Error("Project not found.");
    }

    const statusCounts = await prisma.task.groupBy({
      by: ["status"],
      where: { projectId, deletedAt: null },
      _count: true,
    });
    const totalTasks = statusCounts.reduce((sum, row) => sum + row._count, 0);
    const doneTasks = statusCounts.find((row) => row.status === "DONE")?._count ?? 0;

    return {
      summaryCards: [
        { label: "Project", value: project.name },
        { label: "Client", value: project.client?.name ?? "—" },
        { label: "Status", value: project.status },
        { label: "Budget", value: `$${toPlainNumber(project.budget).toLocaleString()}` },
        { label: "Total Tasks", value: String(totalTasks) },
        {
          label: "Completion",
          value: totalTasks > 0 ? `${Math.round((doneTasks / totalTasks) * 100)}%` : "0%",
        },
      ],
      chart: statusCounts.map((row) => ({ status: row.status, count: row._count })),
      columns: ["Status", "Count"],
      rows: statusCounts.map((row) => [row.status, row._count]),
    };
  }

  const [projectStatusCounts, taskStatusCounts, completedProjectsCount, totalProjects] =
    await Promise.all([
      prisma.project.groupBy({
        by: ["status"],
        where: { companyId, deletedAt: null },
        _count: true,
      }),
      getTaskStatusCounts(companyId),
      getCompletedProjectsCount(companyId),
      prisma.project.count({ where: { companyId, deletedAt: null } }),
    ]);

  const totalTasks = taskStatusCounts.reduce((sum, row) => sum + row.count, 0);

  return {
    summaryCards: [
      { label: "Total Projects", value: String(totalProjects) },
      { label: "Completed Projects", value: String(completedProjectsCount) },
      { label: "Total Tasks", value: String(totalTasks) },
    ],
    chart: taskStatusCounts.map((row) => ({ status: row.status, count: row.count })),
    columns: ["Project Status", "Count"],
    rows: projectStatusCounts.map((row) => [row.status, row._count]),
  };
}

async function getClientSummaryData(
  companyId: string,
  clientId?: string
): Promise<ReportData> {
  if (clientId) {
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.companyId !== companyId) {
      throw new Error("Client not found.");
    }

    const [projectCount, leadCount] = await Promise.all([
      prisma.project.count({ where: { clientId, deletedAt: null } }),
      prisma.lead.count({ where: { clientId, deletedAt: null } }),
    ]);

    return {
      summaryCards: [
        { label: "Client", value: client.name },
        { label: "Status", value: client.status },
        { label: "Projects", value: String(projectCount) },
        { label: "Leads", value: String(leadCount) },
      ],
      columns: ["Metric", "Value"],
      rows: [
        ["Projects", projectCount],
        ["Leads", leadCount],
      ],
    };
  }

  const statusCounts = await prisma.client.groupBy({
    by: ["status"],
    where: { companyId, deletedAt: null },
    _count: true,
  });
  const totalClients = statusCounts.reduce((sum, row) => sum + row._count, 0);

  return {
    summaryCards: [
      { label: "Total Clients", value: String(totalClients) },
      ...statusCounts.map((row) => ({ label: row.status, value: String(row._count) })),
    ],
    columns: ["Client Status", "Count"],
    rows: statusCounts.map((row) => [row.status, row._count]),
  };
}

async function getBudgetRollupData(
  companyId: string,
  clientId?: string
): Promise<ReportData> {
  const where = {
    companyId,
    deletedAt: null,
    ...(clientId ? { clientId } : {}),
  };

  const [totals, byStatus] = await Promise.all([
    prisma.project.aggregate({
      where,
      _sum: { budget: true },
      _avg: { budget: true },
      _count: true,
    }),
    prisma.project.groupBy({
      by: ["status"],
      where,
      _sum: { budget: true },
      _count: true,
    }),
  ]);

  return {
    summaryCards: [
      { label: "Total Budget", value: `$${toPlainNumber(totals._sum.budget).toLocaleString()}` },
      {
        label: "Average Budget",
        value: `$${toPlainNumber(totals._avg.budget).toLocaleString()}`,
      },
      { label: "Projects", value: String(totals._count) },
    ],
    columns: ["Status", "Project Count", "Total Budget"],
    rows: byStatus.map((row) => [
      row.status,
      row._count,
      toPlainNumber(row._sum.budget),
    ]),
  };
}

async function getSalesPipelineData(companyId: string): Promise<ReportData> {
  const [funnel, stages] = await Promise.all([
    getLeadFunnelStats(companyId),
    getLeadsByStage(companyId),
  ]);

  return {
    summaryCards: [
      { label: "New Leads", value: String(funnel.newLeads) },
      { label: "Qualified Leads", value: String(funnel.qualifiedLeads) },
      { label: "Won Deals", value: String(funnel.wonDeals) },
      { label: "Lost Deals", value: String(funnel.lostDeals) },
      { label: "Conversion Rate", value: `${funnel.conversionRate}%` },
      { label: "Pipeline Value", value: `$${funnel.pipelineValue.toLocaleString()}` },
    ],
    chart: stages.map((stage) => ({ status: stage.status, count: stage.leads.length })),
    columns: ["Stage", "Lead Count", "Total Value"],
    rows: stages.map((stage) => [
      stage.status,
      stage.leads.length,
      stage.leads.reduce((sum, lead) => sum + toPlainNumber(lead.value), 0),
    ]),
  };
}

/**
 * Server-only dispatch from report type to its compute function — the
 * counterpart to REPORT_TYPE_OPTIONS in report.schema.ts. CUSTOM has no
 * entry (it never computes; see generateReport). Adding a new report
 * type means adding one entry here and one in REPORT_TYPE_OPTIONS.
 */
export const REPORT_COMPUTE: Partial<
  Record<SupportedReportType, (companyId: string, scopeId?: string) => Promise<ReportData>>
> = {
  PROJECT_SUMMARY: getProjectSummaryData,
  CLIENT_SUMMARY: getClientSummaryData,
  FINANCIAL: getBudgetRollupData,
  SALES_PIPELINE: (companyId) => getSalesPipelineData(companyId),
  SEO_PERFORMANCE: getSeoPerformanceData,
  SEO_AUDIT: getSeoAuditReportData,
};

export async function listReports(
  companyId: string,
  searchParams: ListSearchParams
) {
  const { page, pageSize, q, status, skip } = parseListParams(searchParams);
  const showArchived = status === "archived";

  const where = {
    companyId,
    deletedAt: showArchived ? { not: null } : null,
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [reports, totalCount] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        generatedBy: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.report.count({ where }),
  ]);

  return { reports, totalCount, page, pageSize };
}

export function getReportById(id: string) {
  return prisma.report.findUnique({
    where: { id },
    include: {
      generatedBy: { select: { firstName: true, lastName: true } },
      file: { select: { id: true, fileName: true, sizeBytes: true } },
    },
  });
}

/** Feeds the dashboard's "Recent Reports" card. */
export function getRecentReportsList(companyId: string) {
  return prisma.report.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      generatedBy: { select: { firstName: true, lastName: true } },
    },
  });
}
