-- AlterTable
ALTER TABLE "WebsiteAnalysisJob" ADD COLUMN     "clientId" UUID;

-- CreateIndex
CREATE INDEX "WebsiteAnalysisJob_clientId_idx" ON "WebsiteAnalysisJob"("clientId");

-- AddForeignKey
ALTER TABLE "WebsiteAnalysisJob" ADD CONSTRAINT "WebsiteAnalysisJob_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
