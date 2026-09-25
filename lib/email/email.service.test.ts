import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/resend-adapter", () => ({
  resendAdapter: {
    isConfigured: vi.fn(() => true),
    sendPasswordResetEmail: vi.fn(async () => ({ ok: true })),
  },
}));

import { resendAdapter } from "@/lib/email/resend-adapter";
import { isEmailConfigured, sendPasswordResetEmail } from "@/lib/email/email.service";

const mockedIsConfigured = resendAdapter.isConfigured as unknown as ReturnType<typeof vi.fn>;
const mockedSend = resendAdapter.sendPasswordResetEmail as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsConfigured.mockReturnValue(true);
  mockedSend.mockResolvedValue({ ok: true });
});

describe("email.service", () => {
  it("1. isEmailConfigured delegates to the configured adapter", () => {
    expect(isEmailConfigured()).toBe(true);
    expect(mockedIsConfigured).toHaveBeenCalledTimes(1);
  });

  it("2. sendPasswordResetEmail forwards exactly {to, resetUrl} to the adapter — no provider-specific shape leaks through", async () => {
    const result = await sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/reset-password?token=abc" });
    expect(result).toEqual({ ok: true });
    expect(mockedSend).toHaveBeenCalledWith({ to: "jane@acme.test", resetUrl: "https://app.test/reset-password?token=abc" });
  });
});
