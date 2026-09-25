/**
 * Phase 6 — the Social Composer's rules.
 *
 * Pure and read-only: no I/O, no state, no writes, no AI. The composer UI and
 * the server action both import from here, so what the user is told and what
 * the server enforces cannot drift apart.
 *
 * Nothing in this module publishes anything. There is no platform API in this
 * system, and a "target" here means an account this post is INTENDED for.
 */

import type { SocialConnectionState, SocialPlatform } from "@/lib/generated/prisma/enums";

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  X: "X",
  TIKTOK: "TikTok",
  PINTEREST: "Pinterest",
  YOUTUBE: "YouTube",
  GOOGLE_BUSINESS_PROFILE: "Google Business Profile",
};

/**
 * Published caption limits, per platform.
 *
 * Reference data for guidance, never a claim that a platform is connected —
 * a limit is only ever applied for an account that actually exists in the
 * database. These are the platforms' own documented maximums.
 */
export const PLATFORM_CAPTION_LIMITS: Record<SocialPlatform, number> = {
  FACEBOOK: 63206,
  INSTAGRAM: 2200,
  LINKEDIN: 3000,
  X: 280,
  TIKTOK: 2200,
  PINTEREST: 500,
  YOUTUBE: 5000,
  GOOGLE_BUSINESS_PROFILE: 1500,
};

/**
 * The limit that actually binds a caption: the strictest among the platforms
 * the post is going to.
 *
 * With no account selected there is no platform to bind to, so this returns
 * null and the composer shows a plain character count rather than inventing a
 * limit no platform asked for.
 */
export function bindingCaptionLimit(platforms: readonly SocialPlatform[]): { limit: number; platform: SocialPlatform } | null {
  let strictest: { limit: number; platform: SocialPlatform } | null = null;
  for (const platform of platforms) {
    const limit = PLATFORM_CAPTION_LIMITS[platform];
    if (limit === undefined) continue;
    if (strictest === null || limit < strictest.limit) strictest = { limit, platform };
  }
  return strictest;
}

/* -------------------------------------------------------------- hashtags */

/**
 * The hashtags written in a caption.
 *
 * Hashtags are part of the caption rather than a separate system, because
 * that is how they are typed and how their characters are counted. This only
 * reads them back out — for display and for validation — and never rewrites
 * the caption or adds any.
 */
export function extractHashtags(caption: string): string[] {
  const matches = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    const key = match.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(match);
  }
  return result;
}

/** A bare `#` with nothing after it — the one hashtag mistake worth naming. */
export function hasMalformedHashtag(caption: string): boolean {
  return /#(?![\p{L}\p{N}_])/u.test(caption);
}

/* ---------------------------------------------------------------- limits */

/** The longest a record's derived name may be. Not a field anyone types. */
export const MAX_POST_TITLE_LENGTH = 120;
export const MAX_CAPTION_LENGTH = 5000;

/**
 * Enough hashtags to be useful, past which it reads as stuffing. A warning
 * rather than a block: the number that is right varies, and refusing to save
 * someone's post over it would be the wrong call.
 */
export const HASHTAG_ADVISORY_THRESHOLD = 12;

export type CaptionMeasurement = {
  characters: number;
  hashtags: string[];
  /** The binding platform limit, when platforms are selected. */
  limit: number | null;
  limitPlatform: SocialPlatform | null;
  /** Characters left before the binding limit. Null when nothing binds. */
  remaining: number | null;
  overLimit: boolean;
  /** Non-blocking guidance, e.g. a very high hashtag count. */
  advisory: string | null;
};

/** Everything the caption box needs to report, computed once. */
export function measureCaption(caption: string, platforms: readonly SocialPlatform[]): CaptionMeasurement {
  const binding = bindingCaptionLimit(platforms);
  const characters = [...caption].length;
  const hashtags = extractHashtags(caption);

  return {
    characters,
    hashtags,
    limit: binding?.limit ?? null,
    limitPlatform: binding?.platform ?? null,
    remaining: binding ? binding.limit - characters : null,
    overLimit: binding ? characters > binding.limit : false,
    advisory:
      hashtags.length > HASHTAG_ADVISORY_THRESHOLD
        ? `${hashtags.length} hashtags is a lot — most platforms reward a focused handful over a long list.`
        : null,
  };
}

