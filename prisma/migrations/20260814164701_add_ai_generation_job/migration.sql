-- CreateEnum
CREATE TYPE "AiGenerationJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "AiGenerationJob" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "seoProjectId" UUID,
    "contentId" UUID,
    "taskType" "AiTaskType" NOT NULL,
    "status" "AiGenerationJobStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER,
    "inputJson" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "errorType" "WebsiteAnalysisErrorType",
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiGenerationJob_companyId_idx" ON "AiGenerationJob"("companyId");

-- CreateIndex
CREATE INDEX "AiGenerationJob_seoProjectId_idx" ON "AiGenerationJob"("seoProjectId");

-- CreateIndex
CREATE INDEX "AiGenerationJob_contentId_idx" ON "AiGenerationJob"("contentId");

-- CreateIndex
CREATE INDEX "AiGenerationJob_status_idx" ON "AiGenerationJob"("status");

-- CreateIndex
CREATE INDEX "AiGenerationJob_createdById_idx" ON "AiGenerationJob"("createdById");

-- CreateIndex
CREATE INDEX "AiGenerationJob_companyId_taskType_inputHash_status_idx" ON "AiGenerationJob"("companyId", "taskType", "inputHash", "status");

-- AddForeignKey
ALTER TABLE "AiGenerationJob" ADD CONSTRAINT "AiGenerationJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGenerationJob" ADD CONSTRAINT "AiGenerationJob_seoProjectId_fkey" FOREIGN KEY ("seoProjectId") REFERENCES "SEOProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGenerationJob" ADD CONSTRAINT "AiGenerationJob_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiGenerationJob" ADD CONSTRAINT "AiGenerationJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
