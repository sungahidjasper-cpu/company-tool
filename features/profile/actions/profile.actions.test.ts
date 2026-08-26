import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/password", () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));

type MockPrisma = {
  user: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { updateProfile, changePassword } from "@/features/profile/actions/profile.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedHashPassword = hashPassword as unknown as ReturnType<typeof vi.fn>;
const mockedVerifyPassword = verifyPassword as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const COMPANY_A = "company-a";
const ACTOR = { id: "user-1", role: "EMPLOYEE", companyId: COMPANY_A };

const VALID_PROFILE_INPUT = {
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@acme.test",
  avatar: "",
};

const VALID_PASSWORD_INPUT = {
  currentPassword: "OldPassword123",
  newPassword: "NewPassword456",
  confirmPassword: "NewPassword456",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRequireUser.mockResolvedValue(ACTOR);
  mockedPrisma.user.findFirst.mockResolvedValue(null);
  mockedPrisma.user.findUnique.mockResolvedValue({ id: ACTOR.id, passwordHash: "stored-hash" });
  mockedPrisma.user.update.mockResolvedValue({ id: ACTOR.id });
  mockedVerifyPassword.mockResolvedValue(true);
  mockedHashPassword.mockResolvedValue("new-hashed-password");
});

describe("updateProfile", () => {
  it("1. rejects invalid input (missing first name) without any database work", async () => {
    const result = await updateProfile({ ...VALID_PROFILE_INPUT, firstName: "" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.user.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("2. rejects invalid input (malformed email)", async () => {
    const result = await updateProfile({ ...VALID_PROFILE_INPUT, email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("3. checks email uniqueness excluding the actor's own row", async () => {
    await updateProfile(VALID_PROFILE_INPUT);
    expect(mockedPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: "jane@acme.test", id: { not: ACTOR.id } },
    });
  });

  it("4. rejects when the email is already taken by a different user, without mutating", async () => {
    mockedPrisma.user.findFirst.mockResolvedValue({ id: "someone-else" });
    const result = await updateProfile(VALID_PROFILE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("A user with that email already exists.");
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("5. updates only the actor's own row with the parsed fields, avatar defaulting to null when blank", async () => {
    await updateProfile(VALID_PROFILE_INPUT);
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: ACTOR.id },
      data: { firstName: "Jane", lastName: "Doe", email: "jane@acme.test", avatar: null },
    });
  });

  it("6. stores a provided avatar URL as-is", async () => {
    await updateProfile({ ...VALID_PROFILE_INPUT, avatar: "https://example.test/avatar.png" });
    const [{ data }] = mockedPrisma.user.update.mock.calls[0];
    expect(data.avatar).toBe("https://example.test/avatar.png");
  });

  it("7. logs user.profile_updated for the actor's own company/user", async () => {
    mockedPrisma.user.update.mockResolvedValue({ id: ACTOR.id });
    await updateProfile(VALID_PROFILE_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: ACTOR.id,
      action: "user.profile_updated",
      companyId: COMPANY_A,
      userId: ACTOR.id,
    });
  });

  it("8. revalidates /profile", async () => {
    const { revalidatePath } = await import("next/cache");
    await updateProfile(VALID_PROFILE_INPUT);
    expect(revalidatePath).toHaveBeenCalledWith("/profile");
  });

  it("9. returns the actor's own id", async () => {
    mockedPrisma.user.update.mockResolvedValue({ id: ACTOR.id });
    const result = await updateProfile(VALID_PROFILE_INPUT);
    expect(result).toEqual({ success: true, data: { id: ACTOR.id } });
  });

  it("10. has no role gate — any authenticated actor may update their own profile (matches production, which performs no Permissions check)", async () => {
    mockedRequireUser.mockResolvedValue({ id: "user-9", role: "EMPLOYEE", companyId: COMPANY_A });
    const result = await updateProfile(VALID_PROFILE_INPUT);
    expect(result.success).toBe(true);
  });
});

describe("changePassword", () => {
  it("1. rejects invalid input (new password too short) without verifying anything", async () => {
    const result = await changePassword({ ...VALID_PASSWORD_INPUT, newPassword: "short", confirmPassword: "short" });
    expect(result.success).toBe(false);
    expect(mockedVerifyPassword).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("2. rejects invalid input (confirmPassword does not match newPassword) — real cross-field schema refinement", async () => {
    const result = await changePassword({ ...VALID_PASSWORD_INPUT, confirmPassword: "SomethingElse123" });
    expect(result.success).toBe(false);
    expect(mockedVerifyPassword).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("3. rejects when the account has no passwordHash, without calling verifyPassword", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: ACTOR.id, passwordHash: null });
    const result = await changePassword(VALID_PASSWORD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Unable to change password for this account.");
    expect(mockedVerifyPassword).not.toHaveBeenCalled();
  });

  it("4. rejects when the actor's user row cannot be found", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    const result = await changePassword(VALID_PASSWORD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Unable to change password for this account.");
    expect(mockedVerifyPassword).not.toHaveBeenCalled();
  });

  it("5. verifies the current password against the actor's own stored hash", async () => {
    await changePassword(VALID_PASSWORD_INPUT);
    expect(mockedVerifyPassword).toHaveBeenCalledWith("OldPassword123", "stored-hash");
  });

  it("6. rejects when the current password is incorrect, without hashing or updating", async () => {
    mockedVerifyPassword.mockResolvedValue(false);
    const result = await changePassword(VALID_PASSWORD_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Current password is incorrect.");
    expect(mockedHashPassword).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("7. [business rule] rejects when the new password is identical to the current password", async () => {
    const result = await changePassword({
      currentPassword: "SamePassword123",
      newPassword: "SamePassword123",
      confirmPassword: "SamePassword123",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe("New password must be different from the current password.");
    }
    expect(mockedHashPassword).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("8. hashes the new password and stores exactly that hash on the actor's own row", async () => {
    mockedHashPassword.mockResolvedValue("freshly-hashed-value");
    await changePassword(VALID_PASSWORD_INPUT);
    expect(mockedHashPassword).toHaveBeenCalledWith("NewPassword456");
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: ACTOR.id },
      data: { passwordHash: "freshly-hashed-value" },
    });
  });

  it("9. logs user.password_changed for the actor's own company/user", async () => {
    await changePassword(VALID_PASSWORD_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: ACTOR.id,
      action: "user.password_changed",
      companyId: COMPANY_A,
      userId: ACTOR.id,
    });
  });

  it("10. does not call revalidatePath (matches production, which never revalidates a path here)", async () => {
    const { revalidatePath } = await import("next/cache");
    await changePassword(VALID_PASSWORD_INPUT);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("11. returns a plain success result", async () => {
    const result = await changePassword(VALID_PASSWORD_INPUT);
    expect(result).toEqual({ success: true, data: undefined });
  });
});
