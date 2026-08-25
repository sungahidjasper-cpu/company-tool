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
import { archiveCompany, restoreCompany } from "@/features/companies/actions/company.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const SUPER_ADMIN = { id: "user-1", role: "SUPER_ADMIN", companyId: "company-a" };
const ADMIN = { id: "user-2", role: "ADMIN", companyId: "company-a" };
const MANAGER = { id: "user-3", role: "MANAGER", companyId: "company-a" };

function makeCompany(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "company-a", name: "Acme Co", ...overrides };
}

describe("archiveCompany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    mockedPrisma.company.update.mockResolvedValue(makeCompany({ deletedAt: new Date() }));
  });

  it("1. succeeds for a Super Admin", async () => {
    const result = await archiveCompany("company-a");
    expect(result.success).toBe(true);
  });

  it("2. rejects an ADMIN — only Super Admin may archive a company", async () => {
    mockedRequireUser.mockResolvedValue(ADMIN);
    const result = await archiveCompany("company-a");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/super admin/i);
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("3. rejects a Manager", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await archiveCompany("company-a");
    expect(result.success).toBe(false);
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("4. sets deletedAt to a Date instance, nothing else", async () => {
    await archiveCompany("company-a");
    const [{ data }] = mockedPrisma.company.update.mock.calls[0];
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("5. logs company.archived scoped to this company's own id", async () => {
    await archiveCompany("company-a");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: SUPER_ADMIN.id,
      action: "company.archived",
      companyId: "company-a",
      metadata: { name: "Acme Co" },
    });
  });
});

describe("restoreCompany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    mockedPrisma.company.update.mockResolvedValue(makeCompany({ deletedAt: null }));
  });

  it("1. succeeds for a Super Admin", async () => {
    const result = await restoreCompany("company-a");
    expect(result.success).toBe(true);
  });

  it("2. rejects an ADMIN — only Super Admin may restore a company", async () => {
    mockedRequireUser.mockResolvedValue(ADMIN);
    const result = await restoreCompany("company-a");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/super admin/i);
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("3. sets deletedAt to null, nothing else", async () => {
    await restoreCompany("company-a");
    const [{ data }] = mockedPrisma.company.update.mock.calls[0];
    expect(data).toEqual({ deletedAt: null });
  });

  it("4. logs company.restored scoped to this company's own id", async () => {
    await restoreCompany("company-a");
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: SUPER_ADMIN.id,
      action: "company.restored",
      companyId: "company-a",
      metadata: { name: "Acme Co" },
    });
  });
});