/* ------------------------------------------------------------ validation */

export type ComposerDraft = {
  caption: string;
  link: string;
  /** Account ids the user selected. Verified against the client's own accounts server-side. */
  accountIds: readonly string[];
};

export type ComposerValidation = { ok: true } | { ok: false; field: "caption" | "link" | "accounts"; error: string };

/**
 * Whether a draft may be saved.
 *
 * `platforms` are the platforms of the accounts actually selected, which is
 * what makes the caption limit real rather than hypothetical. The link is
 * only shape-checked here — the SSRF guard is asynchronous and runs in the
 * action, which is the only place that can be a security boundary anyway.
 */
export function validateComposerDraft(draft: ComposerDraft, platforms: readonly SocialPlatform[]): ComposerValidation {
  const caption = draft.caption.trim();
  if (caption.length === 0) return { ok: false, field: "caption", error: "Write a caption — this is what the post actually says." };
  if ([...caption].length > MAX_CAPTION_LENGTH) return { ok: false, field: "caption", error: `Captions are limited to ${MAX_CAPTION_LENGTH} characters.` };

  const measurement = measureCaption(caption, platforms);
  if (measurement.overLimit && measurement.limitPlatform) {
    return {
      ok: false,
      field: "caption",
      error: `${SOCIAL_PLATFORM_LABELS[measurement.limitPlatform]} allows ${measurement.limit} characters and this caption is ${measurement.characters}.`,
    };
  }

  if (hasMalformedHashtag(caption)) return { ok: false, field: "caption", error: "A '#' needs a word after it." };

  const link = draft.link.trim();
  if (link.length > 0 && !/^https?:\/\/\S+$/i.test(link)) {
    return { ok: false, field: "link", error: "A link must be a full http:// or https:// address." };
  }

  return { ok: true };
}

/* --------------------------------------------------------------- preview */

export type PreviewModel = {
  accountLabel: string;
  handle: string | null;
  caption: string;
  hashtags: string[];
  link: string | null;
  /** The intended time, already formatted; the composer supplies it. */
  scheduleLabel: string | null;
  /** True when no account is connected, so the preview is generic. */
  generic: boolean;
};

/**
 * What the preview shows.
 *
 * With no connected account this is explicitly GENERIC — it never claims to
 * be how a particular platform will render the post, because this phase does
 * not implement platform-specific rendering and pretending otherwise would
 * mislead someone into approving copy they have not really seen.
 */
export function buildPreview(input: {
  caption: string;
  link: string;
  scheduleLabel: string | null;
  account: { platform: SocialPlatform; handle: string } | null;
}): PreviewModel {
  const caption = input.caption.trim();
  const link = input.link.trim();
  return {
    accountLabel: input.account ? SOCIAL_PLATFORM_LABELS[input.account.platform] : "Social post",
    handle: input.account?.handle ?? null,
    caption,
    hashtags: extractHashtags(caption),
    link: link.length > 0 ? link : null,
    scheduleLabel: input.scheduleLabel,
    generic: input.account === null,
  };
}

/**
 * The two states a saved social post can be in, and what each honestly means.
 *
 * Kept explicit because "scheduled" here means scheduled IN THIS SYSTEM. No
 * platform is contacted, nothing is queued for delivery, and nobody outside
 * Cloud Compass learns anything about the post.
 */
export const SCHEDULED_IN_APP_NOTE =
  "Scheduled in Cloud Compass. This records when you intend to publish — it does not send the post to any social platform, and no platform is connected.";

export const DRAFT_NOTE = "Saved as a draft. Nothing is scheduled and nothing is published.";

/* --------------------------------------------- per-platform customization */

/**
 * Phase 7 — one post, many accounts, each able to say it differently.
 *
 * A target either INHERITS the post's shared caption or carries its own. That
 * distinction is the whole model, and `null` is what carries it: null means
 * "whatever the shared caption says, now and later", while a string — even an
 * empty one — means "this account has been customized".
 *
 * Everything below is pure, so the tabs in the composer and the server action
 * enforce the same rules from the same source.
 */
