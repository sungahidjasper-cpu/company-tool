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
import { isHostWithinProjectDomain, isRecordablePublicUrl } from "@/features/publishing/services/publishing-domain.service";

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
  /**
   * Phase F.3 — true when this publication's verified URL differs from a URL
   * the Content already had. The existing value is always preserved; this
   * only reports that a person should look at it.
   */
  urlConflict: boolean;
};

async function getPublishableContent(contentId: string, companyId: string) {
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    // Phase F.3 — domain and deletedAt are additionally selected: the first
    // decides whether a destination may publish this project's content at
    // all, the second closes the soft-deleted-project gap below.
    include: { seoProject: { select: { companyId: true, domain: true, deletedAt: true } } },
  });
  if (!content || content.companyId !== companyId) return null;
  return content;
}

function checkContentEligibility(content: Awaited<ReturnType<typeof getPublishableContent>>): string | null {
  if (!content) return "Content not found.";
  if (content.deletedAt) return "This content has been archived and cannot be published.";
  // Phase F.3 — a trashed project is not a publishable project, the same rule
  // the connected AI tools already enforce.
  /*
   * Publishing is domain-scoped: the destination is checked against the SEO
   * project's own domain. Content with no project has no domain to check
   * against, so it is not publishable — refused in words rather than by
   * inventing a domain for it.
   */
  if (!content.seoProject) return "This content has no SEO project, so there is no website to publish it to. Move it into an SEO project first.";
  if (content.seoProject.deletedAt) return "This content's SEO project has been archived and cannot be published.";
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

/**
 * Phase F.3 — the fourth leg of destination eligibility: the connection must
 * publish to the project's OWN site.
 *
 * A PublishingConnection belongs to a Company, not to a project, so company
 * ownership alone allows a project's content to be published to any site the
 * company has connected. That was tolerable while nothing was recorded back
 * onto the Content; once a published URL becomes Content.url it would let one
 * project's link inventory fill with another domain's URLs. Fails closed when
 * either value cannot be reduced to a hostname.
 */
function checkDestinationDomain(content: ContentRow, connection: ConnectionRow): string | null {
  if (!content.seoProject || !isHostWithinProjectDomain(connection.baseUrl, content.seoProject.domain)) {
    return "This destination does not belong to this SEO project's website.";
  }
  return null;
}

/** What the Content.url write decided, for reporting after the transaction commits. */
type UrlOutcome = "populated" | "unchanged_match" | "conflict" | "not_recordable";

/**
 * Decides and applies the Content.url write, INSIDE the caller's transaction
 * and under a fresh `SELECT ... FOR UPDATE` on the Content row.
 *
 * The re-lock matters: the pre-flight lock is released when its own
 * transaction commits, so two publishes to two different connections for the
 * same Content could otherwise both read a null url and both write. Reading
 * the current url under the lock, in the same transaction that persists the
 * publication, makes the decision serialized and atomic with it.
 *
 * Never overwrites an existing, different URL — a live indexed URL is not
 * something an automated process should replace silently.
 */
async function associateVerifiedUrl(
  tx: Pick<typeof prisma, "$queryRaw" | "content">,
  content: ContentRow,
  verifiedUrl: string | null
): Promise<UrlOutcome> {
  if (!content.seoProject || !isRecordablePublicUrl(verifiedUrl, content.seoProject.domain)) {
    return "not_recordable";
  }
  const url = (verifiedUrl as string).trim();

  await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${content.id} FOR UPDATE`;
  const current = await tx.content.findUnique({ where: { id: content.id }, select: { url: true } });
  const existing = current?.url?.trim() ?? "";

  if (existing === "") {
    await tx.content.update({ where: { id: content.id }, data: { url } });
    return "populated";
  }
  if (existing === url) return "unchanged_match";
  return "conflict";
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
    // The WordPress POST already succeeded at this point — if persisting
    // that fact fails, we must NOT retry the persistence or the POST (the
    // external post may already exist), and we must NOT let the exception
    // escape uncaught. The job is left exactly as it was (RUNNING) so the
    // existing Stage 3 startup reaper resolves it to FAILED/
    // AMBIGUOUS_RESPONSE on the next restart, the same safe, non-retryable
    // outcome as any other unconfirmed external result.
    let persisted;
    try {
      persisted = await prisma.$transaction(async (tx) => {
        await tx.publishingAttempt.create({
          data: { jobId, attemptNumber, outcome: "SUCCESS", httpStatus: 201, startedAt, finishedAt },
        });
        await tx.publishingJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", errorType: null, errorMessage: null } });
        const created = await tx.contentPublication.create({
          data: {
            companyId: actor.companyId,
            contentId: content.id,
            connectionId: connection.id,
            externalId: result.externalId,
            externalUrl: result.externalUrl,
          },
        });

        // Phase F.3 — only now, with the publication persisted in this same
        // transaction, may the verified URL be associated with the Content.
        // A URL that fails validation leaves Content.url untouched; the
        // publication itself still stands, because it really did happen.
        const urlOutcome = await associateVerifiedUrl(tx, content, result.externalUrl);
        return { publication: created, urlOutcome };
      });
    } catch (err) {
      console.error("Publishing: failed to persist a confirmed successful WordPress publish", {
        jobId,
        connectionId: connection.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return actionError(
        "The content was published, but Compass could not record the result. This will be reviewed automatically."
      );
    }

    const { publication, urlOutcome } = persisted;

    // Best-effort only — Activity is an audit trail, not the source of
    // truth for the publish result. A failure here must never change what
    // was already correctly determined and durably persisted above.
    try {
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
    } catch (err) {
      console.error("Publishing: failed to record the activity log for a successful publish", {
        jobId,
        connectionId: connection.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Phase F.3 — a URL conflict is reported, never resolved automatically.
    // Best-effort like the activity log above: the publication and the
    // preserved URL are already durably correct either way.
    if (urlOutcome === "conflict") {
      try {
        await logActivity({
          actorId: actor.id,
          companyId: actor.companyId,
          contentId: content.id,
          action: "content_publication.url_conflict",
          metadata: {
            connectionId: connection.id,
            publishingJobId: jobId,
            existingContentUrl: content.url,
            publishedUrl: publication.externalUrl,
          },
        });
      } catch (err) {
        console.error("Publishing: failed to record the activity log for a Content URL conflict", {
          jobId,
          connectionId: connection.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return actionSuccess({
      externalId: publication.externalId,
      externalUrl: publication.externalUrl,
      publishedAt: publication.publishedAt,
      alreadyPublished: false,
      urlConflict: urlOutcome === "conflict",
    });
  }

  const sanitizedMessage = sanitizeErrorMessage(result.message);
  try {
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
  } catch (err) {
    // No external resource was created on this path (the WordPress call
    // itself failed/was ambiguous), so the only consequence of a
    // persistence failure here is a delayed record — again safely resolved
    // by the Stage 3 reaper rather than by any retry from this function.
    console.error("Publishing: failed to persist a failed publish attempt", {
      jobId,
      connectionId: connection.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return actionError(sanitizedMessage);
  }

  const isAmbiguous = result.errorType === "AMBIGUOUS_RESPONSE";
  try {
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
  } catch (err) {
    console.error("Publishing: failed to record the activity log for a failed publish", {
      jobId,
      connectionId: connection.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

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
  if (content.companyId !== connection.companyId) {
    return actionError("This content and connection do not belong to the same company.");
  }

  const destinationError = checkDestinationDomain(content, connection);
  if (destinationError) return actionError(destinationError);

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
    return actionSuccess({ externalId: p.externalId, externalUrl: p.externalUrl, publishedAt: p.publishedAt, alreadyPublished: true, urlConflict: false });
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

  if (content.companyId !== connection.companyId) {
    return actionError("This content and connection do not belong to the same company.");
  }

  const destinationError = checkDestinationDomain(content, connection);
  if (destinationError) return actionError(destinationError);

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
      return actionSuccess({ externalId: p.externalId, externalUrl: p.externalUrl, publishedAt: p.publishedAt, alreadyPublished: true, urlConflict: false });
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
