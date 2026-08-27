import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/publishing/services/ssrf-guard.service", () => {
  class UnsafePublishingUrlError extends Error {}
  return {
    assertSafePublicUrl: vi.fn(),
    performSsrfGuardedRequest: vi.fn(),
    UnsafePublishingUrlError,
  };
});
vi.mock("@/features/seo/services/website-crawler.service", () => ({
  extractPageContent: vi.fn(),
}));

import {
  assertSafePublicUrl,
  performSsrfGuardedRequest,
  UnsafePublishingUrlError,
} from "@/features/publishing/services/ssrf-guard.service";
import { extractPageContent } from "@/features/seo/services/website-crawler.service";
import { ingestKnowledgeSourceContent } from "@/features/seo/services/knowledge-source-ingestion.service";

const mockedAssertSafePublicUrl = assertSafePublicUrl as unknown as ReturnType<typeof vi.fn>;
const mockedPerformSsrfGuardedRequest = performSsrfGuardedRequest as unknown as ReturnType<typeof vi.fn>;
const mockedExtractPageContent = extractPageContent as unknown as ReturnType<typeof vi.fn>;

const SAFE_URL_CHECK = { hostname: "example.com", port: 443, pinnedIp: "93.184.216.34", pinnedFamily: 4 as const };

function makeCrawledPage(overrides: Partial<Record<string, unknown>> = {}) {
  return { bodyText: "Some real page content.", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAssertSafePublicUrl.mockResolvedValue(SAFE_URL_CHECK);
  mockedPerformSsrfGuardedRequest.mockResolvedValue({ statusCode: 200, body: "<html><body>Some real page content.</body></html>" });
  mockedExtractPageContent.mockReturnValue(makeCrawledPage());
});

describe("ingestKnowledgeSourceContent", () => {
  it("1. [CRITICAL] passes the exact URL to the SSRF guard before any fetch", async () => {
    await ingestKnowledgeSourceContent("https://example.com/article");
    expect(mockedAssertSafePublicUrl).toHaveBeenCalledWith("https://example.com/article");
  });

  it("2. [CRITICAL] performs the guarded request against the SSRF-validated pinned target, using the exact path/query from the supplied URL", async () => {
    await ingestKnowledgeSourceContent("https://example.com/article?ref=test");
    expect(mockedPerformSsrfGuardedRequest).toHaveBeenCalledWith(SAFE_URL_CHECK, { method: "GET", path: "/article?ref=test" });
  });

  it("3. [CRITICAL] passes the exact response body and original URL to the existing extraction function — never a second parser", async () => {
    mockedPerformSsrfGuardedRequest.mockResolvedValue({ statusCode: 200, body: "<html><body>Exact body.</body></html>" });
    await ingestKnowledgeSourceContent("https://example.com/exact");
    expect(mockedExtractPageContent).toHaveBeenCalledWith("<html><body>Exact body.</body></html>", "https://example.com/exact", 0);
  });

  it("4. returns the extracted bodyText on success", async () => {
    mockedExtractPageContent.mockReturnValue(makeCrawledPage({ bodyText: "Extracted readable text." }));
    const result = await ingestKnowledgeSourceContent("https://example.com/article");
    expect(result).toEqual({ success: true, content: "Extracted readable text." });
  });

  it("5. [CRITICAL] rejects a blocked/private URL without ever calling performSsrfGuardedRequest — no fetch, no internal details leaked", async () => {
    mockedAssertSafePublicUrl.mockRejectedValue(new UnsafePublishingUrlError("resolves to a private address"));
    const result = await ingestKnowledgeSourceContent("https://internal.example.com");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("This URL cannot be fetched. Use a public https:// URL.");
      expect(result.reason).not.toContain("private");
    }
    expect(mockedPerformSsrfGuardedRequest).not.toHaveBeenCalled();
  });

  it("6. reports a clean generic failure when the SSRF guard throws something other than UnsafePublishingUrlError", async () => {
    mockedAssertSafePublicUrl.mockRejectedValue(new Error("ENOTFOUND"));
    const result = await ingestKnowledgeSourceContent("https://nonexistent.invalid");
    expect(result).toEqual({ success: false, reason: "This URL cannot be fetched." });
    expect(mockedPerformSsrfGuardedRequest).not.toHaveBeenCalled();
  });

  it("7. reports a clean failure on a network/timeout error from the guarded request, without exposing the underlying error", async () => {
    mockedPerformSsrfGuardedRequest.mockRejectedValue(new Error("Request to the destination timed out."));
    const result = await ingestKnowledgeSourceContent("https://slow.example.com");
    expect(result).toEqual({ success: false, reason: "The URL could not be reached." });
  });

  it("8. [CRITICAL] treats an HTTP error status as a failure, not a success, even though a response object was returned", async () => {
    mockedPerformSsrfGuardedRequest.mockResolvedValue({ statusCode: 404, body: "<html>Not Found</html>" });
    const result = await ingestKnowledgeSourceContent("https://example.com/missing");
    expect(result).toEqual({ success: false, reason: "The URL returned an error (status 404)." });
    expect(mockedExtractPageContent).not.toHaveBeenCalled();
  });

  it("9. treats a 500 response the same way — never treated as success", async () => {
    mockedPerformSsrfGuardedRequest.mockResolvedValue({ statusCode: 500, body: "" });
    const result = await ingestKnowledgeSourceContent("https://example.com/error");
    expect(result.success).toBe(false);
  });

  it("10. reports failure when extraction yields empty content", async () => {
    mockedExtractPageContent.mockReturnValue(makeCrawledPage({ bodyText: "" }));
    const result = await ingestKnowledgeSourceContent("https://example.com/blank");
    expect(result).toEqual({ success: false, reason: "No readable content could be extracted from this page." });
  });

  it("11. reports failure when extraction yields only whitespace", async () => {
    mockedExtractPageContent.mockReturnValue(makeCrawledPage({ bodyText: "   \n\t  " }));
    const result = await ingestKnowledgeSourceContent("https://example.com/whitespace");
    expect(result.success).toBe(false);
  });

  it("12. [Content length] returns exactly what the existing extractor produced, with no additional truncation layer of its own", async () => {
    const longBody = "x".repeat(3000); // extractPageContent's own existing cap — reused as-is, not duplicated
    mockedExtractPageContent.mockReturnValue(makeCrawledPage({ bodyText: longBody }));
    const result = await ingestKnowledgeSourceContent("https://example.com/long");
    expect(result).toEqual({ success: true, content: longBody });
  });
});
