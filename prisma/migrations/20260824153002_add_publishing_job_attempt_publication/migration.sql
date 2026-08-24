-- CreateEnum
CREATE TYPE "PublishingJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PublishingErrorType" AS ENUM ('AUTHENTICATION_FAILED', 'INSUFFICIENT_PERMISSIONS', 'RATE_LIMITED', 'VALIDATION_FAILED', 'NETWORK_TIMEOUT', 'DESTINATION_UNAVAILABLE', 'DUPLICATE_RESOURCE', 'AMBIGUOUS_RESPONSE', 'UNSAFE_URL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PublishingAttemptOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "PublishingJob" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "status" "PublishingJobStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID,
    "errorType" "PublishingErrorType",
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishingAttempt" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "outcome" "PublishingAttemptOutcome" NOT NULL,
    "httpStatus" INTEGER,
    "errorType" "PublishingErrorType",
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PublishingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPublication" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublishingJob_companyId_status_idx" ON "PublishingJob"("companyId", "status");

-- CreateIndex
CREATE INDEX "PublishingJob_contentId_idx" ON "PublishingJob"("contentId");

-- CreateIndex
CREATE INDEX "PublishingJob_connectionId_idx" ON "PublishingJob"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishingAttempt_jobId_attemptNumber_key" ON "PublishingAttempt"("jobId", "attemptNumber");

-- CreateIndex
CREATE INDEX "ContentPublication_companyId_idx" ON "ContentPublication"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPublication_contentId_connectionId_key" ON "ContentPublication"("contentId", "connectionId");

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PublishingConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingAttempt" ADD CONSTRAINT "PublishingAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "PublishingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPublication" ADD CONSTRAINT "ContentPublication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPublication" ADD CONSTRAINT "ContentPublication_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPublication" ADD CONSTRAINT "ContentPublication_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PublishingConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
