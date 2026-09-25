"use client";

import { CalendarClock, Check, Hash, Link2, Lock, Send, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelContentScheduleAction } from "@/features/content-workspace/actions/content-scheduling.actions";
import { formatScheduledFor, zonedWallTimeToInstant } from "@/features/content-workspace/services/content-scheduling";
import { browserTimeZone, timeZoneOptions } from "@/features/content-workspace/services/timezone-options";
import { publishSocialPostTargetAction } from "@/features/social/actions/social-publish.actions";
import { saveSocialPostAction } from "@/features/social/actions/social-post.actions";
import type { CommentOutcome, PublishOutcome } from "@/features/social/schemas/social-publish.schema";
import PlatformMark from "@/features/social/components/PlatformMark";
import SocialMediaPanel, { isStagedMedia, uploadStagedMedia, type SocialMediaFile } from "@/features/social/components/SocialMediaPanel";
import {
  DRAFT_NOTE,
  SCHEDULED_IN_APP_NOTE,
  SOCIAL_PLATFORM_LABELS,
  buildPreview,
  effectiveCaption,
  effectiveFirstComment,
  effectiveLink,
  evaluatePublishEligibility,
  inheritingPlatforms,
  measureCaption,
  resolveInitialAccountSelection,
  validateComposerDraft,
  validateTargets,
  type TargetDraft,
} from "@/features/social/services/social-composer";
import { describeConnection } from "@/features/social/services/social-connection-status";
import { describeAccount, platformCapabilities, platformDefinition } from "@/features/social/services/social-platforms";
import type { SocialConnectionState, SocialPlatform } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

const fieldClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/** The tab id for the shared post, distinct from any account id (which is a uuid). */
const SHARED_TAB = "shared";

/**
 * One account the composer may write for.
 *
 * `connectionState` is required, not optional: a composer that could receive
 * an account with no connection state would have to assume one, and assuming
 * is what made a typed handle look publishable in the first place.
 */
export type ComposerAccount = {
  id: string;
  platform: SocialPlatform;
  handle: string;
  displayName: string | null;
  connectionState: SocialConnectionState;
};

/** The real outcome of the one real publish attempt a saved target may have had. */
export type ComposerTargetPublication = {
  status: "DRAFT" | "QUEUED" | "PUBLISHING" | "PROCESSING" | "PUBLISHED" | "FAILED";
  externalPostId: string | null;
  externalUrl: string | null;
  failureMessage: string | null;
};

/** The real outcome of the one real first-comment attempt a saved target may have had — a SEPARATE result from the post's own. */
export type ComposerTargetComment = {
  status: "PENDING" | "PUBLISHING" | "PUBLISHED" | "FAILED";
  externalCommentId: string | null;
  failureMessage: string | null;
};

/**
 * A target's own content. `null` means it follows the shared value.
 *
 * `id` and `publication` exist only for a target that has actually been
 * SAVED — a SocialPostTarget row exists in the database. They are absent for
 * an account only just selected in this editing session, which is exactly
 * why "Publish Test Post" is offered only after a save: publishing needs a
 * real row to record its outcome against, not a plan for one.
 */
export type ComposerTarget = {
  id?: string;
  accountId: string;
  caption: string | null;
  link: string | null;
  firstComment: string | null;
  publication?: ComposerTargetPublication | null;
  comment?: ComposerTargetComment | null;
};

export type SocialComposerProps = {
  /** The client this post is for. A social post always belongs to one. */
  clientId: string;
  clientName: string;
  /** Optional SEO project context — a social post never requires one. */
  seoProjectId: string | null;
  seoProjectName: string | null;
  /** Live accounts for this project's client. Empty is a real, honest state. */
  accounts: ComposerAccount[];
  /** The moment carried in from the calendar. */
  initialDateIso: string;
  initialTime: string;
  initialTimeZone: string | null;
  /** Present when editing a saved post. */
  existing?: {
    contentId: string;
    caption: string;
    link: string;
    firstComment: string;
    targets: ComposerTarget[];
    status: string;
    files: SocialMediaFile[];
  };
  backHref: string;
};

