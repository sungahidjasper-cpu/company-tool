# Social Composer — removing the schema from the user's screen

Two UX corrections on top of Phase 8. **No schema change. No new model. No second media library. No second scheduling system.** Everything Phase 8 established is intact.

---

## 1. What was discovered

| Question | Finding |
|---|---|
| Is `Content.title` actually required? | **Yes** — `title String`, NOT NULL. But nothing requires the *user* to supply it. |
| Why did media need a saved post? | `File` is polymorphic by foreign key (`contentId`, `seoProjectId`, …). A row must point at something that exists, so an upload genuinely needed a record. |
| Is there an existing staging concept? | No. `File` has no "unattached" state, and adding one would mean a nullable-owner file — a new orphan class in a table shared by eight entities. |
| Could media attach to the SEO project first? | Technically yes (`seoProject` is already a valid `File` target). |

## 2. How Internal name was handled

**Removed from the UI. Derived on the server instead.**

`deriveSocialPostTitle(caption, now)` in `social-composer.ts` — pure, tested, and called by `saveSocialPostAction`:

- the caption's first non-empty line, with hashtags stripped (they are the message, not a description of it)
- a caption of *only* hashtags keeps the line as written rather than becoming blank
- longer than 120 characters → truncated with an ellipsis, so it always fits the column
- an empty caption → `Social post — 2026-09-11` (the caption is required anyway, so this is a guard, not a normal path)

Re-derived on **every** save, so a record's name never drifts from what the post currently says.

`title` was **removed from `SaveSocialPostInput` entirely** — the browser cannot supply one even if it wanted to. `MIN_POST_TITLE_LENGTH` and the two title validation branches are gone; `MAX_POST_TITLE_LENGTH` survives because the derived name still has to fit.

No replacement field was added. The composer now asks only for: accounts → caption → media → link → per-platform content → schedule.

## 3. How media-before-save was implemented

Three approaches were considered, and the two that create rows early were rejected on the same ground — both invent an orphan class that then needs cleaning up:

| Approach | Why not |
|---|---|
| **B.** Upload against `seoProjectId`, re-point to the Content on save | An abandoned upload stays visible in the SEO project's **Files** tab. A real, user-visible orphan. |
| **C.** Invisible backend draft shell | A DRAFT `Content` row appears immediately in the content workspace **and** the calendar. A worse orphan — and it makes "Not saved yet" a lie. |
| **A. Client-side staging** ✅ | Nothing is created until the user saves, so **there is no orphan class at all.** |

**Chosen: A.** The browser `File` object is held in component state with an object-URL thumbnail. `uploadStagedMedia(contentId, files)` runs immediately after the Content row exists, pushing each staged file through the **same `uploadFile` server action** every other upload in this app uses.

Staging moved *when* the upload happens — never *whether* it is checked. The company check, the permission check, the MIME allow-list and the 10MB limit all still run server-side at the real upload. The client-side MIME/size check is convenience for a fast message, exactly as before.

The panel has two honest modes:

- **No saved post** → staged, with the note *"1 file is ready and will be attached when you save this post."*
- **Already saved** → uploaded immediately, as before, so finished work is never held hostage to another Save.

A file the server refuses stays staged and is named in the message, so the post still saves and the photo can be retried rather than silently lost.

## 4. Did the database change?

**No.** No migration, no new column, no new table, no new model. `SocialPost`, `SocialPostTarget`, `SocialAccount`, `File` and `Content` are untouched.

## 5. How temporary media is handled

There is nothing temporary in the database to handle — that is the point of choosing A.

| Event | What happens |
|---|---|
| Remove a staged file | Dropped from state, object URL revoked. **No server call**, because nothing was written. |
| Cancel | State is discarded with the component. **No File row, no Content row.** |
| Close the tab / navigate away | Same — nothing was ever created. |
| Save | Staged files upload and become ordinary `File` rows owned by the Content record. |
| Upload fails | The file stays staged and keeps its thumbnail; the post is still saved. |

Verified in the browser by counting `File` rows before staging, during staging and after cancelling: **unchanged throughout.**

## 6. Save state

`fingerprintOf(files)` now takes the media list explicitly. Saving turns staged files into uploaded ones and their ids change, so the fingerprint recorded after a save is the **post-upload** one — otherwise a successful save would immediately report "Unsaved changes" against its own result. The three states stay distinct: *Not saved yet* (never saved) · *Unsaved changes* (saved, then edited) · *Saved*.

