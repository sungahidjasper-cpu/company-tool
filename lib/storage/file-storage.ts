export type SaveFileInput = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

export type SavedFile = {
  key: string;
  sizeBytes: number;
};

/**
 * Storage-provider abstraction. Business logic (Server Actions, route
 * handlers) depends only on this interface, never on a concrete provider.
 * Migrating to S3 / Cloudinary / Vercel Blob / Azure Blob / GCS later means
 * writing one new class that implements this interface and swapping the
 * single instantiation in index.ts — no other file in the codebase changes.
 */
export interface FileStorage {
  save(input: SaveFileInput): Promise<SavedFile>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /**
   * Providers with native signed/public URLs (S3, Blob, Cloudinary) should
   * return one so callers can redirect the client directly instead of
   * proxying bytes through our server. Providers without that capability
   * (local filesystem) return null, and callers fall back to read().
   */
  getSignedUrl(
    key: string,
    options?: { expiresInSeconds?: number }
  ): Promise<string | null>;
}
