import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Phase 24 Stage 1 — AES-256-GCM encryption for PublishingCredential.encryptedPayload.
 * Node's built-in crypto module, no new dependency. Format:
 * "v<keyVersion>:<base64 iv>:<base64 authTag>:<base64 ciphertext>" — a single
 * self-describing string, never the raw secret. The master key never lives in
 * the database; it's read once from an env var at first use.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;
const CURRENT_KEY_VERSION = 1;

let cachedKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.PUBLISHING_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "PUBLISHING_CREDENTIAL_ENCRYPTION_KEY is not set. A 32-byte, base64-encoded key is required before any publishing credential can be encrypted or decrypted."
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `PUBLISHING_CREDENTIAL_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes (got ${key.length}).`
    );
  }

  cachedKey = key;
  return key;
}

export type EncryptedCredential = {
  encryptedPayload: string;
  encryptionKeyVersion: number;
};

/**
 * Encrypts a plaintext credential payload (e.g. JSON.stringify({ username, applicationPassword })).
 * The returned encryptedPayload is safe to persist; the plaintext argument
 * must never be logged, returned, or persisted anywhere else.
 */
export function encryptCredentialPayload(plaintext: string): EncryptedCredential {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const encryptedPayload = [
    `v${CURRENT_KEY_VERSION}`,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");

  return { encryptedPayload, encryptionKeyVersion: CURRENT_KEY_VERSION };
}

/**
 * Decrypts a previously-encrypted payload. Throws on any tampering (wrong
 * key, corrupted ciphertext, or a mismatched auth tag) — AES-GCM's
 * authentication check fails closed, never silently returning garbage.
 */
export function decryptCredentialPayload(encryptedPayload: string, encryptionKeyVersion: number): string {
  if (encryptionKeyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(`Unsupported encryption key version: ${encryptionKeyVersion}`);
  }

  const parts = encryptedPayload.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed encrypted credential payload.");
  }
  const [versionTag, ivB64, authTagB64, ciphertextB64] = parts;
  if (versionTag !== `v${encryptionKeyVersion}`) {
    throw new Error("Encrypted payload's embedded version tag does not match encryptionKeyVersion.");
  }

  const key = getMasterKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
