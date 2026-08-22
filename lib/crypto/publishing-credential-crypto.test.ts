import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_KEY = Buffer.from("0".repeat(32)).toString("base64");

describe("publishing-credential-crypto", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLISHING_CREDENTIAL_ENCRYPTION_KEY", TEST_KEY);
    vi.resetModules();
  });

  it("round-trips a plaintext payload", async () => {
    const { encryptCredentialPayload: encrypt, decryptCredentialPayload: decrypt } = await import(
      "@/lib/crypto/publishing-credential-crypto"
    );
    const plaintext = JSON.stringify({ username: "admin", applicationPassword: "abcd 1234 EFGH 5678" });

    const { encryptedPayload, encryptionKeyVersion } = encrypt(plaintext);
    expect(encryptedPayload).not.toContain("abcd");
    expect(encryptedPayload).not.toContain("admin");
    expect(encryptionKeyVersion).toBe(1);

    const decrypted = decrypt(encryptedPayload, encryptionKeyVersion);
    expect(decrypted).toBe(plaintext);
  });

  it("produces a different ciphertext for the same plaintext each time (random IV)", async () => {
    const { encryptCredentialPayload: encrypt } = await import("@/lib/crypto/publishing-credential-crypto");
    const a = encrypt("same-plaintext");
    const b = encrypt("same-plaintext");
    expect(a.encryptedPayload).not.toBe(b.encryptedPayload);
  });

  it("rejects a tampered ciphertext", async () => {
    const { encryptCredentialPayload: encrypt, decryptCredentialPayload: decrypt } = await import(
      "@/lib/crypto/publishing-credential-crypto"
    );
    const { encryptedPayload, encryptionKeyVersion } = encrypt("secret-value");
    const parts = encryptedPayload.split(":");
    // Flip the last character of the ciphertext segment.
    const tamperedCiphertext = parts[3].slice(0, -1) + (parts[3].endsWith("A") ? "B" : "A");
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext].join(":");

    expect(() => decrypt(tampered, encryptionKeyVersion)).toThrow();
  });

  it("rejects decryption with the wrong key", async () => {
    const { encryptCredentialPayload: encrypt } = await import("@/lib/crypto/publishing-credential-crypto");
    const { encryptedPayload, encryptionKeyVersion } = encrypt("secret-value");

    vi.stubEnv("PUBLISHING_CREDENTIAL_ENCRYPTION_KEY", Buffer.from("1".repeat(32)).toString("base64"));
    vi.resetModules();
    const { decryptCredentialPayload: decryptWithWrongKey } = await import(
      "@/lib/crypto/publishing-credential-crypto"
    );

    expect(() => decryptWithWrongKey(encryptedPayload, encryptionKeyVersion)).toThrow();
  });

  it("throws a clear error when the encryption key env var is missing", async () => {
    vi.stubEnv("PUBLISHING_CREDENTIAL_ENCRYPTION_KEY", "");
    vi.resetModules();
    const { encryptCredentialPayload: encryptWithoutKey } = await import(
      "@/lib/crypto/publishing-credential-crypto"
    );
    expect(() => encryptWithoutKey("anything")).toThrow(/PUBLISHING_CREDENTIAL_ENCRYPTION_KEY/);
  });

  it("throws a clear error when the key is the wrong length", async () => {
    vi.stubEnv("PUBLISHING_CREDENTIAL_ENCRYPTION_KEY", Buffer.from("too-short").toString("base64"));
    vi.resetModules();
    const { encryptCredentialPayload: encryptWithBadKey } = await import(
      "@/lib/crypto/publishing-credential-crypto"
    );
    expect(() => encryptWithBadKey("anything")).toThrow(/32 bytes/);
  });
});
