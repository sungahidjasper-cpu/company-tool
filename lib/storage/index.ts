import { LocalFileStorage } from "@/lib/storage/local-file-storage";
import type { FileStorage } from "@/lib/storage/file-storage";

export type { FileStorage, SaveFileInput, SavedFile } from "@/lib/storage/file-storage";

/**
 * The single place that decides which storage provider is active. To
 * migrate to S3 / Cloudinary / Vercel Blob / Azure Blob / GCS: implement
 * FileStorage in a new file and swap the instantiation below — every
 * consumer (Server Actions, the download route) is unaffected.
 */
export const storage: FileStorage = new LocalFileStorage();
