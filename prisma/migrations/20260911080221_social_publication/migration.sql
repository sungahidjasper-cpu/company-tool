/*
  Phase 10A — one publication result per SocialPostTarget.

  SocialPostTarget had no way to record whether a real publish attempt was
  ever made, whether the provider confirmed it, or what the provider's own
  post id and permalink were. Adding a status column directly to
  SocialPostTarget would conflate "the plan" (caption, link, which account)
  with "the outcome" (did this specific platform's publish actually succeed),
  and would make one shared column ambiguous the moment a post targets more
  than one platform — a Facebook success and an Instagram failure on the
  same SocialPost must never be able to collide in one field.

  SocialPublication is therefore a separate, one-per-target row:
  @unique(socialPostTargetId) means a retry replaces this row's status
  rather than accumulating a second attempt, so "the current truth about
  this target" is always exactly one row to read.

  NO CREDENTIAL LIVES HERE. This is the OUTCOME of a publish call — the
  credential used to make it stays in SocialAccountCredential, one hop away
  through socialPostTarget.socialAccount.

  externalUrl is populated ONLY from a value a provider actually returned
  (e.g. Meta's own permalink_url, fetched via a documented follow-up query) —
  never constructed from a guessed URL pattern.

  ENTIRELY ADDITIVE. No column dropped or retyped, no row updated or
  deleted. Verified before writing this migration: 2 existing SocialPost
  rows, 0 existing SocialPostTarget rows — nothing for this table to
  reference yet, so this is provably a no-data-risk change.
*/

-- CreateEnum
CREATE TYPE "SocialPublicationStatus" AS ENUM ('DRAFT', 'QUEUED', 'PUBLISHING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "SocialPublication" (
    "id" UUID NOT NULL,
    "socialPostTargetId" UUID NOT NULL,
    "status" "SocialPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialPublication_socialPostTargetId_key" ON "SocialPublication"("socialPostTargetId");

-- CreateIndex
CREATE INDEX "SocialPublication_status_idx" ON "SocialPublication"("status");

-- AddForeignKey
ALTER TABLE "SocialPublication" ADD CONSTRAINT "SocialPublication_socialPostTargetId_fkey" FOREIGN KEY ("socialPostTargetId") REFERENCES "SocialPostTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
