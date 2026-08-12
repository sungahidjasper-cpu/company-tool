-- CreateEnum
CREATE TYPE "WebsiteAnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "WebsiteAnalysisJob" (
    "id" UUID NOT NULL,
    "seoProjectId" UUID,
    "companyId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "WebsiteAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteAnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebsiteAnalysisJob_companyId_idx" ON "WebsiteAnalysisJob"("companyId");

-- CreateIndex
CREATE INDEX "WebsiteAnalysisJob_seoProjectId_idx" ON "WebsiteAnalysisJob"("seoProjectId");

-- CreateIndex
CREATE INDEX "WebsiteAnalysisJob_status_idx" ON "WebsiteAnalysisJob"("status");

-- AddForeignKey
ALTER TABLE "WebsiteAnalysisJob" ADD CONSTRAINT "WebsiteAnalysisJob_seoProjectId_fkey" FOREIGN KEY ("seoProjectId") REFERENCES "SEOProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAnalysisJob" ADD CONSTRAINT "WebsiteAnalysisJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
