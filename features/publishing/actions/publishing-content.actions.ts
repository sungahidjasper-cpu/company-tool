"use server";

import { z } from "zod";

import { actionError, actionSuccess, type ActionResult } from "@/lib/action-result";
import { logActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth";
import { Permissions } from "@/lib/authorization";
import { decryptCredentialPayload } from "@/lib/crypto/publishing-credential-crypto";
import { prisma } from "@/lib/prisma";
import { publishContentToWordPress } from "@/features/publishing/services/wordpress-publish.service";
import { isRetryableErrorType } from "@/features/publishing/services/publishing-errors";
import { isContentStatusPublishable } from "@/features/publishing/services/content-publication-state.service";

/**
 * Phase 24 Stage 2C — the publishing action layer. Owns everything
 * wordpress-publish.service.ts (Stage 2B) deliberately does not:
 * authorization, tenant ownership, Content/connection eligibility,
 * idempotency, and PublishingJob/PublishingAttempt/ContentPublication
 * persistence. This file has no UI consumer yet (Stage 2D) — it exists to
 * be called by one, later.
 *
 * publishContentAction is the FIRST-attempt path only: once any
 * PublishingJob row exists for a (contentId, connectionId) pair —
 * SUCCEEDED, FAILED, or in-flight — every subsequent attempt must go
 * through retryPublishAction, which has its own, stricter re-validation
 * and retryability gate. This keeps "first attempt" and "explicit retry"
 * as two clearly separate, independently auditable code paths rather than
 * one function with implicit retry-or-not branching.
 */

const publishInputSchema = z.object({
  contentId: z.string().min(1),
  connectionId: z.string().min(1),
});

type PublishInput = z.infer<typeof publishInputSchema>;

export type PublicationSummary = {
  externalId: string;
  externalUrl: string | null;
  publishedAt: Date;
  alreadyPublished: boolean;
};

async function getPublishableContent(contentId: string, companyId: string) {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { seoProject: { select: { companyId: true } } },
  });
  if (!content || content.seoProject.companyId !== companyId) return null;
  return content;
}

function checkContentEligibility(content: Awaited<ReturnType<typeof getPublishableContent>>): string | null {
  if (!content) return "Content not found.";
  if (content.deletedAt) return "This content has been archived and cannot be published.";
  if (!content.body || content.body.trim().length === 0) return "This content has no article body to publish.";
  if (!isContentStatusPublishable(content.status)) {
    return "This content must be approved before it can be published.";
  }
  return null;
}

async function getEligibleConnection(connectionId: string, companyId: string) {
  const connection = await prisma.publishingConnection.findUnique({
    where: { id: connectionId },
    include: { credential: true },
  });
  if (!connection || connection.companyId !== companyId) return null;
  return connection;
}

function checkConnectionEligibility(connection: Awaited<ReturnType<typeof getEligibleConnection>>): string | null {
  if (!connection) return "Publishing connection not found.";
  if (connection.providerType !== "WORDPRESS") return "This destination type is not supported.";
  if (connection.status !== "ACTIVE") return "This connection is not active.";
  if (!connection.credential) return "This connection has no stored credential.";
  return null;
}

/** Defensive, belt-and-suspenders only — wordpress-publish.service.ts's messages are always static per-type strings and never interpolate raw request/response/credential data, so this should never actually trigger. */
function sanitizeErrorMessage(message: string): string {
  return message.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]").slice(0, 500);
}

async function nextAttemptNumber(jobId: string): Promise<number> {
  const count = await prisma.publishingAttempt.count({ where: { jobId } });
  return count + 1;
}

type ContentRow = NonNullable<Awaited<ReturnType<typeof getPublishableContent>>>;
type ConnectionRow = NonNullable<Awaited<ReturnType<typeof getEligibleConnection>>>;

/**
 * Runs one external publish attempt for an already-validated job, records
 * the attempt, and finalizes the job. Shared by both publishContentAction
 * and retryPublishAction — the only difference between "first attempt" and
 * "retry" is which pre-flight created/selected the job, not how the
 * attempt itself executes.
 *
 * For a first attempt, the job was just created PENDING inside the locked
 * pre-flight transaction (row creation is itself the atomic claim), so the
 * PENDING → RUNNING transition happens here, after the lock is released.
 * For a retry, the FAILED → RUNNING transition is instead performed
 * atomically inside retryPublishAction's own locked pre-flight transaction
 * — the same transaction that verifies the job is FAILED with a retryable
 * errorType — so that a second, concurrent retry attempt for the same job
 * can never observe FAILED after the first has already claimed it. This
 * function must not perform a second, competing FAILED → RUNNING update
 * for that case.
 */
