import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { logger } from "@/lib/logger";
import { resendAdapter } from "@/lib/email/resend-adapter";

const mockedLoggerError = logger.error as unknown as ReturnType<typeof vi.fn>;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.EMAIL_FROM_ADDRESS = "noreply@cloudcompass.test";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resendAdapter.isConfigured", () => {
  it("1. false when RESEND_API_KEY is missing", () => {
    delete process.env.RESEND_API_KEY;
    expect(resendAdapter.isConfigured()).toBe(false);
  });

  it("2. false when EMAIL_FROM_ADDRESS is missing", () => {
    delete process.env.EMAIL_FROM_ADDRESS;
    expect(resendAdapter.isConfigured()).toBe(false);
  });

  it("3. true when both are set", () => {
    expect(resendAdapter.isConfigured()).toBe(true);
  });
});

describe("resendAdapter.sendPasswordResetEmail", () => {
  it("4. returns NOT_CONFIGURED without calling fetch when unconfigured", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchSpy = vi.spyOn(global, "fetch");

    const result = await resendAdapter.sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/reset-password?token=secret" });

    expect(result).toEqual({ ok: false, errorType: "NOT_CONFIGURED", message: expect.any(String) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("5. sends the expected request and returns ok on a successful Resend call", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));

    const result = await resendAdapter.sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/reset-password?token=secret" });

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-resend-key");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("jane@acme.test");
    expect(body.from).toBe("noreply@cloudcompass.test");
    expect(body.html).toContain("https://app.test/reset-password?token=secret");
  });

  it("6. classifies a 401 as AUTH_FAILED", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const result = await resendAdapter.sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/x" });
    expect(result).toEqual({ ok: false, errorType: "AUTH_FAILED", message: expect.any(String) });
  });

  it("7. classifies a 429 as RATE_LIMITED", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));
    const result = await resendAdapter.sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/x" });
    expect(result).toEqual({ ok: false, errorType: "RATE_LIMITED", message: expect.any(String) });
  });

  it("8. classifies a 422 as INVALID_REQUEST", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("validation failed", { status: 422 }));
    const result = await resendAdapter.sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/x" });
    expect(result).toEqual({ ok: false, errorType: "INVALID_REQUEST", message: expect.any(String) });
  });

  it("9. classifies a 500 as PROVIDER_UNAVAILABLE", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("server error", { status: 500 }));
    const result = await resendAdapter.sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/x" });
    expect(result).toEqual({ ok: false, errorType: "PROVIDER_UNAVAILABLE", message: expect.any(String) });
  });

  it("10. returns a safe PROVIDER_UNAVAILABLE result — never throws — when fetch itself rejects", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    const result = await resendAdapter.sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/x" });
    expect(result).toEqual({ ok: false, errorType: "PROVIDER_UNAVAILABLE", message: expect.any(String) });
  });

  it("11. never logs the API key, on a provider error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await resendAdapter.sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/x" });
    expect(JSON.stringify(mockedLoggerError.mock.calls)).not.toContain("test-resend-key");
  });

  it("12. never logs the reset URL, on a provider error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await resendAdapter.sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/reset-password?token=super-secret-token" });
    expect(JSON.stringify(mockedLoggerError.mock.calls)).not.toContain("super-secret-token");
  });

  it("13. never logs the API key when the request throws", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    await resendAdapter.sendPasswordResetEmail({ to: "jane@acme.test", resetUrl: "https://app.test/x" });
    expect(JSON.stringify(mockedLoggerError.mock.calls)).not.toContain("test-resend-key");
  });
});
