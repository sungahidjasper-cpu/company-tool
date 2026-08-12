-- CreateEnum
CREATE TYPE "AiTaskType" AS ENUM ('EXTRACTION', 'SCORES', 'RECOMMENDATIONS', 'CONTENT_INTELLIGENCE', 'EXECUTIVE_SUMMARY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WebsiteAnalysisIssueType" ADD VALUE 'MISSING_OG_TAGS';
ALTER TYPE "WebsiteAnalysisIssueType" ADD VALUE 'MISSING_TWITTER_CARD';

-- AlterTable
ALTER TABLE "WebsiteAnalysisJob" ADD COLUMN     "crawlHash" TEXT;

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" UUID NOT NULL,
    "websiteAnalysisJobId" UUID,
    "provider" TEXT NOT NULL,
    "taskType" "AiTaskType" NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT,
    "temperature" DOUBLE PRECISION,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "estimatedCostUsd" DECIMAL(10,6),
    "succeeded" BOOLEAN NOT NULL,
    "errorType" "WebsiteAnalysisErrorType",
    "latencyMs" INTEGER NOT NULL,
    "retried" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageLog_websiteAnalysisJobId_idx" ON "AiUsageLog"("websiteAnalysisJobId");

-- CreateIndex
CREATE INDEX "AiUsageLog_provider_idx" ON "AiUsageLog"("provider");

-- CreateIndex
CREATE INDEX "AiUsageLog_taskType_idx" ON "AiUsageLog"("taskType");

-- CreateIndex
CREATE INDEX "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "WebsiteAnalysisJob_domain_crawlHash_idx" ON "WebsiteAnalysisJob"("domain", "crawlHash");

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_websiteAnalysisJobId_fkey" FOREIGN KEY ("websiteAnalysisJobId") REFERENCES "WebsiteAnalysisJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
