import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/publishing/services/ssrf-guard.service", () => {
  class UnsafePublishingUrlError extends Error {}
  return {
    UnsafePublishingUrlError,
    assertSafePublicUrl: vi.fn(),
    performSsrfGuardedRequest: vi.fn(),
  };
});

import {
  assertSafePublicUrl,
  performSsrfGuardedRequest,
  UnsafePublishingUrlError,
} from "@/features/publishing/services/ssrf-guard.service";
import { publishContentToWordPress } from "@/features/publishing/services/wordpress-publish.service";

const mockedAssertSafePublicUrl = assertSafePublicUrl as unknown as ReturnType<typeof vi.fn>;
const mockedPerformSsrfGuardedRequest = performSsrfGuardedRequest as unknown as ReturnType<typeof vi.fn>;

const FAKE_CHECK = { hostname: "blog.example.com", port: 443, pinnedIp: "203.0.113.9", pinnedFamily: 4 as const };
const CREDENTIAL = { username: "admin", applicationPassword: "abcd 1234 EFGH 5678" };
const CONTENT = { title: "My Article", bodyMarkdown: "# Heading\n\nSome **bold** text." };

describe("publishContentToWordPress", () => {
  beforeEach(() => {
    mockedAssertSafePublicUrl.mockReset();
    mockedPerformSsrfGuardedRequest.mockReset();
  });

  it("runs the SSRF guard before any network I/O, and never calls performSsrfGuardedRequest if it rejects", async () => {
    mockedAssertSafePublicUrl.mockRejectedValue(new UnsafePublishingUrlError("blocked"));

    const result = await publishContentToWordPress("https://169.254.169.254", CREDENTIAL, CONTENT, "publish");

    expect(result).toEqual({ ok: false, errorType: "UNSAFE_URL", message: "blocked" });
    expect(mockedPerformSsrfGuardedRequest).not.toHaveBeenCalled();
  });

  it("constructs the correct endpoint, method, and payload, and reuses the pinned-IP check", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({
      statusCode: 201,
      body: JSON.stringify({ id: 42, link: "https://blog.example.com/?p=42", status: "publish" }),
    });

    await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");

    expect(mockedAssertSafePublicUrl).toHaveBeenCalledWith("https://blog.example.com");
    expect(mockedPerformSsrfGuardedRequest).toHaveBeenCalledTimes(1);
    const [passedCheck, options] = mockedPerformSsrfGuardedRequest.mock.calls[0];
    expect(passedCheck).toBe(FAKE_CHECK); // the exact same validated check object, not re-derived
    expect(options.method).toBe("POST");
    expect(options.path).toBe("/wp-json/wp/v2/posts");

    const payload = JSON.parse(options.body);
    expect(payload.title).toBe("My Article");
    expect(payload.status).toBe("publish");
    expect(payload.content).toContain("<h1>Heading</h1>"); // markdownToHtml actually applied
    expect(payload.content).not.toContain("# Heading"); // raw markdown never sent
    expect(payload).not.toHaveProperty("metaTitle");
    expect(payload).not.toHaveProperty("metaDescription");
  });

  it("handles a baseUrl with a subdirectory path correctly", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue({ ...FAKE_CHECK, hostname: "example.com" });
    mockedPerformSsrfGuardedRequest.mockResolvedValue({
      statusCode: 201,
      body: JSON.stringify({ id: 1, link: "https://example.com/blog/?p=1", status: "publish" }),
    });

    await publishContentToWordPress("https://example.com/blog/", CREDENTIAL, CONTENT, "publish");

    const [, options] = mockedPerformSsrfGuardedRequest.mock.calls[0];
    expect(options.path).toBe("/blog/wp-json/wp/v2/posts");
  });

  it("builds a correct Basic Auth header without ever exposing the credential elsewhere", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({
      statusCode: 201,
      body: JSON.stringify({ id: 1, link: "https://blog.example.com/?p=1", status: "publish" }),
    });

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");

    const [, options] = mockedPerformSsrfGuardedRequest.mock.calls[0];
    const decoded = Buffer.from(options.headers.Authorization.replace("Basic ", ""), "base64").toString("utf8");
    expect(decoded).toBe("admin:abcd 1234 EFGH 5678");

    // The credential must never appear anywhere in the returned result.
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL.applicationPassword);
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL.username);
  });

  it("reduces a successful response to only id/link/status — never the raw response", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({
      statusCode: 201,
      body: JSON.stringify({
        id: 42,
        link: "https://blog.example.com/?p=42",
        status: "publish",
        content: { rendered: "<h1>should never be echoed back</h1>", raw: "..." },
        author: 1,
        excerpt: { rendered: "..." },
      }),
    });

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");

    expect(result).toEqual({
      ok: true,
      externalId: "42",
      externalUrl: "https://blog.example.com/?p=42",
      externalStatus: "publish",
    });
  });

  it("classifies a 401 response as AUTHENTICATION_FAILED, not a network failure", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({ statusCode: 401, body: "" });

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");
    expect(result).toEqual({ ok: false, errorType: "AUTHENTICATION_FAILED", message: expect.any(String) });
  });

  it("classifies a 403 with a permission-shaped body as INSUFFICIENT_PERMISSIONS", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({
      statusCode: 403,
      body: JSON.stringify({ code: "rest_cannot_create" }),
    });

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");
    expect(result).toEqual({ ok: false, errorType: "INSUFFICIENT_PERMISSIONS", message: expect.any(String) });
  });

  it("classifies a validation-rejecting 400 as VALIDATION_FAILED", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({ statusCode: 400, body: "" });

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");
    expect(result).toEqual({ ok: false, errorType: "VALIDATION_FAILED", message: expect.any(String) });
  });

  it("classifies a rate-limited 429 as RATE_LIMITED", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({ statusCode: 429, body: "" });

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");
    expect(result).toEqual({ ok: false, errorType: "RATE_LIMITED", message: expect.any(String) });
  });

  it("classifies a 503 as DESTINATION_UNAVAILABLE — a received 5xx is NOT a network failure", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({ statusCode: 503, body: "" });

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorType).toBe("DESTINATION_UNAVAILABLE");
  });

  it("distinguishes a never-connected network failure (safe) from a received response", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");
    expect(result).toEqual({ ok: false, errorType: "NETWORK_TIMEOUT", message: expect.any(String) });
  });

  it("classifies an ambiguous mid-request failure (no response received) as AMBIGUOUS_RESPONSE, never a plain retryable timeout", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockRejectedValue(new Error("Request to the destination timed out."));

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");
    expect(result).toEqual({ ok: false, errorType: "AMBIGUOUS_RESPONSE", message: expect.any(String) });
  });

  it("treats a malformed 201 response (unparseable / missing fields) as AMBIGUOUS_RESPONSE, not a clean success or a plain failure", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({ statusCode: 201, body: "not json at all" });

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");
    expect(result).toEqual({ ok: false, errorType: "AMBIGUOUS_RESPONSE", message: expect.any(String) });
  });

  it("treats a redirect (3xx) as a failure, never silently followed", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({ statusCode: 301, body: "" });

    const result = await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorType).toBe("AMBIGUOUS_RESPONSE");
  });

  it("never logs the credential to the console across success and failure paths", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValueOnce({ statusCode: 401, body: "" });
    await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");

    mockedPerformSsrfGuardedRequest.mockRejectedValueOnce(new Error("boom"));
    await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "publish");

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join("\n");
    expect(allLoggedText).not.toContain(CREDENTIAL.applicationPassword);
    expect(allLoggedText).not.toContain(CREDENTIAL.username);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("requires an explicit externalStatus — publishing live content is never silently assumed", async () => {
    mockedAssertSafePublicUrl.mockResolvedValue(FAKE_CHECK);
    mockedPerformSsrfGuardedRequest.mockResolvedValue({
      statusCode: 201,
      body: JSON.stringify({ id: 1, link: "https://blog.example.com/?p=1&preview=true", status: "draft" }),
    });

    await publishContentToWordPress("https://blog.example.com", CREDENTIAL, CONTENT, "draft");

    const [, options] = mockedPerformSsrfGuardedRequest.mock.calls[0];
    expect(JSON.parse(options.body).status).toBe("draft");
  });
});
