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

type ProjectsPerMonthChartProps = {
  data: { month: Date; count: number }[];
};

export default function ProjectsPerMonthChart({
  data,
}: ProjectsPerMonthChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-500">No projects yet.</p>;
  }

  const chartData = data.map((row) => ({
    month: format(row.month, "MMM"),
    count: row.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12, fill: "#64748b" }}
          axisLine={{ stroke: "#e2e8f0" }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 12, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e2e8f0" }}
        />
        <Line
          type="monotone"
          dataKey="count"
          stroke="#2F4156"
          strokeWidth={2}
          dot={{ r: 4, fill: "#2F4156" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
