import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

import type { FileStorage, SaveFileInput, SavedFile } from "@/lib/storage/file-storage";

const STORAGE_ROOT =
  process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), "storage", "uploads");

/** Local-disk implementation of FileStorage, for development and single-instance hosting. */
export class LocalFileStorage implements FileStorage {
  async save(input: SaveFileInput): Promise<SavedFile> {
    await mkdir(STORAGE_ROOT, { recursive: true });

    const extension = path.extname(input.fileName);
    const key = `${randomUUID()}${extension}`;

    await writeFile(this.resolveKey(key), input.buffer);

    return { key, sizeBytes: input.buffer.byteLength };
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async getSignedUrl(): Promise<string | null> {
    return null;
  }

  /** Guards against a tampered key ever escaping the storage root. */
  private resolveKey(key: string) {
    // turbopackIgnore: this is a runtime data path, not a source-code
    // dependency — without the hint, Turbopack's tracer treats it as one
    // and bundles the entire project into the server output.
    const resolved = path.join(/* turbopackIgnore: true */ STORAGE_ROOT, key);
    if (!resolved.startsWith(STORAGE_ROOT)) {
      throw new Error("Invalid storage key.");
    }
    return resolved;
  }
}
