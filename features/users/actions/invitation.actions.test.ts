import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/features/users/services/invitation.service", () => ({
  createInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}));

import { requireUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { createInvitation, acceptInvitation } from "@/features/users/services/invitation.service";
import { inviteUserAction, acceptInvitationAction } from "@/features/users/actions/invitation.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;
const mockedCreateInvitation = createInvitation as unknown as ReturnType<typeof vi.fn>;
const mockedAcceptInvitation = acceptInvitation as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A = "company-a";
const SUPER_ADMIN = { id: "user-super", role: "SUPER_ADMIN", companyId: COMPANY_A };
const ADMIN = { id: "user-admin", role: "ADMIN", companyId: COMPANY_A };
const MANAGER = { id: "user-manager", role: "MANAGER", companyId: COMPANY_A };
const EMPLOYEE = { id: "user-employee", role: "EMPLOYEE", companyId: COMPANY_A };

const VALID_INVITE_INPUT = {
  email: "newperson@acme.test",
  firstName: "Jane",
  lastName: "Doe",
  role: "EMPLOYEE" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://app.test";
  mockedRequireUser.mockResolvedValue(ADMIN);
  mockedCreateInvitation.mockResolvedValue({ ok: true });
});

describe("inviteUserAction — permission (reuses Permissions.manageUsers, no new permission)", () => {
  it("1. ADMIN can invite", async () => {
    mockedRequireUser.mockResolvedValue(ADMIN);
    const result = await inviteUserAction(VALID_INVITE_INPUT);
    expect(result.success).toBe(true);
    expect(mockedCreateInvitation).toHaveBeenCalled();
  });

  it("2. SUPER_ADMIN can invite", async () => {
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    const result = await inviteUserAction(VALID_INVITE_INPUT);
    expect(result.success).toBe(true);
  });

  it("3. MANAGER cannot invite", async () => {
    mockedRequireUser.mockResolvedValue(MANAGER);
    const result = await inviteUserAction(VALID_INVITE_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateInvitation).not.toHaveBeenCalled();
  });

  it("4. EMPLOYEE (unauthorized) cannot invite", async () => {
    mockedRequireUser.mockResolvedValue(EMPLOYEE);
    const result = await inviteUserAction(VALID_INVITE_INPUT);
    expect(result.success).toBe(false);
    expect(mockedCreateInvitation).not.toHaveBeenCalled();
  });
});

describe("inviteUserAction — company isolation", () => {
  it("5. uses the actor's own companyId, never a client-supplied one", async () => {
    await inviteUserAction(VALID_INVITE_INPUT);
    const callArgs = mockedCreateInvitation.mock.calls[0][0];
    expect(callArgs.companyId).toBe(COMPANY_A);
  });

  it("6. records invitedById as the actor's own id", async () => {
    await inviteUserAction(VALID_INVITE_INPUT);
    const callArgs = mockedCreateInvitation.mock.calls[0][0];
    expect(callArgs.invitedById).toBe(ADMIN.id);
  });
});

