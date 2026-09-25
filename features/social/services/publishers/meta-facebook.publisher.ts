import "server-only";

import { GRAPH_VERSION, graphFetch, graphPost, graphPostMultipart, type GraphResult } from "@/features/social/services/providers/meta-graph-client";
import type {
  PublishCommentInput,
  PublishCommentResult,
  PublishFailure,
  PublishInput,
  PublishMediaInput,
  PublishResult,
  PublishSuccess,
  SocialPublisher,
} from "@/features/social/services/social-publisher";
import { logger } from "@/lib/logger";

/**
 * Phase 10A (text) / Stage 2 (one image) — publishing to a connected
 * Facebook Page.
 *
 * EVERY ENDPOINT AND FIELD BELOW WAS VERIFIED AGAINST META'S CURRENT
 * DOCUMENTATION — the Page node's `feed` edge, the Page node's `photos` edge,
 * and the `permalink_url` field, all re-checked for Stage 2. Nothing here is
 * from memory or a tutorial.
 *
 * TWO REQUESTS, NEVER MORE. A text-only post is `POST /{page-id}/feed`; a
 * post with one image is `POST /{page-id}/photos` with the image uploaded as
 * `source` (a real `multipart/form-data` part, not a URL Meta is asked to
 * fetch — this app's own file-serving route requires a session, so there is
 * no public URL to give it anyway). Either way, a documented follow-up
 * `GET .../{post-id}?fields=permalink_url` gets the real permalink. This file
 * does not discover Pages, does not exchange tokens, does not touch
 * SocialAccount or SocialAccountCredential — those stay in
 * meta-facebook.provider.ts and social-connection.service.ts.
 *
 * NO FABRICATED URL, EVER. Both `/feed` and `/photos` are documented as
 * returning only bare ids — no permalink in either response. externalUrl is
 * populated ONLY by the documented follow-up read; if that fails, externalUrl
 * is null rather than a URL this file constructed from a guessed pattern.
 *
 * PUBLISHED MEANS META CONFIRMED IT. A non-2xx response, a missing id, or a
 * failed permalink follow-up still counts as success for the POST ITSELF
 * (the post exists — losing the permalink is not the same as losing the
 * post), but this file never invents success where Meta returned none, and
 * never publishes a caption-only post while silently dropping an image the
 * caller asked to attach.
 */

function failure(code: string, message: string, logDetail?: string): { ok: false; failure: PublishFailure } {
  logger.warn("Facebook publish call failed", { detail: logDetail ?? message });
  return { ok: false, failure: { code, message, logDetail } };
}

/**
 * Turns Meta's own structured error fields into one honest, safe sentence —
 * never the raw provider message (it can echo request text back) and never
 * the access token.
 *
 * `type: "OAuthException"` is Meta's documented type for authorization-level
 * rejections — the app/user/token relationship itself, not the content of
 * the post. Labeling that as an "image" or "post" problem would be exactly
 * the invented reason this function must not produce, so it gets its own,
 * differently-worded message regardless of which edge (feed or photos)
 * rejected the call.
 *
 * Every other rejection falls back to the smallest true statement available:
 * the numeric code Meta returned, with no guess at what it means. A response
 * with no parseable code at all keeps the original generic wording — there is
 * nothing more specific to say honestly.
 */
function describeRejection(error: Extract<GraphResult, { ok: false }>, subject: "post" | "image" | "comment"): string {
  if (error.type === "OAuthException") {
    return `Facebook rejected this post due to an authorization problem with the connected account${
      typeof error.code === "number" ? ` (Meta error ${error.code})` : ""
    }. Reconnect the account from Social Accounts settings and try again.`;
  }
  if (typeof error.code === "number") {
    const subcode = typeof error.subcode === "number" ? `, subcode ${error.subcode}` : "";
    return `Facebook rejected the ${subject}. Meta error code: ${error.code}${subcode}.`;
  }
  if (subject === "image") return "Facebook did not accept this image. Try again.";
  if (subject === "comment") return "Facebook did not accept this comment. Try again.";
  return "Facebook did not accept this post. Try again.";
}

