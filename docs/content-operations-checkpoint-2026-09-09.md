# Cloud Compass — Content Operations checkpoint

**Date:** 2026-09-09 · **Branch:** `master` · **HEAD:** `9a9077b`
**Everything below is UNCOMMITTED working-tree work (157 changed/new files). Nothing has been committed or pushed.**

This is the "where we stopped" document. Per-phase detail lives in the linked phase docs.

---

## The product direction

```
Calendar → Date → Time → Content type ─┬─ Social post → composer  → schedule
                                        └─ Blog post   → studio    → schedule
                                                     ↓
                                          Content record (one model)
                                                     ↓
                              detail · revisions · AI operations · publishing
```

Both branches enter through the same calendar workflow and end at the same `Content` record. They stay **different editors** because a caption and an article are different jobs.

---

## 1. What is completed

| Area | State | Detail |
|---|---|---|
| **Content Calendar** | Working | Month / Week / Day / Agenda, client+project context remembered, filters, date selection, undated content listed separately instead of being given an invented date. [Phase 1](content-workspace-phase-1-progress.md) · [Phase 2](content-workspace-phase-2-progress.md) |
| **Calendar date interaction** | Working | Clicking a date selects it and opens the creation workflow; the selection survives view switches, client/project switches and refresh. [Phase 5 date interaction](content-workspace-phase-5-date-interaction.md) |
| **Content scheduling** | Working | `scheduledAt` (UTC) + `scheduledTimezone` (IANA) + `SCHEDULED` status. Scheduling never publishes; cancelling returns to `DRAFT`; `publishedAt` is only ever a real publication. [Phase 5](content-workspace-phase-5-scheduling.md) |
| **Content Detail** | Working | The central detail page: client, project, status, schedule, content type, article, revisions, notes, activity, files, and grouped **Content operations** (7 AI hand-offs, each with a stated reason when unavailable). [Phase 4](content-workspace-phase-4-progress.md) |
| **Social Composer** | Working | Internal name, caption with live character count, hashtags, link (SSRF-guarded), media, account selection, scheduling, draft saving, generic preview. [Phase 6](content-workspace-phase-6-social-composer.md) |
| **Blog Content Studio** | **Working — completed 2026-09-10** | Article-first block editor with **inline images at a chosen position**, alt text and captions, Edit/Preview/SEO views, SEO panel with search preview, scheduling, revisions. [Phase 7](content-workspace-phase-7-blog-studio.md) |

> **Correction to the day's verbal summary:** the Blog Content Studio is *not* outstanding — it was implemented and verified today (76/76 browser checks). The plain admin form at `/seo/[id]/content/new` still exists and still works, but the calendar's **Blog post** button now opens the Studio at `/content/create/blog`.

### Verification totals for today's phases

| Phase | Browser checks | Suite at the time |
|---|---|---|
| 4 — Content detail | 126/126 functional + 35/36 responsive | 3706 |
| 5 — Date interaction | 55/55 | 3740 |
| 5 — Scheduling | 80/80 | 3815 |
| 6 — Social Composer | 72/72 | 3877 |
| 7 — Blog Studio | 76/76 | 3952 |
| 7 — Studio completion (2026-09-10) | 48/48, plus a 76/76 re-run | **3963** |

Current gates: **3963 tests pass**, typecheck exit 0, lint 0 errors (one pre-existing warning in the untouched `features/reports/components/ReportForm.tsx`), production build succeeds.

---

## 2. What is currently incomplete

- **No social publishing at all.** There is no OAuth, no platform API, and **zero social accounts exist** — `SocialAccount` rows can only be created by a future phase. "Schedule" means *scheduled inside Cloud Compass*, and every screen says so.
- **No automatic publishing.** A schedule is an intention; nothing acts on it when the time arrives.
- **Social Composer UX** is functional but, in your assessment, still reads closer to an admin form than a professional social dashboard. Worth a design pass — the architecture does not need to change for it.
- **Blog Studio omissions, deliberate** (see limitations): underline, third-party iframe embeds, charts.
- **Blog "article settings"** now offers author, editorial status and tags. A featured image, category and excerpt still have no columns on `Content`, so they are not offered — adding them would be a small, deliberate migration.
- **Analytics, campaigns, approvals, client portal, Data Stronghold** — untouched, as intended.

---

## 3. What we will do next

Nothing is authorized yet. The obvious candidates, in the order that unblocks the most:

