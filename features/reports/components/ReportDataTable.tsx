import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatEnumLabel } from "@/lib/utils";

type ReportDataTableProps = {
  columns: string[];
  rows: (string | number)[][];
};

const ENUM_LIKE = /^[A-Z][A-Z0-9_]*$/;

function formatCell(value: string | number) {
  if (typeof value === "string" && ENUM_LIKE.test(value)) {
    return formatEnumLabel(value);
  }
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  return value;
}

/**
 * Renders any report's columns/rows uniformly using the existing shadcn
 * Table primitives — the same table component every list page in the app
 * already uses, not a bespoke report-table component.
 */
export default function ReportDataTable({ columns, rows }: ReportDataTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No data to show.</p>;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <TableCell key={cellIndex}>{formatCell(cell)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
