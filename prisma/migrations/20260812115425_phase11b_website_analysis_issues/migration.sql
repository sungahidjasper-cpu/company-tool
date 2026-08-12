-- CreateEnum
CREATE TYPE "WebsiteAnalysisIssueType" AS ENUM ('MISSING_TITLE', 'MISSING_META_DESCRIPTION', 'DUPLICATE_TITLE', 'DUPLICATE_H1', 'BROKEN_LINK', 'REDIRECT_CHAIN', 'LARGE_IMAGE', 'MISSING_ALT_TEXT', 'CANONICAL_ISSUE', 'SITEMAP_ISSUE', 'ROBOTS_ISSUE', 'STRUCTURED_DATA_ISSUE', 'INTERNAL_LINKING_OPPORTUNITY');

-- CreateEnum
CREATE TYPE "WebsiteAnalysisIssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "WebsiteAnalysisIssueSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "WebsiteAnalysisIssue" (
    "id" UUID NOT NULL,
    "websiteAnalysisJobId" UUID NOT NULL,
    "issueType" "WebsiteAnalysisIssueType" NOT NULL,
    "severity" "WebsiteAnalysisIssueSeverity" NOT NULL,
    "url" TEXT,
    "explanation" TEXT NOT NULL,
    "recommendedFix" TEXT NOT NULL,
    "status" "WebsiteAnalysisIssueStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteAnalysisIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteAnalysisIssue_websiteAnalysisJobId_idx" ON "WebsiteAnalysisIssue"("websiteAnalysisJobId");

-- CreateIndex
CREATE INDEX "WebsiteAnalysisIssue_issueType_idx" ON "WebsiteAnalysisIssue"("issueType");

-- CreateIndex
CREATE INDEX "WebsiteAnalysisIssue_status_idx" ON "WebsiteAnalysisIssue"("status");

-- AddForeignKey
ALTER TABLE "WebsiteAnalysisIssue" ADD CONSTRAINT "WebsiteAnalysisIssue_websiteAnalysisJobId_fkey" FOREIGN KEY ("websiteAnalysisJobId") REFERENCES "WebsiteAnalysisJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
