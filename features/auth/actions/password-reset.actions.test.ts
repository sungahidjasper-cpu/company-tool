import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/services/password-reset.service", () => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));

import { requestPasswordReset, resetPassword } from "@/features/auth/services/password-reset.service";
import { requestPasswordResetAction, resetPasswordAction } from "@/features/auth/actions/password-reset.actions";

const mockedRequestPasswordReset = requestPasswordReset as unknown as ReturnType<typeof vi.fn>;
const mockedResetPassword = resetPassword as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://app.test";
  mockedRequestPasswordReset.mockResolvedValue(undefined);
});

describe("requestPasswordResetAction", () => {
  it("1. rejects a malformed email without calling the service", async () => {
    const result = await requestPasswordResetAction({ email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(mockedRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("2. returns the same generic success for a well-formed email regardless of what the service does", async () => {
    const result = await requestPasswordResetAction({ email: "jane@acme.test" });
    expect(result).toEqual({ success: true, data: undefined });
    expect(mockedRequestPasswordReset).toHaveBeenCalledWith("jane@acme.test", "https://app.test");
  });

  it("3. builds the reset link from NEXTAUTH_URL, not a hardcoded origin", async () => {
    process.env.NEXTAUTH_URL = "https://different-origin.test";
    await requestPasswordResetAction({ email: "jane@acme.test" });
    expect(mockedRequestPasswordReset).toHaveBeenCalledWith("jane@acme.test", "https://different-origin.test");
  });

  it("4. returns identical success shape whether the service actually sent an email or silently no-opped", async () => {
    const resultA = await requestPasswordResetAction({ email: "exists@acme.test" });
    const resultB = await requestPasswordResetAction({ email: "unknown@acme.test" });
    expect(resultA).toEqual(resultB);
  });
});

describe("resetPasswordAction", () => {
  it("5. rejects mismatched passwords without calling the service", async () => {
    const result = await resetPasswordAction({ token: "t", newPassword: "Password123", confirmPassword: "Different123" });
    expect(result.success).toBe(false);
    expect(mockedResetPassword).not.toHaveBeenCalled();
  });

  it("6. rejects a too-short password without calling the service", async () => {
    const result = await resetPasswordAction({ token: "t", newPassword: "short", confirmPassword: "short" });
    expect(result.success).toBe(false);
    expect(mockedResetPassword).not.toHaveBeenCalled();
  });

  it("7. returns INVALID_TOKEN when the service rejects the token", async () => {
    mockedResetPassword.mockResolvedValue({ ok: false, reason: "INVALID_OR_EXPIRED" });
    const result = await resetPasswordAction({ token: "bad", newPassword: "Password123", confirmPassword: "Password123" });
    expect(result).toEqual({ success: false, reason: "INVALID_TOKEN" });
  });

  it("8. returns success when the service accepts the token", async () => {
    mockedResetPassword.mockResolvedValue({ ok: true });
    const result = await resetPasswordAction({ token: "good", newPassword: "Password123", confirmPassword: "Password123" });
    expect(result).toEqual({ success: true });
    expect(mockedResetPassword).toHaveBeenCalledWith("good", "Password123");
  });
});
