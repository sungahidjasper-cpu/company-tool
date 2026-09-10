/*
  Phase 9 — where an authorization waits while a person picks a Page.

  Meta's flow does not end at the callback. Exchanging the code yields a
  user-level authorization; the Pages that authorization manages come back
  from a separate Graph call; and only then can a person say which Page this
  client actually is. That choice needs the authorization to still be
  available, and there are only bad places to keep it:

    - the browser        would mean handing a token to a browser
    - SocialAccountCredential  is keyed by an account, and no account has been
                               chosen yet — a row there would need a fabricated
                               account to hang off

  So it stays with the flow it belongs to, on the row that already represents
  exactly one in-flight authorization, encrypted with the same AES-256-GCM
  infrastructure as every other credential in this system, cleared the moment
  the flow finishes, and refused once selectionExpiresAt passes.

  selectionHash is the SHA-256 of a single-use token, never the token — the
  same treatment the state value itself gets, so neither this table nor a dump
  of it can be replayed.

  ENTIRELY ADDITIVE: five nullable columns and one unique index. No column is
  dropped or retyped, and no row is written, updated or deleted.
*/

-- AlterTable
ALTER TABLE "SocialOAuthState" ADD COLUMN     "authorizationKeyVersion" INTEGER,
ADD COLUMN     "encryptedAuthorization" TEXT,
ADD COLUMN     "selectionConsumedAt" TIMESTAMP(3),
ADD COLUMN     "selectionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "selectionHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SocialOAuthState_selectionHash_key" ON "SocialOAuthState"("selectionHash");
