import { z } from "zod";

/**
 * Phase 10A — publishing one already-saved social post target for real.
 *
 * ONE FIELD, ON PURPOSE. Everything else this action needs — the caption, the
 * link, which account, which platform, which company and client it belongs to
 * — is read server-side from the SocialPostTarget row itself. A browser can
 * only say WHICH target to publish; it cannot supply what gets published or
 * where, so there is nothing here for a manipulated request to override.
 */
export const publishSocialPostTargetSchema = z.object({
  socialPostTargetId: z.string().min(1),
});

export type PublishSocialPostTargetInput = z.input<typeof publishSocialPostTargetSchema>;

/**
 * First Comment's own outcome — deliberately separate from the post's
 * PublishOutcome below, because it is a separate operation with a separate
 * lifecycle. `NOT_ATTEMPTED` covers exactly one case: a first comment was
 * requested but the main post itself failed, so Meta was never asked about
 * the comment at all — this is never used when no comment was requested in
 * the first place (see `comment?` on PublishOutcome, which is simply absent
 * then).
 */
export type CommentOutcome =
  | { status: "PUBLISHED"; externalCommentId: string }
  | { status: "FAILED"; failureCode: string; failureMessage: string }
  | { status: "NOT_ATTEMPTED" };

/**
 * What publishing actually produced. Both top-level branches are a
 * SUCCESSFUL call to this action — the request was valid and a real publish
 * attempt was made — `FAILED` just means the provider itself declined it.
 * Never conflate this with `ActionResult.success = false`, which means the
 * request was refused before any provider was ever contacted.
 *
 * `comment` is present ONLY when a first comment was actually requested for
 * this target — omitted entirely (not merely null) when none was, so "no
 * comment was intended" and "a comment was intended but not attempted" can
 * never be confused.
 */
export type PublishOutcome =
  | { status: "PUBLISHED"; externalPostId: string; externalUrl: string | null; comment?: CommentOutcome }
  | { status: "FAILED"; failureCode: string; failureMessage: string; comment?: CommentOutcome };
