import { z } from "zod";

import { SocialPlatform } from "@/lib/generated/prisma/enums";
import type { SocialConnectionState } from "@/lib/generated/prisma/enums";

/**
 * Phase 7 — what a client's social account is allowed to be.
 * Phase 9 — plus what its real connection state is.
 *
 * STILL NO CREDENTIAL FIELD, ANYWHERE. Not in an input schema, not in the
 * summary the settings screen renders. Tokens are accepted only from a
 * provider during a callback, encrypted immediately, and stored in
 * SocialAccountCredential — a table nothing in this file can reach. Adding a
 * credential field here is how one would eventually leak, so there is none to
 * add to.
 *
 * A person may not type an `externalId` either. It is present on the summary
 * because a Page id is public identity worth showing, but no input schema
 * accepts one: real platform identity comes from the provider, or not at all.
 */

export const MAX_HANDLE_LENGTH = 80;
export const MAX_DISPLAY_NAME_LENGTH = 120;

const platformEnum = z.enum(Object.values(SocialPlatform) as [SocialPlatform, ...SocialPlatform[]]);

/**
 * A handle is display text, so the rules are about legibility, not syntax:
 * no whitespace in the middle (a handle with a space in it is a copy-paste
 * accident) and no URL, because a profile URL is not a handle.
 */
const handleField = z
  .string()
  .trim()
  .min(2, "A handle needs at least 2 characters.")
  .max(MAX_HANDLE_LENGTH, `Keep the handle under ${MAX_HANDLE_LENGTH} characters.`)
  .refine((value) => !/\s/.test(value), "A handle cannot contain spaces.")
  .refine((value) => !/^https?:\/\//i.test(value), "Enter the handle, not the profile URL.");

const displayNameField = z
  .string()
  .trim()
  .max(MAX_DISPLAY_NAME_LENGTH, `Keep the name under ${MAX_DISPLAY_NAME_LENGTH} characters.`)
  .optional()
  .default("");

export const addSocialAccountSchema = z.object({
  clientId: z.string().min(1, "Choose a client."),
  platform: platformEnum,
  handle: handleField,
  displayName: displayNameField,
});

export const updateSocialAccountSchema = z.object({
  accountId: z.string().min(1),
  handle: handleField,
  displayName: displayNameField,
});

export const setSocialAccountStatusSchema = z.object({
  accountId: z.string().min(1),
  status: z.enum(["ACTIVE", "DISCONNECTED"]),
});

export type AddSocialAccountInput = z.input<typeof addSocialAccountSchema>;
export type UpdateSocialAccountInput = z.input<typeof updateSocialAccountSchema>;
export type SetSocialAccountStatusInput = z.input<typeof setSocialAccountStatusSchema>;

/** The shape the settings screen renders. No credential field exists to leak. */
export type SocialAccountSummary = {
  id: string;
  clientId: string;
  platform: SocialPlatform;
  handle: string;
  displayName: string | null;
  /**
   * The USER'S switch: whether they want this account available in Cloud
   * Compass. Says nothing about whether the platform is connected — that is
   * `connectionState`, and conflating the two is the Phase 9 defect.
   */
  status: "ACTIVE" | "DISCONNECTED";
  /** Whether an authorization really exists. NOT_CONNECTED for every hand-added account. */
  connectionState: SocialConnectionState;
  /** The platform's own id, once a provider supplied one. Public identity, not a secret. */
  externalId: string | null;
  /** ISO strings so this crosses to a client component unchanged. */
  connectedAt: string | null;
  lastCheckedAt: string | null;
  /** Why the last check failed. A check RESULT — never a credential. */
  lastCheckError: string | null;
  /**
   * Whether a credential is stored. A boolean, deliberately: the settings
   * screen needs to know one exists and must never receive the thing itself.
   */
  hasStoredCredential: boolean;
  /** How many saved posts already target this account — what removal would affect. */
  targetCount: number;
};
