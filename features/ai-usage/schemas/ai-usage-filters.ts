export const AI_PROVIDERS = ["gemini", "openai", "anthropic", "ollama", "openrouter"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

export const AI_TASK_TYPES = [
  "EXTRACTION",
  "SCORES",
  "RECOMMENDATIONS",
  "CONTENT_INTELLIGENCE",
  "EXECUTIVE_SUMMARY",
  "CONTENT_BRIEF",
  "CONTENT_DRAFT",
] as const;
export type AiTaskTypeValue = (typeof AI_TASK_TYPES)[number];

export const AI_USAGE_PAGE_SIZE = 10;

export type AiUsageSearchParams = {
  dateFrom?: string;
  dateTo?: string;
  provider?: string;
  taskType?: string;
  page?: string;
};

export type AiUsageFilters = {
  dateFrom?: Date;
  dateTo?: Date;
  provider?: AiProviderName;
  taskType?: AiTaskTypeValue;
  page: number;
};

function parseDateBoundary(value: string | undefined, time: "start" | "end"): Date | undefined {
  if (!value) return undefined;
  const suffix = time === "start" ? "T00:00:00.000" : "T23:59:59.999";
  const parsed = new Date(`${value}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Date To is deliberately parsed as the END of that calendar day (23:59:59.999),
 * not midnight-start — a native <input type="date"> value alone would otherwise
 * exclude every row created later that same day.
 */
export function parseAiUsageFilters(searchParams: AiUsageSearchParams): AiUsageFilters {
  const page = Math.max(1, Number(searchParams.page) || 1);
  const dateFrom = parseDateBoundary(searchParams.dateFrom, "start");
  const dateTo = parseDateBoundary(searchParams.dateTo, "end");
  const provider = AI_PROVIDERS.includes(searchParams.provider as AiProviderName)
    ? (searchParams.provider as AiProviderName)
    : undefined;
  const taskType = AI_TASK_TYPES.includes(searchParams.taskType as AiTaskTypeValue)
    ? (searchParams.taskType as AiTaskTypeValue)
    : undefined;

  return { dateFrom, dateTo, provider, taskType, page };
}