export type TargetDraft = {
  accountId: string;
  platform: SocialPlatform;
  /** How this account should be named in an error message, e.g. "@storagemoguls". */
  label: string;
  /** null inherits the shared caption. */
  caption: string | null;
  /** null inherits the shared link. */
  link: string | null;
  /** null inherits the shared first comment (which may itself be null — no comment at all). */
  firstComment: string | null;
};

/** What a target actually says once inheritance is resolved. */
export function effectiveCaption(baseCaption: string, target: Pick<TargetDraft, "caption">): string {
  return target.caption ?? baseCaption;
}

export function effectiveLink(baseLink: string, target: Pick<TargetDraft, "link">): string {
  return target.link ?? baseLink;
}

/**
 * What a target's first comment actually says once inheritance is resolved.
 * `baseFirstComment` is nullable (unlike the base caption, which is always
 * required) — no shared comment and no override both mean "nothing to post".
 */
export function effectiveFirstComment(baseFirstComment: string | null, target: Pick<TargetDraft, "firstComment">): string {
  return (target.firstComment ?? baseFirstComment ?? "").trim();
}

/**
 * The platforms the SHARED caption still has to satisfy: only the ones still
 * inheriting it.
 *
 * This is why per-platform captions are worth having. X allows 280 characters,
 * so with a shared caption a single X account caps everything. Give X its own
 * caption and it stops constraining the others — which is exactly what the
 * writer meant by customizing it.
 */
export function inheritingPlatforms(targets: readonly TargetDraft[]): SocialPlatform[] {
  return targets.filter((target) => target.caption === null).map((target) => target.platform);
}

export type TargetValidation = { ok: true } | { ok: false; accountId: string; field: "caption" | "link"; error: string };

/**
 * Every customized target, checked against ITS OWN platform.
 *
 * A target is judged only by its own platform's rules, so an over-long
 * LinkedIn caption can never invalidate the Instagram one — changing one
 * platform does not change another, in validation as much as in content.
 */
