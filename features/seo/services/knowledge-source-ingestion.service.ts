import { assertSafePublicUrl, performSsrfGuardedRequest, UnsafePublishingUrlError } from "@/features/publishing/services/ssrf-guard.service";
import { extractPageContent } from "@/features/seo/services/website-crawler.service";

export type KnowledgeSourceIngestionResult = { success: true; content: string } | { success: false; reason: string };

/**
 * Phase 30 Stage 7 — fetches a URL's readable text for a human to review
 * before saving it into KnowledgeSource.content. Deliberately does nothing
 * else: no Prisma access, no AI call, no persistence — the caller (the
 * action layer) is the only place this result can ever become a saved
 * Knowledge Source, and only via the existing create/update actions once a
 * human has reviewed and explicitly submitted the form.
 *
 * Reuses two already-hardened, already-tested primitives rather than
 * building new ones:
 *  - assertSafePublicUrl/performSsrfGuardedRequest (features/publishing's
 *    Phase 24 SSRF guard, unmodified) for the fetch itself.
 *  - extractPageContent (website-crawler.service.ts, unmodified apart from
 *    being exported) for HTML→text extraction, including its existing
 *    3000-char bodyText cap — reused as-is rather than inventing a second
 *    length limit.
 */
export async function ingestKnowledgeSourceContent(url: string): Promise<KnowledgeSourceIngestionResult> {
  let safeUrl;
  try {
    safeUrl = await assertSafePublicUrl(url);
  } catch (error) {
    if (error instanceof UnsafePublishingUrlError) {
      return { success: false, reason: "This URL cannot be fetched. Use a public https:// URL." };
    }
    return { success: false, reason: "This URL cannot be fetched." };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { success: false, reason: "This URL cannot be fetched. Use a public https:// URL." };
  }

  let response;
  try {
    response = await performSsrfGuardedRequest(safeUrl, {
      method: "GET",
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
    });
  } catch {
    return { success: false, reason: "The URL could not be reached." };
  }

  if (response.statusCode >= 400) {
    return { success: false, reason: `The URL returned an error (status ${response.statusCode}).` };
  }

  const extracted = extractPageContent(response.body, url, 0);
  if (!extracted.bodyText.trim()) {
    return { success: false, reason: "No readable content could be extracted from this page." };
  }

  return { success: true, content: extracted.bodyText };
}
