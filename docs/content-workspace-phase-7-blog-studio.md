# Content Workspace — Phase 7: Blog Content Studio

**Status:** PASS — an article-first block editor with inline images, browser-verified 76/76.
**No new dependency. No schema change. No migration. Content.body stays canonical Markdown.**

---

## 1. Discovery

| Question | Finding |
|---|---|
| Is there an editor dependency? | No — no tiptap/slate/lexical/prosemirror, and no Markdown library. |
| Is there an existing block architecture? | **Yes.** `parseMarkdownBlocks` already returns typed blocks (heading 1–4, paragraph, ul, ol, table), `ArticleMarkdownPreview` renders them to real React elements (never `dangerouslySetInnerHTML`), and `isSafeHref` guards links. |
| What is `Content.body`? | Markdown. `markdownToHtml` converts it for WordPress publishing; the AI tools read it as prose. |
| Media? | `File` already attaches by `contentId`, with company scope, permissions, size and MIME checks. |
| Revisions? | `createContentRevisionSnapshot` already exists and is transaction-aware. |
| SEO? | `Content.metaTitle` / `metaDescription` / `url` already exist, written today by the Meta Tag Optimizer. |

## 2. Editor decision — no dependency

**None of the stop conditions applied**, so no stop was needed: no schema redesign, no body migration, no break to the AI tools or publishing, no new media architecture, and no dependency.

The article is edited as a list of typed blocks and serialized to Markdown. That is what makes an image a real part of the document at a real position rather than an attachment beside it, and it needs no editor library: the block vocabulary is small, the round trip is testable, and the renderer builds React elements so there is no HTML-injection surface at all.

**Extended, not replaced:** the block union gained `quote`, `code`, `divider`, `image`, `video` and heading levels 5–6; the parser learned them; a `serializeMarkdownBlocks` inverse was added; the renderer learned the new blocks plus strikethrough and inline code.

## 3–5. Studio layout and editor

Header with breadcrumb, client, project and the intended schedule. **Edit / Preview / SEO** views. Main canvas: a large title input and the block canvas. Sidebar: schedule, article settings, actions. One column below 1280px, two above.

Supported: H1–H6, paragraph, bold, italic, strikethrough, inline code, links, ordered and unordered lists, blockquote, code block, divider, table (with add row/column), image, video. Blocks can be moved up/down and deleted; **Insert** appears between every pair of blocks.

## 6–7. Inline images — the core requirement

Insert → Image at a chosen position uploads through the **existing** `uploadFile` action (`entityType: "content"`), and the block becomes part of the article at that exact position, with editable **alt text** and **caption**, and Replace/Remove. Verified in the browser against a real file: the saved body is

```
## Why unit mix matters

![A storage facility at dusk](/api/files/01a0838b-… "Our Reno site")

Below the image the article carries on. See [our guide](https://example.com/guide)
```

Images attach to the saved article, so the studio asks for a draft to be saved first rather than uploading into limbo. No second media library exists.

## 8. Storage

`Content.body` remains canonical Markdown. Images use Markdown's own image syntax, with the caption in Markdown's title slot; a video serializes as `[video](src)`, so a plain Markdown reader degrades to a link rather than to broken syntax. **No HTML is ever written into the body** — verified by test.

`markdownToHtml` (the WordPress path) was extended to render inline images, because an article containing one would otherwise have published the literal `![alt](…)`. The src goes through the same `isSafeHref` check, and both attributes are escaped.

## 9. Preview

Renders title, headings, paragraphs, images, captions, video, tables, links, lists, blockquotes and inline formatting — and contains **no editor controls at all** (asserted).

## 10–11. SEO and settings

SEO title, meta description and URL/slug write to the **existing** columns, with length guidance and a live search preview that falls back to the article's own title and first prose — and says when it is doing so, because nothing is stored as metadata that the user did not type. Target keywords reuse the project's existing keywords. Author reuses the existing user list.

A featured image, category and excerpt are **not** offered: they have no columns on Content, and inventing them to match another CMS was out of scope.

**Correction (second pass):** an earlier version of this document said tags were not stored. That was wrong — `Content.tags Tag[]` is a real, existing, company-owned relation that simply had no code listing it. Tags are now offered, as is the editorial status. See the second-pass section below.

## 12–14. Scheduling, saving, revisions

Phase 5 scheduling exactly: the calendar's date, time and zone arrive, can be changed, and **only Schedule** produces `SCHEDULED`. `publishedAt` is never touched, and nothing publishes. Saving uses the existing Content record and the **existing** revision service inside one transaction — a revision is written only when the title, body or meta actually changed.

