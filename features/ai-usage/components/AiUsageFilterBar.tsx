import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_PROVIDERS, AI_TASK_TYPES } from "@/features/ai-usage/schemas/ai-usage-filters";
import { formatEnumLabel } from "@/lib/utils";

const selectClassName =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type AiUsageFilterBarProps = {
  dateFrom?: string;
  dateTo?: string;
  provider?: string;
  taskType?: string;
};

/**
 * A plain GET form navigating to /ai-usage?... — same "URL is the state,
 * no client JS needed" convention as components/dashboard/SearchInput.tsx,
 * so filtered views stay bookmarkable/refreshable.
 */
export default function AiUsageFilterBar({ dateFrom, dateTo, provider, taskType }: AiUsageFilterBarProps) {
  return (
    <form action="/ai-usage" method="GET" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dateFrom" className="text-sm font-medium">
          Date From
        </label>
        <Input id="dateFrom" type="date" name="dateFrom" defaultValue={dateFrom} className="w-40" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="dateTo" className="text-sm font-medium">
          Date To
        </label>
        <Input id="dateTo" type="date" name="dateTo" defaultValue={dateTo} className="w-40" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="provider" className="text-sm font-medium">
          Provider
        </label>
        <select id="provider" name="provider" defaultValue={provider ?? ""} className={selectClassName + " w-40"}>
          <option value="">All providers</option>
          {AI_PROVIDERS.map((option) => (
            <option key={option} value={option}>
              {formatEnumLabel(option)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="taskType" className="text-sm font-medium">
          AI Task Type
        </label>
        <select id="taskType" name="taskType" defaultValue={taskType ?? ""} className={selectClassName + " w-48"}>
          <option value="">All tasks</option>
          {AI_TASK_TYPES.map((option) => (
            <option key={option} value={option}>
              {formatEnumLabel(option)}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="outline">
        Apply filters
      </Button>
      <Link href="/ai-usage" className="text-sm font-medium text-slate-500 hover:underline">
        Reset
      </Link>
    </form>
  );
}
