import { prisma } from "@/lib/prisma";
import { Prisma, type AiTaskType } from "@/lib/generated/prisma/client";
import { AI_PROVIDERS, AI_TASK_TYPES, AI_USAGE_PAGE_SIZE, type AiUsageFilters } from "@/features/ai-usage/schemas/ai-usage-filters";

/**
 * AiUsageLog has no direct companyId — the only path to company-scope it is
 * through websiteAnalysisJob.companyId. A relation filter on this nullable
 * to-one relation (without `is`/`isNot`) requires the related row to exist
 * AND match, so a log row with no linked job (or a job belonging to another
 * company) can never satisfy this filter — company isolation is structural,
 * not just a matter of remembering to add a clause.
 */
function buildWhere(companyId: string, filters: AiUsageFilters): Prisma.AiUsageLogWhereInput {
  return {
    websiteAnalysisJob: { companyId },
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.taskType ? { taskType: filters.taskType as AiTaskType } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          createdAt: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        }
      : {}),
  };
}

function toNumberOrZero(value: Prisma.Decimal | null): number {
  return value ? Number(value) : 0;
}

export type AiUsageSummary = {
  /** Null when calls exist but none of them reported a cost — never fabricated as $0. */
  totalSpendUsd: number | null;
  callsMissingCost: number;
  totalCalls: number;
  successRate: number | null;
  avgLatencyMs: number | null;
};

export async function getAiUsageSummary(companyId: string, filters: AiUsageFilters): Promise<AiUsageSummary> {
  const where = buildWhere(companyId, filters);

  const [agg, successCount] = await Promise.all([
    prisma.aiUsageLog.aggregate({
      where,
      _sum: { estimatedCostUsd: true },
      _avg: { latencyMs: true },
      _count: { _all: true, estimatedCostUsd: true },
    }),
    prisma.aiUsageLog.count({ where: { ...where, succeeded: true } }),
  ]);

  const totalCalls = agg._count._all;
  const callsWithCost = agg._count.estimatedCostUsd;
  const callsMissingCost = totalCalls - callsWithCost;
  const noCostDataAtAll = totalCalls > 0 && callsMissingCost === totalCalls;

  return {
    totalSpendUsd: noCostDataAtAll ? null : toNumberOrZero(agg._sum.estimatedCostUsd),
    callsMissingCost,
    totalCalls,
    successRate: totalCalls === 0 ? null : (successCount / totalCalls) * 100,
    avgLatencyMs: totalCalls === 0 ? null : agg._avg.latencyMs,
  };
}

export type AiSpendTrendPoint = {
  day: Date;
  /** Null when calls happened that day but none reported a cost — a genuine gap, never a dip to zero. */
  costUsd: number | null;
  calls: number;
  callsMissingCost: number;
};

type SpendTrendRow = { day: Date; cost: Prisma.Decimal | null; calls: bigint; callsMissingCost: bigint };

/**
 * Prisma's groupBy can't bucket by a truncated date, so this needs raw SQL —
 * same reason features/dashboard/services/dashboard.service.ts's
 * getActivityTrend does. AiUsageLog has no companyId of its own, so this
 * joins through WebsiteAnalysisJob for the company scope (see buildWhere's
 * comment above — the ORM-level relation filter isn't available in raw SQL,
 * so the join here is the raw-SQL equivalent of that same requirement).
 */
export async function getAiSpendTrend(companyId: string, filters: AiUsageFilters): Promise<AiSpendTrendPoint[]> {
  const conditions = [Prisma.sql`w."companyId" = ${companyId}::uuid`];
  if (filters.dateFrom) conditions.push(Prisma.sql`a."createdAt" >= ${filters.dateFrom}`);
  if (filters.dateTo) conditions.push(Prisma.sql`a."createdAt" <= ${filters.dateTo}`);
  if (filters.provider) conditions.push(Prisma.sql`a.provider = ${filters.provider}`);
  if (filters.taskType) conditions.push(Prisma.sql`a."taskType" = ${filters.taskType}::"AiTaskType"`);

  const rows = await prisma.$queryRaw<SpendTrendRow[]>`
    SELECT date_trunc('day', a."createdAt") AS day,
           SUM(a."estimatedCostUsd") AS cost,
           COUNT(*)::bigint AS calls,
           (COUNT(*) - COUNT(a."estimatedCostUsd"))::bigint AS "callsMissingCost"
    FROM "AiUsageLog" a
    JOIN "WebsiteAnalysisJob" w ON w.id = a."websiteAnalysisJobId"
    WHERE ${Prisma.join(conditions, " AND ")}
    GROUP BY day
    ORDER BY day ASC
  `;

  return rows.map((row) => {
    const calls = Number(row.calls);
    const callsMissingCost = Number(row.callsMissingCost);
    const noCostDataThatDay = calls > 0 && callsMissingCost === calls;
    return {
      day: row.day,
      costUsd: noCostDataThatDay ? null : toNumberOrZero(row.cost),
      calls,
      callsMissingCost,
    };
  });
}

