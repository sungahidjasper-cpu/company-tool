import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/resend-adapter", () => ({
  resendAdapter: {
    isConfigured: vi.fn(() => true),
    sendPasswordResetEmail: vi.fn(async () => ({ ok: true })),
    sendInvitationEmail: vi.fn(async () => ({ ok: true })),
  },
}));

import { resendAdapter } from "@/lib/email/resend-adapter";
import { isEmailConfigured, sendPasswordResetEmail, sendInvitationEmail } from "@/lib/email/email.service";

const mockedIsConfigured = resendAdapter.isConfigured as unknown as ReturnType<typeof vi.fn>;
const mockedSendReset = resendAdapter.sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>;
const mockedSendInvitation = resendAdapter.sendInvitationEmail as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsConfigured.mockReturnValue(true);
  mockedSendReset.mockResolvedValue({ ok: true });
  mockedSendInvitation.mockResolvedValue({ ok: true });
});

describe("email.service", () => {
  it("1. isEmailConfigured delegates to the configured adapter", () => {
    expect(isEmailConfigured()).toBe(true);
    expect(mockedIsConfigured).toHaveBeenCalledTimes(1);
  });

  it("2. sendPasswordResetEmail forwards exactly {to, resetUrl} to the adapter — no provider-specific shape leaks through", async () => {
    const result = await sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/reset-password?token=abc" });
    expect(result).toEqual({ ok: true });
    expect(mockedSendReset).toHaveBeenCalledWith({ to: "jane@acme.test", resetUrl: "https://app.test/reset-password?token=abc" });
  });

  it("3. sendInvitationEmail forwards exactly {to, inviteUrl, firstName, companyName} to the adapter — no provider-specific shape leaks through", async () => {
    const params = { to: "jane@acme.test", inviteUrl: "https://app.test/accept-invitation?token=abc", firstName: "Jane", companyName: "Acme Co" };
    const result = await sendInvitationEmail(params);
    expect(result).toEqual({ ok: true });
    expect(mockedSendInvitation).toHaveBeenCalledWith(params);
  });
});
