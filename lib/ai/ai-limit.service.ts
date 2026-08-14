import { logActivity } from "@/lib/activity";
import { describeLlmError, LlmProviderError, type LlmErrorType } from "@/lib/ai/providers/errors";
import type { AiTaskType, Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Encapsulates every per-company AI limit check behind one entry point,
 * enforceCompanyAiLimits — so generateStructuredOutput() stays a pure
 * orchestrator with no knowledge of what "budget" or "rate limit" mean.
 * Adding a future limit (a daily cap, a provider-specific budget, a
 * per-user quota, a warning-threshold notification) is one more private
 * check function plus one more line in enforceCompanyAiLimits; nothing
 * outside this file needs to change.
 */

/** Start of the current UTC calendar month — the budget's fixed period. */
function currentBudgetPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Sums this company's AiUsageLog.estimatedCostUsd for the current UTC
 * month. Exported separately from the enforcement check so the admin UI
 * (CompanyAiLimitsForm) can show "current spend" using the exact same
 * query the gate itself uses — no drift between what blocks a call and
 * what an admin sees.
 */
export async function getCurrentPeriodSpendUsd(companyId: string): Promise<number> {
  const agg = await prisma.aiUsageLog.aggregate({
    where: { companyId, createdAt: { gte: currentBudgetPeriodStart() } },
    _sum: { estimatedCostUsd: true },
  });
  return agg._sum.estimatedCostUsd ? Number(agg._sum.estimatedCostUsd) : 0;
}

/**
 * Fails open on a query error: a DB hiccup here is evidence of an
 * infrastructure problem, not evidence the company exceeded its cap.
 * Mirrors structured-output.ts's own logUsage() precedent — an
 * accounting/analytics failure must never be able to block or break the
 * actual AI call. Fail-closed would mean one transient DB blip blocks
 * every AI call for every company with a budget configured, a far larger
 * blast radius than the thing it protects against.
 */
async function isWithinBudget(companyId: string, budgetUsd: Prisma.Decimal | null): Promise<boolean> {
  if (budgetUsd === null) return true;
  try {
    const spent = await getCurrentPeriodSpendUsd(companyId);
    return spent < Number(budgetUsd);
  } catch (error) {
    logger.error("AI limit service: budget check failed — allowing the call through (fail-open)", {
      companyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/**
 * In-memory, fixed 60-second window counter — mirrors
 * lib/ai/providers/health-cache.ts's exact globalThis-backed Map pattern.
 * Losing this state on a server restart is low-stakes (a few seconds of
 * unthrottled requests at worst), unlike the budget check above, which
 * must survive restarts since it represents real money.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
type RateLimitEntry = { count: number; windowStart: number };
const globalForRateLimit = globalThis as unknown as { aiCompanyRateLimit?: Map<string, RateLimitEntry> };

function getRateLimitCache(): Map<string, RateLimitEntry> {
  if (!globalForRateLimit.aiCompanyRateLimit) {
    globalForRateLimit.aiCompanyRateLimit = new Map();
  }
  return globalForRateLimit.aiCompanyRateLimit;
}

/** Returns true (and increments the window's counter) if this request is allowed; returns false, without incrementing further, once the current window's limit is already reached. */
function isWithinRateLimit(companyId: string, limitPerMinute: number | null): boolean {
  if (limitPerMinute === null) return true;

  const cache = getRateLimitCache();
  const now = Date.now();
  const entry = cache.get(companyId);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    cache.set(companyId, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= limitPerMinute) return false;

  entry.count++;
  return true;
}

/** Logs the rejection via the existing Activity mechanism (no AiUsageLog row — no provider was ever called, so there's no cost/tokens/latency to log) and throws, classified so Phase 17's retry/fallback loop — which runs strictly after this function — never sees it as retryable or fallback-worthy. */
async function rejectWith(companyId: string, taskType: AiTaskType, errorType: Extract<LlmErrorType, "BUDGET_EXCEEDED" | "COMPANY_RATE_LIMITED">, action: string): Promise<never> {
  try {
    await logActivity({ companyId, action, metadata: { taskType } });
  } catch (error) {
    logger.error("AI limit service: failed to log a limit-rejection activity — the rejection itself still applies", {
      companyId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  throw new LlmProviderError(describeLlmError(errorType).message, errorType, "none");
}

/**
 * The single entry point generateStructuredOutput calls, before any
 * provider is contacted. Runs the budget check, then the rate-limit
 * check; the first violation wins. A company with neither field
 * configured (every company today) short-circuits to a single indexed
 * findUnique and nothing else — no AiUsageLog aggregate, no in-memory
 * Map write.
 */
export async function enforceCompanyAiLimits(companyId: string, taskType: AiTaskType): Promise<void> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { aiMonthlyBudgetUsd: true, aiRateLimitPerMinute: true },
  });
  if (!company) return;

  if (!(await isWithinBudget(companyId, company.aiMonthlyBudgetUsd))) {
    await rejectWith(companyId, taskType, "BUDGET_EXCEEDED", "ai.budget_exceeded");
  }

  if (!isWithinRateLimit(companyId, company.aiRateLimitPerMinute)) {
    await rejectWith(companyId, taskType, "COMPANY_RATE_LIMITED", "ai.company_rate_limited");
  }
}
