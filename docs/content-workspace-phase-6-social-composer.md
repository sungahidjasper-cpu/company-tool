# Content Workspace — Phase 6: Social Composer

**Status:** PASS — a working Social Composer with real persistence, browser-verified 72/72.
**Migration:** `20260908224635_social_composer` — three new tables, two enums, no change to any existing table.
**No social platform API was implemented, and no social account was fabricated.**

---

## 1. Discovery

| Question | Finding |
|---|---|
| Is there a reusable media system? | Yes. `File` already attaches by `contentId`, and `uploadFile`/`deleteFile` already enforce company scope, permissions, size and MIME rules. **Reused wholesale.** |
| Is there a reusable connection model? | `PublishingConnection` exists but is WordPress-only and credential-bearing. It models a *CMS* connection owned by the company, not a *social account* owned by a client. Not reusable. |
| Can Content carry the social data? | Partly. Title and scheduling fit; caption, link and account targets do not (below). |
| Is there safe URL handling? | Yes — `assertSafePublicUrl` in `ssrf-guard.service`. Reused unchanged. |
| Is there an AI action to reuse? | Yes, several, but none was wired in: no AI generation was added to this phase, and no second provider architecture exists. |

## 2. Existing architecture reused

`File` + `uploadFile`/`deleteFile` + `/api/files/[id]` (media) · `assertSafePublicUrl` (links) · Phase 5 `scheduledAt`/`scheduledTimezone`/`SCHEDULED` and `validateScheduleRequest` (scheduling) · `Content` (the record itself) · the Phase 5 calendar creation flow (entry) · `buildWorkspaceHref` (return) · `ContentRevision`, `PublishContentPanel`, Content Detail (untouched).

## 3–4. Schema changes and the social content model

**A Social Post is a Content row.** Ownership, soft-delete, scheduling, activity and the calendar all come for free and stay consistent.

| New | Why it could not live on Content |
|---|---|
| `SocialAccount` (company → **client** → platform, handle, status) | The minimum abstraction for a client's social connection. **No credentials, no tokens** — there is no OAuth in this phase, so there is nothing to store and nothing that could look like a working connection. |
| `SocialPost` (1:1 with Content: caption, optional link) | `Content.body` means "the article" and `Content.url` means "where this page lives" — the Rewriter, Long-Form and Publishing paths depend on those meanings. A caption is neither. |
| `SocialPostTarget` (post ↔ account) | A many-to-many cannot be a column. |

**Deliberately not added:** a `contentType` column — the presence of the `socialPost` relation *is* the discriminator, so every pre-existing row keeps its honest "not recorded" type. No variation table (a later `SocialPostVariation` attaches to `SocialPostTarget` without touching this). No media model. No new scheduling.

The migration only creates tables; nothing existing was altered, so every existing row was valid before and after.

## 5. Client/account architecture

A social account belongs to a **client**, and the composer only ever offers accounts that are this project's client's, live, and `ACTIVE`. Availability is decided by rows — never by the enum. **Zero accounts exist**, so the composer shows the truthful empty state and no platform is selectable. The `SocialPlatform` enum is a definition of what is possible, not a claim about what is connected.

## 6. Composer UI

Left: internal name, caption, link, media, accounts. Right: intended schedule, live preview, actions. Sections are cards with clear hierarchy, compact controls and useful empty states; the layout stacks to one column below 1280px.

## 7. Media

Reuses the existing File pipeline end to end — upload, list, remove, and the same 10MB and MIME rules. `video/mp4`, `video/webm` and `video/quicktime` were added to the shared allow-list (the only change to the file system). Media attaches to the Content record, so the composer says plainly that a draft must be saved first rather than uploading into limbo.

## 8. Caption handling

A real multiline editor with a live character count, hashtags parsed out of the caption and shown as chips, a non-blocking advisory past 12 hashtags, and validation for a bare `#`. **Hashtags are part of the caption** — no separate system — because that is how they are written and how their characters count.

Character guidance binds to the **strictest selected platform**. With no account selected nothing binds, and the composer says so rather than inventing a limit.

## 9–10. Scheduling and draft persistence

The calendar's date, time and zone arrive with the user and stay visible; they can be changed here. **Save draft** persists everything as `DRAFT` with both schedule fields null. **Schedule** is the only path to `SCHEDULED`, and it reuses Phase 5's validation and invariants. `publishedAt` is never written.

Reopening a draft finds no stored instant — a draft deliberately stores none — so the composer offers tomorrow as an editable starting point rather than an empty field that would silently block Schedule.

## 11. Preview

Reflects media, caption, hashtags, link, the selected account and the intended time, updating as you type. With no connected account it is labelled **Generic** and states that it is not a rendering of any particular platform — platform-accurate previews are a later phase.

## 12–13. Calendar and Content Detail integration

A social post flows through the existing feed, so Month/Week/Day/Agenda place it by the same rules, with the same four distinct states (Planned / Draft / Scheduled / Published). Content Detail now reports **Content type: Social post**, shows the caption, link and targeted accounts in their own card, hides the Article card that does not apply, and offers "Edit in composer". Nothing was rebuilt.

## 14. Authorization

