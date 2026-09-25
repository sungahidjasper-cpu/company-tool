-- CreateEnum
CREATE TYPE "SocialCommentStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "firstComment" TEXT;

-- AlterTable
ALTER TABLE "SocialPostTarget" ADD COLUMN     "firstComment" TEXT;

-- CreateTable
CREATE TABLE "SocialComment" (
    "id" UUID NOT NULL,
    "socialPostTargetId" UUID NOT NULL,
    "status" "SocialCommentStatus" NOT NULL DEFAULT 'PENDING',
    "externalCommentId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialComment_socialPostTargetId_key" ON "SocialComment"("socialPostTargetId");

-- CreateIndex
CREATE INDEX "SocialComment_status_idx" ON "SocialComment"("status");

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_socialPostTargetId_fkey" FOREIGN KEY ("socialPostTargetId") REFERENCES "SocialPostTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
