import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiUsageLog: {
      aggregate: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import {
  getAiFailuresByErrorType,
  getAiSpendByProvider,
  getAiSpendByTaskType,
  getAiSpendTrend,
  getAiUsageSummary,
  listRecentAiUsage,
} from "@/features/ai-usage/services/ai-usage.service";
import type { AiUsageFilters } from "@/features/ai-usage/schemas/ai-usage-filters";

const mockAggregate = vi.mocked(prisma.aiUsageLog.aggregate);
const mockCount = vi.mocked(prisma.aiUsageLog.count);
const mockGroupBy = vi.mocked(prisma.aiUsageLog.groupBy);
const mockFindMany = vi.mocked(prisma.aiUsageLog.findMany);
const mockQueryRaw = vi.mocked(prisma.$queryRaw);

const COMPANY_ID = "company-1";
const NO_FILTERS: AiUsageFilters = { page: 1 };

describe("getAiUsageSummary", () => {
  it("computes a real spend figure when at least one call reported a cost", async () => {
    mockAggregate.mockResolvedValue({
      _sum: { estimatedCostUsd: { toString: () => "0.005" } as never },
      _avg: { latencyMs: 850 },
      _count: { _all: 4, estimatedCostUsd: 3 },
    } as never);
    mockCount.mockResolvedValue(3);

    const result = await getAiUsageSummary(COMPANY_ID, NO_FILTERS);

    expect(result.totalCalls).toBe(4);
    expect(result.callsMissingCost).toBe(1);
    expect(result.totalSpendUsd).toBeCloseTo(0.005);
    expect(result.successRate).toBeCloseTo(75);
    expect(result.avgLatencyMs).toBe(850);
  });

  it("reports totalSpendUsd as null (never $0) when calls exist but none reported a cost", async () => {
    mockAggregate.mockResolvedValue({
      _sum: { estimatedCostUsd: null },
      _avg: { latencyMs: 500 },
      _count: { _all: 2, estimatedCostUsd: 0 },
    } as never);
    mockCount.mockResolvedValue(0);

    const result = await getAiUsageSummary(COMPANY_ID, NO_FILTERS);

    expect(result.totalCalls).toBe(2);
    expect(result.callsMissingCost).toBe(2);
    expect(result.totalSpendUsd).toBeNull();
  });

  it("handles zero calls gracefully — no NaN, no divide-by-zero", async () => {
    mockAggregate.mockResolvedValue({
      _sum: { estimatedCostUsd: null },
      _avg: { latencyMs: null },
      _count: { _all: 0, estimatedCostUsd: 0 },
    } as never);
    mockCount.mockResolvedValue(0);

    const result = await getAiUsageSummary(COMPANY_ID, NO_FILTERS);

    expect(result.totalCalls).toBe(0);
    expect(result.successRate).toBeNull();
    expect(result.avgLatencyMs).toBeNull();
    expect(Number.isNaN(result.successRate)).toBe(false);
  });

  it("scopes every query through a direct companyId (Phase 19) OR websiteAnalysisJob.companyId OR seoProject.companyId — never an omitted scope", async () => {
    mockAggregate.mockResolvedValue({
      _sum: { estimatedCostUsd: null },
      _avg: { latencyMs: null },
      _count: { _all: 0, estimatedCostUsd: 0 },
    } as never);
    mockCount.mockResolvedValue(0);

    await getAiUsageSummary("company-42", NO_FILTERS);

    const expectedOr = [{ companyId: "company-42" }, { websiteAnalysisJob: { companyId: "company-42" } }, { seoProject: { companyId: "company-42" } }];
    expect(mockAggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expectedOr }) }));
    expect(mockCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expectedOr, succeeded: true }) })
    );
  });
});

describe("getAiSpendTrend", () => {
  it("distinguishes a full-cost day, a partial day, and an all-missing day (null, not a $0 dip)", async () => {
    mockQueryRaw.mockResolvedValue([
      { day: new Date("2026-08-10"), cost: { toString: () => "0.01" } as never, calls: BigInt(2), callsMissingCost: BigInt(0) },
      { day: new Date("2026-08-11"), cost: { toString: () => "0.005" } as never, calls: BigInt(3), callsMissingCost: BigInt(1) },
      { day: new Date("2026-08-12"), cost: null, calls: BigInt(2), callsMissingCost: BigInt(2) },
    ] as never);

    const result = await getAiSpendTrend(COMPANY_ID, NO_FILTERS);

    expect(result[0].costUsd).toBeCloseTo(0.01);
    expect(result[1].costUsd).toBeCloseTo(0.005);
    expect(result[1].callsMissingCost).toBe(1);
    expect(result[2].costUsd).toBeNull();
    expect(result[2].calls).toBe(2);
  });
});