export type AiSpendByGroup = { costUsd: number; calls: number; callsMissingCost: number };
export type AiSpendByProvider = AiSpendByGroup & { provider: string };
export type AiSpendByTask = AiSpendByGroup & { taskType: string };

/**
 * Always returns exactly 5 rows, one per AI_PROVIDERS, so a never-used
 * provider still appears with {costUsd: 0, calls: 0} rather than being
 * silently omitted — that 0 is genuinely correct (0 calls happened), unlike
 * the AiUsageSummary case above where 0 could misrepresent unreported cost.
 * Bar height is always the best-available sum; the UI's tooltip is where
 * `callsMissingCost` gets surfaced, since a bar chart has no "gap" the way
 * a line chart's null point does.
 */
export async function getAiSpendByProvider(companyId: string, filters: AiUsageFilters): Promise<AiSpendByProvider[]> {
  const where = buildWhere(companyId, filters);
  const grouped = await prisma.aiUsageLog.groupBy({
    by: ["provider"],
    where,
    _sum: { estimatedCostUsd: true },
    _count: { _all: true, estimatedCostUsd: true },
  });

  return AI_PROVIDERS.map((provider) => {
    const match = grouped.find((row) => row.provider === provider);
    const calls = match?._count._all ?? 0;
    const callsWithCost = match?._count.estimatedCostUsd ?? 0;
    return {
      provider,
      costUsd: toNumberOrZero(match?._sum.estimatedCostUsd ?? null),
      calls,
      callsMissingCost: calls - callsWithCost,
    };
  });
}

/** Same shape and same always-5-rows guarantee as getAiSpendByProvider, grouped by AI_TASK_TYPES instead. */
export async function getAiSpendByTaskType(companyId: string, filters: AiUsageFilters): Promise<AiSpendByTask[]> {
  const where = buildWhere(companyId, filters);
  const grouped = await prisma.aiUsageLog.groupBy({
    by: ["taskType"],
    where,
    _sum: { estimatedCostUsd: true },
    _count: { _all: true, estimatedCostUsd: true },
  });

  return AI_TASK_TYPES.map((taskType) => {
    const match = grouped.find((row) => row.taskType === taskType);
    const calls = match?._count._all ?? 0;
    const callsWithCost = match?._count.estimatedCostUsd ?? 0;
    return {
      taskType,
      costUsd: toNumberOrZero(match?._sum.estimatedCostUsd ?? null),
      calls,
      callsMissingCost: calls - callsWithCost,
    };
  });
}

export type AiFailureBreakdownRow = { errorType: string; count: number };

/** A UI-only bucket label, never a real WebsiteAnalysisErrorType value — see the comment on the coalesce below. */
const UNKNOWN_OTHER = "UNKNOWN_OTHER";

/**
 * Every current failure path in lib/ai/structured-output.ts already sets a
 * real errorType, so a null one isn't reachable by today's code — this
 * coalesce is defensive for future callers, so a failed row can never
 * silently vanish from the breakdown. sum(rows[].count) always equals the
 * total failed-call count as a result.
 */
export async function getAiFailuresByErrorType(companyId: string, filters: AiUsageFilters): Promise<AiFailureBreakdownRow[]> {
  const where = { ...buildWhere(companyId, filters), succeeded: false };
  const grouped = await prisma.aiUsageLog.groupBy({
    by: ["errorType"],
    where,
    _count: { _all: true },
  });

  return grouped.map((row) => ({
    errorType: row.errorType ?? UNKNOWN_OTHER,
    count: row._count._all,
  }));
}

export type RecentAiUsageRow = {
  id: string;
  createdAt: Date;
  provider: string;
  taskType: string;
  model: string | null;
  succeeded: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: Prisma.Decimal | null;
  latencyMs: number;
  retried: boolean;
  errorType: string | null;
};

export async function listRecentAiUsage(
  companyId: string,
  filters: AiUsageFilters,
  page: number,
  pageSize = AI_USAGE_PAGE_SIZE
): Promise<{ rows: RecentAiUsageRow[]; totalCount: number }> {
  const where = buildWhere(companyId, filters);

  const [rows, totalCount] = await Promise.all([
    prisma.aiUsageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        provider: true,
        taskType: true,
        model: true,
        succeeded: true,
        promptTokens: true,
        completionTokens: true,
        estimatedCostUsd: true,
        latencyMs: true,
        retried: true,
        errorType: true,
      },
    }),
    prisma.aiUsageLog.count({ where }),
  ]);

  return { rows, totalCount };
}