/** A small numbered marker, so the composer reads as a workflow rather than a settings page. */
function Step({ number, title, hint }: { number: number; title: string; hint?: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#2F4156] text-[11px] font-semibold text-white">
        {number}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {hint && <p className="text-xs leading-snug text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * Phase 6 composer, Phase 7 per-platform content.
 *
 * ONE post, MANY accounts, and each account able to say it its own way. The
 * shared tab holds what everyone gets; every selected account gets a tab of
 * its own that either follows the shared caption or replaces it. Because a
 * platform's text lives under that platform's own key, editing Instagram
 * cannot touch Facebook — not in the UI, not in validation, not in the row
 * that is written.
 *
 * Every platform's identity — its mark, its name, its caption limit, whether
 * a link even means anything there — comes from the central registry, so a
 * ninth platform is a registry entry and a SocialAccount row, not a rewrite of
 * this file.
 *
 * Accounts are configured in Settings → Clients → [client] → Social accounts.
 * This screen reads them and never creates one.
 *
 * CONFIGURED IS NOT CONNECTED — Phase 9. Every account chip states which it
 * is. An account can be chosen, written for and scheduled either way, because
 * all of that is internal to Cloud Compass; what an account's connection
 * state changes is what this screen CLAIMS, not what it permits. A chip never
 * reads "Connected" unless the platform really authorized it.
 *
 * It still writes only when Save draft, Schedule or Cancel schedule is
 * pressed, and it still publishes nothing — no post is sent to any platform
 * in this phase.
 */
export default function SocialComposer({
  seoProjectId,
  seoProjectName,
  clientName,
  clientId,
  accounts,
  initialDateIso,
  initialTime,
  initialTimeZone,
  existing,
  backHref,
}: SocialComposerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [caption, setCaption] = useState(existing?.caption ?? "");
  const [link, setLink] = useState(existing?.link ?? "");
  const [accountIds, setAccountIds] = useState<string[]>(() =>
    resolveInitialAccountSelection(accounts, existing?.targets.map((target) => target.accountId) ?? [])
  );
  /**
   * Per-account content, keyed by account id. Absent or null means "follow
   * the shared value" — the key exists only once someone customizes it, so
   * inheritance is the default without anything having to say so.
   */
  const [overrides, setOverrides] = useState<Record<string, { caption: string | null; link: string | null; firstComment: string | null }>>(() =>
    Object.fromEntries((existing?.targets ?? []).map((target) => [target.accountId, { caption: target.caption, link: target.link, firstComment: target.firstComment }]))
  );
  const [activeTab, setActiveTab] = useState<string>(SHARED_TAB);
  const [dateIso, setDateIso] = useState(() => initialDateIso || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [time, setTime] = useState(initialTime);
  const [timeZone, setTimeZone] = useState(initialTimeZone ?? browserTimeZone());
  const [error, setError] = useState<string | null>(null);
  const [contentId, setContentId] = useState(existing?.contentId ?? null);
  const [files, setFiles] = useState<SocialMediaFile[]>(existing?.files ?? []);
  const [isScheduled, setIsScheduled] = useState(existing?.status === "SCHEDULED");
  /**
   * First Comment's shared base text — persisted on `SocialPost.firstComment`,
   * saved and reopened exactly like caption/link. Empty means no comment is
   * intended.
   */
  const [firstComment, setFirstComment] = useState(existing?.firstComment ?? "");

  /*
   * Phase 10A, made real STATE in Stage 1 — which accounts have a real,
   * saved target row, keyed by account id.
   *
   * Seeded from what the page loaded with, but NOT recomputed from `existing`
   * on every render: `save()` deliberately does not re-run the server page
   * after a save (avoids clobbering in-progress edits with a fresh server
   * render — see its own comment), so a target created or updated in THIS
   * editing session would otherwise never appear here at all, and "Publish
   * Now" would stay disabled right after the very Save/Schedule click that
   * was supposed to enable it. `save()` merges each save's real returned
   * target ids into this state directly, which is what actually fixes that.
   */
  const [savedTargetIds, setSavedTargetIds] = useState<Record<string, string>>(() =>
    Object.fromEntries((existing?.targets ?? []).filter((row): row is ComposerTarget & { id: string } => Boolean(row.id)).map((row) => [row.accountId, row.id]))
  );
  const [publishOutcomes, setPublishOutcomes] = useState<Record<string, PublishOutcome>>(() => {
    const entries: [string, PublishOutcome][] = [];
    for (const row of existing?.targets ?? []) {
      if (!row.publication) continue;
      /*
       * The comment's own outcome, reconstructed the same honest way as the
       * post's: PUBLISHED/FAILED only ever from a real stored result, never
       * invented for a comment that was never attempted (no row = no entry).
       */
      const comment: CommentOutcome | undefined =
        row.comment?.status === "PUBLISHED"
          ? { status: "PUBLISHED", externalCommentId: row.comment.externalCommentId ?? "" }
          : row.comment?.status === "FAILED"
            ? { status: "FAILED", failureCode: "", failureMessage: row.comment.failureMessage ?? "Comment publishing failed." }
            : undefined;

      if (row.publication.status === "PUBLISHED") {
        entries.push([
          row.accountId,
          { status: "PUBLISHED", externalPostId: row.publication.externalPostId ?? "", externalUrl: row.publication.externalUrl, comment },
        ]);
      } else if (row.publication.status === "FAILED") {
        entries.push([
          row.accountId,
          { status: "FAILED", failureCode: "", failureMessage: row.publication.failureMessage ?? "Publishing failed.", comment },
        ]);
      }
    }
    return Object.fromEntries(entries);
  });
  const [publishingAccountId, setPublishingAccountId] = useState<string | null>(null);

  const captionRef = useRef<HTMLTextAreaElement | null>(null);
  const linkRef = useRef<HTMLInputElement | null>(null);
  const platformCaptionRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedAccounts = accounts.filter((account) => accountIds.includes(account.id));

  /** The same shape the server builds, so the composer and the action agree by construction. */
  const targets: TargetDraft[] = selectedAccounts.map((account) => ({
    accountId: account.id,
    platform: account.platform,
    label: describeAccount(account).primary,
    caption: overrides[account.id]?.caption ?? null,
    link: overrides[account.id]?.link ?? null,
    firstComment: overrides[account.id]?.firstComment ?? null,
  }));

  /*
   * The shared caption is measured against the platforms STILL INHERITING it.
   * Give X its own caption and its 280-character limit stops governing
   * everyone else's — which is what customizing it was for.
   */
  const sharedMeasurement = measureCaption(caption, inheritingPlatforms(targets));

  const instant = zonedWallTimeToInstant(dateIso, time, timeZone);
  const scheduleLabel = instant ? formatScheduledFor(instant, timeZone) : null;

  /**
   * Save state, derived from a fingerprint of everything the composer can
   * change.
   *
   * The media list is passed in rather than closed over, because saving
   * turns staged files into uploaded ones and their ids change. Recording
   * the fingerprint of the POST-UPLOAD list is what stops a successful save
   * from immediately reporting "Unsaved changes" against its own result.
   */
  function fingerprintOf(mediaList: readonly SocialMediaFile[]): string {
    return JSON.stringify({
      caption,
      link,
      firstComment,
      targets: [...targets].sort((a, b) => a.accountId.localeCompare(b.accountId)),
      media: mediaList.map((file) => file.id).sort(),
    });
  }
  const fingerprint = fingerprintOf(files);
  const [savedFingerprint, setSavedFingerprint] = useState(existing ? fingerprint : null);
  const hasUnsavedChanges = savedFingerprint !== null && savedFingerprint !== fingerprint;

  /*
   * The active platform drives BOTH the editor and the preview — one notion of
   * "which platform am I looking at", so the preview can never be showing one
   * platform while you edit another.
   */
  const activeAccount = selectedAccounts.find((account) => account.id === activeTab) ?? null;
  const activeTarget = targets.find((target) => target.accountId === activeTab) ?? null;
  const previewAccount = activeAccount ?? selectedAccounts[0] ?? null;
  const previewCaption = activeTarget ? effectiveCaption(caption, activeTarget) : caption;
  const previewLinkValue = activeTarget ? effectiveLink(link, activeTarget) : link;
  const previewFirstComment = activeTarget ? effectiveFirstComment(firstComment, activeTarget) : effectiveFirstComment(firstComment, { firstComment: null });

  const preview = buildPreview({
    caption: previewCaption,
    link: previewLinkValue,
    scheduleLabel,
    account: previewAccount ? { platform: previewAccount.platform, handle: previewAccount.handle } : null,
  });

  function toggleAccount(id: string) {
    setAccountIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
    // Deselecting the account you were editing would otherwise leave the tab
    // bar pointing at nothing; the shared tab always exists.
    if (accountIds.includes(id) && activeTab === id) setActiveTab(SHARED_TAB);
  }

  /** Writes ONE account's field. Every other account's entry is copied through untouched. */
  function setOverride(accountId: string, field: "caption" | "link" | "firstComment", value: string | null) {
    setOverrides((current) => {
      const existingEntry = current[accountId] ?? { caption: null, link: null, firstComment: null };
      return { ...current, [accountId]: { ...existingEntry, [field]: value } };
    });
  }

  /** Inserts text at the cursor of whichever caption is being edited. */
  function insertIntoCaption(snippet: string) {
    const textarea = activeAccount ? platformCaptionRef.current : captionRef.current;
    const apply = activeAccount
      ? (next: string) => setOverride(activeAccount.id, "caption", next)
      : (next: string) => setCaption(next);

    if (!textarea) {
      apply((activeTarget?.caption ?? caption) + snippet);
      return;
    }
    const { selectionStart, selectionEnd, value } = textarea;
    apply(value.slice(0, selectionStart) + snippet + value.slice(selectionEnd));
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = selectionStart + snippet.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  /**
   * The one place a post is actually written — Save Draft, Schedule, and
   * Publish Now's own transparent persistence step all call this SAME
   * function, so there is exactly one implementation of "what saving this
   * post means," never two that could drift apart. Returns the real
   * targetIds this save produced so a caller (Publish Now) can act on one
   * immediately, without waiting on anything else.
   */
  async function persistPost(withSchedule: boolean): Promise<{ contentId: string; targetIds: { accountId: string; id: string }[] } | null> {
    const validation = validateComposerDraft({ caption, link, accountIds }, inheritingPlatforms(targets));
    if (!validation.ok) {
      setError(validation.error);
      return null;
    }
    const targetValidation = validateTargets(targets);
    if (!targetValidation.ok) {
      setError(targetValidation.error);
      // Take the writer to the platform that has the problem, so the message
      // points at something they can actually see.
      setActiveTab(targetValidation.accountId);
      return null;
    }
    if (withSchedule && !instant) {
      setError("Choose a valid date, time and timezone before scheduling.");
      return null;
    }

    const result = await saveSocialPostAction({
      contentId: contentId ?? undefined,
      clientId,
      seoProjectId: seoProjectId ?? undefined,
      caption,
      link,
      firstComment,
      accountIds,
      platformOverrides: Object.fromEntries(
        targets.map((target) => [target.accountId, { caption: target.caption, link: target.link, firstComment: target.firstComment }])
      ),
      schedule: withSchedule ? { dateIso, time, timeZone } : undefined,
    });

    if (!result.success) {
      setError(result.message);
      return null;
    }

    setContentId(result.data.contentId);
    if (result.data.scheduled) setIsScheduled(true);
    /*
     * Stage 1 fix — merge in real target ids from THIS save, right now,
     * rather than waiting on a server re-render that deliberately does not
     * happen (see savedTargetIds's own comment). Without this, Publish Now
     * stayed disabled immediately after the very Schedule/Save click that
     * was supposed to enable it, for any target saved in this session.
     */
    if (result.data.targetIds.length > 0) {
      setSavedTargetIds((current) => ({
        ...current,
        ...Object.fromEntries(result.data.targetIds.map((row) => [row.accountId, row.id])),
      }));
    }

    /*
     * Now — and only now — the media the user added while composing gets
     * uploaded, because only now is there a record to attach it to. This is
     * the whole trick: the dependency is real, so it is satisfied here
     * instead of being pushed onto the user as "save a draft first".
     */
    let savedFiles = files;
    if (files.some(isStagedMedia)) {
      const uploaded = await uploadStagedMedia(result.data.contentId, files);
      savedFiles = uploaded.files;
      setFiles(uploaded.files);
      if (uploaded.failed.length > 0) {
        // The post itself saved. Say exactly what did not, rather than
        // implying the whole save failed.
        setError(`The post was saved, but ${uploaded.failed.join(", ")} could not be uploaded. Try adding ${uploaded.failed.length === 1 ? "it" : "them"} again.`);
      }
    }
    setSavedFingerprint(fingerprintOf(savedFiles));
    /*
     * Put the saved record's id in the URL, with the intended moment. The id
     * otherwise lives only in component state, so a refresh reopened an
     * empty composer and the work looked lost — it was safe in the database
     * but unreachable from that URL. replaceState is what Next supports
     * here, and it avoids re-running the server page for values it has.
     */
    const reopen = new URLSearchParams({ contentId: result.data.contentId, date: dateIso, time, tz: timeZone });
    globalThis.history.replaceState(null, "", `/content/create/social?${reopen.toString()}`);

    return { contentId: result.data.contentId, targetIds: result.data.targetIds };
  }

  function save(withSchedule: boolean) {
    setError(null);
    startTransition(async () => {
      const persisted = await persistPost(withSchedule);
      if (!persisted) return;
      toast.success(withSchedule ? "Scheduled in Cloud Compass" : "Draft saved");
      router.refresh();
    });
  }

  /** Reuses the EXISTING Phase 5 action — the composer adds no scheduling system of its own. */
  function cancelSchedule() {
    if (!contentId) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelContentScheduleAction({ contentId });
      if (!result.success) {
        setError(result.message);
        return;
      }
      setIsScheduled(false);
      toast.success("Schedule cancelled — this post is back to draft.");
      router.refresh();
    });
  }

  /**
   * Phase 10A, promoted to a primary action in Stage 1 — the one action in
   * this screen that contacts a real platform.
   *
   * Only offered for a saved target on a genuinely CONNECTED account (the
   * server re-checks both regardless). The outcome shown afterwards is
   * exactly what the provider said — a real external post id and, if the
   * provider returned one, its real permalink; never a guessed one.
   */
  function publishNow(accountId: string) {
    setError(null);
    setPublishingAccountId(accountId);
    startTransition(async () => {
      let targetId: string | undefined = savedTargetIds[accountId];
      /*
       * Transparent persistence — a brand-new, never-saved post gets ONE
       * click, not "save, reload, then publish". This calls the exact same
       * persistPost() Save Draft itself uses, so nothing about validation or
       * ownership is looser for arriving here instead of through Save Draft
       * — it is the identical write, just followed immediately by the real
       * publish call instead of stopping at "saved".
       */
      if (!targetId) {
        const persisted = await persistPost(false);
        if (!persisted) {
          setPublishingAccountId(null);
          return;
        }
        targetId = persisted.targetIds.find((row) => row.accountId === accountId)?.id;
        if (!targetId) {
          setError("This account could not be saved as a target for this post.");
          setPublishingAccountId(null);
          return;
        }
      }

      const result = await publishSocialPostTargetAction({ socialPostTargetId: targetId });
      setPublishingAccountId(null);
      if (!result.success) {
        setError(result.message);
        return;
      }
      setPublishOutcomes((current) => ({ ...current, [accountId]: result.data }));
      toast[result.data.status === "PUBLISHED" ? "success" : "error"](
        result.data.status === "PUBLISHED" ? "Published — a real post now exists on the platform." : `Publishing failed: ${result.data.failureMessage}`
      );
      /*
       * First Comment's own result, shown separately — a failed comment must
       * never read as if the post itself failed, and a published one is real
       * news on its own.
       */
      if (result.data.comment?.status === "PUBLISHED") {
        toast.success("First comment published.");
      } else if (result.data.comment?.status === "FAILED") {
        toast.error(`First comment failed: ${result.data.comment.failureMessage}`);
      }
    });
  }

  /**
   * Stage 3 — what "Publish Now" in the primary action bar would act on, and
   * whether it can run at all right now.
   *
   * ELIGIBILITY IS NO LONGER "ALREADY SAVED". A selected, genuinely CONNECTED
   * account is eligible regardless of whether this post has been saved yet —
   * `publishNow` above saves it transparently the moment it's clicked. NOT
   * tied to which platform tab happens to be open either: the active tab
   * only matters to DISAMBIGUATE when more than one connected account is
   * selected — with exactly one, there is nothing to guess.
   *
   * CONTENT VALIDITY USES THE SAME RULES SAVE DRAFT DOES — the identical
   * `validateComposerDraft`/`validateTargets` calls `persistPost` itself runs.
   * Publish Now does not get a looser or a stricter content rule than saving
   * already has; it is disabled until there is something that could actually
   * be saved.
   */
  const publishEligibility = evaluatePublishEligibility({
    allAccounts: accounts,
    selectedAccounts,
    activeAccountId: activeTab === SHARED_TAB ? null : activeTab,
    contentValidation: validateComposerDraft({ caption, link, accountIds }, inheritingPlatforms(targets)),
    targetsValidation: validateTargets(targets),
  });
  const canPublishNow = publishEligibility.ok;
  const publishTargetAccountId = publishEligibility.ok ? publishEligibility.accountId : null;
  const publishNowBlockedReason = publishEligibility.ok ? null : publishEligibility.reason;
  const isPublishingActive = publishTargetAccountId !== null && publishingAccountId === publishTargetAccountId;

  /**
   * Jumps to whichever link field belongs to the tab you are on.
   *
   * The shared link input is not rendered while a platform tab is open, so
   * focusing the shared ref from there did nothing at all. A control that
   * silently does nothing is worse than one that is absent, which is also why
   * the button is not offered on a platform that has no link to set.
   */
  function focusLink() {
    if (activeAccount) {
      document.getElementById(`link-${activeAccount.id}`)?.focus();
      return;
    }
    linkRef.current?.focus();
  }

  const activeSupportsLink = activeAccount === null || platformCapabilities(activeAccount.platform).link;

  const addToPostActions = (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => insertIntoCaption("#")} disabled={isPending}>
        <Hash size={14} /> Hashtag
      </Button>
      {activeSupportsLink && (
        <Button type="button" variant="outline" size="sm" onClick={focusLink} disabled={isPending}>
          <Link2 size={14} /> Link
        </Button>
      )}
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ------------------------------------------------------ context bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        {/*
          Client -> Content type -> when it goes out. That is the order the
          question actually comes in: whose is this, what is it, and when.
          The SEO project used to sit second and render an EMPTY value for
          client-owned posts, which read as missing data rather than as
          something optional — so it now appears last, and only when there is
          one to show.
        */}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Client</p>
          <p className="truncate text-sm font-medium text-slate-900">{clientName}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Content type</p>
          <p className="truncate text-sm font-medium text-slate-900">Social post</p>
        </div>
        {scheduleLabel && (
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{isScheduled ? "Scheduled for" : "Intended for"}</p>
            <p className="truncate text-sm font-medium text-slate-900">{scheduleLabel}</p>
          </div>
        )}
        {seoProjectName && (
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">SEO project</p>
            <p className="truncate text-sm text-slate-500">{seoProjectName}</p>
          </div>
        )}

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-slate-500">
            {savedFingerprint === null ? (
              "Not saved yet"
            ) : hasUnsavedChanges ? (
              "Unsaved changes"
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check size={13} /> Saved
              </span>
            )}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => router.push(backHref)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => save(false)} disabled={isPending}>
            {isPending ? "Saving…" : "Save draft"}
          </Button>
          <Button type="button" size="sm" onClick={() => save(true)} disabled={isPending}>
            <Send size={14} /> {isScheduled ? "Update schedule" : "Schedule"}
          </Button>
          {isScheduled && contentId && (
            <Button type="button" variant="outline" size="sm" onClick={cancelSchedule} disabled={isPending}>
              Cancel schedule
            </Button>
          )}
          {/*
            Stage 1 — real, right now, to the platform whose tab is open.
            Disabled rather than hidden even with nothing selected, so the
            workflow always reads Save Draft / Schedule / Publish Now.
          */}
          <Button
            type="button"
            size="sm"
            className="bg-emerald-700 hover:bg-emerald-700/90"
            onClick={() => publishTargetAccountId && publishNow(publishTargetAccountId)}
            disabled={isPending || !canPublishNow}
            title={publishNowBlockedReason ?? undefined}
          >
            <Send size={14} /> {isPublishingActive ? "Publishing…" : "Publish Now"}
          </Button>
        </div>
      </div>

      {publishNowBlockedReason && (
        <p className="text-right text-xs text-slate-500">{publishNowBlockedReason}</p>
      )}

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ------------------------------------------------------- compose */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* 1 — who is this for */}
          <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <Step
              number={1}
              title="Accounts"
              hint={`Social accounts configured for ${clientName}. Writing and scheduling work whether or not an account is connected.`}
            />

            {accounts.length === 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <Lock size={14} className="mt-0.5 shrink-0 text-amber-700" />
                <div className="min-w-0 text-sm leading-snug text-amber-900">
                  <p className="font-medium">No social accounts are configured for {clientName} yet.</p>
                  <p className="mt-0.5">
                    You can still write, save and schedule this post in Cloud Compass. Accounts are added in{" "}
                    <a href={`/settings/clients/${clientId}/social-accounts`} className="font-medium underline">
                      Settings → Clients → {clientName} → Social accounts
                    </a>
                    , and connected there too. Nothing is published to a platform from Cloud Compass yet.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {accounts.map((account) => {
                    const selected = accountIds.includes(account.id);
                    const described = describeAccount(account);
                    return (
                      <button
                        key={account.id}
                        type="button"
                        onClick={() => toggleAccount(account.id)}
                        disabled={isPending}
                        aria-pressed={selected}
                        className={cn(
                          "flex min-w-0 items-center gap-2 rounded-full border py-1.5 pr-3 pl-1.5 text-sm transition-colors",
                          selected ? "border-[#2F4156] bg-[#2F4156] text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        )}
                      >
                        <PlatformMark platform={account.platform} size="sm" decorative />
                        <span className="truncate font-medium">{described.primary}</span>
                        <span className={cn("truncate text-xs", selected ? "text-white/70" : "text-slate-500")}>
                          {described.secondary ?? SOCIAL_PLATFORM_LABELS[account.platform]}
                        </span>
                        {/*
                          The connection, said in words rather than by colour
                          alone — a filled dot with no label is exactly the
                          ambiguity Phase 9 removed. "Not connected" is not a
                          warning here: the post can still be written and
                          scheduled. It is simply true.
                        */}
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            connectionChipClass(account.connectionState, selected)
                          )}
                        >
                          {describeConnection(account.connectionState).label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {clientId && (
                  <a href={`/settings/clients/${clientId}/social-accounts`} className="w-fit text-xs text-slate-500 underline hover:text-slate-700">
                    Manage {clientName}&apos;s accounts in Settings
                  </a>
                )}
              </>
            )}
          </section>

          {/* 2 — the media itself, first — this is what a social post actually leads with */}
          <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <Step number={2} title="Media" hint="Photos and video are shared by every account on this post — one set of media, attached to the post itself." />
            <SocialMediaPanel contentId={contentId} files={files} onFilesChange={setFiles} disabled={isPending} />
          </section>

          {/* 3 — what are you posting, per platform */}
          <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <Step
              number={3}
              title="Caption"
              hint={
                selectedAccounts.length > 0
                  ? "Write it once for everyone, then open a platform's tab to say it differently there."
                  : "This is what your audience reads."
              }
            />

            {/* ------------------------------------------------ platform tabs */}
            {selectedAccounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2" role="tablist" aria-label="Post content by platform">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === SHARED_TAB}
                  onClick={() => setActiveTab(SHARED_TAB)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    activeTab === SHARED_TAB ? "bg-[#2F4156] text-white" : "text-slate-600 hover:bg-slate-100"
                  )}
                >
                  All accounts
                </button>
                {selectedAccounts.map((account) => {
                  const target = targets.find((row) => row.accountId === account.id);
                  const customized = target !== undefined && (target.caption !== null || target.link !== null);
                  const described = describeAccount(account);
                  return (
                    <button
                      key={account.id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === account.id}
                      onClick={() => setActiveTab(account.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg py-1.5 pr-3 pl-1.5 text-sm font-medium transition-colors",
                        activeTab === account.id ? "bg-[#2F4156] text-white" : "text-slate-600 hover:bg-slate-100"
                      )}
                    >
                      <PlatformMark platform={account.platform} size="sm" decorative />
                      <span className="max-w-[10rem] truncate">{described.primary}</span>
                      {customized && (
                        <span
                          className={cn("rounded px-1 py-0.5 text-[10px] font-semibold", activeTab === account.id ? "bg-white/20" : "bg-amber-100 text-amber-800")}
                        >
                          Custom
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {activeAccount === null ? (
              /* ------------------------------------------ the shared post */
              <>
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <label htmlFor="caption" className="text-xs font-medium text-slate-500">
                      Caption
                    </label>
                    <span className={cn("text-xs", sharedMeasurement.overLimit ? "font-semibold text-red-600" : "text-slate-500")}>
                      {sharedMeasurement.characters} characters
                      {sharedMeasurement.limit !== null && sharedMeasurement.limitPlatform
                        ? ` · ${sharedMeasurement.remaining} left for ${SOCIAL_PLATFORM_LABELS[sharedMeasurement.limitPlatform]}`
                        : ""}
                    </span>
                  </div>
                  <textarea
                    id="caption"
                    ref={captionRef}
                    rows={6}
                    className="w-full min-w-0 resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    placeholder="Write something about this post…  Hashtags go straight in the text, like #selfstorage."
                    disabled={isPending}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">Add to caption</span>
                    {addToPostActions}
                  </div>

                  {sharedMeasurement.limit === null && (
                    <p className="text-xs text-slate-500">
                      {selectedAccounts.length === 0
                        ? "Select an account above to see that platform's character limit."
                        : "Every selected account has its own caption, so no platform limit applies to this shared one."}
                    </p>
                  )}
                  {sharedMeasurement.hashtags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-slate-500">Hashtags:</span>
                      {sharedMeasurement.hashtags.map((hashtag) => (
                        <span key={hashtag} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                          {hashtag}
                        </span>
                      ))}
                    </div>
                  )}
                  {sharedMeasurement.advisory && <p className="text-xs text-amber-700">{sharedMeasurement.advisory}</p>}
                </div>

                {/* Secondary to the caption, which is the point of the screen. */}
                <div className="flex flex-col gap-1 border-t border-slate-100 pt-3">
                  <label htmlFor="postLink" className="text-xs font-medium text-slate-500">
                    Link <span className="font-normal">(optional)</span>
                  </label>
                  <Input id="postLink" ref={linkRef} value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://example.com/article" disabled={isPending} />
                  <p className="text-[11px] leading-snug text-slate-400">
                    Checked against the same public-URL rules the rest of the platform uses.
                  </p>
                </div>
              </>
            ) : (
              /* --------------------------------- one platform's own version */
              <PlatformTabPanel
                account={activeAccount}
                target={activeTarget}
                sharedCaption={caption}
                sharedLink={link}
                disabled={isPending}
                captionRef={platformCaptionRef}
                onSetOverride={setOverride}
                extraActions={addToPostActions}
                publishOutcome={publishOutcomes[activeAccount.id] ?? null}
              />
            )}

            {/*
              First comment — a SEPARATE operation from the post itself.
              Shown once, not per platform: there is no per-platform override
              control yet, though the underlying model already supports one.
              Saved with the post (Save Draft/Schedule) and published, after
              the post itself succeeds, by Publish Now.
            */}
            <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-3">
              <label htmlFor="firstComment" className="text-xs font-medium text-slate-500">
                First comment <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                id="firstComment"
                rows={2}
                className="w-full min-w-0 resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={firstComment}
                onChange={(event) => setFirstComment(event.target.value)}
                placeholder="Add the first comment to publish right after the post…"
                disabled={isPending}
              />
              <p className="text-[11px] leading-snug text-slate-400">
                Published as a separate comment immediately after the post itself, once Publish Now succeeds. Left empty, no comment is posted.
              </p>
            </div>
          </section>
        </div>

        {/* --------------------------------------------------- right column */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* 3 — what will it look like */}
          <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <Step
              number={4}
              title="Preview"
              hint={
                activeAccount
                  ? `Showing the ${platformDefinition(activeAccount.platform).name} version.`
                  : preview.generic
                    ? "A plain preview — not a rendering of any particular platform."
                    : "Showing the shared post. Open a platform tab to preview its own version."
              }
            />

            {selectedAccounts.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedAccounts.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setActiveTab(account.id)}
                    aria-pressed={activeTab === account.id}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 text-xs font-medium transition-colors",
                      activeTab === account.id ? "border-[#2F4156] bg-[#2F4156] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <PlatformMark platform={account.platform} size="sm" decorative />
                    {SOCIAL_PLATFORM_LABELS[account.platform]}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-center gap-2">
                {previewAccount ? (
                  <PlatformMark platform={previewAccount.platform} size="lg" decorative className="rounded-full" />
                ) : (
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[#2F4156] text-[11px] font-semibold text-white">
                    {(clientName ?? "CC").slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {previewAccount ? describeAccount(previewAccount).primary : (clientName ?? "Your client")}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {previewAccount ? `${SOCIAL_PLATFORM_LABELS[previewAccount.platform]} · ${previewAccount.handle}` : preview.accountLabel}
                  </span>
                </span>
              </div>

              {/* Media leads the preview, same as it now leads the composer — the caption reads underneath it, not the other way around. */}
              {files.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {files.map((file) => (
                    <div key={file.id} className="overflow-hidden rounded-lg border border-slate-200">
                      {file.mimeType.startsWith("video/") ? (
                        <video src={file.url} controls className="max-h-64 w-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={file.url} alt={file.fileName} className="max-h-64 w-full object-cover" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              <p className="text-sm whitespace-pre-wrap text-slate-800">{preview.caption || "Your caption will appear here."}</p>

              {preview.link && <p className="truncate text-xs text-[#2F4156] underline">{preview.link}</p>}
              {preview.scheduleLabel && <p className="text-[11px] text-slate-500">Intended for {preview.scheduleLabel}</p>}
              {previewFirstComment.length > 0 && (
                <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs leading-snug text-slate-500">
                  <span className="font-medium text-slate-600">First comment</span>: {previewFirstComment}
                </p>
              )}
            </div>

            <p className="text-[11px] leading-snug text-slate-400">
              {preview.generic
                ? "Platform-accurate previews arrive once accounts can be connected. This shows your own content, not a platform's rendering."
                : `Shown for ${preview.accountLabel}. The mark and layout are Cloud Compass's own — not that platform's logo or rendering.`}
            </p>
          </section>

          {/* 4 — when does it go out */}
          <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <Step number={5} title="Schedule" />
            {scheduleLabel && (
              <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <CalendarClock size={15} className="mt-0.5 shrink-0 text-slate-500" />
                {scheduleLabel}
              </p>
            )}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Date</span>
                <input type="date" className={fieldClassName} value={dateIso} onChange={(event) => setDateIso(event.target.value)} disabled={isPending} />
              </label>
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Time</span>
                <input type="time" className={fieldClassName} value={time} onChange={(event) => setTime(event.target.value)} disabled={isPending} />
              </label>
              <label className="flex min-w-0 flex-col gap-1 sm:col-span-2 xl:col-span-1">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Timezone</span>
                <select className={fieldClassName} value={timeZone} onChange={(event) => setTimeZone(event.target.value)} disabled={isPending}>
                  {timeZoneOptions(timeZone).map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs leading-snug text-slate-500">{SCHEDULED_IN_APP_NOTE}</p>
            <p className="text-xs leading-snug text-slate-500">{DRAFT_NOTE}</p>
            {contentId && (
              <a href={`/seo/${seoProjectId}/content/${contentId}`} className="text-xs font-medium text-primary hover:underline">
                Open this post&apos;s content record →
              </a>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * One platform's tab.
 *
 * It reads and writes ONLY its own account's entry, so nothing here can reach
 * another platform's text. What it offers is decided by the registry, not by
 * this component: the caption limit is that platform's, and the link field
 * appears only where a link means something (Instagram and TikTok have no
 * clickable link in a post, so offering one would be a lie).
 */
function PlatformTabPanel({
  account,
  target,
  sharedCaption,
  sharedLink,
  disabled,
  captionRef,
  onSetOverride,
  extraActions,
  publishOutcome,
}: {
  account: ComposerAccount;
  target: TargetDraft | null;
  sharedCaption: string;
  sharedLink: string;
  disabled: boolean;
  captionRef: React.RefObject<HTMLTextAreaElement | null>;
  onSetOverride: (accountId: string, field: "caption" | "link", value: string | null) => void;
  extraActions: React.ReactNode;
  /** The real outcome of this account's last Publish Now click, if any — the action itself now lives in the primary bar. */
  publishOutcome: PublishOutcome | null;
}) {
  const definition = platformDefinition(account.platform);
  const capabilities = platformCapabilities(account.platform);
  const described = describeAccount(account);

  const captionOverride = target?.caption ?? null;
  const linkOverride = target?.link ?? null;
  const shownCaption = captionOverride ?? sharedCaption;
  const measurement = measureCaption(shownCaption, [account.platform]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
        <PlatformMark platform={account.platform} size="lg" decorative />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{described.primary}</span>
          <span className="block truncate text-xs text-slate-500">
            {definition.name} {definition.accountNoun.toLowerCase()}
            {described.secondary ? ` · ${described.secondary}` : ""} · up to {capabilities.captionLimit.toLocaleString()} characters
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor={`caption-${account.id}`} className="text-xs text-slate-500">
            {captionOverride === null ? `Following the shared caption` : `${definition.name} caption`}
          </label>
          <span className={cn("text-xs", measurement.overLimit ? "font-semibold text-red-600" : "text-slate-500")}>
            {measurement.characters} characters · {measurement.remaining} left for {definition.name}
          </span>
        </div>

        <textarea
          id={`caption-${account.id}`}
          ref={captionRef}
          rows={8}
          className={cn(
            "w-full min-w-0 resize-y rounded-lg border bg-white px-3 py-2.5 text-base leading-relaxed outline-none placeholder:text-slate-400 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            captionOverride === null ? "border-dashed border-slate-300 text-slate-500" : "border-slate-200 text-slate-800"
          )}
          value={shownCaption}
          /*
           * Typing here is what customizes this platform: the first keystroke
           * turns the inherited text into this account's own copy, and every
           * other platform keeps following the shared caption exactly as
           * before.
           */
          onChange={(event) => onSetOverride(account.id, "caption", event.target.value)}
          placeholder={`What should ${described.primary} say?`}
          disabled={disabled}
        />

        <div className="flex flex-wrap items-center gap-2">
          {captionOverride === null ? (
            <p className="text-xs text-slate-500">
              This account posts the shared caption. Edit the text above and it becomes {definition.name}&apos;s own — nothing else changes.
            </p>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => onSetOverride(account.id, "caption", null)} disabled={disabled}>
                <Undo2 size={14} /> Use the shared caption
              </Button>
              <span className="text-xs text-slate-500">Only {described.primary} is affected.</span>
            </>
          )}
        </div>

        {measurement.hashtags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">Hashtags:</span>
            {measurement.hashtags.map((hashtag) => (
              <span key={hashtag} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                {hashtag}
              </span>
            ))}
          </div>
        )}
        {measurement.advisory && <p className="text-xs text-amber-700">{measurement.advisory}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
        <span className="text-xs font-medium text-slate-500">Add to this caption</span>
        {extraActions}
      </div>

      {capabilities.link ? (
        <div className="flex flex-col gap-1 border-t border-slate-100 pt-3">
          <label htmlFor={`link-${account.id}`} className="text-xs font-medium text-slate-500">
            {definition.name} link {linkOverride === null && <span className="font-normal">(following the shared link)</span>}
          </label>
          <Input
            id={`link-${account.id}`}
            value={linkOverride ?? sharedLink}
            onChange={(event) => onSetOverride(account.id, "link", event.target.value)}
            placeholder="https://example.com/article"
            disabled={disabled}
          />
          {linkOverride !== null && (
            <button
              type="button"
              onClick={() => onSetOverride(account.id, "link", null)}
              disabled={disabled}
              className="w-fit text-xs text-slate-500 underline hover:text-slate-700"
            >
              Use the shared link
            </button>
          )}
        </div>
      ) : (
        <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
          A {definition.name} post has no clickable link, so there is no link to set here. The shared link still applies to the platforms that support one.
        </p>
      )}

      <p className="text-[11px] leading-snug text-slate-400">
        Photos and video are shared by every account on this post — one set of media, attached to the post itself. Per-platform media is not stored yet, and
        saying so is better than showing a control that quietly does nothing.
      </p>

      {/*
        Stage 1 — the action itself now lives in the primary bar as
        "Publish Now"; this is only ever the RESULT of the last click,
        shown next to the content it was about.
      */}
      {(publishOutcome?.status === "PUBLISHED" || publishOutcome?.status === "FAILED") && (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          {publishOutcome.status === "PUBLISHED" && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-snug text-emerald-800">
              Published. Post id <span className="font-mono">{publishOutcome.externalPostId}</span>.{" "}
              {publishOutcome.externalUrl ? (
                <a href={publishOutcome.externalUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                  View it on {definition.name} →
                </a>
              ) : (
                `${definition.name} did not return a permalink for this post.`
              )}
            </p>
          )}
          {publishOutcome.status === "FAILED" && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-snug text-red-700">
              {publishOutcome.failureMessage}
            </p>
          )}
          {/* First Comment's own result — a SEPARATE outcome from the post's, shown right alongside it. */}
          {publishOutcome.comment && <FirstCommentResult outcome={publishOutcome.comment} />}
        </div>
      )}
    </div>
  );
}

/** First Comment's own result — never conflated with the post's own outcome above it. */
function FirstCommentResult({ outcome }: { outcome: CommentOutcome }) {
  if (outcome.status === "PUBLISHED") {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-snug text-emerald-800">
        First comment published. Comment id <span className="font-mono">{outcome.externalCommentId}</span>.
      </p>
    );
  }
  if (outcome.status === "FAILED") {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-snug text-red-700">
        First comment failed — {outcome.failureMessage} Click Publish Now again to retry just the comment.
      </p>
    );
  }
  // NOT_ATTEMPTED — the post itself failed, so this is never shown as a separate alarming failure of its own.
  return null;
}

/**
 * How a connection label looks on an account chip.
 *
 * Only CONNECTED gets the affirmative treatment. NEEDS_RECONNECT is amber
 * because someone should act on it; NOT_CONNECTED and DISCONNECTED are plain,
 * because neither is a problem with the post being written.
 */
function connectionChipClass(state: SocialConnectionState, selected: boolean): string {
  if (selected) return "bg-white/20 text-white";
  switch (state) {
    case "CONNECTED":
      return "bg-emerald-50 text-emerald-700";
    case "NEEDS_RECONNECT":
      return "bg-amber-50 text-amber-700";
    default:
      return "bg-slate-100 text-slate-500";
  }
}
