-- AlterEnum
ALTER TYPE "AiTaskType" ADD VALUE 'CONTENT_DRAFT';

-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "body" TEXT;
