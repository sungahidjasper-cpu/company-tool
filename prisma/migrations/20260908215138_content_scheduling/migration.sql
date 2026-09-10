-- AlterEnum
ALTER TYPE "ContentStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "scheduledTimezone" TEXT;

-- CreateIndex
CREATE INDEX "Content_seoProjectId_scheduledAt_idx" ON "Content"("seoProjectId", "scheduledAt");
