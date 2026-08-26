import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockPrisma = {
  company: {
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    company: {
      update: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import {
  archiveCompany,
  restoreCompany,
  createCompany,
  updateCompany,
} from "@/features/companies/actions/company.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const SUPER_ADMIN = { id: "user-1", role: "SUPER_ADMIN", companyId: COMPANY_A };
const ADMIN = { id: "user-2", role: "ADMIN", companyId: COMPANY_A };
const MANAGER = { id: "user-3", role: "MANAGER", companyId: COMPANY_A };

function makeCompany(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "company-a", name: "Acme Co", ...overrides };
}

const VALID_COMPANY_INPUT = {
  name: "Acme Co",
  slug: "acme-co",
  industry: undefined,
  website: undefined,
  timezone: undefined,
};

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

describe("createCompany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    mockedPrisma.company.findUnique.mockResolvedValue(null);
    mockedPrisma.company.create.mockResolvedValue(makeCompany({ id: "new-company-1" }));
  });

  it("1. rejects an ADMIN — only Super Admin may create a company", async () => {
    mockedRequireUser.mockResolvedValue(ADMIN);
    const result = await createCompany(VALID_COMPANY_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/super admin/i);
    expect(mockedPrisma.company.create).not.toHaveBeenCalled();
  });

  it("2. rejects a Manager", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await createCompany(VALID_COMPANY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.company.create).not.toHaveBeenCalled();
  });

  it("3. succeeds for a Super Admin", async () => {
    const result = await createCompany(VALID_COMPANY_INPUT);
    expect(result.success).toBe(true);
  });

  it("4. rejects invalid input (bad slug format) without touching the database", async () => {
    const result = await createCompany({ ...VALID_COMPANY_INPUT, slug: "Not A Valid Slug!" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.company.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.company.create).not.toHaveBeenCalled();
  });

  it("5. rejects a duplicate slug without creating a row", async () => {
    mockedPrisma.company.findUnique.mockResolvedValue(makeCompany({ slug: VALID_COMPANY_INPUT.slug }));
    const result = await createCompany(VALID_COMPANY_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/already in use/i);
    expect(mockedPrisma.company.create).not.toHaveBeenCalled();
  });

  it("6. creates the company with the parsed input, logs company.created, and returns its id", async () => {
    mockedPrisma.company.create.mockResolvedValue(makeCompany({ id: "new-company-1", name: VALID_COMPANY_INPUT.name }));

    const result = await createCompany(VALID_COMPANY_INPUT);

    expect(mockedPrisma.company.create).toHaveBeenCalledWith({ data: VALID_COMPANY_INPUT });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: SUPER_ADMIN.id,
      action: "company.created",
      companyId: "new-company-1",
      metadata: { name: VALID_COMPANY_INPUT.name },
    });
    expect(result).toEqual({ success: true, data: { id: "new-company-1" } });
  });
});

describe("updateCompany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    mockedPrisma.company.findFirst.mockResolvedValue(null);
    mockedPrisma.company.update.mockResolvedValue(makeCompany());
  });

  it("1. rejects a Manager (below the ADMIN minimum, and not Super Admin)", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await updateCompany(COMPANY_A, VALID_COMPANY_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/permission/i);
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("2. rejects an ADMIN editing a different company than their own", async () => {
    mockedRequireUser.mockResolvedValue(ADMIN);
    const result = await updateCompany(COMPANY_B, VALID_COMPANY_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("3. allows an ADMIN editing their own company", async () => {
    mockedRequireUser.mockResolvedValue(ADMIN);
    const result = await updateCompany(COMPANY_A, VALID_COMPANY_INPUT);
    expect(result.success).toBe(true);
  });

  it("4. allows a Super Admin editing any company, regardless of their own companyId", async () => {
    const result = await updateCompany(COMPANY_B, VALID_COMPANY_INPUT);
    expect(result.success).toBe(true);
  });

  it("5. rejects invalid input", async () => {
    const result = await updateCompany(COMPANY_A, { ...VALID_COMPANY_INPUT, name: "A" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("6. rejects a slug already used by a different company", async () => {
    mockedPrisma.company.findFirst.mockResolvedValue(makeCompany({ id: "some-other-company" }));
    const result = await updateCompany(COMPANY_A, VALID_COMPANY_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/already in use/i);
    expect(mockedPrisma.company.findFirst).toHaveBeenCalledWith({
      where: { slug: VALID_COMPANY_INPUT.slug, id: { not: COMPANY_A } },
    });
    expect(mockedPrisma.company.update).not.toHaveBeenCalled();
  });

  it("7. updates with the parsed input, logs company.updated, and returns its id", async () => {
    mockedPrisma.company.update.mockResolvedValue(makeCompany({ id: COMPANY_A, name: VALID_COMPANY_INPUT.name }));

    const result = await updateCompany(COMPANY_A, VALID_COMPANY_INPUT);

    expect(mockedPrisma.company.update).toHaveBeenCalledWith({
      where: { id: COMPANY_A },
      data: VALID_COMPANY_INPUT,
    });
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: SUPER_ADMIN.id,
      action: "company.updated",
      companyId: COMPANY_A,
      metadata: { name: VALID_COMPANY_INPUT.name },
    });
    expect(result).toEqual({ success: true, data: { id: COMPANY_A } });
  });
});
