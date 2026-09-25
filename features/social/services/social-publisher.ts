import type { SocialPlatform } from "@/lib/generated/prisma/enums";

/**
 * Phase 10A — what a social platform has to be able to do to genuinely
 * PUBLISH, mirroring social-provider.ts's split for CONNECTING.
 *
 * PURE TYPES — no secrets, no Prisma, safe for a client bundle. Exactly one
 * implementation exists today (Facebook); everything else is honestly
 * "not built yet", the same discipline social-provider.ts already applies to
 * connecting.
 *
 * PROVIDER-NEUTRAL ON PURPOSE. This does not assume every platform accepts a
 * plain text message and an optional link — a provider with a genuinely
 * different publish shape (a two-step media container, a resumable video
 * upload, a board-scoped Pin) implements this SAME interface with whatever
 * internal steps that requires; nothing outside its own file needs to know.
 */

export type PublishMediaKind = "IMAGE" | "VIDEO";

/**
 * Stage 2 — real bytes, not a URL.
 *
 * Cloud Compass's own file-serving route (`/api/files/{id}`) requires a
 * signed-in session, so a provider (or the platform it publishes to) has no
 * way to fetch it — there is no public URL to hand over. Meta's own Page
 * Photos reference documents a `source` binary-upload parameter as an
 * equal alternative to a public `url`, so the action reads the file's bytes
 * server-side (from Cloud Compass's own storage, which it already has direct
 * access to) and the provider uploads them directly. Nothing here fetches a
 * URL on the provider's behalf, and no file URL is ever handed to Meta.
 */
export type PublishMediaInput = {
  kind: PublishMediaKind;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
};

export type PublishInput = {
  /** The account's own decrypted credential. Never logged, never returned. */
  accessToken: string;
  /** The platform's own id for the account being published to (e.g. a Facebook Page id). */
  externalId: string;
  content: string;
  link: string | null;
  media: readonly PublishMediaInput[];
};

export type PublishSuccess = {
  /** The provider's own id for what it created. Public identity, not a secret. */
  externalPostId: string;
  /** Only ever set from a value the PROVIDER returned — never a guessed URL pattern. */
  externalUrl: string | null;
};

export type PublishFailure = {
  /** A short, stable machine code (e.g. "PROVIDER_REJECTED"), for branching without parsing prose. */
  code: string;
  /** One sentence safe to show a person. Provider error bodies can echo request parameters — never surfaced. */
  message: string;
  /** For the server log only. */
  logDetail?: string;
};

export type PublishResult = { ok: true; result: PublishSuccess } | { ok: false; failure: PublishFailure };

/**
 * First Comment — a SEPARATE operation from publishing the post itself, on
 * purpose: it can only ever be attempted once a real post id exists, it has
 * its own success/failure outcome, and a provider's comment shape need not
 * resemble its post shape at all.
 */
export type PublishCommentInput = {
  /** The account's own decrypted credential. Never logged, never returned. */
  accessToken: string;
  /** The provider's own id for the post this comment is published under — never a Cloud Compass id. */
  externalPostId: string;
  comment: string;
};

export type PublishCommentSuccess = {
  /** The provider's own id for the comment it created. Public identity, not a secret. */
  externalCommentId: string;
};

export type PublishCommentResult = { ok: true; result: PublishCommentSuccess } | { ok: false; failure: PublishFailure };

export type SocialPublisher = {
  platform: SocialPlatform;
  publish(input: PublishInput): Promise<PublishResult>;
  /**
   * Optional — a future platform's publisher can implement `publish` alone
   * and honestly leave comments unsupported, rather than every provider
   * being forced to pretend it has one.
   */
  publishComment?(input: PublishCommentInput): Promise<PublishCommentResult>;
};

/** Platforms with a real publisher implementation. Everything else is honestly "not built yet". */
export const PUBLISHABLE_PLATFORMS: readonly SocialPlatform[] = ["FACEBOOK"];

export function isPublishablePlatform(platform: SocialPlatform): boolean {
  return PUBLISHABLE_PLATFORMS.includes(platform);
}
