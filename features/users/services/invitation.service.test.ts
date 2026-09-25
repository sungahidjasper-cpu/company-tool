import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/email.service", () => ({ sendInvitationEmail: vi.fn() }));
vi.mock("@/lib/password", () => ({ hashPassword: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

type MockTx = {
  userInvitation: {
    updateMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  user: { create: ReturnType<typeof vi.fn> };
};

function createMockTx(): MockTx {
  return {
    userInvitation: { updateMany: vi.fn(), findUnique: vi.fn() },
    user: { create: vi.fn() },
  };
}

let mockTx: MockTx;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    company: { findUniqueOrThrow: vi.fn() },
    userInvitation: { findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: MockTx) => unknown) => cb(mockTx)),
  },
}));

import { prisma } from "@/lib/prisma";
import { sendInvitationEmail } from "@/lib/email/email.service";
import { hashPassword } from "@/lib/password";
import { logActivity } from "@/lib/activity";
import { acceptInvitation, createInvitation, getInvitationPreview } from "@/features/users/services/invitation.service";

const mockedPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  company: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
  userInvitation: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mockedSendInvitationEmail = sendInvitationEmail as unknown as ReturnType<typeof vi.fn>;
const mockedHashPassword = hashPassword as unknown as ReturnType<typeof vi.fn>;
const mockedLogActivity = logActivity as unknown as ReturnType<typeof vi.fn>;

const COMPANY_ID = "company-1";
const ADMIN_ID = "admin-1";

const VALID_INPUT = {
  companyId: COMPANY_ID,
  invitedById: ADMIN_ID,
  email: "newperson@acme.test",
  firstName: "Jane",
  lastName: "Doe",
  role: "EMPLOYEE" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockTx = createMockTx();
  mockedPrisma.user.findUnique.mockResolvedValue(null);
  mockedPrisma.userInvitation.findFirst.mockResolvedValue(null);
  mockedPrisma.userInvitation.create.mockResolvedValue({ id: "invitation-1" });
  mockedPrisma.company.findUniqueOrThrow.mockResolvedValue({ name: "Acme Co" });
  mockedSendInvitationEmail.mockResolvedValue({ ok: true });
  mockedHashPassword.mockResolvedValue("new-hash");
});

describe("createInvitation", () => {
  it("1. rejects when a User already exists with that email", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "existing-user" });
    const result = await createInvitation(VALID_INPUT, "https://app.test");
    expect(result).toEqual({ ok: false, reason: "EMAIL_ALREADY_REGISTERED" });
    expect(mockedPrisma.userInvitation.create).not.toHaveBeenCalled();
  });

  it("2. rejects when a pending invitation already exists for that email — no silent second invitation", async () => {
    mockedPrisma.userInvitation.findFirst.mockResolvedValue({ id: "existing-invitation" });
    const result = await createInvitation(VALID_INPUT, "https://app.test");
    expect(result).toEqual({ ok: false, reason: "INVITATION_ALREADY_PENDING" });
    expect(mockedPrisma.userInvitation.create).not.toHaveBeenCalled();
  });

  it("3. creates the invitation with the actor's companyId and sends the email", async () => {
    const result = await createInvitation(VALID_INPUT, "https://app.test");
    expect(result).toEqual({ ok: true });
    expect(mockedPrisma.userInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: COMPANY_ID,
        invitedById: ADMIN_ID,
        email: "newperson@acme.test",
        firstName: "Jane",
        lastName: "Doe",
        role: "EMPLOYEE",
      }),
    });
    expect(mockedSendInvitationEmail).toHaveBeenCalledTimes(1);
    const emailArgs = mockedSendInvitationEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe("newperson@acme.test");
    expect(emailArgs.firstName).toBe("Jane");
    expect(emailArgs.companyName).toBe("Acme Co");
    expect(emailArgs.inviteUrl).toContain("https://app.test/accept-invitation?token=");
  });

  it("4. stores only a hashed token, never the raw value", async () => {
    await createInvitation(VALID_INPUT, "https://app.test");
    const createArgs = mockedPrisma.userInvitation.create.mock.calls[0][0];
    expect(createArgs.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("5. sets a 7-day expiry", async () => {
    const before = Date.now();
    await createInvitation(VALID_INPUT, "https://app.test");
    const createArgs = mockedPrisma.userInvitation.create.mock.calls[0][0];
    const expiresAt = createArgs.data.expiresAt as Date;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt.getTime() - before - sevenDaysMs)).toBeLessThan(5000);
  });

  it("6. rolls back the invitation and reports failure when the email cannot be sent", async () => {
    mockedSendInvitationEmail.mockResolvedValue({ ok: false, errorType: "PROVIDER_UNAVAILABLE", message: "failed" });
    const result = await createInvitation(VALID_INPUT, "https://app.test");
    expect(result).toEqual({ ok: false, reason: "EMAIL_SEND_FAILED" });
    expect(mockedPrisma.userInvitation.delete).toHaveBeenCalledWith({ where: { id: "invitation-1" } });
  });
});

