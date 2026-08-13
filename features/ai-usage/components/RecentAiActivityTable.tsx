import StatusBadge from "@/components/dashboard/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RecentAiUsageRow } from "@/features/ai-usage/services/ai-usage.service";
import { formatEnumLabel } from "@/lib/utils";

type RecentAiActivityTableProps = {
  rows: RecentAiUsageRow[];
};

const MISSING = "—";

function formatTokens(value: number | null) {
  return value === null ? MISSING : value.toLocaleString();
}

/**
 * Purpose-built rather than reusing features/reports/components/ReportDataTable
 * — that component forces (string | number)[][] cells with automatic
 * .toLocaleString() formatting on every number, which has no way to
 * represent "unavailable" distinctly from a real 0, and no room for a
 * StatusBadge. Uses the same low-level @/components/ui/table primitives
 * every other table in the app is built from — not a new visual system.
 */
export default function RecentAiActivityTable({ rows }: RecentAiActivityTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No AI activity in the selected range.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date/Time</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Prompt Tokens</TableHead>
            <TableHead>Completion Tokens</TableHead>
            <TableHead>Total Tokens</TableHead>
            <TableHead>Estimated Cost</TableHead>
            <TableHead>Latency</TableHead>
            <TableHead>Retried</TableHead>
            <TableHead>Error Type</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const totalTokens =
              row.promptTokens !== null && row.completionTokens !== null
                ? (row.promptTokens + row.completionTokens).toLocaleString()
                : MISSING;

            return (
              <TableRow key={row.id}>
                <TableCell title={row.createdAt.toISOString()} className="whitespace-nowrap">
                  {row.createdAt.toLocaleString()}
                </TableCell>
                <TableCell>{formatEnumLabel(row.provider)}</TableCell>
                <TableCell>{formatEnumLabel(row.taskType)}</TableCell>
                <TableCell>{row.model ?? MISSING}</TableCell>
                <TableCell>
                  <StatusBadge status={row.succeeded ? "SUCCEEDED" : "FAILED"} />
                </TableCell>
                <TableCell>{formatTokens(row.promptTokens)}</TableCell>
                <TableCell>{formatTokens(row.completionTokens)}</TableCell>
                <TableCell>{totalTokens}</TableCell>
                <TableCell>
                  {row.estimatedCostUsd !== null ? `$${Number(row.estimatedCostUsd).toFixed(6)} est.` : MISSING}
                </TableCell>
                <TableCell>{row.latencyMs.toLocaleString()}ms</TableCell>
                <TableCell>{row.retried ? "Retry observed" : MISSING}</TableCell>
                <TableCell>{row.errorType ? formatEnumLabel(row.errorType) : MISSING}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
