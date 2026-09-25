import { z } from "zod";

export const FILE_ENTITY_TYPES = [
  "company",
  "client",
  "project",
  "task",
  "lead",
  "seoProject",
  "content",
  "user",
] as const;
export type FileEntityType = (typeof FILE_ENTITY_TYPES)[number];

export const fileEntityTypeSchema = z.enum(FILE_ENTITY_TYPES);

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * The image subset of ALLOWED_MIME_TYPES, named here so every consumer agrees
 * on what counts as an image rather than each re-listing the four strings.
 * Spread into ALLOWED_MIME_TYPES below so the two can never drift apart.
 */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** True for the four image types this platform accepts; false for every document/archive type. */
export function isImageMimeType(mimeType: string): mimeType is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Phase 6 — the video types a social post may attach.
 *
 * Named separately for the same reason as IMAGE_MIME_TYPES, and spread into
 * ALLOWED_MIME_TYPES below so the lists cannot drift. Note the platform-wide
 * MAX_FILE_SIZE_BYTES still applies, which is small for video — that limit is
 * deliberately left alone rather than raised for one feature.
 */
export const VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export type VideoMimeType = (typeof VIDEO_MIME_TYPES)[number];

export function isVideoMimeType(mimeType: string): mimeType is VideoMimeType {
  return (VIDEO_MIME_TYPES as readonly string[]).includes(mimeType);
}

export const ALLOWED_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
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
