import {
  assertSafePublicUrl,
  performSsrfGuardedRequest,
  UnsafePublishingUrlError,
} from "@/features/publishing/services/ssrf-guard.service";

/**
 * Phase 24 Stage 1 — validates a WordPress Application Password against the
 * REST API's own "who am I" endpoint before anything is ever persisted.
 * assertSafePublicUrl runs first, unconditionally, for this call exactly as
 * it will for every future publish call — there is no code path here that
 * reaches the network without passing the SSRF guard first.
 */

export type WordPressValidationErrorType =
  | "UNSAFE_URL"
  | "AUTHENTICATION_FAILED"
  | "NETWORK_ERROR"
  | "UNEXPECTED_RESPONSE";

export type WordPressCredentialValidationResult =
  | { ok: true }
  | { ok: false; errorType: WordPressValidationErrorType; message: string };

export async function validateWordPressCredential(
  baseUrl: string,
  username: string,
  applicationPassword: string
): Promise<WordPressCredentialValidationResult> {
  let check;
  try {
    check = await assertSafePublicUrl(baseUrl);
  } catch (err) {
    if (err instanceof UnsafePublishingUrlError) {
      return { ok: false, errorType: "UNSAFE_URL", message: err.message };
    }
    throw err;
  }

  const authHeader = `Basic ${Buffer.from(`${username}:${applicationPassword}`).toString("base64")}`;
  const basePath = new URL(baseUrl).pathname.replace(/\/$/, "");
  const path = `${basePath}/wp-json/wp/v2/users/me`;

  let response;
  try {
    response = await performSsrfGuardedRequest(check, {
      method: "GET",
      path,
      headers: { Authorization: authHeader, Accept: "application/json" },
    });
  } catch {
    return {
      ok: false,
      errorType: "NETWORK_ERROR",
      message: "Could not reach the destination. Check the URL and try again.",
    };
  }

  if (response.statusCode === 200) {
    try {
      const parsed = JSON.parse(response.body) as { id?: unknown };
      if (parsed && typeof parsed.id !== "undefined") {
        return { ok: true };
      }
    } catch {
      // Falls through to the unexpected-response branch below.
    }
    return {
      ok: false,
      errorType: "UNEXPECTED_RESPONSE",
      message: "The destination responded, but not with a recognizable WordPress user.",
    };
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    return { ok: false, errorType: "AUTHENTICATION_FAILED", message: "The destination rejected these credentials." };
  }

  if (response.statusCode >= 300 && response.statusCode < 400) {
    return {
      ok: false,
      errorType: "UNEXPECTED_RESPONSE",
      message: "The destination responded with a redirect, which is not followed for security reasons.",
    };
  }

  return {
    ok: false,
    errorType: "UNEXPECTED_RESPONSE",
    message: `The destination responded with an unexpected status (${response.statusCode}).`,
  };
}