describe("getAiSpendByProvider", () => {
  it("always returns all 5 providers, even ones with zero rows — never silently omitted", async () => {
    mockGroupBy.mockResolvedValue([
      { provider: "gemini", _sum: { estimatedCostUsd: { toString: () => "0.02" } }, _count: { _all: 5, estimatedCostUsd: 5 } },
    ] as never);

    const result = await getAiSpendByProvider(COMPANY_ID, NO_FILTERS);

    expect(result).toHaveLength(5);
    const gemini = result.find((r) => r.provider === "gemini");
    expect(gemini?.costUsd).toBeCloseTo(0.02);
    expect(gemini?.calls).toBe(5);

    const neverUsed = result.filter((r) => r.provider !== "gemini");
    expect(neverUsed).toHaveLength(4);
    for (const row of neverUsed) {
      expect(row.costUsd).toBe(0);
      expect(row.calls).toBe(0);
      expect(row.callsMissingCost).toBe(0);
    }
  });
});

describe("getAiSpendByTaskType", () => {
  it("always returns all 7 task types, including Phase 15's CONTENT_BRIEF and Phase 16's CONTENT_DRAFT", async () => {
    mockGroupBy.mockResolvedValue([] as never);
    const result = await getAiSpendByTaskType(COMPANY_ID, NO_FILTERS);
    expect(result).toHaveLength(7);
    expect(result.map((r) => r.taskType)).toContain("CONTENT_BRIEF");
    expect(result.map((r) => r.taskType)).toContain("CONTENT_DRAFT");
    expect(result.every((r) => r.costUsd === 0 && r.calls === 0)).toBe(true);
  });

  it("includes a CONTENT_BRIEF row scoped only via seoProjectId (no websiteAnalysisJobId at all)", async () => {
    mockGroupBy.mockResolvedValue([
      { taskType: "CONTENT_BRIEF", _sum: { estimatedCostUsd: { toString: () => "0.002" } }, _count: { _all: 2, estimatedCostUsd: 2 } },
    ] as never);

    const result = await getAiSpendByTaskType(COMPANY_ID, NO_FILTERS);

    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ companyId: COMPANY_ID }, { websiteAnalysisJob: { companyId: COMPANY_ID } }, { seoProject: { companyId: COMPANY_ID } }],
        }),
      })
    );
    const brief = result.find((r) => r.taskType === "CONTENT_BRIEF");
    expect(brief?.calls).toBe(2);
    expect(brief?.costUsd).toBeCloseTo(0.002);
  });

  it("includes a CONTENT_DRAFT row scoped only via seoProjectId (same pattern as CONTENT_BRIEF)", async () => {
    mockGroupBy.mockResolvedValue([
      { taskType: "CONTENT_DRAFT", _sum: { estimatedCostUsd: { toString: () => "0.004" } }, _count: { _all: 1, estimatedCostUsd: 1 } },
    ] as never);

    const result = await getAiSpendByTaskType(COMPANY_ID, NO_FILTERS);

    const draft = result.find((r) => r.taskType === "CONTENT_DRAFT");
    expect(draft?.calls).toBe(1);
    expect(draft?.costUsd).toBeCloseTo(0.004);
  });
});

describe("getAiFailuresByErrorType", () => {
  it("keeps failures reconcilable — a null errorType is bucketed as UNKNOWN_OTHER, never dropped", async () => {
    mockGroupBy.mockResolvedValue([
      { errorType: "INSUFFICIENT_CREDITS", _count: { _all: 3 } },
      { errorType: null, _count: { _all: 2 } },
    ] as never);

    const result = await getAiFailuresByErrorType(COMPANY_ID, NO_FILTERS);

    const total = result.reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(5);
    expect(result.find((r) => r.errorType === "UNKNOWN_OTHER")?.count).toBe(2);
  });

  it("scopes to succeeded: false in addition to the company filter", async () => {
    mockGroupBy.mockResolvedValue([] as never);
    await getAiFailuresByErrorType(COMPANY_ID, NO_FILTERS);
    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ companyId: COMPANY_ID }, { websiteAnalysisJob: { companyId: COMPANY_ID } }, { seoProject: { companyId: COMPANY_ID } }],
          succeeded: false,
        }),
      })
    );
  });
});

describe("listRecentAiUsage", () => {
  it("paginates and scopes by company", async () => {
    mockFindMany.mockResolvedValue([{ id: "log-1" }] as never);
    mockCount.mockResolvedValue(1);

    const result = await listRecentAiUsage(COMPANY_ID, NO_FILTERS, 1, 10);

    expect(result.totalCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ companyId: COMPANY_ID }, { websiteAnalysisJob: { companyId: COMPANY_ID } }, { seoProject: { companyId: COMPANY_ID } }],
        }),
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 10,
      })
    );
  });
});
