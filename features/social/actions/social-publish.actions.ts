"use server";

import { revalidatePath } from "next/cache";

import { CLEARED_SCHEDULE } from "@/features/content-workspace/services/content-scheduling";
import { contentRevalidatePaths } from "@/features/content-workspace/services/content-location";
import { isImageMimeType, isVideoMimeType } from "@/features/files/schemas/file.schema";
import { publishSocialPostTargetSchema, type CommentOutcome, type PublishOutcome, type PublishSocialPostTargetInput } from "@/features/social/schemas/social-publish.schema";
import { effectiveCaption, effectiveFirstComment, effectiveLink } from "@/features/social/services/social-composer";
import { readAccessToken } from "@/features/social/services/social-credential.service";
import { socialPublisherFor } from "@/features/social/services/social-publisher-registry";
import { isPublishablePlatform, type PublishMediaInput, type SocialPublisher } from "@/features/social/services/social-publisher";
import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { isUuid } from "@/lib/utils";

/**
 * Phase 10A — actually publishing one target to its real platform.
 *
 * THIS IS THE ONLY PATH IN THE APP THAT CONTACTS A PROVIDER. Saving a draft or
 * a schedule (social-post.actions.ts) never has and still does not; it only
 * ever requires `status: "ACTIVE"`. This action is the one place that requires
 * `connectionState === "CONNECTED"`, because it is the one place that is about
 * to hand a real access token to a real platform.
 *
 * OWNERSHIP IS RE-DERIVED, NEVER TRUSTED. The only input is a target id. Every
 * fact used to publish — company, client, platform, account, caption, link,
 * the credential itself — is read back from that target's own row chain, so a
 * request cannot smuggle in a different company's account or a different
 * message than what is actually stored.
 */

async function getOwnedTarget(socialPostTargetId: string, companyId: string) {
  if (!isUuid(socialPostTargetId)) return null;

  const target = await prisma.socialPostTarget.findUnique({
    where: { id: socialPostTargetId },
    select: {
      id: true,
      caption: true,
      link: true,
      firstComment: true,
      socialPost: {
        select: {
          caption: true,
          link: true,
          firstComment: true,
          content: { select: { id: true, companyId: true, clientId: true, deletedAt: true } },
        },
      },
      socialAccount: {
        select: {
          id: true,
          companyId: true,
          clientId: true,
          platform: true,
          externalId: true,
          status: true,
          connectionState: true,
          deletedAt: true,
          displayName: true,
          handle: true,
        },
      },
    },
  });
  if (!target) return null;

  const content = target.socialPost.content;
  const account = target.socialAccount;

  // Every leg of the chain must agree on company AND client, or this is not this actor's target to publish.
  if (content.companyId !== companyId || account.companyId !== companyId) return null;
  if (content.clientId !== account.clientId) return null;

  return { target, content, account };
}

/**
 * First Comment — attempted ONLY after the main post is confirmed PUBLISHED,
 * and ONLY when there is real text to post. Never called for a failed main
 * publish; the caller handles that case as NOT_ATTEMPTED without reaching
 * here at all.
 *
 * IDEMPOTENT BY CONSTRUCTION. `SocialComment` is `@unique` on
 * `socialPostTargetId` — a row already PUBLISHED with a real
 * `externalCommentId` is reused as-is, with no second call to Meta, so a
 * retried Publish Now click (or a refresh, or any other repeat) can never
 * create a duplicate comment. This mirrors the exact discipline
 * `SocialPublication` already uses for the post itself.
 */
