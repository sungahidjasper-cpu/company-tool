import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";

type JwtCallback = NonNullable<NonNullable<typeof authConfig.callbacks>["jwt"]>;
type JwtParams = Parameters<JwtCallback>[0];

function callJwt(params: Record<string, unknown>) {
  return authConfig.callbacks!.jwt!(params as unknown as JwtParams);
}

const mockedFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;

const SIGN_IN_USER = {
  id: "user-1",
  role: "EMPLOYEE",
  companyId: "company-1",
  firstName: "Jane",
  lastName: "Doe",
  avatar: null,
  securityVersion: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authConfig jwt callback — session invalidation (securityVersion)", () => {
  it("1. sign-in: copies the user's securityVersion onto the token — normal login creates a matching securityVersion", async () => {
    const token = (await callJwt({ token: {}, user: SIGN_IN_USER, trigger: undefined, session: undefined })) as Record<string, unknown>;
    expect(token.securityVersion).toBe(3);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  it("2. revalidation: matching securityVersion returns the token unchanged — a normal session continues to work", async () => {
    mockedFindUnique.mockResolvedValue({ securityVersion: 3 });
    const existingToken = { id: "user-1", securityVersion: 3, role: "EMPLOYEE", companyId: "company-1", firstName: "Jane", lastName: "Doe", avatar: null };

    const token = await callJwt({ token: { ...existingToken }, user: undefined, trigger: undefined, session: undefined });

    expect(token).toEqual(existingToken);
    expect(mockedFindUnique).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { securityVersion: true } });
  });

  it("3. revalidation: a securityVersion bump elsewhere (password reset/change) invalidates this token", async () => {
    mockedFindUnique.mockResolvedValue({ securityVersion: 4 });
    const existingToken = { id: "user-1", securityVersion: 3 };

    await expect(callJwt({ token: existingToken, user: undefined, trigger: undefined, session: undefined })).rejects.toThrow();
  });

  it("4. revalidation: a deleted/missing user invalidates the token", async () => {
    mockedFindUnique.mockResolvedValue(null);
    const existingToken = { id: "user-1", securityVersion: 3 };

    await expect(callJwt({ token: existingToken, user: undefined, trigger: undefined, session: undefined })).rejects.toThrow();
  });

  it("5. profile-update trigger applies the session update without touching the database (unaffected by this change)", async () => {
    const existingToken = { id: "user-1", securityVersion: 3, firstName: "Jane" };

    const token = (await callJwt({
      token: existingToken,
      user: undefined,
      trigger: "update",
      session: { firstName: "Janet" },
    })) as Record<string, unknown>;

    expect(token.firstName).toBe("Janet");
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });
});