export function validateTargets(targets: readonly TargetDraft[]): TargetValidation {
  for (const target of targets) {
    if (target.caption !== null) {
      const caption = target.caption.trim();
      if (caption.length === 0) {
        return { ok: false, accountId: target.accountId, field: "caption", error: `Write a caption for ${target.label}, or reset it to the shared caption.` };
      }
      if ([...caption].length > MAX_CAPTION_LENGTH) {
        return { ok: false, accountId: target.accountId, field: "caption", error: `Captions are limited to ${MAX_CAPTION_LENGTH} characters.` };
      }

      const measurement = measureCaption(caption, [target.platform]);
      if (measurement.overLimit) {
        return {
          ok: false,
          accountId: target.accountId,
          field: "caption",
          error: `${SOCIAL_PLATFORM_LABELS[target.platform]} allows ${measurement.limit} characters and the caption for ${target.label} is ${measurement.characters}.`,
        };
      }
      if (hasMalformedHashtag(caption)) {
        return { ok: false, accountId: target.accountId, field: "caption", error: `A '#' needs a word after it — check the caption for ${target.label}.` };
      }
    }

    if (target.link !== null) {
      const link = target.link.trim();
      if (link.length > 0 && !/^https?:\/\/\S+$/i.test(link)) {
        return { ok: false, accountId: target.accountId, field: "link", error: `The link for ${target.label} must be a full http:// or https:// address.` };
      }
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------- the record's name */

/**
 * What to call the Content row behind a social post.
 *
 * `Content.title` is NOT NULL, so every social post needs one — but nobody
 * writing a post thinks about naming a database record, and asking them to
 * was the UI leaking the schema's mental model into the user's. The caption
 * already says what the post is, so the name is taken from it.
 *
 * Derived on every save, so a record's name always matches what the post
 * currently says rather than drifting from an old first draft. Hashtags are
 * dropped from the name — they are part of the message, not a description of
 * it, and a list of tags makes a poor label in the content workspace.
 *
 * Pure: the caller supplies `now`, so the empty-caption fallback is testable
 * and never depends on the clock during a render.
 */
export function deriveSocialPostTitle(caption: string, now: Date): string {
  const firstLine = caption.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const withoutHashtags = firstLine.replace(/#[\p{L}\p{N}_]+/gu, " ").replace(/\s+/g, " ").trim();

  // A caption that is ONLY hashtags still deserves a name, so fall back to the
  // line as written before falling back to the date.
  const source = withoutHashtags.length > 0 ? withoutHashtags : firstLine;
  if (source.length === 0) return `Social post — ${now.toISOString().slice(0, 10)}`;

  const characters = [...source];
  if (characters.length <= MAX_POST_TITLE_LENGTH) return source;
  return characters.slice(0, MAX_POST_TITLE_LENGTH - 1).join("").trimEnd() + "…";
}

/* ------------------------------------------------------- Publish Now */

/**
 * Which accounts a composer should start with selected.
 *
 * A reopened post's own saved targets always win — this never overrides an
 * explicit past choice. For a brand-new post with nothing saved yet, exactly
 * one CONNECTED account is selected automatically: with only one real choice
 * available, requiring a click first is friction with no decision behind it.
 * Two or more connected accounts (or zero) leave the saved/empty selection
 * alone — guessing among several would be a real guess, not a convenience.
 */
export function resolveInitialAccountSelection(
  accounts: readonly { id: string; connectionState: SocialConnectionState }[],
  savedAccountIds: readonly string[]
): string[] {
  if (savedAccountIds.length > 0) return [...savedAccountIds];
  const solelyConnected = accounts.filter((account) => account.connectionState === "CONNECTED");
  return solelyConnected.length === 1 ? [solelyConnected[0].id] : [...savedAccountIds];
}

export type PublishEligibility = { ok: true; accountId: string } | { ok: false; reason: string };

/**
 * Whether "Publish Now" may run right now, and why not when it can't.
 *
 * NOT tied to which platform tab happens to be open: a selected, genuinely
 * CONNECTED account is eligible regardless — the active account only matters
 * to disambiguate when more than one is selected. Content validity uses the
 * EXACT SAME `validateComposerDraft`/`validateTargets` Save Draft itself
 * runs, passed in rather than re-imported here, so there is exactly one
 * definition of "valid enough to save" — Publish Now never gets a looser or
 * stricter rule than saving already has.
 */
export function evaluatePublishEligibility(input: {
  allAccounts: readonly { connectionState: SocialConnectionState }[];
  selectedAccounts: readonly { id: string; connectionState: SocialConnectionState }[];
  activeAccountId: string | null;
  contentValidation: ComposerValidation;
  targetsValidation: TargetValidation;
}): PublishEligibility {
  const eligibleConnectedAccounts = input.selectedAccounts.filter((account) => account.connectionState === "CONNECTED");
  const publishTargetAccount =
    (input.activeAccountId
      ? (eligibleConnectedAccounts.find((account) => account.id === input.activeAccountId) ?? null)
      : null) ?? (eligibleConnectedAccounts.length === 1 ? eligibleConnectedAccounts[0] : null);

  if (publishTargetAccount && input.contentValidation.ok && input.targetsValidation.ok) {
    return { ok: true, accountId: publishTargetAccount.id };
  }

  /* NEVER silent — every disabled state says why, including "nothing is selected yet". */
  if (eligibleConnectedAccounts.length === 0) {
    return {
      ok: false,
      reason: input.allAccounts.some((account) => account.connectionState === "CONNECTED")
        ? "Select an account to publish to."
        : "Connect an account before publishing.",
    };
  }
  if (!publishTargetAccount) return { ok: false, reason: "Open the platform's tab you want to Publish Now for." };
  if (!input.contentValidation.ok) return { ok: false, reason: input.contentValidation.error };
  if (!input.targetsValidation.ok) return { ok: false, reason: input.targetsValidation.error };
  return { ok: false, reason: "This post can't be published yet." };
}
