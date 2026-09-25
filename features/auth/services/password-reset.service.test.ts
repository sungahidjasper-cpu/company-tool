import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/email.service", () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock("@/lib/password", () => ({ hashPassword: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

type MockTx = {
  passwordResetToken: {
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  user: { update: ReturnType<typeof vi.fn> };
};

function createMockTx(): MockTx {
  return {
    passwordResetToken: { updateMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    user: { update: vi.fn() },
  };
}

let mockTx: MockTx;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    passwordResetToken: { findFirst: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: MockTx) => unknown) => cb(mockTx)),
  },
}));

import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email/email.service";
import { hashPassword } from "@/lib/password";
import { requestPasswordReset, resetPassword } from "@/features/auth/services/password-reset.service";

const mockedPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  passwordResetToken: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mockedSendEmail = sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>;
const mockedHashPassword = hashPassword as unknown as ReturnType<typeof vi.fn>;

const ACTIVE_USER = { id: "user-1", email: "jane@acme.test", deletedAt: null, status: "ACTIVE", passwordHash: "existing-hash" };

beforeEach(() => {
  vi.clearAllMocks();
  mockTx = createMockTx();
  mockedPrisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
  mockedPrisma.passwordResetToken.findFirst.mockResolvedValue(null);
  mockedSendEmail.mockResolvedValue({ ok: true });
  mockedHashPassword.mockResolvedValue("new-hash");
});

describe("requestPasswordReset — no account enumeration", () => {
  it("1. does nothing for an unknown email", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    await requestPasswordReset("nobody@acme.test", "https://app.test");
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("2. does nothing for a deleted user", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, deletedAt: new Date() });
    await requestPasswordReset("jane@acme.test", "https://app.test");
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("3. does nothing for a suspended user", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, status: "SUSPENDED" });
    await requestPasswordReset("jane@acme.test", "https://app.test");
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("4. does nothing for a user with no password set", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, passwordHash: null });
    await requestPasswordReset("jane@acme.test", "https://app.test");
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("5. never throws for any of the above — the caller always sees the same resolved promise either way", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);
    await expect(requestPasswordReset("nobody@acme.test", "https://app.test")).resolves.toBeUndefined();
  });
});

describe("requestPasswordReset — valid account", () => {
  it("6. creates a token and emails the reset link", async () => {
    await requestPasswordReset("jane@acme.test", "https://app.test");
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.passwordResetToken.create).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail.mock.calls[0][0].to).toBe("jane@acme.test");
    expect(mockedSendEmail.mock.calls[0][0].resetUrl).toContain("https://app.test/reset-password?token=");
  });

  it("7. invalidates any previous pending token before creating the new one", async () => {
    await requestPasswordReset("jane@acme.test", "https://app.test");
    expect(mockTx.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: ACTIVE_USER.id, usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("8. skips creating a new token within the cooldown window of a recent request", async () => {
    mockedPrisma.passwordResetToken.findFirst.mockResolvedValue({ id: "existing-token" });
    await requestPasswordReset("jane@acme.test", "https://app.test");
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("9. does not crash the caller when the email provider fails", async () => {
    mockedSendEmail.mockResolvedValue({ ok: false, errorType: "PROVIDER_UNAVAILABLE", message: "failed" });
    await expect(requestPasswordReset("jane@acme.test", "https://app.test")).resolves.toBeUndefined();
  });
});

describe("resetPassword", () => {
  it("10. rejects when no row matches (unknown/already-used/expired token)", async () => {
    mockTx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    const result = await resetPassword("bad-token", "NewPassword123");
    expect(result).toEqual({ ok: false, reason: "INVALID_OR_EXPIRED" });
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it("11. accepts a valid token: hashes the new password, marks the token used, increments securityVersion", async () => {
    mockTx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    mockTx.passwordResetToken.findUnique.mockResolvedValue({ userId: "user-1" });

    const result = await resetPassword("good-token", "NewPassword123");

    expect(result).toEqual({ ok: true });
    expect(mockedHashPassword).toHaveBeenCalledWith("NewPassword123");
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "new-hash", securityVersion: { increment: 1 } },
    });
  });

  it("12. never stores or queries by the raw token — only its hash", async () => {
    mockTx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    mockTx.passwordResetToken.findUnique.mockResolvedValue({ userId: "user-1" });

    await resetPassword("plaintext-raw-token-value", "NewPassword123");

    const updateManyArgs = mockTx.passwordResetToken.updateMany.mock.calls[0][0];
    expect(updateManyArgs.where.tokenHash).not.toBe("plaintext-raw-token-value");
    expect(updateManyArgs.where.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("13. the atomic conditional update is the only consumption guard — a raced second call sees count 0 and is rejected", async () => {
    // Simulates two concurrent callers hitting the DB: the first UPDATE
    // commits (usedAt no longer null), so the second's WHERE no longer
    // matches — modeled here as updateMany simply returning count: 0 on
    // the second invocation, exactly what Postgres would report.
    mockTx.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mockTx.passwordResetToken.findUnique.mockResolvedValue({ userId: "user-1" });

    const first = await resetPassword("same-token", "NewPassword123");
    const second = await resetPassword("same-token", "NewPassword123");

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: "INVALID_OR_EXPIRED" });
  });
});
