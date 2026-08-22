-- CreateEnum
CREATE TYPE "PublishingProviderType" AS ENUM ('WORDPRESS');

-- CreateEnum
CREATE TYPE "PublishingConnectionStatus" AS ENUM ('ACTIVE', 'INVALID', 'REVOKED');

-- CreateEnum
CREATE TYPE "PublishingCredentialType" AS ENUM ('API_KEY', 'BASIC_AUTH', 'OAUTH2');

-- CreateTable
CREATE TABLE "PublishingConnection" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "providerType" "PublishingProviderType" NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "status" "PublishingConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" UUID,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishingCredential" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "credentialType" "PublishingCredentialType" NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublishingConnection_companyId_idx" ON "PublishingConnection"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishingCredential_connectionId_key" ON "PublishingCredential"("connectionId");

-- CreateIndex
CREATE INDEX "PublishingCredential_companyId_idx" ON "PublishingCredential"("companyId");

-- AddForeignKey
ALTER TABLE "PublishingConnection" ADD CONSTRAINT "PublishingConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingConnection" ADD CONSTRAINT "PublishingConnection_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingCredential" ADD CONSTRAINT "PublishingCredential_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PublishingConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
