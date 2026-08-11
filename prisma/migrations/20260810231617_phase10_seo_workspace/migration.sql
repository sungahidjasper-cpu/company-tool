-- CreateEnum
CREATE TYPE "KeywordIntent" AS ENUM ('INFORMATIONAL', 'NAVIGATIONAL', 'COMMERCIAL', 'TRANSACTIONAL');

-- CreateEnum
CREATE TYPE "KeywordStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'RANKING', 'ACHIEVED', 'ABANDONED');

-- AlterEnum
ALTER TYPE "ContentStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "contentId" UUID,
ADD COLUMN     "seoProjectId" UUID;

-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "intent" "KeywordIntent",
ADD COLUMN     "ownerId" UUID,
ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "status" "KeywordStatus" NOT NULL DEFAULT 'NOT_STARTED';

-- CreateIndex
CREATE INDEX "Activity_seoProjectId_idx" ON "Activity"("seoProjectId");

-- CreateIndex
CREATE INDEX "Activity_contentId_idx" ON "Activity"("contentId");

-- CreateIndex
CREATE INDEX "Keyword_ownerId_idx" ON "Keyword"("ownerId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_seoProjectId_fkey" FOREIGN KEY ("seoProjectId") REFERENCES "SEOProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
