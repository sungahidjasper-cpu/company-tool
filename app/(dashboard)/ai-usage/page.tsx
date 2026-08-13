import { Bot } from "lucide-react";

import DashboardGrid from "@/components/dashboard/DashboardGrid";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import Pagination from "@/components/dashboard/Pagination";
import StatsCard from "@/components/dashboard/StatsCard";
import TasksByStatusChart from "@/components/dashboard/charts/TasksByStatusChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AiSpendBarChart from "@/features/ai-usage/components/AiSpendBarChart";
import AiSpendTrendChart from "@/features/ai-usage/components/AiSpendTrendChart";
import AiUsageFilterBar from "@/features/ai-usage/components/AiUsageFilterBar";
import RecentAiActivityTable from "@/features/ai-usage/components/RecentAiActivityTable";
import { parseAiUsageFilters, type AiUsageSearchParams } from "@/features/ai-usage/schemas/ai-usage-filters";
import {
  getAiFailuresByErrorType,
  getAiSpendByProvider,
  getAiSpendByTaskType,
  getAiSpendTrend,
  getAiUsageSummary,
  listRecentAiUsage,
} from "@/features/ai-usage/services/ai-usage.service";
import { requireUser } from "@/lib/auth";
import { getTotalPages } from "@/lib/pagination";
import { formatEnumLabel } from "@/lib/utils";

type AiUsagePageProps = {
  searchParams: Promise<AiUsageSearchParams>;
};

function formatSpend(value: number) {
  return `$${value.toFixed(6)} estimated`;
}

export default async function AiUsagePage({ searchParams }: AiUsagePageProps) {
  const user = await requireUser();
  const rawParams = await searchParams;
  const filters = parseAiUsageFilters(rawParams);

  const [summary, trend, byProvider, byTask, failures, activity] = await Promise.all([
    getAiUsageSummary(user.companyId, filters),
    getAiSpendTrend(user.companyId, filters),
    getAiSpendByProvider(user.companyId, filters),
    getAiSpendByTaskType(user.companyId, filters),
    getAiFailuresByErrorType(user.companyId, filters),
    listRecentAiUsage(user.companyId, filters, filters.page),
  ]);

  const totalPages = getTotalPages(activity.totalCount, 10);
  const buildActivityHref = (targetPage: number) => {
    const sp = new URLSearchParams();
    if (rawParams.dateFrom) sp.set("dateFrom", rawParams.dateFrom);
    if (rawParams.dateTo) sp.set("dateTo", rawParams.dateTo);
    if (rawParams.provider) sp.set("provider", rawParams.provider);
    if (rawParams.taskType) sp.set("taskType", rawParams.taskType);
    sp.set("page", String(targetPage));
    return `/ai-usage?${sp.toString()}`;
  };

  const spendValue =
    summary.totalCalls === 0
      ? "No calls yet"
      : summary.totalSpendUsd === null
        ? "Unavailable"
        : formatSpend(summary.totalSpendUsd);

  const successRateValue = summary.successRate === null ? "No calls yet" : `${summary.successRate.toFixed(1)}%`;
  const avgLatencyValue = summary.avgLatencyMs === null ? "No data" : `${Math.round(summary.avgLatencyMs).toLocaleString()}ms`;

  return (
    <PageContainer>
      <DashboardHeader
        title="AI Usage & Cost"
        description="Tracks AI provider usage, estimated costs, performance, and failures. Read-only — viewing this page never triggers an AI call."
      />

      <AiUsageFilterBar
        dateFrom={rawParams.dateFrom}
        dateTo={rawParams.dateTo}
        provider={rawParams.provider}
        taskType={rawParams.taskType}
      />

      <DashboardGrid>
        <StatsCard title="Total AI Spend" value={spendValue} icon={Bot} />
        <StatsCard title="AI Calls" value={summary.totalCalls} icon={Bot} />
        <StatsCard title="Success Rate" value={successRateValue} icon={Bot} />
        <StatsCard title="Average Latency" value={avgLatencyValue} icon={Bot} />
      </DashboardGrid>

      {summary.totalCalls > 0 && summary.callsMissingCost > 0 && (
        <p className="text-sm text-slate-500">
          Estimated from {summary.totalCalls - summary.callsMissingCost} of {summary.totalCalls} attempts — the rest
          reported no cost data.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Spend Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <AiSpendTrendChart data={trend} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Spend by Provider</CardTitle>
          </CardHeader>
          <CardContent>
            <AiSpendBarChart
              data={byProvider.map((row) => ({
                label: formatEnumLabel(row.provider),
                costUsd: row.costUsd,
                calls: row.calls,
                callsMissingCost: row.callsMissingCost,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Spend by Task</CardTitle>
          </CardHeader>
          <CardContent>
            <AiSpendBarChart
              data={byTask.map((row) => ({
                label: formatEnumLabel(row.taskType),
                costUsd: row.costUsd,
                calls: row.calls,
                callsMissingCost: row.callsMissingCost,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Failures by Type</CardTitle>
        </CardHeader>
        <CardContent>
          {failures.length === 0 ? (
            <EmptyState icon={Bot} title="No AI failures" description="No failed AI attempts in the selected range." />
          ) : (
            <TasksByStatusChart data={failures.map((row) => ({ status: row.errorType, count: row.count }))} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent AI Activity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RecentAiActivityTable rows={activity.rows} />
          <Pagination page={filters.page} totalPages={totalPages} buildHref={buildActivityHref} />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