## 7. One dead control fixed along the way

The **Link** button focused the shared link input, which is not rendered while a platform tab is open — so on a platform tab it silently did nothing. It now focuses the active tab's own link field, and is not shown at all on a platform that has no link to set (Instagram, TikTok). A control that does nothing is worse than one that is absent.

## 8. One real defect found by the verification, and fixed

Reopening a **scheduled** post, the page header read *"Intended for … **Nothing is scheduled until you choose Schedule.**"* — false, and directly contradicted by the composer's own context bar two lines below reading *"SCHEDULED FOR …"*. The header is now status-aware: *"Scheduled for … Scheduled in Cloud Compass only — no platform is contacted."*

Pre-existing from Phase 6 rather than a regression from this pass, but it is a false statement on the screen this task was about, so it was corrected.

## 9. What was tested

**Unit / action — 4042 tests pass across 148 files**, including:

- 8 new tests for the derived name (first line, hashtags stripped, hashtag-only captions, truncation, empty fallback, purity, always fits the column)
- 13 new tests for staged media (what counts as staged, both kinds staged, attaches to the Content record through the existing action, existing saved media survives a flush, object URL released, refusal keeps the file staged and retryable, one refusal does not stop the rest, nothing written until save, removal needs no server call)
- rewritten action tests: the record names itself, the name refreshes on every save, a too-long caption truncates rather than being refused

**Gates:** typecheck 0 · lint 0 errors (1 pre-existing warning in untouched `ReportForm.tsx`) · build succeeds.

**Browser verification — 70/70**, database identical before and after (`content 12, socialPosts 1, socialTargets 0, socialAccounts 0, files 7, projects 5`):

| Section | Proven against the real database |
|---|---|
| A. The removals | No *Internal name* field, no replacement title field, no *"save a draft first"* anywhere, media buttons live immediately |
| B. Compose first | Image **and** video added before saving; a video offered as a photo is still refused; **nothing written to the database while staging**; staged media removable with no server call and re-addable; per-platform captions written before saving with Instagram not touching Facebook; tab switching loses neither caption nor media; **the preview works pre-save**; state still reads *Not saved yet* |
| C. Save Draft | DRAFT, `publishedAt` null, **the record named itself from the caption**, both staged files uploaded and attached to the Content row, shared and per-platform captions persisted |
| D. Reopen | Media present and not re-staged, captions restored, state reads *Saved*; on a saved post media uploads immediately and **existing media survives** |
| E. Schedule | SCHEDULED at the exact instant (09:00 Singapore → 01:00Z) with the zone recorded, `publishedAt` still null; reopens as scheduled with *Update schedule* + *Cancel schedule* and no plain *Schedule*; **the header now agrees with the composer** |
| F. Cancel | **Zero orphaned `File` rows, zero orphaned `Content` rows**, the abandoned file exists nowhere; the already-saved post is untouched |
| G. Ownership | Another client's account is never offered and never becomes a target; malformed and missing ids fail safely |
| H. Responsive | 390 / 768 / 1024 / 1440 — no sideways scroll, neither removed string reappears |

### Three harness bugs, investigated rather than assumed

- **The harness drove the hidden file input directly**, bypassing the Photo/Video buttons that select which MIME list applies — so the video was correctly refused as "not a supported image type", and the check *passed anyway* by matching the filename inside that error message. It now clicks the buttons like a user, asserts on each item's own Remove control, and additionally proves the refusal path works.
- **A case-sensitive regex against a CSS-`uppercase`d label** made a correct composer look wrong (the same artifact as the previous phase — now fixed across every save-state assertion).
- **An edit made while the harness was running** hot-reloaded the dev server mid-run and reset component state. Re-run against a stable tree.

### One error attributed away from this work

The only console message is the hydration error on a **reload at 390px**, already proven in the previous phase to reproduce on four untouched routes (`/clients`, `/settings/publishing`, `/dashboard`, `/seo`). It is the app shell's mobile sidebar.

## 10. Limitations

- Staged files live in browser memory until save. With the platform-wide 10MB per-file limit this is fine, but a very large batch is held in the tab; the limit itself was deliberately not raised.
- Media is still **shared across platforms** — one set of files per post. Per-platform media would need a new table and was not requested here; the platform tab says so plainly rather than showing a control that does nothing.
- Still no publishing: no OAuth, no platform API, nothing leaves Cloud Compass.
