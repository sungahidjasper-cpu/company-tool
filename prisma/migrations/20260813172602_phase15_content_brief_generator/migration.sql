-- AlterEnum
ALTER TYPE "AiTaskType" ADD VALUE 'CONTENT_BRIEF';

-- AlterTable
ALTER TABLE "AiUsageLog" ADD COLUMN     "seoProjectId" UUID;

-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "aiBriefDetails" JSONB,
ADD COLUMN     "generatedByAi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metaDescription" TEXT,
ADD COLUMN     "metaTitle" TEXT;

-- CreateIndex
CREATE INDEX "AiUsageLog_seoProjectId_idx" ON "AiUsageLog"("seoProjectId");

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_seoProjectId_fkey" FOREIGN KEY ("seoProjectId") REFERENCES "SEOProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