Permission → `isUuid` **before any query** → company match → project match → soft-delete on both. Account ids are filtered by company **and** the project's client, so a foreign account id simply does not come back and can never be written — and the caption limit is derived from the surviving accounts, so tampering cannot loosen validation either. Links go through the same SSRF guard the publishing paths use.

## 15–19. Tests and gates

| Gate | Result |
|---|---|
| New tests | 32 composer rules · 30 action/authorization — all pass |
| Full suite | 142 files, **3877 tests** pass |
| Typecheck | exit 0 |
| Lint | 0 errors (1 pre-existing warning in untouched `ReportForm.tsx`) |
| Build | Compiled successfully |

## 20–21. Browser and responsive verification

**72/72 PASS**, A through Y, no console errors beyond the known shell hydration warning. Verified end to end: calendar → date → time → Social Media → composer, with the clicked date and chosen zone carried through; title, caption, hashtags and link; live preview; Save draft (stays DRAFT); reopen; Schedule (becomes SCHEDULED at the exact instant — 09:00 Singapore stored as 01:00Z); calendar placement; Content Detail; cancel schedule (back to DRAFT, both fields cleared, `publishedAt` never touched).

Responsive at 390/768/1024/1440: nothing overflows, no control clipped, no sideways scroll, single column below 1280 and two columns above.

Tampering: malformed and missing project/content ids fail safely; a **non-social** Content record cannot be opened in the composer; saving into a **trashed project** is refused.

## 22. Database before and after

Identical: `content 10, socialPosts 0, socialTargets 0, socialAccounts 0, files 6, revisions 9, entries 9, projects 5`, statuses 1 PUBLISHED / 9 DRAFT. The verification created one clearly-named test post (`QA Phase6 Social …`) and removed it, along with an orphan left by an earlier crashed run. A backup was taken before migrating.

## 23. Data limitations

**No social account exists**, so platform selection, per-platform character limits and an account-specific preview could not be exercised against real data — they are unit-tested instead. None was fabricated. Media upload was not exercised in the browser (it needs a real file through the existing upload pipeline); the pipeline itself is the pre-existing, already-tested one. Only one company exists, so cross-company manipulation stays unexercised with real records.

## 24. Environmental issues

The dev server was restarted after the migration to pick up the regenerated Prisma client — the same trap as earlier phases.

## 25. NOT implemented

Platform-specific previews · OAuth · every social platform API (Facebook, Instagram, LinkedIn, TikTok, X, Pinterest, YouTube, Google Business Profile) · multi-platform publishing · per-platform caption variations · approval workflow or client portal · campaigns · analytics · performance feedback · Data Stronghold · the complete Blog CMS (its entry point is untouched and still works) · charts · a rich-text editor · image or video generation · automatic publishing of scheduled content · AI caption generation.

---

## Composer UX pass (2026-09-10)

A presentation-only pass against the blueprint. **No schema change, no new dependency, no action signature changed** — the same `saveSocialPostAction`, the same `listConnectedAccounts`, the same `File` uploads, the same Phase 5 scheduling and the same `validateComposerDraft` / `measureCaption` / `buildPreview`.

### What changed

| Before | After |
|---|---|
| Internal name → Caption → Link → Media → Accounts | **1 Accounts → 2 Post content → 3 Platform customization**, with Preview and Schedule beside them |
| Caption was one field among several | The caption is the visual centre — 8 rows, *"What do you want to say?"*, with the internal name and link demoted to a secondary two-up row beneath |
| Media was a separate card with a form-ish button | One **Add to post** row — Photo or GIF · Video · Hashtag · Link — with thumbnails showing filename and size |
| Accounts were checkboxes at the bottom | Selectable platform chips at the top, under the client they belong to |
| Preview sat below Schedule, small and last | Preview is the top of the right column, in a card, with a platform switcher when more than one account is selected |
| Actions sat at the bottom of a sidebar card | A context bar carries client, project, intended time, **save state** and the actions |
| No save state | *Not saved yet* / *Unsaved changes* / *Saved* |
| No Update or Cancel schedule | **Update schedule** once scheduled, plus **Cancel schedule** — reusing the existing Phase 5 `cancelContentScheduleAction` |

### Honesty preserved

No fake platform chips: with zero `SocialAccount` rows the section explains that none is connected and that no platform integration exists. **Platform customization** is shown as a disabled control with the real reason — a post stores one caption and one media set, and per-platform variation needs a table the database does not have. The preview is still labelled as Cloud Compass's own, never a platform's rendering. There is no Publish button.

### Verification

**79/79 browser checks**, including a measured check that the caption sits above the internal name and is more than three times its height. Gates: typecheck 0, **3963 tests**, lint 0 errors, build succeeds. Database identical before and after; no social account fabricated.

Two React-compiler errors were fixed during the pass: an imperative media-picker handed across components touched a ref during render (the "Add to post" row now lives with the file input, and the composer contributes its Hashtag/Link buttons into it), and a hand-written `useMemo` was blocking the compiler's own memoization of the preview.

### Still limited by the missing integrations

Platform chips, per-platform character limits and an account-specific preview are all implemented but **cannot be exercised** until a `SocialAccount` row can exist. That remains the single highest-value next step.
