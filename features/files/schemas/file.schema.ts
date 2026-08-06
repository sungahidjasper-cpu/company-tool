import { z } from "zod";

export const FILE_ENTITY_TYPES = ["company", "client", "project", "task", "user"] as const;
export type FileEntityType = (typeof FILE_ENTITY_TYPES)[number];

export const fileEntityTypeSchema = z.enum(FILE_ENTITY_TYPES);

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "application/zip",
];
