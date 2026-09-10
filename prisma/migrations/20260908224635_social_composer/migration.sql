-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X', 'TIKTOK', 'PINTEREST', 'YOUTUBE', 'GOOGLE_BUSINESS_PROFILE');

-- CreateEnum
CREATE TYPE "SocialAccountStatus" AS ENUM ('ACTIVE', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "handle" TEXT NOT NULL,
    "status" "SocialAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "caption" TEXT NOT NULL,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostTarget" (
    "id" UUID NOT NULL,
    "socialPostId" UUID NOT NULL,
    "socialAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPostTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_companyId_clientId_idx" ON "SocialAccount"("companyId", "clientId");

-- CreateIndex
CREATE INDEX "SocialAccount_deletedAt_idx" ON "SocialAccount"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_clientId_platform_handle_key" ON "SocialAccount"("clientId", "platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_contentId_key" ON "SocialPost"("contentId");

-- CreateIndex
CREATE INDEX "SocialPostTarget_socialAccountId_idx" ON "SocialPostTarget"("socialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPostTarget_socialPostId_socialAccountId_key" ON "SocialPostTarget"("socialPostId", "socialAccountId");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostTarget" ADD CONSTRAINT "SocialPostTarget_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostTarget" ADD CONSTRAINT "SocialPostTarget_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