1. **Social account connection** (the model exists and is empty) — a way to create a `SocialAccount` for a client, still without OAuth. This unblocks platform selection, per-platform character limits and an account-accurate preview, all of which are built but unexercisable today.
2. **Social Composer design pass** — same architecture, better hierarchy.
3. **Blog Studio follow-ups** — embeds/underline if you want them (both have real trade-offs, below), and richer article settings only if columns are added deliberately.
4. **Publishing the schedule** — deciding what should actually happen when a scheduled moment arrives.

---

## 4. Known limitations

- **Only one company exists** in the dev database, so cross-company authorization cannot be exercised with real records. It is tested at the unit level and reported as a data limitation every time.
- **No social accounts exist**, as above.
- **Underline is not supported** in the Blog Studio. Markdown has no underline, and writing raw `<u>` into `Content.body` would leak HTML into every Markdown consumer (the AI tools, the WordPress publisher). Reported rather than faked.
- **Third-party iframe embeds are not supported.** There is no URL allow-list infrastructure and an arbitrary iframe is an injection surface. Video from *uploaded files* is supported.
- **Media attaches to a saved record**, so both editors ask for a draft to be saved before an image can be uploaded. This is deliberate: creating a row the moment an editor opens would write before the user confirmed anything.
- **The dashboard's `notFound()` answers HTTP 200** across this app (verified on untouched routes too). No data is exposed.
- **A malformed non-UUID id on `/clients/[id]`** still throws a Prisma error instead of rendering not-found. The same defect was fixed on the Content detail route; this one is untouched and out of scope.
- **Local environment:** the `prisma dev` proxy (`connection_limit=10`) starts closing idle connections once the dev server, a browser session and a script are all attached — it broke both the app and the test harness today. Restart the proxy and then the dev server. Also restart the dev server after any `prisma generate`, or it serves a stale client.

---

## 5. Decisions that should not be changed without approval

1. **A Social Post and a Blog Post are both `Content` rows.** Social adds `SocialPost` (1:1) + `SocialPostTarget`; the presence of `socialPost` is what identifies a social record. **No `contentType` column was added**, so pre-existing rows keep an honest "type not recorded".
2. **`Content.body` stays canonical Markdown.** The Blog Studio is a block editor that serializes to Markdown — no second format, no HTML in the body. This is what keeps the AI tools, the WordPress publisher and the revision history working untouched.
3. **No editor dependency was installed.** The block model extends the app's existing `parseMarkdownBlocks` / `ArticleMarkdownPreview`, which render to React elements and therefore have no HTML-injection surface.
4. **Scheduling stores the UTC instant *and* the chosen IANA zone.** The instant alone would be silently reinterpreted in the reader's zone. Calendars place a scheduled item on the day the user *intended*, in their zone.
5. **`SCHEDULED` is never reachable from the status dropdown, a CSV import, or the linear "advance stage" button** — only from the explicit scheduling action, because the value is meaningless without a date, time and zone. Cancelling always returns to `DRAFT`.
6. **`publishedAt` is never written by scheduling.** A schedule whose moment has passed is still not a publication.
7. **Nothing is written before an explicit action.** Clicking a date, opening a composer, choosing a time or picking a content type all write nothing.
8. **Availability is derived from data, never declared.** Platforms come from real `SocialAccount` rows; AI operations come from the existing eligibility rules. Anything unavailable is shown as text with a reason — never as a disabled-looking control.
9. **`Content.tags` IS the tag system.** It is a real company-owned relation; the studio edits it and filters foreign-company tag ids out server-side. An earlier note claiming tags were unstorable was wrong and is corrected.
10. **Existing systems are reused, not duplicated:** one Content model, one revision system (`createContentRevisionSnapshot`), one media system (`File` + `uploadFile`), one SSRF guard, one scheduling implementation, one AI provider architecture.

---

## 6. Repository state — read this before continuing

- **Nothing is committed.** `HEAD` is still `9a9077b`; 157 files are changed or new.
- **Two migrations exist and are already applied to the local dev database:**
  `20260908215138_content_scheduling` (adds `SCHEDULED`, `scheduledAt`, `scheduledTimezone`)
  `20260908224635_social_composer` (adds `SocialAccount`, `SocialPost`, `SocialPostTarget`)
  A fresh clone will need `prisma migrate deploy` + `prisma generate`.
- Database backups were taken before each migration, in `backups/`.
- **The dev database contains two records created by manual testing** (a social post with a real uploaded image, and a scheduled item). They are real user data, not fixtures — left in place deliberately. Every automated test record created today was named `QA Phase…` and has been removed; row counts are back to their starting values.

### Routes added today
`/content/create/social` — Social Composer · `/content/create/blog` — Blog Content Studio
Both accept `?contentId=` to reopen a saved record, and carry `date`/`time`/`tz` from the calendar.
