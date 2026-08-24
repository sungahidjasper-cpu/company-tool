import { markdownToHtml } from "@/features/ai-workspace/services/content-export.service";
import {
  assertSafePublicUrl,
  performSsrfGuardedRequest,
  UnsafePublishingUrlError,
} from "@/features/publishing/services/ssrf-guard.service";
import { classifyNetworkFailure, classifyWordPressStatusCode } from "@/features/publishing/services/publishing-errors";
import type { PublishingErrorType } from "@/lib/generated/prisma/enums";

/**
 * Phase 24 Stage 2B — the narrow service that performs one external
 * publish request to WordPress. This file has no database access and
 * knows nothing about PublishingJob/PublishingAttempt/ContentPublication —
 * recording those, enforcing idempotency, and gating retries are the
 * publishing action layer's responsibility (Stage 2C), not this
 * service's. This function does exactly one thing: given a connection's
 * baseUrl, an already-decrypted credential, and the content to send,
 * perform one SSRF-guarded POST and return a narrowly-typed result.
 */

export type WordPressCredential = {
  username: string;
  applicationPassword: string;
};

export type PublishableContent = {
  title: string;
  /** Markdown, exactly as stored on Content.body — converted to HTML here via the existing markdownToHtml, never a second converter. */
  bodyMarkdown: string;
};

export type WordPressPostStatus = "publish" | "draft";

export type WordPressPublishResult =
  | { ok: true; externalId: string; externalUrl: string; externalStatus: string }
  | { ok: false; errorType: PublishingErrorType; message: string };

/**
 * Publishes existing Content to a WordPress destination via
 * POST {baseUrl}/wp-json/wp/v2/posts using HTTP Basic Auth (a WordPress
 * Application Password). The caller must pass the already-decrypted
 * credential — decryption happens in the caller, immediately before this
 * call, never inside this function and never persisted here. externalStatus
 * has no default: the caller must explicitly say "publish" to publish live
 * content, so nothing is ever silently assumed.
 */
export async function publishContentToWordPress(
  baseUrl: string,
  credential: WordPressCredential,
  content: PublishableContent,
  externalStatus: WordPressPostStatus
): Promise<WordPressPublishResult> {
  let check;
  try {
    check = await assertSafePublicUrl(baseUrl);
  } catch (err) {
    if (err instanceof UnsafePublishingUrlError) {
      return { ok: false, errorType: "UNSAFE_URL", message: err.message };
    }
    throw err;
  }

  const authHeader = `Basic ${Buffer.from(`${credential.username}:${credential.applicationPassword}`).toString("base64")}`;
  const basePath = new URL(baseUrl).pathname.replace(/\/$/, "");
  const path = `${basePath}/wp-json/wp/v2/posts`;

  // metaTitle/metaDescription are deliberately never sent — WordPress core
  // has no native field for either, and Stage 2 does not assume any SEO
  // plugin is installed. Those fields stay local to Compass.
  const html = markdownToHtml(content.bodyMarkdown);
  const requestBody = JSON.stringify({ title: content.title, content: html, status: externalStatus });

  let response;
  try {
    response = await performSsrfGuardedRequest(check, {
      method: "POST",
      path,
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: requestBody,
    });
  } catch (err) {
    return {
      ok: false,
      errorType: classifyNetworkFailure(err),
      message: "No response was received from the destination — the outcome of this publish request could not be confirmed.",
    };
  }

  return interpretWordPressResponse(response);
}

function interpretWordPressResponse(response: { statusCode: number; body: string }): WordPressPublishResult {
  if (response.statusCode === 201) {
    try {
      const parsed = JSON.parse(response.body) as { id?: unknown; link?: unknown; status?: unknown };
      if (typeof parsed.id !== "undefined" && typeof parsed.link === "string") {
        return {
          ok: true,
          externalId: String(parsed.id),
          externalUrl: parsed.link,
          externalStatus: typeof parsed.status === "string" ? parsed.status : "publish",
        };
      }
    } catch {
      // Falls through — a 201 with an unparseable body is ambiguous, not a clean failure.
    }
    return {
      ok: false,
      errorType: "AMBIGUOUS_RESPONSE",
      message: "The destination reported success, but its response could not be confirmed as a created post.",
    };
  }

  const errorType = classifyWordPressStatusCode(response.statusCode, response.body);
  return { ok: false, errorType, message: describeWordPressFailure(response.statusCode, errorType) };
}

function describeWordPressFailure(statusCode: number, errorType: PublishingErrorType): string {
  switch (errorType) {
    case "AUTHENTICATION_FAILED":
      return "The destination rejected these credentials.";
    case "INSUFFICIENT_PERMISSIONS":
      return "These credentials do not have permission to create posts on this destination.";
    case "RATE_LIMITED":
      return "The destination is rate-limiting requests. Try again later.";
    case "VALIDATION_FAILED":
      return "The destination rejected this content as invalid.";
    case "DUPLICATE_RESOURCE":
      return "The destination reports a conflicting existing resource.";
    case "DESTINATION_UNAVAILABLE":
      return "The destination is currently unavailable.";
    case "AMBIGUOUS_RESPONSE":
      return "The destination's response could not be confirmed. Do not retry automatically.";
    default:
      return `The destination responded with an unexpected status (${statusCode}).`;
  }
}
