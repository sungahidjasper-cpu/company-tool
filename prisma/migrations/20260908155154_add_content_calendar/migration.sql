-- CreateEnum
CREATE TYPE "CalendarEntryRole" AS ENUM ('PILLAR', 'SUPPORTING', 'RELATED');

-- CreateEnum
CREATE TYPE "CalendarContentType" AS ENUM ('ARTICLE', 'GUIDE', 'LANDING_PAGE', 'FAQ_PAGE', 'CASE_STUDY', 'COMPARISON', 'OTHER');

-- CreateEnum
CREATE TYPE "CalendarEntryStatus" AS ENUM ('PLANNED', 'BRIEF_CREATED', 'DRAFT', 'IN_PROGRESS', 'PUBLISHED', 'COMPLETED');

-- AlterEnum
ALTER TYPE "AiTaskType" ADD VALUE 'CONTENT_CALENDAR';

-- CreateTable
CREATE TABLE "ContentCalendar" (
    "id" UUID NOT NULL,
    "seoProjectId" UUID NOT NULL,
    "createdById" UUID,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContentCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCalendarEntry" (
    "id" UUID NOT NULL,
    "calendarId" UUID NOT NULL,
    "contentId" UUID,
    "keywordId" UUID,
    "keywordClusterId" UUID,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "topic" TEXT NOT NULL,
    "contentType" "CalendarContentType" NOT NULL DEFAULT 'OTHER',
    "role" "CalendarEntryRole" NOT NULL DEFAULT 'RELATED',
    "status" "CalendarEntryStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ContentCalendarEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentCalendar_seoProjectId_deletedAt_idx" ON "ContentCalendar"("seoProjectId", "deletedAt");

-- CreateIndex
CREATE INDEX "ContentCalendar_deletedAt_idx" ON "ContentCalendar"("deletedAt");

-- CreateIndex
CREATE INDEX "ContentCalendarEntry_calendarId_scheduledDate_idx" ON "ContentCalendarEntry"("calendarId", "scheduledDate");

-- CreateIndex
CREATE INDEX "ContentCalendarEntry_contentId_idx" ON "ContentCalendarEntry"("contentId");

-- CreateIndex
CREATE INDEX "ContentCalendarEntry_keywordId_idx" ON "ContentCalendarEntry"("keywordId");

-- CreateIndex
CREATE INDEX "ContentCalendarEntry_keywordClusterId_idx" ON "ContentCalendarEntry"("keywordClusterId");

-- CreateIndex
CREATE INDEX "ContentCalendarEntry_deletedAt_idx" ON "ContentCalendarEntry"("deletedAt");

-- AddForeignKey
ALTER TABLE "ContentCalendar" ADD CONSTRAINT "ContentCalendar_seoProjectId_fkey" FOREIGN KEY ("seoProjectId") REFERENCES "SEOProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCalendar" ADD CONSTRAINT "ContentCalendar_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCalendarEntry" ADD CONSTRAINT "ContentCalendarEntry_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ContentCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCalendarEntry" ADD CONSTRAINT "ContentCalendarEntry_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCalendarEntry" ADD CONSTRAINT "ContentCalendarEntry_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCalendarEntry" ADD CONSTRAINT "ContentCalendarEntry_keywordClusterId_fkey" FOREIGN KEY ("keywordClusterId") REFERENCES "KeywordCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
