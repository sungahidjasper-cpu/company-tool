"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type AiSpendBarDatum = { label: string; costUsd: number; calls: number; callsMissingCost: number };

type AiSpendBarChartProps = {
  data: AiSpendBarDatum[];
};

function formatUsd(value: number) {
  return `$${value.toFixed(6)}`;
}

function SpendBarTooltip({ active, payload }: { active?: boolean; payload?: { payload: AiSpendBarDatum }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-slate-700">{row.label}</p>
      <p className="text-slate-600">{formatUsd(row.costUsd)} estimated</p>
      <p className="text-slate-500">
        {row.calls} call{row.calls === 1 ? "" : "s"}
        {row.callsMissingCost > 0 && ` — ${row.callsMissingCost} with no reported cost`}
      </p>
    </div>
  );
}

/**
 * Currency-aware sibling to components/dashboard/charts/TasksByStatusChart —
 * that component hardcodes allowDecimals={false} (wrong for sub-cent USD
 * values) and has no way to surface the calls/callsMissingCost caveat a
 * cost chart needs. Bar height is always the best-available sum (never
 * null — a bar chart, unlike a line, has no visual "gap"); the tooltip is
 * where a bar with real calls but no reported cost data is disambiguated
 * from a bar that's genuinely zero because the provider/task was never
 * used. Shared by both the provider and task breakdowns (§5/§6) rather
 * than duplicating this component twice.
 */
export default function AiSpendBarChart({ data }: AiSpendBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: "#64748b" }}
          axisLine={{ stroke: "#e2e8f0" }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(value: number) => `$${value}`}
          tick={{ fontSize: 12, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip cursor={{ fill: "#f1f5f9" }} content={<SpendBarTooltip />} />
        <Bar dataKey="costUsd" fill="#2F4156" radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}