async function attemptFirstComment(input: {
  socialPostTargetId: string;
  publisher: SocialPublisher;
  accessToken: string;
  externalPostId: string;
  comment: string;
}): Promise<CommentOutcome> {
  const existingComment = await prisma.socialComment.findUnique({
    where: { socialPostTargetId: input.socialPostTargetId },
    select: { status: true, externalCommentId: true },
  });
  if (existingComment?.status === "PUBLISHED" && existingComment.externalCommentId) {
    return { status: "PUBLISHED", externalCommentId: existingComment.externalCommentId };
  }

  if (!input.publisher.publishComment) {
    const failureMessage = "First comment publishing isn't implemented yet for this platform.";
    await prisma.socialComment.upsert({
      where: { socialPostTargetId: input.socialPostTargetId },
      create: { socialPostTargetId: input.socialPostTargetId, status: "FAILED", failureCode: "NOT_IMPLEMENTED", failureMessage },
      update: { status: "FAILED", failureCode: "NOT_IMPLEMENTED", failureMessage, externalCommentId: null, publishedAt: null },
    });
    return { status: "FAILED", failureCode: "NOT_IMPLEMENTED", failureMessage };
  }

  // A queued/in-flight marker, same pattern as the main SocialPublication upsert below.
  await prisma.socialComment.upsert({
    where: { socialPostTargetId: input.socialPostTargetId },
    create: { socialPostTargetId: input.socialPostTargetId, status: "PUBLISHING" },
    update: { status: "PUBLISHING", failureCode: null, failureMessage: null },
  });

  const result = await input.publisher.publishComment({
    accessToken: input.accessToken,
    externalPostId: input.externalPostId,
    comment: input.comment,
  });

  if (result.ok) {
    await prisma.socialComment.update({
      where: { socialPostTargetId: input.socialPostTargetId },
      data: {
        status: "PUBLISHED",
        externalCommentId: result.result.externalCommentId,
        publishedAt: new Date(),
        failureCode: null,
        failureMessage: null,
      },
    });
    return { status: "PUBLISHED", externalCommentId: result.result.externalCommentId };
  }

  await prisma.socialComment.update({
    where: { socialPostTargetId: input.socialPostTargetId },
    data: {
      status: "FAILED",
      failureCode: result.failure.code,
      failureMessage: result.failure.message,
      externalCommentId: null,
      publishedAt: null,
    },
  });
  /* Meta's real error is kept server-side for diagnostics; the failure message returned here is already the safe, user-facing one. */
  logger.warn("Facebook first-comment publish failed", { detail: result.failure.logDetail ?? result.failure.message });
  return { status: "FAILED", failureCode: result.failure.code, failureMessage: result.failure.message };
}