/** Shared by the text and photo paths alike — the one documented way to learn a post's real permalink. */
async function fetchPermalink(postId: string, accessToken: string): Promise<string | null> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${postId}`);
  url.searchParams.set("fields", "permalink_url");
  url.searchParams.set("access_token", accessToken);

  const permalink = await graphFetch(url.toString());
  if (!permalink.ok) {
    logger.warn("Facebook publish succeeded but the permalink could not be read", { detail: permalink.detail });
    return null;
  }
  const body = permalink.body as Record<string, unknown>;
  return typeof body.permalink_url === "string" && body.permalink_url.length > 0 ? body.permalink_url : null;
}

async function publishText(input: PublishInput): Promise<PublishResult> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${input.externalId}/feed`);
  url.searchParams.set("message", input.content);
  if (input.link) url.searchParams.set("link", input.link);
  url.searchParams.set("access_token", input.accessToken);

  const published = await graphPost(url.toString());
  if (!published.ok) {
    /* Meta's error bodies can echo request parameters (including, in principle, a truncated token) back — never surfaced, only logged. */
    return failure("PROVIDER_REJECTED", describeRejection(published, "post"), published.detail);
  }

  const body = published.body as Record<string, unknown>;
  const externalPostId = body.id;
  if (typeof externalPostId !== "string" || externalPostId.length === 0) {
    return failure("PROVIDER_REJECTED", "Facebook did not confirm the post was created.", "feed publish response had no id field");
  }

  const externalUrl = await fetchPermalink(externalPostId, input.accessToken);
  return { ok: true, result: { externalPostId, externalUrl } };
}

/**
 * Stage 2 — one image, via the Page's own `photos` edge.
 *
 * `caption`, not `message` — the Photos reference documents that field name
 * specifically; using `message` here would silently post the image with no
 * text at all, which is exactly the "half-published" outcome this feature
 * must never produce.
 *
 * `/photos` has no `link` parameter (unlike `/feed`), so a link supplied
 * alongside an image is appended to the caption as plain text rather than
 * silently dropped — Facebook auto-links a URL written in a caption.
 */
async function publishPhoto(input: PublishInput, media: PublishMediaInput): Promise<PublishResult> {
  const caption = input.link ? `${input.content}\n\n${input.link}` : input.content;

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${input.externalId}/photos`);
  url.searchParams.set("caption", caption);
  url.searchParams.set("access_token", input.accessToken);

  const form = new FormData();
  form.set("source", new Blob([new Uint8Array(media.buffer)], { type: media.mimeType }), media.fileName);

  const published = await graphPostMultipart(url.toString(), form);
  if (!published.ok) {
    return failure("PROVIDER_REJECTED", describeRejection(published, "image"), published.detail);
  }

  const body = published.body as Record<string, unknown>;
  /* The Photos reference documents post_id as the id of the actual Page post — the photo's own `id` is a different node. */
  const externalPostId = body.post_id;
  if (typeof externalPostId !== "string" || externalPostId.length === 0) {
    return failure("PROVIDER_REJECTED", "Facebook did not confirm the photo was posted.", "photos publish response had no post_id field");
  }

  const externalUrl = await fetchPermalink(externalPostId, input.accessToken);
  return { ok: true, result: { externalPostId, externalUrl } satisfies PublishSuccess };
}

/**
 * First Comment — `POST /{page-post-id}/comments`, verified against Meta's
 * current Graph API reference for the object's `comments` edge.
 *
 * REQUIRES the real post id the main publish call already returned — this is
 * never invoked with anything else, so there is no separate "does this post
 * exist" check to perform here; the caller (`social-publish.actions.ts`) only
 * calls this once the main post is confirmed PUBLISHED.
 *
 * `pages_manage_engagement` is the documented permission for this specific
 * create operation (an alternative to a Page token from a MODERATE-task
 * holder) — `pages_read_user_content` is NOT required for POSTING a comment;
 * that permission covers READING/moderating comments other users wrote, a
 * different capability this feature never uses.
 */
async function publishComment(input: PublishCommentInput): Promise<PublishCommentResult> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${input.externalPostId}/comments`);
  url.searchParams.set("message", input.comment);
  url.searchParams.set("access_token", input.accessToken);

  const published = await graphPost(url.toString());
  if (!published.ok) {
    return failure("PROVIDER_REJECTED", describeRejection(published, "comment"), published.detail);
  }

  const body = published.body as Record<string, unknown>;
  const externalCommentId = body.id;
  if (typeof externalCommentId !== "string" || externalCommentId.length === 0) {
    return failure("PROVIDER_REJECTED", "Facebook did not confirm the comment was created.", "comments publish response had no id field");
  }

  return { ok: true, result: { externalCommentId } };
}

export const metaFacebookPublisher: SocialPublisher = {
  platform: "FACEBOOK",

  async publish(input: PublishInput): Promise<PublishResult> {
    if (input.media.length === 0) {
      return publishText(input);
    }
    if (input.media.length > 1) {
      return failure("MEDIA_NOT_SUPPORTED", "Only one image can be published to Facebook right now — remove the extra media first.");
    }

    const media = input.media[0];
    if (media.kind === "VIDEO") {
      return failure("MEDIA_NOT_SUPPORTED", "Video is not implemented yet for Facebook — remove it, or publish text only.");
    }

    return publishPhoto(input, media);
  },

  publishComment,
};