describe("inviteUserAction — SUPER_ADMIN role-grant restriction (matches createUser/updateUser)", () => {
  it("7. a non-Super-Admin ADMIN cannot invite someone as SUPER_ADMIN", async () => {
    mockedRequireUser.mockResolvedValue(ADMIN);
    const result = await inviteUserAction({ ...VALID_INVITE_INPUT, role: "SUPER_ADMIN" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("Only a Super Admin can grant the Super Admin role.");
    expect(mockedCreateInvitation).not.toHaveBeenCalled();
  });

  it("8. a SUPER_ADMIN can invite someone as SUPER_ADMIN", async () => {
    mockedRequireUser.mockResolvedValue(SUPER_ADMIN);
    const result = await inviteUserAction({ ...VALID_INVITE_INPUT, role: "SUPER_ADMIN" });
    expect(result.success).toBe(true);
  });
});

describe("inviteUserAction — validation", () => {
  it("9. rejects an invalid email", async () => {
    const result = await inviteUserAction({ ...VALID_INVITE_INPUT, email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(mockedCreateInvitation).not.toHaveBeenCalled();
  });

  it("10. rejects a missing first name", async () => {
    const result = await inviteUserAction({ ...VALID_INVITE_INPUT, firstName: "" });
    expect(result.success).toBe(false);
    expect(mockedCreateInvitation).not.toHaveBeenCalled();
  });

  it("11. rejects a missing last name", async () => {
    const result = await inviteUserAction({ ...VALID_INVITE_INPUT, lastName: "" });
    expect(result.success).toBe(false);
    expect(mockedCreateInvitation).not.toHaveBeenCalled();
  });

  it("12. rejects an invalid role", async () => {
    const result = await inviteUserAction({ ...VALID_INVITE_INPUT, role: "OWNER" as never });
    expect(result.success).toBe(false);
    expect(mockedCreateInvitation).not.toHaveBeenCalled();
  });
});

describe("inviteUserAction — service failure surfacing", () => {
  it("13. surfaces EMAIL_ALREADY_REGISTERED as a clear, existing-convention error", async () => {
    mockedCreateInvitation.mockResolvedValue({ ok: false, reason: "EMAIL_ALREADY_REGISTERED" });
    const result = await inviteUserAction(VALID_INVITE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("A user with that email already exists.");
  });

  it("14. surfaces INVITATION_ALREADY_PENDING without creating a second active invitation", async () => {
    mockedCreateInvitation.mockResolvedValue({ ok: false, reason: "INVITATION_ALREADY_PENDING" });
    const result = await inviteUserAction(VALID_INVITE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toBe("An invitation has already been sent to that email address.");
  });

  it("15. surfaces a safe generic message on email send failure", async () => {
    mockedCreateInvitation.mockResolvedValue({ ok: false, reason: "EMAIL_SEND_FAILED" });
    const result = await inviteUserAction(VALID_INVITE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).not.toMatch(/resend|api key|token/i);
  });

  it("16. logs user.invited on success", async () => {
    await inviteUserAction(VALID_INVITE_INPUT);
    expect(mockedLogActivity).toHaveBeenCalledWith({
      actorId: ADMIN.id,
      action: "user.invited",
      companyId: COMPANY_A,
      metadata: { email: "newperson@acme.test" },
    });
  });
});

describe("acceptInvitationAction", () => {
  const VALID_ACCEPT_INPUT = { token: "raw-token", password: "NewPassword123", confirmPassword: "NewPassword123" };

  it("17. rejects mismatched passwords without calling the service", async () => {
    const result = await acceptInvitationAction({ ...VALID_ACCEPT_INPUT, confirmPassword: "Different123" });
    expect(result.success).toBe(false);
    expect(mockedAcceptInvitation).not.toHaveBeenCalled();
  });

  it("18. rejects a too-short password without calling the service", async () => {
    const result = await acceptInvitationAction({ ...VALID_ACCEPT_INPUT, password: "short", confirmPassword: "short" });
    expect(result.success).toBe(false);
    expect(mockedAcceptInvitation).not.toHaveBeenCalled();
  });

  it("19. returns INVALID_TOKEN when the service rejects the token", async () => {
    mockedAcceptInvitation.mockResolvedValue({ ok: false, reason: "INVALID_OR_EXPIRED" });
    const result = await acceptInvitationAction(VALID_ACCEPT_INPUT);
    expect(result).toEqual({ success: false, reason: "INVALID_TOKEN" });
  });

  it("20. returns success when the service accepts the invitation", async () => {
    mockedAcceptInvitation.mockResolvedValue({ ok: true });
    const result = await acceptInvitationAction(VALID_ACCEPT_INPUT);
    expect(result).toEqual({ success: true });
    expect(mockedAcceptInvitation).toHaveBeenCalledWith("raw-token", "NewPassword123");
  });

  it("21. does not call requireUser — unauthenticated by design", async () => {
    mockedAcceptInvitation.mockResolvedValue({ ok: true });
    await acceptInvitationAction(VALID_ACCEPT_INPUT);
    expect(mockedRequireUser).not.toHaveBeenCalled();
  });
});
