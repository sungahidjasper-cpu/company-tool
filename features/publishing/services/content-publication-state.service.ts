import { prisma } from "@/lib/prisma";
import { isRetryableErrorType } from "@/features/publishing/services/publishing-errors";
import type { ContentStatus, PublishingErrorType, PublishingJobStatus } from "@/lib/generated/prisma/enums";

/**
 * The single source of truth for "which Content.status values are eligible
 * for external publishing" — an application-level precondition, never a
 * change to ContentStatus itself. Both the mutation action layer
 * (publishing-content.actions.ts, which enforces this) and the Content
 * detail page (which uses this only to decide whether to render the
 * publish panel at all) import this rather than each keeping their own
 * copy of the allow-list.
 */
const PUBLISHABLE_CONTENT_STATUSES: ReadonlySet<ContentStatus> = new Set(["APPROVED", "PUBLISHED"]);

export function isContentStatusPublishable(status: ContentStatus): boolean {
  return PUBLISHABLE_CONTENT_STATUSES.has(status);
}

/**
 * Phase 24 Stage 2D — read-only, company-scoped, credential-free. Answers
 * "what is this Content's current external-publication state, right now,
 * across every ACTIVE WordPress connection this company has" — the query
 * neither the Stage 2C mutation actions nor any earlier stage provides,
 * needed so the Content detail page can render accurate state on a fresh
 * load rather than only right after an action call. Deliberately kept
 * separate from publishing-content.actions.ts: this file only ever reads,
 * never writes, and never touches PublishingCredential at all.
 */

export type ConnectionPublicationState = {
  connectionId: string;
  connectionLabel: string;
  publication: { externalId: string; externalUrl: string | null; publishedAt: Date } | null;
  jobStatus: PublishingJobStatus | null;
  errorType: PublishingErrorType | null;
  /** True only when there is no existing publication, the latest job FAILED, and its errorType is one Stage 2B/2C have proven safe to retry. Presentational only — retryPublishAction re-verifies this itself before acting. */
  canRetry: boolean;
};

export async function getContentPublicationState(
  contentId: string,
  companyId: string
): Promise<ConnectionPublicationState[]> {
  const connections = await prisma.publishingConnection.findMany({
    where: { companyId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true },
  });

  if (connections.length === 0) return [];

  const connectionIds = connections.map((c) => c.id);

  const [publications, jobs] = await Promise.all([
    prisma.contentPublication.findMany({
      where: { contentId, connectionId: { in: connectionIds } },
      select: { connectionId: true, externalId: true, externalUrl: true, publishedAt: true },
    }),
    prisma.publishingJob.findMany({
      where: { contentId, connectionId: { in: connectionIds } },
      select: { connectionId: true, status: true, errorType: true },
    }),
  ]);

  const publicationByConnection = new Map(publications.map((p) => [p.connectionId, p]));
  const jobByConnection = new Map(jobs.map((j) => [j.connectionId, j]));

  return connections.map((connection) => {
    const publication = publicationByConnection.get(connection.id) ?? null;
    const job = jobByConnection.get(connection.id) ?? null;
    const canRetry = !publication && job?.status === "FAILED" && job.errorType !== null && isRetryableErrorType(job.errorType);

    return {
      connectionId: connection.id,
      connectionLabel: connection.label,
      publication: publication
        ? { externalId: publication.externalId, externalUrl: publication.externalUrl, publishedAt: publication.publishedAt }
        : null,
      jobStatus: job?.status ?? null,
      errorType: job?.errorType ?? null,
      canRetry,
    };
  });
}
