import type { PublishingErrorType } from "@/lib/generated/prisma/enums";

/**
 * Phase 24 Stage 2B — a new, separate error taxonomy for external
 * publishing failures. Deliberately not WebsiteAnalysisErrorType or
 * LlmErrorType: a destination's HTTP API fails for different reasons than
 * an LLM provider, and forcing either existing vocabulary onto it would
 * misrepresent the failure. Classification is intentionally conservative —
 * it only distinguishes what a response actually tells us, and defaults to
 * the safer/more general bucket whenever WordPress doesn't provide enough
 * information to be more specific.
 */

type WordPressErrorBody = { code?: string; message?: string };

const AUTHENTICATION_FAILURE_CODES = new Set([
  "rest_not_logged_in",
  "incorrect_password",
  "invalid_username",
  "rest_login_required",
]);

const PERMISSION_FAILURE_CODES = new Set(["rest_cannot_create", "rest_forbidden", "rest_cannot_edit", "rest_cannot_publish"]);

function tryParseWordPressErrorBody(body: string): WordPressErrorBody | null {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? (parsed as WordPressErrorBody) : null;
  } catch {
    return null;
  }
}

/**
 * Classifies a RECEIVED HTTP response (any status code) into a
 * PublishingErrorType. This function is only ever called once a response
 * has actually arrived — receiving any status code, including 5xx, is
 * materially different from no response at all (see classifyNetworkFailure
 * below) and must never be treated as automatically retryable here.
 */
export function classifyWordPressStatusCode(statusCode: number, body: string): PublishingErrorType {
  if (statusCode === 401 || statusCode === 403) {
    const parsedBody = tryParseWordPressErrorBody(body);
    const code = parsedBody?.code;
    if (code && PERMISSION_FAILURE_CODES.has(code)) return "INSUFFICIENT_PERMISSIONS";
    if (code && AUTHENTICATION_FAILURE_CODES.has(code)) return "AUTHENTICATION_FAILED";
    // WordPress's own body didn't give us enough to distinguish further —
    // AUTHENTICATION_FAILED is the safer, more actionable default for an
    // unrecognized 401/403 (matching wordpress-connection.service.ts's
    // existing Stage 1 behavior for the same ambiguity).
    return "AUTHENTICATION_FAILED";
  }
  if (statusCode === 429) return "RATE_LIMITED";
  if (statusCode === 400 || statusCode === 422) return "VALIDATION_FAILED";
  if (statusCode === 409) return "DUPLICATE_RESOURCE";
  if (statusCode >= 500) return "DESTINATION_UNAVAILABLE";
  // A 3xx here means the guard already refused to follow it (redirects are
  // never auto-followed) — we genuinely don't know what it would have led
  // to, so this is ambiguous, not a clean failure.
  if (statusCode >= 300 && statusCode < 400) return "AMBIGUOUS_RESPONSE";
  return "UNKNOWN";
}

const NEVER_CONNECTED_CODES = new Set(["ENOTFOUND", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN"]);

/**
 * Classifies a network-level failure where NO response was ever received.
 * This is the one place the ambiguous-response boundary is actually
 * enforced: only errors that occur before any TCP connection is even
 * established (DNS failure, connection refused, host unreachable — Node's
 * own socket error codes) are provably safe to retry, because nothing could
 * possibly have reached the destination yet. Everything else — including
 * the SSRF guard's own request-timeout (which can fire after the request
 * body has already been fully sent, since Node's request timeout spans the
 * whole request/response cycle, not just connection setup) and any
 * mid-request reset — cannot prove the destination never received the
 * POST, so it is classified AMBIGUOUS_RESPONSE rather than assumed safe.
 */
export function classifyNetworkFailure(error: unknown): PublishingErrorType {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code && NEVER_CONNECTED_CODES.has(code)) {
    return "NETWORK_TIMEOUT";
  }
  return "AMBIGUOUS_RESPONSE";
}

/**
 * The single source of truth for "is this failure safe to retry automatically."
 * Currently only NETWORK_TIMEOUT — a failure classifyNetworkFailure has
 * already proven occurred before any TCP connection was established, so
 * nothing could possibly have reached the destination. Both the publishing
 * action layer (which enforces this before retrying) and the read-only
 * publication-state service (which uses this only to decide whether to
 * show a Retry affordance, never to act) import this same function rather
 * than each keeping their own copy of the retryable set.
 */
const RETRYABLE_ERROR_TYPES: ReadonlySet<PublishingErrorType> = new Set(["NETWORK_TIMEOUT"]);

export function isRetryableErrorType(errorType: PublishingErrorType): boolean {
  return RETRYABLE_ERROR_TYPES.has(errorType);
}
