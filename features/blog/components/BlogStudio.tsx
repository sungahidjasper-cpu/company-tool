"use client";

import { CalendarClock, Check, Eye, Pencil, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import ArticleMarkdownPreview from "@/features/ai-workspace/components/ArticleMarkdownPreview";
import {
  emptyDocument,
  parseMarkdownBlocks,
  serializeMarkdownBlocks,
  type MarkdownBlock,
} from "@/features/ai-workspace/services/markdown-preview.service";
import { cancelContentScheduleAction } from "@/features/content-workspace/actions/content-scheduling.actions";
import { contentDetailHref } from "@/features/content-workspace/services/content-location";
import { saveBlogPostAction } from "@/features/blog/actions/blog-post.actions";
import BlogBlockEditor from "@/features/blog/components/BlogBlockEditor";
import { SEO_DESCRIPTION_IDEAL, SEO_TITLE_IDEAL, bodyExcerpt, buildSearchPreview, guideLength, slugify } from "@/features/blog/services/blog-seo";
import { SCHEDULED_IN_APP_NOTE } from "@/features/social/services/social-composer";
import { formatScheduledFor, zonedWallTimeToInstant } from "@/features/content-workspace/services/content-scheduling";
import { browserTimeZone, timeZoneOptions } from "@/features/content-workspace/services/timezone-options";
import { MANUALLY_SELECTABLE_CONTENT_STATUSES } from "@/features/seo/schemas/content.schema";
import { formatEnumLabel } from "@/lib/utils";
import { cn } from "@/lib/utils";

const fieldClassName =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Option = { id: string; label: string };

export type BlogStudioProps = {
  /** The client this article is for. An article always belongs to one. */
  clientId: string;
  clientName: string;
  /** Optional SEO project context — only keywords need one. */
  seoProjectId: string | null;
  seoProjectName: string | null;
  siteDomain: string | null;
  authorOptions: Option[];
  keywordOptions: Option[];
  /** Company-owned tags. Empty is a real state, not a missing feature. */
  tagOptions: Option[];
  initialDateIso: string;
  initialTime: string;
  initialTimeZone: string | null;
  existing?: {
    contentId: string;
    title: string;
    body: string;
    metaTitle: string;
    metaDescription: string;
    url: string;
    authorId: string;
    keywordIds: string[];
    tagIds: string[];
    status: string;
  };
  backHref: string;
};

/**
 * Phase 7 — the Blog Content Studio.
 *
 * The article is the workspace: a title and a block canvas, with settings,
 * SEO and scheduling beside it rather than in front of it. Three views —
 * Edit, Preview, SEO — because reading the finished article and editing it
 * are different jobs, and the preview shows no editor controls at all.
 *
 * Nothing is written until Save draft or Schedule is pressed. Scheduling
 * reuses Phase 5 exactly and publishes nothing.
 */
export default function BlogStudio({
  clientId,
  clientName,
  seoProjectId,
  seoProjectName,
  siteDomain,
  authorOptions,
  keywordOptions,
  tagOptions,
  initialDateIso,
  initialTime,
  initialTimeZone,
  existing,
  backHref,
}: BlogStudioProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<"EDIT" | "PREVIEW" | "SEO">("EDIT");

  const [title, setTitle] = useState(existing?.title ?? "");
  const [blocks, setBlocks] = useState<MarkdownBlock[]>(() => {
    const parsed = existing?.body ? parseMarkdownBlocks(existing.body) : [];
    return parsed.length > 0 ? parsed : emptyDocument();
  });
  const [metaTitle, setMetaTitle] = useState(existing?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(existing?.metaDescription ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [authorId, setAuthorId] = useState(existing?.authorId ?? "");
  const [keywordIds, setKeywordIds] = useState<string[]>(existing?.keywordIds ?? []);
  const [tagIds, setTagIds] = useState<string[]>(existing?.tagIds ?? []);
  const [contentId, setContentId] = useState(existing?.contentId ?? null);
  const [error, setError] = useState<string | null>(null);

  /*
   * The editorial status, and whether the record currently holds a schedule.
   *
   * These are tracked separately because SCHEDULED is not an editorial status
   * a writer may pick — it is a state the scheduling action puts the record
   * in. While a record is scheduled the status control is therefore inert and
   * says so, and a plain Save draft deliberately sends no status at all so
   * that editing an article cannot silently unschedule it.
   */
  const [status, setStatus] = useState(existing && existing.status !== "SCHEDULED" ? existing.status : "DRAFT");
  const [isScheduled, setIsScheduled] = useState(existing?.status === "SCHEDULED");

  const [dateIso, setDateIso] = useState(() => initialDateIso || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [time, setTime] = useState(initialTime);
  const [timeZone, setTimeZone] = useState(initialTimeZone ?? browserTimeZone());

  const markdown = useMemo(() => serializeMarkdownBlocks(blocks), [blocks]);

  /*
   * Save status, derived rather than guessed: a fingerprint of everything the
   * studio can change, compared with the fingerprint of what was last saved.
   * A writer needs to know whether their work is safe, and "Saved" is only
   * honest if it means exactly that.
   */
  const fingerprint = JSON.stringify({
    title,
    markdown,
    metaTitle,
    metaDescription,
    url,
    authorId,
    status,
    keywordIds: [...keywordIds].sort(),
    tagIds: [...tagIds].sort(),
  });
  const [savedFingerprint, setSavedFingerprint] = useState(existing ? fingerprint : null);
  const hasUnsavedChanges = savedFingerprint !== fingerprint;
  const instant = zonedWallTimeToInstant(dateIso, time, timeZone);
  const scheduleLabel = instant ? formatScheduledFor(instant, timeZone) : null;

  const titleGuidance = guideLength(metaTitle || title, SEO_TITLE_IDEAL, "SEO title");
  const descriptionGuidance = guideLength(metaDescription, SEO_DESCRIPTION_IDEAL, "meta description");
  const searchPreview = useMemo(
    () => buildSearchPreview({ metaTitle, metaDescription, title, slug: url || slugify(title), bodyExcerpt: bodyExcerpt(markdown), siteDomain }),
    [metaTitle, metaDescription, title, url, markdown, siteDomain]
  );

  function save(withSchedule: boolean) {
    setError(null);
    if (title.trim().length < 2) {
      setError("Give the article a title of at least 2 characters.");
      return;
    }
    if (withSchedule && !instant) {
      setError("Choose a valid date, time and timezone before scheduling.");
      return;
    }

    startTransition(async () => {
      const result = await saveBlogPostAction({
        contentId: contentId ?? undefined,
        clientId,
        seoProjectId: seoProjectId ?? undefined,
        title,
        body: markdown,
        metaTitle,
        metaDescription,
        url,
        authorId,
        keywordIds,
        tagIds,
        // A scheduled record keeps its schedule through an ordinary save.
        status: withSchedule || isScheduled ? undefined : status,
        schedule: withSchedule ? { dateIso, time, timeZone } : undefined,
      });
      if (!result.success) {
        setError(result.message);
        return;
      }
      setContentId(result.data.contentId);
      setSavedFingerprint(fingerprint);
      if (result.data.scheduled) setIsScheduled(true);
      /*
       * Put the saved record's id in the URL.
       *
       * Without this, a refresh after saving reopened an EMPTY studio: the id
       * lived only in component state, so the page had no idea which article
       * it was editing and the writer's work looked lost (it was safe in the
       * database, but unreachable from that URL). Browser verification caught
       * exactly that. The intended date, time and zone ride along too, so a
       * refresh restores the moment the writer chose rather than falling back
       * to a default. replaceState is what Next supports here, and it avoids
       * re-running the server page for values it already has.
       */
      const reopen = new URLSearchParams({ contentId: result.data.contentId, date: dateIso, time, tz: timeZone });
      globalThis.history.replaceState(null, "", `/content/create/blog?${reopen.toString()}`);
      toast.success(result.data.scheduled ? "Scheduled in Cloud Compass" : "Draft saved");
      router.refresh();
    });
  }

  /** Reuses the EXISTING Phase 5 action — the studio adds no scheduling system of its own. */
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
      setStatus("DRAFT");
      toast.success("Schedule cancelled — this article is back to draft.");
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ------------------------------------------------------------ tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex" role="group" aria-label="Studio view">
          {(
            [
              { key: "EDIT", label: "Edit", icon: Pencil },
              { key: "PREVIEW", label: "Preview", icon: Eye },
              { key: "SEO", label: "SEO", icon: Search },
            ] as const
          ).map((tab, index) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              aria-pressed={view === tab.key}
              className={cn(
                "inline-flex items-center gap-1.5 border border-slate-200 px-3 py-1.5 text-sm font-medium",
                index === 0 && "rounded-l-lg",
                index === 2 && "rounded-r-lg",
                index === 1 && "-mx-px",
                view === tab.key ? "bg-[#2F4156] text-white" : "bg-white text-slate-700 hover:bg-slate-50"
              )}
            >
              <tab.icon size={14} /> {tab.label}
            </button>
          ))}
        </div>
        {/*
          Client first, then what this is, then the optional project. It used
          to read "{project} · {client}", which put the optional context first
          and left a dangling separator when there was no project.
        */}
        <span className="min-w-0 text-xs text-slate-500">
          <span className="font-medium text-slate-700">{clientName}</span>
          {" · Blog post"}
          {seoProjectName ? ` · ${seoProjectName}` : ""}
        </span>

        {/*
          The primary actions live here, beside the view switch, rather than at
          the bottom of a sidebar card — this is the one control surface for the
          whole studio, so it stays reachable at every width.
        */}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-slate-500">
            {/*
              "Never saved" is checked BEFORE the dirty comparison: a brand-new
              article is always different from nothing, so testing dirtiness
              first made this branch unreachable and reported "Unsaved changes"
              for an article that had never been saved at all — true, but less
              useful than saying it does not exist yet.
            */}
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
          <Button type="button" variant="outline" size="sm" onClick={() => save(false)} disabled={isPending}>
            {isPending ? "Saving…" : "Save draft"}
          </Button>
          <Button type="button" size="sm" onClick={() => save(true)} disabled={isPending}>
            {isScheduled ? "Update schedule" : "Schedule"}
          </Button>
          {isScheduled && contentId && (
            <Button type="button" variant="outline" size="sm" onClick={cancelSchedule} disabled={isPending}>
              Cancel schedule
            </Button>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* -------------------------------------------------------- canvas */}
        <div className="flex min-w-0 flex-col gap-4">
          {view === "EDIT" && (
            <div className="flex min-w-0 flex-col gap-3 rounded-xl bg-white p-4 shadow-sm">
              <input
                id="articleTitle"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Article title"
                disabled={isPending}
                aria-label="Article title"
                className="w-full min-w-0 border-none bg-transparent px-2.5 py-1 text-2xl leading-tight font-bold text-slate-900 outline-none placeholder:text-slate-300 focus-visible:ring-0"
              />
              <BlogBlockEditor
                blocks={blocks}
                onChange={setBlocks}
                contentId={contentId}
                onNeedsSave={() => setError("Save the draft first — images attach to the saved article.")}
                disabled={isPending}
              />
            </div>
          )}

          {view === "PREVIEW" && (
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs text-slate-500">The article as a reader sees it. No editor controls appear here.</p>
              <ArticleMarkdownPreview title={title || "Untitled article"} body={markdown} />
            </div>
          )}

          {view === "SEO" && (
            <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">Search appearance</h2>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">SEO title</span>
                <input id="metaTitle" className={fieldClassName} value={metaTitle} onChange={(event) => setMetaTitle(event.target.value)} placeholder={title || "Falls back to the article title"} disabled={isPending} />
                <span className={cn("text-xs", titleGuidance.status === "GOOD" ? "text-emerald-700" : titleGuidance.status === "LONG" ? "text-amber-700" : "text-slate-500")}>{titleGuidance.message}</span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Meta description</span>
                <textarea id="metaDescription" rows={3} className={fieldClassName} value={metaDescription} onChange={(event) => setMetaDescription(event.target.value)} disabled={isPending} />
                <span className={cn("text-xs", descriptionGuidance.status === "GOOD" ? "text-emerald-700" : descriptionGuidance.status === "LONG" ? "text-amber-700" : "text-slate-500")}>{descriptionGuidance.message}</span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">URL / slug</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input id="articleUrl" className={fieldClassName} value={url} onChange={(event) => setUrl(event.target.value)} placeholder={slugify(title) || "article-slug"} disabled={isPending} />
                  {title && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setUrl(slugify(title))} disabled={isPending}>
                      Use title
                    </Button>
                  )}
                </div>
              </label>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Search preview</span>
                <div className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="truncate text-xs text-emerald-800">{searchPreview.url}</p>
                  <p className="truncate text-base text-[#1a0dab]">{searchPreview.title}</p>
                  <p className="text-xs leading-snug text-slate-600">{searchPreview.description}</p>
                </div>
                {(searchPreview.usingFallbackTitle || searchPreview.usingFallbackDescription) && (
                  <p className="text-xs text-slate-500">
                    Shown in grey above: {searchPreview.usingFallbackTitle ? "the title" : ""}
                    {searchPreview.usingFallbackTitle && searchPreview.usingFallbackDescription ? " and " : ""}
                    {searchPreview.usingFallbackDescription ? "the description" : ""} fall back to the article itself. Nothing is saved as metadata until you type it here.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Target keywords</span>
                {keywordOptions.length === 0 ? (
                  <p className="text-xs text-slate-500">This project has no keywords yet.</p>
                ) : (
                  <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {keywordOptions.map((keyword) => (
                      <label key={keyword.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={keywordIds.includes(keyword.id)}
                          onChange={() => setKeywordIds((current) => (current.includes(keyword.id) ? current.filter((id) => id !== keyword.id) : [...current, keyword.id]))}
                          disabled={isPending}
                        />
                        {keyword.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- sidebar */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <CalendarClock size={15} className="text-slate-500" /> Schedule
            </h2>
            {scheduleLabel && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{scheduleLabel}</p>}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Date</span>
              <input type="date" className={fieldClassName} value={dateIso} onChange={(event) => setDateIso(event.target.value)} disabled={isPending} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Time</span>
              <input type="time" className={fieldClassName} value={time} onChange={(event) => setTime(event.target.value)} disabled={isPending} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Timezone</span>
              <select className={fieldClassName} value={timeZone} onChange={(event) => setTimeZone(event.target.value)} disabled={isPending}>
                {timeZoneOptions(timeZone).map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs leading-snug text-slate-500">{SCHEDULED_IN_APP_NOTE}</p>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Article settings</h2>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Author</span>
              <select className={fieldClassName} value={authorId} onChange={(event) => setAuthorId(event.target.value)} disabled={isPending}>
                <option value="">Unassigned</option>
                {authorOptions.map((author) => (
                  <option key={author.id} value={author.id}>
                    {author.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Status</span>
              {isScheduled ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-600">
                  Scheduled — cancel the schedule to set an editorial status.
                </p>
              ) : (
                <select className={fieldClassName} value={status} onChange={(event) => setStatus(event.target.value)} disabled={isPending}>
                  {MANUALLY_SELECTABLE_CONTENT_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {formatEnumLabel(value)}
                    </option>
                  ))}
                </select>
              )}
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Tags</span>
              {tagOptions.length === 0 ? (
                <p className="text-xs text-slate-500">This company has no tags yet.</p>
              ) : (
                <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
                  {tagOptions.map((tag) => (
                    <label key={tag.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={tagIds.includes(tag.id)}
                        onChange={() => setTagIds((current) => (current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id]))}
                        disabled={isPending}
                      />
                      {tag.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/*
              Only fields that genuinely exist are offered. A featured image, a
              category and an excerpt have no columns on Content, and inventing
              them to match another CMS was explicitly out of scope.
            */}
            <p className="text-xs leading-snug text-slate-400">
              A featured image, category and excerpt are not stored on content records in this system, so they are not offered here.
            </p>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => router.push(backHref)} disabled={isPending}>
                Leave the studio
              </Button>
            </div>
            {contentId && (
              <a href={contentDetailHref({ id: contentId, seoProjectId })} className="text-xs font-medium text-primary hover:underline">
                Open this article&apos;s content record →
              </a>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
