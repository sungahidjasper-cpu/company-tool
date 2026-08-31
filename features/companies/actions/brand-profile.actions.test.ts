import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockPrisma = {
  brandProfile: {
    upsert: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    brandProfile: { upsert: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/prisma";
import { upsertBrandProfileAction } from "@/features/companies/actions/brand-profile.actions";
import type { BrandProfileInput } from "@/features/companies/schemas/brand-profile.schema";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";

const SUPER_ADMIN = { id: "user-1", role: "SUPER_ADMIN", companyId: COMPANY_B };
const OWN_ADMIN = { id: "user-2", role: "ADMIN", companyId: COMPANY_A };
const OTHER_COMPANY_ADMIN = { id: "user-3", role: "ADMIN", companyId: COMPANY_B };
const EMPLOYEE = { id: "user-4", role: "EMPLOYEE", companyId: COMPANY_A };

const BLANK_INPUT: BrandProfileInput = {
  brandName: "",
  brandVoice: "",
  targetAudience: "",
  productsServices: "",
  targetCountry: "",
  language: "",
  competitorUrls: "",
};

const FULL_INPUT: BrandProfileInput = {
  brandName: "Acme Plumbing",
  brandVoice: "FRIENDLY",
  targetAudience: "Homeowners needing emergency repairs",
  productsServices: "Emergency plumbing, drain cleaning, water heater installation",
  targetCountry: "United States",
  language: "English",
  competitorUrls: "https://competitor-a.example.com, https://competitor-b.example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(OWN_ADMIN);
  mockedPrisma.brandProfile.upsert.mockResolvedValue({ id: "profile-1" });
});

describe("upsertBrandProfileAction", () => {
  it("1. allows a company's own ADMIN to edit its brand profile — unlike the SUPER_ADMIN-only AI limits gate", async () => {
    const result = await upsertBrandProfileAction(COMPANY_A, FULL_INPUT);
    expect(result.success).toBe(true);
    expect(mockedPrisma.brandProfile.upsert).toHaveBeenCalled();
  });

  it("2. allows a SUPER_ADMIN to edit any company's brand profile", async () => {
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    const result = await upsertBrandProfileAction(COMPANY_A, FULL_INPUT);
    expect(result.success).toBe(true);
  });

  it("3. rejects an ADMIN of a different company — tenant isolation, without touching the database", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_COMPANY_ADMIN);
    const result = await upsertBrandProfileAction(COMPANY_A, FULL_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to edit this company's brand profile.");
    expect(mockedPrisma.brandProfile.upsert).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  it("4. rejects an EMPLOYEE of the same company — insufficient role, without touching the database", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await upsertBrandProfileAction(COMPANY_A, FULL_INPUT);
    expect(result.success).toBe(false);
    expect(mockedPrisma.brandProfile.upsert).not.toHaveBeenCalled();
  });

  it("5. runs the authorization gate before schema validation — a cross-company ADMIN with an invalid brandVoice still gets the authorization message", async () => {
    mockedRequireUser.mockResolvedValue(OTHER_COMPANY_ADMIN);
    const result = await upsertBrandProfileAction(COMPANY_A, { ...FULL_INPUT, brandVoice: "NOT_A_REAL_VOICE" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("You do not have permission to edit this company's brand profile.");
    expect(mockedPrisma.brandProfile.upsert).not.toHaveBeenCalled();
  });

  it("6. rejects a brandVoice value outside BRAND_VOICES for an authorized editor, without mutating", async () => {
    const result = await upsertBrandProfileAction(COMPANY_A, { ...FULL_INPUT, brandVoice: "NOT_A_REAL_VOICE" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.brandProfile.upsert).not.toHaveBeenCalled();
    expect(mockedLogActivity).not.toHaveBeenCalled();
  });

  it("7. treats every blank field as null, and a blank competitorUrls string as an empty array — no Brand Profile fields are required", async () => {
    await upsertBrandProfileAction(COMPANY_A, BLANK_INPUT);
    expect(mockedPrisma.brandProfile.upsert).toHaveBeenCalledWith({
      where: { companyId: COMPANY_A },
      update: {
        brandName: null,
        brandVoice: null,
        targetAudience: null,
        productsServices: null,
        targetCountry: null,
        language: null,
        competitorUrls: [],
      },
      create: {
        companyId: COMPANY_A,
        brandName: null,
        brandVoice: null,
        targetAudience: null,
        productsServices: null,
        targetCountry: null,
        language: null,
        competitorUrls: [],
      },
    });
  });

  it("8. splits, trims, and drops empty entries from the comma-separated competitorUrls string", async () => {
    await upsertBrandProfileAction(COMPANY_A, { ...BLANK_INPUT, competitorUrls: "https://a.example.com,  https://b.example.com ,, " });
    const [{ update }] = mockedPrisma.brandProfile.upsert.mock.calls[0];
    expect(update.competitorUrls).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("9. passes every populated field through to both the update and create branches of the upsert", async () => {
    await upsertBrandProfileAction(COMPANY_A, FULL_INPUT);
    const [{ update, create }] = mockedPrisma.brandProfile.upsert.mock.calls[0];
    expect(update).toEqual({
      brandName: "Acme Plumbing",
      brandVoice: "FRIENDLY",
      targetAudience: "Homeowners needing emergency repairs",
      productsServices: "Emergency plumbing, drain cleaning, water heater installation",
      targetCountry: "United States",
      language: "English",
      competitorUrls: ["https://competitor-a.example.com", "https://competitor-b.example.com"],
    });
    expect(create).toEqual({ companyId: COMPANY_A, ...update });
  });

  it("10. upserts scoped to the exact target companyId, not the actor's own companyId (relevant for the SUPER_ADMIN cross-company case)", async () => {
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    await upsertBrandProfileAction(COMPANY_A, FULL_INPUT);
    expect(mockedPrisma.brandProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: COMPANY_A } }));
  });

  it("11. logs company.brand_profile_updated with the actor id, the target company id, and the brand name", async () => {
    await upsertBrandProfileAction(COMPANY_A, FULL_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: OWN_ADMIN.id,
      action: "company.brand_profile_updated",
      companyId: COMPANY_A,
      metadata: { brandName: "Acme Plumbing" },
    });
  });

  it("12. revalidates the company's own detail page path", async () => {
    const { revalidatePath } = await import("next/cache");
    await upsertBrandProfileAction(COMPANY_A, FULL_INPUT);
    expect(revalidatePath).toHaveBeenCalledWith(`/companies/${COMPANY_A}`);
  });

  it("13. returns the upserted brand profile's own id on success", async () => {
    mockedPrisma.brandProfile.upsert.mockResolvedValue({ id: "profile-xyz" });
    const result = await upsertBrandProfileAction(COMPANY_A, FULL_INPUT);
    expect(result).toEqual({ success: true, data: { id: "profile-xyz" } });
  });
});
