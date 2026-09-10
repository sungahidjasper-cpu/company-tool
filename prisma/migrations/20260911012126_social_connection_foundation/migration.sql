/*
  Phase 9 — the foundation for a REAL social account connection.

  THE DEFECT THIS FIXES. SocialAccount.status carried two unrelated meanings
  at once: "the client wants this account available in Cloud Compass" (a
  preference someone sets here) and "this account actually works" (a fact
  about the outside world). Because adding an account wrote status = ACTIVE,
  typing a handle was enough to make the composer treat it as usable. Nothing
  in the data could tell a configured account from a connected one.

  status keeps its Phase 8 meaning, untouched. connectionState is new and
  describes reality, defaulting to NOT_CONNECTED — which is the truth for
  every row that exists today, since no authorization has ever been performed.

  ENTIRELY ADDITIVE. No column is dropped, retyped or made NOT NULL without a
  default; no row is updated or deleted. There is deliberately NO backfill:
  fabricating an external id, a token or a CONNECTED state for a
  hand-configured account would recreate the exact dishonesty above.

  Credentials do NOT live in SocialAccount. They go in their own table, the
  same separation PublishingConnection/PublishingCredential already uses, so
  no query written for the settings screen or the composer can reach a token
  by widening a select.
*/

-- CreateEnum
CREATE TYPE "SocialConnectionState" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'NEEDS_RECONNECT', 'DISCONNECTED');

-- CreateEnum
-- One member only: an OAuth 2.0 access token is the shape Meta's own Graph
-- API documentation confirms. No speculative member for a provider that has
-- not been integrated — adding a confirmed one later is one ALTER TYPE.
CREATE TYPE "SocialCredentialType" AS ENUM ('OAUTH2_ACCESS_TOKEN');

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "connectedAt" TIMESTAMP(3),
ADD COLUMN     "connectionState" "SocialConnectionState" NOT NULL DEFAULT 'NOT_CONNECTED',
ADD COLUMN     "disconnectedAt" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "lastCheckError" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SocialAccountCredential" (
    "id" UUID NOT NULL,
    "socialAccountId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "credentialType" "SocialCredentialType" NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccountCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- One in-flight authorization. Holds the SHA-256 of the state value, never
-- the value itself, so a dump of this table cannot be replayed into a valid
-- callback. Holds no token and no secret of any kind.
CREATE TABLE "SocialOAuthState" (
    "id" UUID NOT NULL,
    "stateHash" TEXT NOT NULL,
    "companyId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "socialAccountId" UUID,
    "startedByUserId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccountCredential_socialAccountId_key" ON "SocialAccountCredential"("socialAccountId");

-- CreateIndex
CREATE INDEX "SocialAccountCredential_companyId_idx" ON "SocialAccountCredential"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialOAuthState_stateHash_key" ON "SocialOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "SocialOAuthState_companyId_clientId_idx" ON "SocialOAuthState"("companyId", "clientId");

-- CreateIndex
CREATE INDEX "SocialOAuthState_expiresAt_idx" ON "SocialOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "SocialAccount_companyId_connectionState_idx" ON "SocialAccount"("companyId", "connectionState");

-- CreateIndex
-- One Cloud Compass row per real platform page, per company. Postgres treats
-- NULLs as distinct, so every hand-configured account (externalId NULL) is
-- unaffected and any number of them can coexist.
CREATE UNIQUE INDEX "SocialAccount_companyId_platform_externalId_key" ON "SocialAccount"("companyId", "platform", "externalId");

-- AddForeignKey
ALTER TABLE "SocialAccountCredential" ADD CONSTRAINT "SocialAccountCredential_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOAuthState" ADD CONSTRAINT "SocialOAuthState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOAuthState" ADD CONSTRAINT "SocialOAuthState_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOAuthState" ADD CONSTRAINT "SocialOAuthState_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOAuthState" ADD CONSTRAINT "SocialOAuthState_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
