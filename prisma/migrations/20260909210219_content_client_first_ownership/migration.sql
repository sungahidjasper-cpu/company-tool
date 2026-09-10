/*
  Client-first content ownership.

  Content used to reach its company only by joining through SEOProject, and
  seoProjectId was NOT NULL — so a client with no SEO project could not own
  content at all. This adds the company as a direct authorization root, makes
  the client a first-class optional owner, and demotes the SEO project to
  optional context.

  Ordering matters and is why this file is hand-written: the two new columns
  are added NULLABLE, backfilled from the project each row already has, and
  only then constrained. Nothing is guessed and nothing is deleted — every
  existing row keeps the seoProjectId it had, so existing behaviour is
  unchanged after the migration.
*/

-- 1. The SEO project stops owning content. SetNull, not Cascade: deleting a
--    project must never destroy the client's content asset.
ALTER TABLE "Content" DROP CONSTRAINT "Content_seoProjectId_fkey";

-- 2. New ownership columns, nullable for now so the backfill can run.
ALTER TABLE "Content" ADD COLUMN "companyId" UUID;
ALTER TABLE "Content" ADD COLUMN "clientId"  UUID;

-- 3. Backfill from the project each row already belongs to. The company is
--    always derivable; the client only where the project has one, and where
--    it does not the column stays NULL rather than inventing an owner.
UPDATE "Content" c
   SET "companyId" = p."companyId",
       "clientId"  = p."clientId"
  FROM "SEOProject" p
 WHERE c."seoProjectId" = p."id";

-- 4. Guard: refuse to continue if any row failed to resolve a company, rather
--    than silently constraining a half-filled column.
DO $$
DECLARE unresolved INTEGER;
BEGIN
  SELECT COUNT(*) INTO unresolved FROM "Content" WHERE "companyId" IS NULL;
  IF unresolved > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % Content row(s) have no companyId', unresolved;
  END IF;
END $$;

-- 5. Now the company is guaranteed, so it becomes the required root, and the
--    SEO project becomes optional.
ALTER TABLE "Content" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Content" ALTER COLUMN "seoProjectId" DROP NOT NULL;

-- 6. The client-first workspace reads by company and client.
CREATE INDEX "Content_companyId_status_idx" ON "Content"("companyId", "status");
CREATE INDEX "Content_clientId_status_idx" ON "Content"("clientId", "status");
CREATE INDEX "Content_companyId_scheduledAt_idx" ON "Content"("companyId", "scheduledAt");

-- 7. Relations.
ALTER TABLE "Content" ADD CONSTRAINT "Content_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Content" ADD CONSTRAINT "Content_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Content" ADD CONSTRAINT "Content_seoProjectId_fkey"
  FOREIGN KEY ("seoProjectId") REFERENCES "SEOProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