async function executeAttempt(
  actor: { id: string; companyId: string },
  jobId: string,
  content: ContentRow,
  connection: ConnectionRow,
  isRetry: boolean
): Promise<ActionResult<PublicationSummary>> {
  if (!isRetry) {
    await prisma.publishingJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });
  }
  const attemptNumber = await nextAttemptNumber(jobId);

  // Decrypted only here, immediately before the outbound call — never
  // earlier, never persisted, never logged.
  const decryptedPayload = decryptCredentialPayload(
    connection.credential!.encryptedPayload,
    connection.credential!.encryptionKeyVersion
  );
  const credential = JSON.parse(decryptedPayload) as { username: string; applicationPassword: string };

  const startedAt = new Date();
  const result = await publishContentToWordPress(
    connection.baseUrl,
    credential,
    { title: content.title, bodyMarkdown: content.body ?? "" },
    "publish"
  );
  const finishedAt = new Date();

  if (result.ok) {
    const publication = await prisma.$transaction(async (tx) => {
      await tx.publishingAttempt.create({
        data: { jobId, attemptNumber, outcome: "SUCCESS", httpStatus: 201, startedAt, finishedAt },
      });
      await tx.publishingJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", errorType: null, errorMessage: null } });
      return tx.contentPublication.create({
        data: {
          companyId: actor.companyId,
          contentId: content.id,
          connectionId: connection.id,
          externalId: result.externalId,
          externalUrl: result.externalUrl,
        },
      });
    });

    await logActivity({
      actorId: actor.id,
      companyId: actor.companyId,
      contentId: content.id,
      action: isRetry ? "content_publication.retry_succeeded" : "content_publication.succeeded",
      metadata: {
        connectionId: connection.id,
        externalId: publication.externalId,
        externalUrl: publication.externalUrl,
        publishingJobId: jobId,
        attemptNumber,
      },
    });

    return actionSuccess({
      externalId: publication.externalId,
      externalUrl: publication.externalUrl,
      publishedAt: publication.publishedAt,
      alreadyPublished: false,
    });
  }

  const sanitizedMessage = sanitizeErrorMessage(result.message);
  await prisma.$transaction([
    prisma.publishingAttempt.create({
      data: {
        jobId,
        attemptNumber,
        outcome: "FAILURE",
        errorType: result.errorType,
        errorMessage: sanitizedMessage,
        startedAt,
        finishedAt,
      },
    }),
    prisma.publishingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorType: result.errorType, errorMessage: sanitizedMessage },
    }),
  ]);

  const isAmbiguous = result.errorType === "AMBIGUOUS_RESPONSE";
  await logActivity({
    actorId: actor.id,
    companyId: actor.companyId,
    contentId: content.id,
    action: isAmbiguous
      ? isRetry
        ? "content_publication.retry_ambiguous"
        : "content_publication.ambiguous"
      : isRetry
        ? "content_publication.retry_failed"
        : "content_publication.failed",
    metadata: { connectionId: connection.id, publishingJobId: jobId, attemptNumber, errorType: result.errorType },
  });

  // No ContentPublication is ever created here — including for
  // AMBIGUOUS_RESPONSE. WordPress may or may not have actually created the
  // post; this app cannot confirm it, so it must not record a publication
  // it cannot verify.
  return actionError(sanitizedMessage);
}

/**
 * First-attempt publish. Rejects if ANY PublishingJob already exists for
 * this (contentId, connectionId) pair — including a prior FAILED one; use
 * retryPublishAction for every subsequent attempt.
 */
