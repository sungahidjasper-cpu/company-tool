import dns from "node:dns";
import { describe, expect, it, vi } from "vitest";

import { assertSafePublicUrl, UnsafePublishingUrlError } from "@/features/publishing/services/ssrf-guard.service";

describe("assertSafePublicUrl", () => {
  it("rejects a non-https URL", async () => {
    await expect(assertSafePublicUrl("http://example.com")).rejects.toBeInstanceOf(UnsafePublishingUrlError);
  });

  it("rejects an invalid URL", async () => {
    await expect(assertSafePublicUrl("not-a-url")).rejects.toBeInstanceOf(UnsafePublishingUrlError);
  });

  it("rejects localhost by hostname", async () => {
    await expect(assertSafePublicUrl("https://localhost")).rejects.toBeInstanceOf(UnsafePublishingUrlError);
  });

  it("rejects a hostname resolving to a private IPv4 range", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }] as never);
    await expect(assertSafePublicUrl("https://internal.example.com")).rejects.toBeInstanceOf(UnsafePublishingUrlError);
  });

  it("rejects a hostname resolving to a loopback IPv4 address", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    await expect(assertSafePublicUrl("https://sneaky.example.com")).rejects.toBeInstanceOf(UnsafePublishingUrlError);
  });

  it("rejects a hostname resolving to a link-local IPv4 address", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as never);
    await expect(assertSafePublicUrl("https://metadata.example.com")).rejects.toBeInstanceOf(UnsafePublishingUrlError);
  });

  it("rejects a hostname resolving to an IPv6 loopback address", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([{ address: "::1", family: 6 }] as never);
    await expect(assertSafePublicUrl("https://v6loop.example.com")).rejects.toBeInstanceOf(UnsafePublishingUrlError);
  });

  it("rejects a hostname resolving to an IPv4-mapped-IPv6 private address", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([{ address: "::ffff:192.168.1.1", family: 6 }] as never);
    await expect(assertSafePublicUrl("https://mapped.example.com")).rejects.toBeInstanceOf(UnsafePublishingUrlError);
  });

  it("rejects if ANY resolved address is blocked, even when another is public", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ] as never);
    await expect(assertSafePublicUrl("https://multi.example.com")).rejects.toBeInstanceOf(UnsafePublishingUrlError);
  });

  it("accepts and pins a hostname resolving to a genuinely public IPv4 address", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }] as never);
    const result = await assertSafePublicUrl("https://public.example.com/wp-json");
    expect(result.hostname).toBe("public.example.com");
    expect(result.pinnedIp).toBe("8.8.8.8");
    expect(result.pinnedFamily).toBe(4);
    expect(result.port).toBe(443);
  });

  it("rejects when DNS resolution fails outright", async () => {
    vi.spyOn(dns.promises, "lookup").mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(assertSafePublicUrl("https://nonexistent.invalid")).rejects.toBeInstanceOf(UnsafePublishingUrlError);
  });
});
