-- CreateEnum
CREATE TYPE "WebsiteAnalysisErrorType" AS ENUM ('AUTHENTICATION_ERROR', 'INSUFFICIENT_CREDITS', 'RATE_LIMIT', 'TIMEOUT', 'SERVICE_UNAVAILABLE', 'INVALID_REQUEST', 'UNKNOWN');

-- AlterTable
ALTER TABLE "WebsiteAnalysisJob" ADD COLUMN     "crawlResultJson" JSONB,
ADD COLUMN     "errorType" "WebsiteAnalysisErrorType";