describe("getInvitationPreview", () => {
  it("7. returns null for an unknown/invalid/expired token", async () => {
    mockedPrisma.userInvitation.findFirst.mockResolvedValue(null);
    const preview = await getInvitationPreview("bad-token");
    expect(preview).toBeNull();
  });

  it("8. returns the invitee's name/email/company for a valid pending invitation", async () => {
    mockedPrisma.userInvitation.findFirst.mockResolvedValue({
      firstName: "Jane",
      lastName: "Doe",
      email: "newperson@acme.test",
      company: { name: "Acme Co" },
    });
    const preview = await getInvitationPreview("good-token");
    expect(preview).toEqual({ firstName: "Jane", lastName: "Doe", email: "newperson@acme.test", companyName: "Acme Co" });
  });
});

describe("acceptInvitation", () => {
  it("9. rejects an unknown/expired/already-used token", async () => {
    mockTx.userInvitation.updateMany.mockResolvedValue({ count: 0 });
    const result = await acceptInvitation("bad-token", "NewPassword123");
    expect(result).toEqual({ ok: false, reason: "INVALID_OR_EXPIRED" });
    expect(mockTx.user.create).not.toHaveBeenCalled();
  });

  it("10. accepts a valid invitation: creates an ACTIVE user with the invitation's stored details", async () => {
    mockTx.userInvitation.updateMany.mockResolvedValue({ count: 1 });
    mockTx.userInvitation.findUnique.mockResolvedValue({
      companyId: COMPANY_ID,
      email: "newperson@acme.test",
      firstName: "Jane",
      lastName: "Doe",
      role: "EMPLOYEE",
    });
    mockTx.user.create.mockResolvedValue({ id: "new-user-1" });

    const result = await acceptInvitation("good-token", "NewPassword123");

    expect(result).toEqual({ ok: true });
    expect(mockedHashPassword).toHaveBeenCalledWith("NewPassword123");
    expect(mockTx.user.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_ID,
        email: "newperson@acme.test",
        firstName: "Jane",
        lastName: "Doe",
        role: "EMPLOYEE",
        passwordHash: "new-hash",
        status: "ACTIVE",
      },
    });
  });

  it("11. never stores or queries by the raw token — only its hash", async () => {
    mockTx.userInvitation.updateMany.mockResolvedValue({ count: 1 });
    mockTx.userInvitation.findUnique.mockResolvedValue({
      companyId: COMPANY_ID,
      email: "newperson@acme.test",
      firstName: "Jane",
      lastName: "Doe",
      role: "EMPLOYEE",
    });
    mockTx.user.create.mockResolvedValue({ id: "new-user-1" });

    await acceptInvitation("plaintext-raw-invitation-token", "NewPassword123");

    const updateManyArgs = mockTx.userInvitation.updateMany.mock.calls[0][0];
    expect(updateManyArgs.where.tokenHash).not.toBe("plaintext-raw-invitation-token");
    expect(updateManyArgs.where.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("12. logs user.invitation_accepted for the newly created user", async () => {
    mockTx.userInvitation.updateMany.mockResolvedValue({ count: 1 });
    mockTx.userInvitation.findUnique.mockResolvedValue({
      companyId: COMPANY_ID,
      email: "newperson@acme.test",
      firstName: "Jane",
      lastName: "Doe",
      role: "EMPLOYEE",
    });
    mockTx.user.create.mockResolvedValue({ id: "new-user-1" });

    await acceptInvitation("good-token", "NewPassword123");

    expect(mockedLogActivity).toHaveBeenCalledWith({ actorId: null, action: "user.invitation_accepted", userId: "new-user-1" });
  });

  it("13. the atomic conditional update is the only consumption guard — a raced second call sees count 0 and is rejected", async () => {
    mockTx.userInvitation.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mockTx.userInvitation.findUnique.mockResolvedValue({
      companyId: COMPANY_ID,
      email: "newperson@acme.test",
      firstName: "Jane",
      lastName: "Doe",
      role: "EMPLOYEE",
    });
    mockTx.user.create.mockResolvedValue({ id: "new-user-1" });

    const first = await acceptInvitation("same-token", "NewPassword123");
    const second = await acceptInvitation("same-token", "NewPassword123");

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: "INVALID_OR_EXPIRED" });
  });
});
