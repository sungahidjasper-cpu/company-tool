# Content Workspace — UX consistency pass

**No schema change. No new fields. No new routes.** Every control that moved was moved, not duplicated.

The goal: make four screens tell the same story — **the client owns the content, the content type says what it is, the SEO project is optional context.**

---

## What was reviewed

The Social Composer context bar, the Blog Studio header, Content Detail, and the Content Workspace calendar (context bar, item cards, filters, creation flow).

## Issues found, and what changed

### 1. Social Composer showed a blank SEO project field

For a client-owned post the bar rendered a bold **SEO PROJECT** label above nothing at all — which reads as missing data, not as something optional. There was also no mention of the content type.

Now: **Client → Content type → Intended for**, with the SEO project last, in muted text, and **only when there is one**.

### 2. Content Detail linked to `/seo/null` — in four places

A real bug, not cosmetic. For content with no project the page rendered `href="/seo/null"`:

- the breadcrumb (with an empty label)
- **the primary Edit button** — dead for every client-owned record
- the Details card's SEO project row
- each targeted keyword

Fixed: each of those appears only when the record actually has a project. The Edit button is a project-scoped form, so it is offered only for project content — social and blog records already have their own working **Edit in composer** / **Edit in studio** links that need no project.

The Details card now reads **Client → Content type → SEO project**, with the type moved up from a lower card so the three identifying facts sit together. No project reads *"None — optional"*.

### 3. Blog Studio put the optional context first

The header read `{project} · {client}`, and with no project it left a dangling `·` before the client name. Now: **client (emphasised) · Blog post · project when present**.

### 4. The calendar mixed two type vocabularies in one control

Content Type was a checkbox group buried in the filter panel, and its options were built from *every* type present — so **"Social post" sat beside "Guide" and "Landing page"** as though they were the same kind of thing. They are not: the first three are real content types on `Content`, the rest are planned-item types on `ContentCalendarEntry`.

Now:

- **Content type** is a select in the top context bar, between Client and SEO Project — `All content · Social post · Blog post · SEO content`
- the filter panel keeps the other vocabulary, relabelled **Planned item type**
- both still drive the same `filters.contentTypes` state, so there is one control per question rather than two for one

### 5. Dead project-first copy in the composer

Two branches still said *"this project has none assigned"* and *"assign a client to this SEO project"*. Since `clientId`/`clientName` became required they could no longer render, so they were removed rather than left to mislead a future reader.

## Left unchanged on purpose

`SocialAccount` architecture, platform tabs, per-platform captions, media-before-save, previews, social scheduling, social Settings, the Blog rich editor, blog media, the blog SEO panel, publishing, AI, content ownership, the `contentType` field, planned items and `ContentCalendar` ownership.

**The four unclassified records were not touched** — verified before and after that the same four rows remain `NULL`.

`hasTypedItems` is now used only by its own test. Left in place: it is a small, pure, tested helper, and removing it is not part of a UX pass.

## Verified

**68/68 browser checks** across the Social Composer (with and without a project), Blog Studio (with and without), Content Detail, the calendar context bar, type narrowing, the creation flow, isolation, and four widths. Database identical before and after, no test records left.

Gates: typecheck 0 · **4090 tests** · lint 0 errors · build clean.

## Remaining limitations

- Four older records still read **"Not recorded"**, and are hidden while a content type is selected. Classifying them needs a human decision.
- Newsletter and press release still create no `Content` row, so they have no type and cannot appear on the calendar.
- The app shell overflows horizontally at some widths on wide-table pages such as `/clients`, `/seo` and `/users`. Out of scope here, and the workspace overflows no more than those untouched routes at any width.
