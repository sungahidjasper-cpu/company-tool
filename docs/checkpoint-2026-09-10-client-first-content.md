# Checkpoint — 10 September 2026

**Today's headline: the Content Workspace is now client-first. You no longer need an SEO project to use it.**

Nothing is committed. All of today's work sits in the working tree on top of `9a9077b`.

---

## 1. What we finished today

### The ownership change

Content used to belong to an SEO project, and only to an SEO project. That meant a client with no SEO project could not own content at all — the calendar told them there was "nothing to show here", and creating a social post or a blog article simply failed.

Content now belongs to:

- a **company** — always. This is what decides who is allowed to see it.
- a **client** — optionally. This is the business the content is for.
- an **SEO project** — optionally. This is now just extra context, not the way in.

### Why the SEO project became optional

Because for most content it was never really needed. A social post is written for a client's own social accounts. A blog article is written for a client. Neither of them needs a keyword list or a website domain — the SEO project was only there because the database insisted on it.

Work that genuinely *does* need a project still asks for one: keyword research, internal-link analysis, meta tags, long-form article generation, and publishing. Those now say so in plain words instead of quietly assuming it.

### What this unlocked

A client with no SEO project can now open the Content Workspace, see a working calendar, click **Create content for this day**, and choose a social post or a blog article. All of it saves, schedules, and shows up on their calendar.

### Existing work was protected

- Every existing content record was kept and filled in automatically from the project it already belonged to. Nothing was lost, and no client was guessed at.
- **Deleting an SEO project no longer deletes its content.** The content stays with the client and simply stops being linked to a project.
- Every existing SEO web address still works exactly as before.

### The Social Composer is unchanged and still complete

Platform tabs, each platform's own caption, per-platform settings, platform identity, adding photos and video *before* saving, the preview, Save Draft and Schedule — all still working. Social accounts are still managed only in **Settings → Clients → [client] → Social accounts**, never inside the composer.

## 2. What we checked

| Check | Result |
|---|---|
| Existing content preserved | 13 of 13 records kept, every one filled in correctly |
| Records with no company | 0 |
| Deleting a project | Content survived; only the project link was cleared |
| Client with no SEO project | Calendar loads, social and blog both work |
| Old SEO web addresses | Still work |
| Wrong client/project combination in a link | Refused |
| Automated tests | 4,068 passing |
| Type checking / code linting / production build | All clean |
| Screen sizes 390 / 768 / 1024 / 1440 | All fine |
| Test data left behind | None — checked again after today's restart |

## 3. What still depends on an SEO project

**Correctly, and we should leave these alone:** keywords, keyword clusters, knowledge sources, long-form article generation, publishing, internal-link analysis, meta tags, topic clusters, and competitor/gap analysis. These genuinely use the project's keyword list or website address.

**Still linked to a project only out of habit:** the newsletter writer, press release writer, social snippet generator and image alt-text tool. None of them actually reads anything from the project — they just use it as a container. These could become client-based later.

## 4. Three limitations we found today (all left alone on purpose)

### Content does not know what type it is

A content record cannot currently say whether it is a blog article, an SEO page or something else. The only type the system can tell for certain is "social post", because those have a social record attached.

This means we **cannot yet build an honest content type filter**:

```
CONTENT TYPE
[ All ] [ Social ] [ Blog ] [ SEO ]
```

Choosing a type today would quietly hide most real content. This is the clearest next thing to fix.

### Planned calendar items are still project-based

The Content Calendar Assistant plans from a project's keywords, and its planned items belong to a project rather than a client. This is a fair design as long as planning is an SEO activity — but if planning should also cover social and blog, it will need the same change Content just had.

**This needs a product decision first, so nothing was changed.**

### Newsletters and press releases are not saved as content

Both tools generate text but do not create a content record. So they cannot appear on the calendar, cannot be scheduled, and cannot be published. If "Newsletter" is meant to be a content type on the calendar, that gap has to be closed first.

## 5. Recommended next phase

**Give content a proper content type.**

It is the smallest change that unlocks the most: the calendar filter, a clearer "what would you like to create", and a path for newsletters to become real content later. It is one new optional field, filled in from what the records already prove — social posts are already identifiable, and records with an article body are articles. Anything genuinely unknown stays blank rather than being guessed.

It does not touch ownership, publishing, the AI tools, or planned items.

## 6. Where things stand

- Nothing committed, nothing pushed. All work is in the working tree on `9a9077b`.
- Four database changes have been applied locally and are not yet committed.
- Database contents match the verified checkpoint exactly, with no test records left over.

### Related documents

- `content-client-first-ownership.md` — the full technical detail of today's change
- `content-ownership-dependency-map.md` — the investigation that led to it
- `content-operations-architecture-assessment.md` — what is client-first, what is project-first, and why