## 15–16. Content Detail and calendar

Content Detail now **renders** the article (previously raw text), so inline images appear, and offers "Edit in studio". Scheduling, version history and everything else are unchanged. The calendar places the article on its scheduled date and keeps Draft / Scheduled / Published / Planned distinct.

## 17. Social Composer

Not rebuilt. It shares the same cards, spacing, schedule panel and action pattern, and received the same URL fix described below.

## Defects found and fixed during verification

1. **A refresh after saving lost the draft.** The new record's id lived only in component state, so reopening the URL gave an empty studio — the work was safe in the database but unreachable. Fixed by writing `?contentId=` into the URL on save. **The Social Composer had the same defect and the same fix.**
2. **The intended schedule did not survive that refresh**, falling back to a default. The date, time and zone now ride along in the same URL.

## Tests and gates

| Gate | Result |
|---|---|
| New tests | 23 block round-trip · 25 SEO/publishing · 27 action/authorization |
| Full suite | 142 files, **3952 tests** pass |
| Typecheck | exit 0 |
| Lint | 0 errors (1 pre-existing warning, untouched file) |
| Build | Compiled successfully |
| Browser | **76/76 PASS**, A–Z plus security and responsive |

## Database before and after

Identical: `content 12, revisions 9, files 7, socialPosts 1, socialAccounts 0`. The one clearly-named test article and its uploaded image were removed. **Two rows created by your own manual testing** (a social post with a real image, and a scheduled item) were left untouched.

## Environmental issues

The local Prisma dev proxy (`connection_limit=10`) began closing idle connections once the dev server, a browser session and the harness were all attached, which broke both the app route and the harness. Resolved by restarting the proxy and the dev server; the harness also retries reads. Not an application defect.

## Not implemented

Underline (Markdown has no underline, and writing raw `<u>` into the body would leak HTML into every Markdown consumer — reported rather than faked) · third-party iframe embeds (no allow-list infrastructure; an arbitrary iframe is an injection surface) · charts · client portal or approval system · OAuth and social publishing APIs · analytics · campaigns · Data Stronghold · automatic scheduled publishing · collaboration · image or video generation · AI writing · platform-specific social variations.

---

## Second pass — studio completion (2026-09-10)

The core studio was already in place; this pass closed the remaining gaps against the Phase 7 brief. **No schema change, no new dependency.**

| Gap | Now |
|---|---|
| **Tags** were reported as unstorable — wrong | `Content.tags` is real and company-owned. A new server-only `listCompanyTags` lists them and the studio edits them; a foreign-company tag id is filtered out before any write. |
| **Editorial status** could not be set | A Status control offers only the manually-selectable statuses. `SCHEDULED` is refused by the action, since that value needs a date, a time and a zone. |
| **Update / Cancel schedule** were missing from the studio | The primary button reads **Update schedule** once scheduled, and **Cancel schedule** appears beside it — reusing the *existing* Phase 5 `cancelContentScheduleAction`, not a second scheduling path. |
| **No save status** | The header reports *Not saved yet* / *Unsaved changes* / *Saved*, derived from a fingerprint of everything the studio can change. |
| Actions sat at the bottom of a sidebar card | They now sit in the studio header beside the Edit/Preview/SEO switch — one control surface, reachable at every width. The canvas lost its border so the article is the visual focus. |

**A scheduled article keeps its schedule through an ordinary save.** A plain *Save draft* deliberately sends no status, so editing a scheduled article cannot silently unschedule it; while it is scheduled the Status control is inert and says why.

### Verification

**48/48 new checks pass**, and the original **76/76 Phase 7 suite still passes** unchanged. Gates: typecheck 0, **3963 tests**, lint 0 errors, build succeeds. Database identical before and after (`content 12, revisions 9, files 7, tags 0`).

Two flaws found and fixed during this pass, both mine:
1. The *Not saved yet* branch was unreachable — a never-saved article is always "dirty", so it reported *Unsaved changes* for something that had never been saved. The state is now checked before the diff.
2. An early truncated harness run (`head` closing the pipe) killed cleanup and left one test row behind; it was found and removed, and the harness now writes to a file so cleanup always completes.

### Still not offered, and why

Featured image, category and excerpt have no columns on `Content`. Adding three columns to match another CMS was out of scope for this phase; say the word and they are a small, deliberate migration.
