/*
  Content Type as a first-class field.

  Content could not say what kind of asset it was: the calendar derived
  "social post" from the presence of a social half and reported everything
  else as nothing at all, so a blog article and an SEO page were
  indistinguishable and a real type filter could not be built honestly.

  NULLABLE on purpose, and the backfill classifies ONLY where an existing
  relationship proves the type. Nothing is guessed; unproven rows stay NULL
  and are reported as "not recorded".
*/

CREATE TYPE "ContentType" AS ENUM ('SOCIAL_POST', 'BLOG_POST', 'SEO_CONTENT');

ALTER TABLE "Content" ADD COLUMN "contentType" "ContentType";

-- PROOF 1: a Content row with a SocialPost half genuinely IS a social post.
-- This relation has been the de-facto discriminator since Phase 6.
UPDATE "Content" c
   SET "contentType" = 'SOCIAL_POST'
 WHERE EXISTS (SELECT 1 FROM "SocialPost" sp WHERE sp."contentId" = c."id");

-- PROOF 2: aiBriefDetails is written ONLY by the SEO content-brief and
-- long-form workflows (verified: content-brief.actions.ts,
-- long-form-content.actions.ts, ai-generation-job-runner.ts). The Blog Studio
-- writes neither aiBriefDetails nor generatedByAi, so its presence proves the
-- row came from the keyword-driven SEO workflow.
UPDATE "Content"
   SET "contentType" = 'SEO_CONTENT'
 WHERE "contentType" IS NULL
   AND "aiBriefDetails" IS NOT NULL;

/*
  Everything else stays NULL. A body, a url, a keyword or a project does NOT
  separate a blog article from an SEO page — the Blog Studio sets a body and
  keywords too — so classifying on those would be a guess. Those rows read as
  "not recorded", which is the truth.
*/

CREATE INDEX "Content_companyId_contentType_idx" ON "Content"("companyId", "contentType");