export async function publishSocialPostTargetAction(
  input: PublishSocialPostTargetInput
): Promise<ActionResult<PublishOutcome>> {
  const actor = await requireUser();
  if (!Permissions.manageSeoProjects(actor.role)) {
    return actionError("You do not have permission to publish social posts.");
  }

  const parsed = publishSocialPostTargetSchema.safeParse(input);
  if (!parsed.success) return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");

  const owned = await getOwnedTarget(parsed.data.socialPostTargetId, actor.companyId);
  if (!owned) return actionError("Social post target not found.");
  const { target, content, account } = owned;

  if (content.deletedAt !== null) return actionError("This content is in the trash. Restore it before publishing.");
  if (account.deletedAt !== null) return actionError("This social account no longer exists.");
  if (account.status !== "ACTIVE") return actionError("This social account is not available for publishing.");

  /*
   * THE ONE HARD GATE THIS ACTION ADDS. connectionState is a fact about the
   * outside world, not a setting — it is only ever CONNECTED when a real
   * OAuth authorization exists (Phase 9B) and this app has not since been
   * told, by the provider itself, that it stopped working.
   */
  if (account.connectionState !== "CONNECTED" || !account.externalId) {
    return actionError("This account is not connected. Connect it from the client's Social Accounts settings before publishing.");
  }

  if (!isPublishablePlatform(account.platform)) {
    return actionError("Publishing is not implemented yet for this platform.");
  }
  const publisher = socialPublisherFor(account.platform);
  if (!publisher) return actionError("Publishing is not implemented yet for this platform.");

  const accessToken = await readAccessToken(account.id, actor.companyId);
  if (!accessToken) {
    return actionError("This account's authorization could not be read. Reconnect it before publishing.");
  }

  const caption = effectiveCaption(target.socialPost.caption, target).trim();
  const link = effectiveLink(target.socialPost.link ?? "", target).trim();
  if (caption.length === 0) return actionError("This post has no content to publish.");
  /*
   * Resolved BEFORE the post is published, regardless of what happens next —
   * this is what lets a failed main post correctly report the comment as
   * NOT_ATTEMPTED (it was intended, Meta was simply never asked) rather than
   * silently omitted, which would look identical to no comment ever having
   * been written at all.
   */
  const firstComment = effectiveFirstComment(target.socialPost.firstComment, target);

  /*
   * Stage 2 — media is resolved ENTIRELY server-side, from the post's own
   * Content row. There is no File id anywhere in this action's input; a
   * browser cannot name a file to publish, let alone another company's or
   * client's — whatever is actually attached to this already-ownership-
   * checked Content row is the only thing that can ever be sent.
   *
   * Never a silent partial publish: an attached video, or more than one
   * image, is refused outright here — before anything is marked PUBLISHING —
   * rather than quietly publishing the caption alone and pretending the
   * attachment went with it.
   */
  const attachedFiles = await prisma.file.findMany({
    where: { contentId: content.id, deletedAt: null },
    select: { id: true, url: true, mimeType: true, fileName: true },
    orderBy: { createdAt: "asc" },
  });
  if (attachedFiles.some((file) => isVideoMimeType(file.mimeType))) {
    return actionError("This post has a video attached. Video publishing isn't implemented yet — remove it before publishing to Facebook.");
  }
  const images = attachedFiles.filter((file) => isImageMimeType(file.mimeType));
  if (images.length > 1) {
    return actionError("This post has more than one image. Only a single image can be published to Facebook right now — remove the extra images.");
  }

  const media: PublishMediaInput[] = [];
  if (images.length === 1) {
    const image = images[0];
    let buffer: Buffer;
    try {
      buffer = await storage.read(image.url);
    } catch (error) {
      logger.error("Could not read attached image from storage before publishing", {
        detail: error instanceof Error ? error.message : "unknown",
      });
      return actionError("The attached image could not be read. Try removing and re-adding it.");
    }
    media.push({ kind: "IMAGE", buffer, mimeType: image.mimeType, fileName: image.fileName });
  }

  // A queued/in-flight marker so a concurrent second click reads as already in progress rather than silence.
  await prisma.socialPublication.upsert({
    where: { socialPostTargetId: target.id },
    create: { socialPostTargetId: target.id, status: "PUBLISHING" },
    update: { status: "PUBLISHING", failureCode: null, failureMessage: null },
  });

  const result = await publisher.publish({
    accessToken,
    externalId: account.externalId,
    content: caption,
    link: link.length > 0 ? link : null,
    media,
  });

  let outcome: PublishOutcome;
  if (result.ok) {
    await prisma.socialPublication.update({
      where: { socialPostTargetId: target.id },
      data: {
        status: "PUBLISHED",
        externalPostId: result.result.externalPostId,
        externalUrl: result.result.externalUrl,
        publishedAt: new Date(),
        failureCode: null,
        failureMessage: null,
      },
    });
    /*
     * A real, successful external publish has just happened — a
     * Cloud-Compass-only SCHEDULED status left in place after that would be
     * false: the post is not "still waiting," it already went out. This
     * mirrors the exact status/publishedAt pair the SEO content publish path
     * already uses, and clears the schedule fields together (same as
     * cancelling a schedule) so nothing is left claiming a schedule that no
     * longer applies. A post already DRAFT is moved the same way — Publish
     * Now is real publishing regardless of which button reached it.
     */
    await prisma.content.update({
      where: { id: content.id },
      data: { status: "PUBLISHED", publishedAt: new Date(), ...CLEARED_SCHEDULE },
    });
    outcome = { status: "PUBLISHED", externalPostId: result.result.externalPostId, externalUrl: result.result.externalUrl };

    /*
     * First Comment — a SEPARATE operation, only ever attempted once a real
     * post id exists. Empty text means none was requested; nothing is
     * created and `outcome.comment` stays absent, never a "not attempted"
     * placeholder for something nobody asked for.
     */
    if (firstComment.length > 0) {
      outcome.comment = await attemptFirstComment({
        socialPostTargetId: target.id,
        publisher,
        accessToken,
        externalPostId: result.result.externalPostId,
        comment: firstComment,
      });
    }
  } else {
    await prisma.socialPublication.update({
      where: { socialPostTargetId: target.id },
      data: {
        status: "FAILED",
        failureCode: result.failure.code,
        failureMessage: result.failure.message,
        externalPostId: null,
        externalUrl: null,
        publishedAt: null,
      },
    });
    outcome = { status: "FAILED", failureCode: result.failure.code, failureMessage: result.failure.message };
    /* The post never went out, so Meta was never asked about the comment — never silently omitted, never invented as attempted. */
    if (firstComment.length > 0) outcome.comment = { status: "NOT_ATTEMPTED" };
  }

  await logActivity({
    actorId: actor.id,
    action: outcome.status === "PUBLISHED" ? "content.social_post_published" : "content.social_post_publish_failed",
    companyId: actor.companyId,
    clientId: account.clientId,
    contentId: content.id,
    /* Public facts only: platform, account, and (on success) the provider's own public post id. Never the token. */
    metadata:
      outcome.status === "PUBLISHED"
        ? { platform: account.platform, accountId: account.id, externalPostId: outcome.externalPostId, commentStatus: outcome.comment?.status }
        : { platform: account.platform, accountId: account.id, failureCode: outcome.failureCode, commentStatus: outcome.comment?.status },
  });

  contentRevalidatePaths({ id: content.id, seoProjectId: null }).forEach((path) => revalidatePath(path));

  return actionSuccess(outcome);
}