export async function publishContentAction(input: PublishInput): Promise<ActionResult<PublicationSummary>> {
  const actor = await requireUser();
  if (!Permissions.managePublishingConnections(actor.role)) {
    return actionError("You do not have permission to publish content.");
  }

  const parsed = publishInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { contentId, connectionId } = parsed.data;

  const content = await getPublishableContent(contentId, actor.companyId);
  const contentError = checkContentEligibility(content);
  if (contentError) return actionError(contentError);

  const connection = await getEligibleConnection(connectionId, actor.companyId);
  const connectionError = checkConnectionEligibility(connection);
  if (connectionError) return actionError(connectionError);

  // TypeScript narrowing only — both checks above already guarantee non-null.
  if (!content || !connection) return actionError("Content not found.");

  // Third leg of the mandatory 3-part ownership check: Content's company
  // and the connection's company must be the SAME company, not merely each
  // independently equal to the actor's company (which the two lookups
  // above already enforce).
  if (content.seoProject.companyId !== connection.companyId) {
    return actionError("This content and connection do not belong to the same company.");
  }

  // Idempotency + concurrency: a SELECT ... FOR UPDATE row lock on the
  // Content row — the same idiom lib/jobs/job-table.ts already uses for
  // WebsiteAnalysisJob's claim query — fully serializes concurrent publish
  // requests for this Content row within this database, using only
  // existing Postgres/Prisma capabilities. It does NOT and cannot prevent
  // the separate, irreducible external-ambiguity race: if WordPress itself
  // already received and processed a POST but this app's response was
  // lost, no lock in this database can undo or detect that after the
  // fact — that risk is instead handled by never auto-retrying an
  // AMBIGUOUS_RESPONSE outcome (see below and publishing-errors.ts).
  const preflight = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${contentId} FOR UPDATE`;

    const existingPublication = await tx.contentPublication.findUnique({
      where: { contentId_connectionId: { contentId, connectionId } },
    });
    if (existingPublication) {
      return { kind: "already_published" as const, publication: existingPublication };
    }

    const existingJob = await tx.publishingJob.findFirst({
      where: { contentId, connectionId },
    });
    if (existingJob) {
      return { kind: "already_attempted" as const };
    }

    const job = await tx.publishingJob.create({
      data: { companyId: actor.companyId, contentId, connectionId, requestedById: actor.id, status: "PENDING" },
    });
    return { kind: "created" as const, jobId: job.id };
  });

  if (preflight.kind === "already_published") {
    const p = preflight.publication;
    return actionSuccess({ externalId: p.externalId, externalUrl: p.externalUrl, publishedAt: p.publishedAt, alreadyPublished: true });
  }
  if (preflight.kind === "already_attempted") {
    return actionError("A publish attempt already exists for this content and connection. Use retry instead.");
  }

  return executeAttempt(actor, preflight.jobId, content, connection, false);
}

/**
 * Explicit retry of a previously FAILED job. Re-validates authorization,
 * ownership, and eligibility from scratch — nothing about the original
 * attempt's validity is assumed to still hold. Only proceeds if the
 * existing job's classified errorType is one Stage 2B has proven safe to
 * retry (currently: NETWORK_TIMEOUT only — a pre-connection failure where
 * nothing could have reached the destination). AMBIGUOUS_RESPONSE,
 * DUPLICATE_RESOURCE, and every received 4xx/5xx are never retried
 * automatically here, by design.
 */
export async function retryPublishAction(input: PublishInput): Promise<ActionResult<PublicationSummary>> {
  const actor = await requireUser();
  if (!Permissions.managePublishingConnections(actor.role)) {
    return actionError("You do not have permission to publish content.");
  }

  const parsed = publishInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { contentId, connectionId } = parsed.data;

  const content = await getPublishableContent(contentId, actor.companyId);
  const contentError = checkContentEligibility(content);
  if (contentError) return actionError(contentError);

  const connection = await getEligibleConnection(connectionId, actor.companyId);
  const connectionError = checkConnectionEligibility(connection);
  if (connectionError) return actionError(connectionError);

  if (!content || !connection) return actionError("Content not found.");

  if (content.seoProject.companyId !== connection.companyId) {
    return actionError("This content and connection do not belong to the same company.");
  }

  const preflight = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${contentId} FOR UPDATE`;

    const existingPublication = await tx.contentPublication.findUnique({
      where: { contentId_connectionId: { contentId, connectionId } },
    });
    if (existingPublication) {
      return { kind: "already_published" as const, publication: existingPublication };
    }

    const existingJob = await tx.publishingJob.findFirst({ where: { contentId, connectionId } });
    if (!existingJob) {
      return { kind: "no_job" as const };
    }
    if (existingJob.status === "PENDING" || existingJob.status === "RUNNING") {
      return { kind: "in_progress" as const };
    }
    // SUCCEEDED with no ContentPublication row would be an inconsistent
    // state this schema should never reach — treated as not-retryable
    // rather than silently proceeding.
    if (existingJob.status === "SUCCEEDED" || !existingJob.errorType || !isRetryableErrorType(existingJob.errorType)) {
      return { kind: "not_retryable" as const, errorType: existingJob.errorType };
    }

    // Atomic claim: transition FAILED → RUNNING while the Content row lock
    // is still held, in the same transaction that just verified the job is
    // retryable. A second, concurrent retry request for this same job will
    // block on the lock above until this transaction commits, then observe
    // status: "RUNNING" (not "FAILED") and correctly fall into the
    // in_progress branch instead of also claiming it — closing the race
    // the prior audit found.
    await tx.publishingJob.update({ where: { id: existingJob.id }, data: { status: "RUNNING" } });

    return { kind: "retry" as const, jobId: existingJob.id };
  });

  switch (preflight.kind) {
    case "already_published": {
      const p = preflight.publication;
      return actionSuccess({ externalId: p.externalId, externalUrl: p.externalUrl, publishedAt: p.publishedAt, alreadyPublished: true });
    }
    case "no_job":
      return actionError("No publish attempt exists for this content and connection yet. Publish it first.");
    case "in_progress":
      return actionError("A publish request for this content and connection is already in progress.");
    case "not_retryable":
      return actionError("This publish failure cannot be retried automatically. Its outcome could not be confirmed as safe to repeat.");
    case "retry":
      return executeAttempt(actor, preflight.jobId, content, connection, true);
  }
}
