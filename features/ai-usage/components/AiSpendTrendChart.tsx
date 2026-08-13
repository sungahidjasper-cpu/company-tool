"use client";

import { format } from "date-fns";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TrendPoint = { day: Date; costUsd: number | null; calls: number; callsMissingCost: number };

type AiSpendTrendChartProps = {
  data: TrendPoint[];
};

type ChartRow = { dayLabel: string; costUsd: number | null; calls: number; callsMissingCost: number };

function formatUsd(value: number) {
  return `$${value.toFixed(6)}`;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-slate-700">{row.dayLabel}</p>
      {row.costUsd === null ? (
        <p className="text-slate-500">
          No cost data reported ({row.calls} call{row.calls === 1 ? "" : "s"})
        </p>
      ) : (
        <>
          <p className="text-slate-600">{formatUsd(row.costUsd)} estimated</p>
          {row.callsMissingCost > 0 && (
            <p className="text-slate-500">
              Partial — {row.callsMissingCost} of {row.calls} calls have no reported cost
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Currency-aware sibling to components/dashboard/charts/ActivityTrendChart —
 * that component hardcodes allowDecimals={false} on its Y-axis (correct for
 * integer activity counts, wrong for sub-cent USD values, which would
 * visually round to a flat zero line). connectNulls is left at its default
 * (false) deliberately: a day with calls but no reported cost renders as a
 * genuine gap in the line, never a dip to $0.
 */
export default function AiSpendTrendChart({ data }: AiSpendTrendChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-500">No AI usage in the selected range.</p>;
  }

  const chartData: ChartRow[] = data.map((row) => ({
    dayLabel: format(row.day, "MMM d"),
    costUsd: row.costUsd,
    calls: row.calls,
    callsMissingCost: row.callsMissingCost,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="dayLabel"
          tick={{ fontSize: 12, fill: "#64748b" }}
          axisLine={{ stroke: "#e2e8f0" }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(value: number) => `$${value}`}
          tick={{ fontSize: 12, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<TrendTooltip />} />
        <Line type="monotone" dataKey="costUsd" stroke="#567C8D" strokeWidth={2} dot={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
