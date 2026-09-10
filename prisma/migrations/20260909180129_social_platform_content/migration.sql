-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "displayName" TEXT;

-- AlterTable
ALTER TABLE "SocialPostTarget" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "link" TEXT;
