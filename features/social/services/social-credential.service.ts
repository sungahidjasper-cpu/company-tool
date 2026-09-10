import "server-only";

import {
  decryptCredentialPayload,
  encryptCredentialPayload,
} from "@/lib/crypto/publishing-credential-crypto";
import { prisma } from "@/lib/prisma";

/**
 * Phase 9 — storing and reading one connected social account's authorization.
 *
 * THE ENCRYPTION IS NOT NEW. This deliberately calls
 * lib/crypto/publishing-credential-crypto.ts — the same AES-256-GCM
 * implementation, the same versioned master key read from the environment.
 * A second crypto implementation would be a second thing to get wrong.
 *
 * LOGICAL SEPARATION FROM PUBLISHING. Sharing the primitive is not sharing
 * the data. Every social payload is an envelope tagged `social_oauth2`, and
 * `readAccessToken` refuses any envelope without that tag — so a WordPress
 * ciphertext handed to this module fails closed rather than being parsed as a
 * social credential, even though both were encrypted with the same key. The
 * two also live in different tables with different owners.
 *
 * WHAT NEVER LEAVES THIS FILE. The decrypted token is returned only to
 * server-side provider code that is about to call the provider with it. It is
 * never returned from a server action, never put in a prop, never logged,
 * never written into lastCheckError, and never included in an error message —
 * every throw below is written to be safe to surface.
 */

/** Bumped only if the stored shape changes; `kind` is what separates social from publishing. */
const ENVELOPE_VERSION = 1 as const;
const ENVELOPE_KIND = "social_oauth2" as const;

type SocialCredentialEnvelope = {
  kind: typeof ENVELOPE_KIND;
  v: typeof ENVELOPE_VERSION;
  /** The provider's access token. The ONE secret this system stores. */
  accessToken: string;
};

export type StoreCredentialInput = {
  socialAccountId: string;
  companyId: string;
  /** The token itself. Never logged, never echoed back. */
  accessToken: string;
  /**
   * What the provider itself said, not a locally-assumed lifetime. Null when
   * the provider stated none — Meta explicitly warns its long-lived tokens
   * may "expire early", so a computed 60 days would be a guess.
   */
  expiresAt: Date | null;
  /** Permissions the provider actually granted. Not secret. */
  grantedScopes: string[];
};

/**
 * Writes (or replaces) the encrypted credential for one account.
 *
 * One credential per account, enforced by the table's own unique constraint —
 * reconnecting replaces the old token rather than accumulating stale ones.
 */
export async function storeSocialCredential(input: StoreCredentialInput): Promise<void> {
  const envelope: SocialCredentialEnvelope = {
    kind: ENVELOPE_KIND,
    v: ENVELOPE_VERSION,
    accessToken: input.accessToken,
  };
  const { encryptedPayload, encryptionKeyVersion } = encryptCredentialPayload(JSON.stringify(envelope));

  await prisma.socialAccountCredential.upsert({
    where: { socialAccountId: input.socialAccountId },
    create: {
      socialAccountId: input.socialAccountId,
      companyId: input.companyId,
      credentialType: "OAUTH2_ACCESS_TOKEN",
      encryptedPayload,
      encryptionKeyVersion,
      expiresAt: input.expiresAt,
      grantedScopes: input.grantedScopes,
    },
    update: {
      companyId: input.companyId,
      credentialType: "OAUTH2_ACCESS_TOKEN",
      encryptedPayload,
      encryptionKeyVersion,
      expiresAt: input.expiresAt,
      grantedScopes: input.grantedScopes,
    },
  });
}

/**
 * The decrypted access token for one account, for a server-side provider call
 * that is about to use it.
 *
 * Company-scoped on purpose: passing another company's account id returns
 * null, exactly as if the account did not exist. Null also covers "connected
 * but the credential row is gone", which is a real state after a disconnect.
 */
export async function readAccessToken(socialAccountId: string, companyId: string): Promise<string | null> {
  const row = await prisma.socialAccountCredential.findUnique({
    where: { socialAccountId },
    select: { companyId: true, encryptedPayload: true, encryptionKeyVersion: true },
  });
  if (!row || row.companyId !== companyId) return null;

  const plaintext = decryptCredentialPayload(row.encryptedPayload, row.encryptionKeyVersion);

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    // Deliberately does not include the plaintext.
    throw new Error("Stored social credential is not readable.");
  }

  if (!isSocialEnvelope(parsed)) {
    /*
     * This is the separation from publishing doing its job: a payload
     * encrypted for a WordPress connection decrypts fine (same key) but has
     * no `social_oauth2` tag, so it is refused here instead of being used.
     */
    throw new Error("Stored credential is not a social credential.");
  }

  return parsed.accessToken;
}

/** Whether an account has a stored credential at all, without decrypting anything. */
export async function hasStoredCredential(socialAccountId: string, companyId: string): Promise<boolean> {
  const count = await prisma.socialAccountCredential.count({ where: { socialAccountId, companyId } });
  return count > 0;
}

/**
 * Destroys the stored authorization for one account.
 *
 * Deleting the row is the point: disconnecting must leave nothing decryptable
 * behind. The SocialAccount itself — the client's own record of who they are
 * on the platform — is untouched, because a person disconnecting is saying
 * "stop using this authorization", not "forget this page exists".
 */
export async function deleteSocialCredential(socialAccountId: string, companyId: string): Promise<void> {
  await prisma.socialAccountCredential.deleteMany({ where: { socialAccountId, companyId } });
}

function isSocialEnvelope(value: unknown): value is SocialCredentialEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === ENVELOPE_KIND &&
    candidate.v === ENVELOPE_VERSION &&
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0
  );
}
