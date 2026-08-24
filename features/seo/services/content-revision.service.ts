import { Prisma } from "@/lib/generated/prisma/client";
import type { ContentRevisionSource } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Phase 25 Stage 1 — read-only, company-scoped listing plus the
 * concurrency-safe snapshot primitive Stage 2 will call from
 * updateContent/saveLongFormContent. No write call sites exist yet — this
 * file only defines the mechanism.
 */

export type ContentRevisionSummary = {
  id: string;
  revisionNumber: number;
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  body: string | null;
  changeSource: ContentRevisionSource;
  createdByUserId: string | null;
  createdAt: Date;
};

/** Company-scoped, newest first — mirrors content-publication-state.service.ts's shape. */
export async function getContentRevisions(contentId: string, companyId: string): Promise<ContentRevisionSummary[]> {
  return prisma.contentRevision.findMany({
    where: { contentId, companyId },
    orderBy: { revisionNumber: "desc" },
    select: {
      id: true,
      revisionNumber: true,
      title: true,
      metaTitle: true,
      metaDescription: true,
      body: true,
      changeSource: true,
      createdByUserId: true,
      createdAt: true,
    },
  });
}

export type ContentRevisionSnapshotInput = {
  contentId: string;
  companyId: string;
  /** The four tracked fields' values as they were BEFORE the change being made — never the post-change state. */
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  body: string | null;
  changeSource: ContentRevisionSource;
  createdByUserId: string | null;
};

/**
 * Creates one ContentRevision snapshot with a guaranteed-unique, gap-free
 * revisionNumber, safe under concurrent callers for the same contentId.
 *
 * Concurrency strategy: the first statement this function issues is a
 * `SELECT ... FOR UPDATE` row lock on the parent Content row, inside the
 * caller's transaction — the same idiom this schema already uses for
 * PublishingJob idempotency (see publishing-content.actions.ts). Postgres
 * row locks are exclusive: a second concurrent call for the SAME contentId
 * blocks on this SELECT until the first transaction commits or rolls back.
 * Only after the lock is acquired does this function count existing
 * revisions and compute the next number, so no two concurrent callers can
 * ever observe the same count and no two revisions for the same Content can
 * ever receive the same revisionNumber. This holds regardless of what the
 * caller does before or after calling this function, as long as the caller
 * passes an already-open transaction — the lock is acquired here, not
 * assumed to already be held by the caller.
 *
 * count()+1 is safe here specifically BECAUSE of the lock above — remove
 * the lock and two concurrent transactions could both read the same count
 * before either commits. It also assumes ContentRevision rows are never
 * deleted independently of their parent Content, which holds today (no
 * pruning/retention path exists in v1, and Content itself is only ever
 * soft-deleted, never hard-deleted). If a future phase adds revision
 * deletion, this numbering strategy would need MAX(revisionNumber)+1 or a
 * different approach entirely.
 *
 * Deciding WHETHER to call this (e.g. skipping a no-op save, or a save that
 * only touches non-versioned fields like keywords/authorId) is the calling
 * action's responsibility, not this function's — see Stage 2.
 */
export async function createContentRevisionSnapshot(tx: Prisma.TransactionClient, input: ContentRevisionSnapshotInput) {
  await tx.$queryRaw`SELECT id FROM "Content" WHERE id = ${input.contentId} FOR UPDATE`;

  const revisionCount = await tx.contentRevision.count({ where: { contentId: input.contentId } });

  return tx.contentRevision.create({
    data: {
      contentId: input.contentId,
      companyId: input.companyId,
      revisionNumber: revisionCount + 1,
      title: input.title,
      metaTitle: input.metaTitle,
      metaDescription: input.metaDescription,
      body: input.body,
      changeSource: input.changeSource,
      createdByUserId: input.createdByUserId,
    },
  });
}
