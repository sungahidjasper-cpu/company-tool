import { describe, expect, it, vi } from "vitest";

type MockPrisma = {
  brandProfile: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    brandProfile: { findUnique: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { prisma } from "@/lib/prisma";
import { getBrandProfileByCompanyId } from "@/features/companies/services/brand-profile.service";

const mockedPrisma = prisma as unknown as MockPrisma;

describe("getBrandProfileByCompanyId", () => {
  it("1. looks up by companyId and returns whatever Prisma resolves", async () => {
    mockedPrisma.brandProfile.findUnique.mockResolvedValue({ id: "profile-1", companyId: "company-a", brandName: "Acme" });
    const result = await getBrandProfileByCompanyId("company-a");
    expect(mockedPrisma.brandProfile.findUnique).toHaveBeenCalledWith({ where: { companyId: "company-a" } });
    expect(result).toEqual({ id: "profile-1", companyId: "company-a", brandName: "Acme" });
  });

  it("2. returns null when the company has no brand profile yet", async () => {
    mockedPrisma.brandProfile.findUnique.mockResolvedValue(null);
    const result = await getBrandProfileByCompanyId("company-with-no-profile");
    expect(result).toBeNull();
  });
});
