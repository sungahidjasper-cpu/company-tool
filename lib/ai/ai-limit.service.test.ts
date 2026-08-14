import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    aiUsageLog: { aggregate: vi.fn() },
  },
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";
import { enforceCompanyAiLimits, getCurrentPeriodSpendUsd } from "@/lib/ai/ai-limit.service";

const mockFindCompany = vi.mocked(prisma.company.findUnique);
const mockAggregate = vi.mocked(prisma.aiUsageLog.aggregate);
const mockLogActivity = vi.mocked(logActivity);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentPeriodSpendUsd", () => {
  it("returns the summed estimatedCostUsd for the current period", async () => {
    mockAggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 12.5 } } as never);
    expect(await getCurrentPeriodSpendUsd("company-1")).toBe(12.5);
  });

  it("returns 0 when no usage exists yet this period", async () => {
    mockAggregate.mockResolvedValue({ _sum: { estimatedCostUsd: null } } as never);
    expect(await getCurrentPeriodSpendUsd("company-1")).toBe(0);
  });

  it("scopes the query to this company and the current UTC month start", async () => {
    mockAggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 0 } } as never);
    await getCurrentPeriodSpendUsd("company-1");

    const [args] = mockAggregate.mock.calls[0];
    expect(args?.where).toMatchObject({ companyId: "company-1" });
    expect(args?.where?.createdAt).toHaveProperty("gte");
  });
});

describe("enforceCompanyAiLimits — no limits configured", () => {
  it("resolves as a no-op and never queries AiUsageLog when both fields are null", async () => {
    mockFindCompany.mockResolvedValue({ aiMonthlyBudgetUsd: null, aiRateLimitPerMinute: null } as never);

    await expect(enforceCompanyAiLimits("no-limits-co", "CONTENT_BRIEF")).resolves.toBeUndefined();
    expect(mockAggregate).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("resolves as a no-op when the company can't be found", async () => {
    mockFindCompany.mockResolvedValue(null);
    await expect(enforceCompanyAiLimits("missing-co", "CONTENT_BRIEF")).resolves.toBeUndefined();
  });
});

describe("enforceCompanyAiLimits — budget", () => {
  it("allows the call when spend is under the configured budget", async () => {
    mockFindCompany.mockResolvedValue({ aiMonthlyBudgetUsd: 100, aiRateLimitPerMinute: null } as never);
    mockAggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 50 } } as never);

    await expect(enforceCompanyAiLimits("budget-ok-co", "CONTENT_BRIEF")).resolves.toBeUndefined();
  });

  it("rejects with BUDGET_EXCEEDED and logs an Activity row when spend has reached the budget", async () => {
    mockFindCompany.mockResolvedValue({ aiMonthlyBudgetUsd: 100, aiRateLimitPerMinute: null } as never);
    mockAggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 100 } } as never);

    await expect(enforceCompanyAiLimits("over-budget-co", "CONTENT_DRAFT")).rejects.toMatchObject({ type: "BUDGET_EXCEEDED" });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "over-budget-co", action: "ai.budget_exceeded", metadata: { taskType: "CONTENT_DRAFT" } })
    );
  });

  it("fails open (allows the call) when the budget-check query itself throws, and never lets the error surface", async () => {
    mockFindCompany.mockResolvedValue({ aiMonthlyBudgetUsd: 100, aiRateLimitPerMinute: null } as never);
    mockAggregate.mockRejectedValue(new Error("connection reset"));

    await expect(enforceCompanyAiLimits("db-hiccup-co", "CONTENT_BRIEF")).resolves.toBeUndefined();
  });

  it("logging the rejection Activity never shadows the real BUDGET_EXCEEDED throw, even if logActivity itself fails", async () => {
    mockFindCompany.mockResolvedValue({ aiMonthlyBudgetUsd: 10, aiRateLimitPerMinute: null } as never);
    mockAggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 10 } } as never);
    mockLogActivity.mockRejectedValue(new Error("activity table down"));

    await expect(enforceCompanyAiLimits("co", "CONTENT_BRIEF")).rejects.toMatchObject({ type: "BUDGET_EXCEEDED" });
  });
});

describe("enforceCompanyAiLimits — rate limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the configured per-minute limit, then rejects with COMPANY_RATE_LIMITED", async () => {
    mockFindCompany.mockResolvedValue({ aiMonthlyBudgetUsd: null, aiRateLimitPerMinute: 2 } as never);

    await expect(enforceCompanyAiLimits("rl-co-1", "CONTENT_BRIEF")).resolves.toBeUndefined();
    await expect(enforceCompanyAiLimits("rl-co-1", "CONTENT_BRIEF")).resolves.toBeUndefined();
    await expect(enforceCompanyAiLimits("rl-co-1", "CONTENT_BRIEF")).rejects.toMatchObject({ type: "COMPANY_RATE_LIMITED" });
    expect(mockLogActivity).toHaveBeenCalledWith(expect.objectContaining({ companyId: "rl-co-1", action: "ai.company_rate_limited" }));
  });

  it("resets the window after 60 seconds, allowing new requests again", async () => {
    mockFindCompany.mockResolvedValue({ aiMonthlyBudgetUsd: null, aiRateLimitPerMinute: 1 } as never);

    await expect(enforceCompanyAiLimits("rl-co-2", "CONTENT_BRIEF")).resolves.toBeUndefined();
    await expect(enforceCompanyAiLimits("rl-co-2", "CONTENT_BRIEF")).rejects.toMatchObject({ type: "COMPANY_RATE_LIMITED" });

    vi.advanceTimersByTime(61_000);

    await expect(enforceCompanyAiLimits("rl-co-2", "CONTENT_BRIEF")).resolves.toBeUndefined();
  });

  it("tracks each company's rate limit independently", async () => {
    mockFindCompany.mockResolvedValue({ aiMonthlyBudgetUsd: null, aiRateLimitPerMinute: 1 } as never);

    await expect(enforceCompanyAiLimits("rl-co-3", "CONTENT_BRIEF")).resolves.toBeUndefined();
    // A different company's own first request this window is unaffected by rl-co-3 already being at its limit.
    await expect(enforceCompanyAiLimits("rl-co-4", "CONTENT_BRIEF")).resolves.toBeUndefined();
    await expect(enforceCompanyAiLimits("rl-co-3", "CONTENT_BRIEF")).rejects.toMatchObject({ type: "COMPANY_RATE_LIMITED" });
  });

  it("checks budget before rate limit — a budget violation is reported even if the rate limit would also be exceeded", async () => {
    mockFindCompany.mockResolvedValue({ aiMonthlyBudgetUsd: 10, aiRateLimitPerMinute: 1 } as never);
    mockAggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 10 } } as never);

    await expect(enforceCompanyAiLimits("rl-co-5", "CONTENT_BRIEF")).rejects.toMatchObject({ type: "BUDGET_EXCEEDED" });
  });
});
