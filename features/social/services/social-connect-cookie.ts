/**
 * Phase 9 — the name and lifetime of the page-selection cookie, in one place.
 *
 * The callback route sets it and the selection page reads it, so it lives
 * here rather than being exported from a `route.ts` (Next validates what a
 * route module may export) or written as a literal in two files that could
 * drift apart.
 *
 * WHAT THE COOKIE HOLDS: a single-use, short-lived token identifying one
 * in-flight authorization on the server. NOT a credential — the provider's
 * authorization stays encrypted in the database and never reaches a browser.
 * It is httpOnly so script cannot read it, and a cookie rather than a query
 * parameter so it stays out of URLs, history and referrer headers.
 */
export const SOCIAL_CONNECT_SELECTION_COOKIE = "cc_social_connect";

/** Matches the selection window on the server; a stale cookie is refused anyway. */
export const SOCIAL_CONNECT_SELECTION_MAX_AGE_SECONDS = 5 * 60;
