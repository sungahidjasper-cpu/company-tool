-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WebsiteAnalysisErrorType" ADD VALUE 'BUDGET_EXCEEDED';
ALTER TYPE "WebsiteAnalysisErrorType" ADD VALUE 'COMPANY_RATE_LIMITED';

-- AlterTable
ALTER TABLE "AiUsageLog" ADD COLUMN     "companyId" UUID;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "aiMonthlyBudgetUsd" DECIMAL(10,2),
ADD COLUMN     "aiRateLimitPerMinute" INTEGER;

-- CreateIndex
CREATE INDEX "AiUsageLog_companyId_idx" ON "AiUsageLog"("companyId");

-- CreateIndex
CREATE INDEX "AiUsageLog_companyId_createdAt_idx" ON "AiUsageLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
