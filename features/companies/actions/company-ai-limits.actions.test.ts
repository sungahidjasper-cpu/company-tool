import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockPrisma = {
  company: {
    update: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    company: { update: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { updateCompanyAiLimitsAction } from "@/features/companies/actions/company-ai-limits.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";

const SUPER_ADMIN = { id: "user-1", role: "SUPER_ADMIN", companyId: COMPANY_A };
const ADMIN = { id: "user-2", role: "ADMIN", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-3", role: "EMPLOYEE", companyId: COMPANY_A };

const BLANK_INPUT = { aiMonthlyBudgetUsd: "", aiRateLimitPerMinute: "" };
const FULL_INPUT = { aiMonthlyBudgetUsd: "500", aiRateLimitPerMinute: "10" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
  mockedPrisma.company.update.mockResolvedValue({ id: COMPANY_A });
});

describe("updateCompanyAiLimitsAction", () => {
  it("1. rejects an ADMIN — only a Super Admin may configure AI limits — without touching the database", async () => {
    mockedRequireUser.mockResolvedValue(ADMIN);
    const result = await updateCompanyAiLimitsAction(COMPANY_A, FULL_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Only a Super Admin can configure AI limits.");
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  it("2. rejects an EMPLOYEE — same Super-Admin-only gate — without touching the database", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await updateCompanyAiLimitsAction(COMPANY_A, FULL_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("3. runs the authorization gate before schema validation — an ADMIN with invalid input still gets the authorization message, not a validation message", async () => {
    mockedRequireUser.mockResolvedValue(ADMIN);
    const result = await updateCompanyAiLimitsAction(COMPANY_A, { aiMonthlyBudgetUsd: "not-a-number", aiRateLimitPerMinute: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Only a Super Admin can configure AI limits.");
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("4. rejects a non-numeric budget value for a Super Admin, without mutating", async () => {
    const result = await updateCompanyAiLimitsAction(COMPANY_A, { aiMonthlyBudgetUsd: "abc", aiRateLimitPerMinute: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Enter a positive number, or leave blank for no limit");
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  it("5. rejects a zero rate limit for a Super Admin — zero is not a positive number", async () => {
    const result = await updateCompanyAiLimitsAction(COMPANY_A, { aiMonthlyBudgetUsd: "", aiRateLimitPerMinute: "0" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Enter a positive number, or leave blank for no limit");
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("6. rejects a negative budget value for a Super Admin, without mutating", async () => {
    const result = await updateCompanyAiLimitsAction(COMPANY_A, { aiMonthlyBudgetUsd: "-5", aiRateLimitPerMinute: "" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Enter a positive number, or leave blank for no limit");
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("7. treats blank strings for both fields as 'no limit' — stores null for both", async () => {
    await updateCompanyAiLimitsAction(COMPANY_A, BLANK_INPUT);
    expect(mockedPrisma.company.update).toHaveBeenCalledWith({
      where: { id: COMPANY_A },
      data: { aiMonthlyBudgetUsd: null, aiRateLimitPerMinute: null },
    });
  });

  it("8. treats undefined fields (schema's optional() branch, not just the '' literal) the same as blank — stores null for both", async () => {
    await updateCompanyAiLimitsAction(COMPANY_A, { aiMonthlyBudgetUsd: undefined, aiRateLimitPerMinute: undefined });
    expect(mockedPrisma.company.update).toHaveBeenCalledWith({
      where: { id: COMPANY_A },
      data: { aiMonthlyBudgetUsd: null, aiRateLimitPerMinute: null },
    });
  });

  it("9. sets only the monthly budget, leaving the rate limit as null", async () => {
    await updateCompanyAiLimitsAction(COMPANY_A, { aiMonthlyBudgetUsd: "500", aiRateLimitPerMinute: "" });
    expect(mockedPrisma.company.update).toHaveBeenCalledWith({
      where: { id: COMPANY_A },
      data: { aiMonthlyBudgetUsd: 500, aiRateLimitPerMinute: null },
    });
  });

  it("10. sets only the rate limit, leaving the monthly budget as null", async () => {
    await updateCompanyAiLimitsAction(COMPANY_A, { aiMonthlyBudgetUsd: "", aiRateLimitPerMinute: "10" });
    expect(mockedPrisma.company.update).toHaveBeenCalledWith({
      where: { id: COMPANY_A },
      data: { aiMonthlyBudgetUsd: null, aiRateLimitPerMinute: 10 },
    });
  });

  it("11. sets both fields with the exact target company id in the where clause", async () => {
    await updateCompanyAiLimitsAction(COMPANY_A, FULL_INPUT);
    expect(mockedPrisma.company.update).toHaveBeenCalledWith({
      where: { id: COMPANY_A },
      data: { aiMonthlyBudgetUsd: 500, aiRateLimitPerMinute: 10 },
    });
  });

  it("12. converts the validated numeric strings to real numbers in the database payload", async () => {
    await updateCompanyAiLimitsAction(COMPANY_A, FULL_INPUT);
    const [{ data }] = mockedPrisma.company.update.mock.calls[0];
    expect(typeof data.aiMonthlyBudgetUsd).toBe("number");
    expect(typeof data.aiRateLimitPerMinute).toBe("number");
  });

  it("13. [documents current behavior] the activity-log metadata keeps the original string values, unlike the Number-converted database payload", async () => {
    await updateCompanyAiLimitsAction(COMPANY_A, FULL_INPUT);
    const [{ data }] = mockedPrisma.company.update.mock.calls[0];
    const [activityPayload] = mockedLogActivity.mock.calls[0];
    expect(data.aiMonthlyBudgetUsd).toBe(500);
    expect(typeof data.aiMonthlyBudgetUsd).toBe("number");
    expect(activityPayload.metadata.aiMonthlyBudgetUsd).toBe("500");
    expect(typeof activityPayload.metadata.aiMonthlyBudgetUsd).toBe("string");
  });

  it("14. activity-log metadata is null for a blank field, consistent with the database payload's null", async () => {
    await updateCompanyAiLimitsAction(COMPANY_A, { aiMonthlyBudgetUsd: "", aiRateLimitPerMinute: "10" });
    const [activityPayload] = mockedLogActivity.mock.calls[0];
    expect(activityPayload.metadata).toEqual({ aiMonthlyBudgetUsd: null, aiRateLimitPerMinute: "10" });
  });

  it("15. logs company.ai_limits_updated with the actor id and the updated company's own id", async () => {
    await updateCompanyAiLimitsAction(COMPANY_A, FULL_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: SUPER_ADMIN.id,
      action: "company.ai_limits_updated",
      companyId: COMPANY_A,
      metadata: { aiMonthlyBudgetUsd: "500", aiRateLimitPerMinute: "10" },
    });
  });

  it("16. distinguishes the input companyId from the Prisma-resolved company id — where/revalidate use the input id, logActivity/return use the resolved id", async () => {
    mockedPrisma.company.update.mockResolvedValue({ id: "resolved-different-id" });
    const { revalidatePath } = await import("next/cache");

    const result = await updateCompanyAiLimitsAction(COMPANY_A, FULL_INPUT);

    expect(mockedPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: COMPANY_A } })
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/companies/${COMPANY_A}`);
    expect(mockedLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "resolved-different-id" })
    );
    expect(result).toEqual({ success: true, data: { id: "resolved-different-id" } });
  });

  it("17. revalidates the company's own path using the input company id", async () => {
    const { revalidatePath } = await import("next/cache");
    await updateCompanyAiLimitsAction(COMPANY_A, FULL_INPUT);
    expect(revalidatePath).toHaveBeenCalledWith(`/companies/${COMPANY_A}`);
  });

  it("18. returns the updated company's id on success", async () => {
    mockedPrisma.company.update.mockResolvedValue({ id: COMPANY_A });
    const result = await updateCompanyAiLimitsAction(COMPANY_A, FULL_INPUT);
    expect(result).toEqual({ success: true, data: { id: COMPANY_A } });
  });
});
