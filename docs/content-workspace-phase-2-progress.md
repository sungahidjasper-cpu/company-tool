# Content Workspace — Phase 2

**Status:** Working — persistent client/workspace context, verified in the browser
**Route:** `/content` (unchanged)
**Still read-only.**

---

## What was implemented

A client/workspace context bar above the Phase 1 calendar, so it is always obvious whose content is
on screen.

- **Client selector** — All clients, each of the company's clients, and "No client assigned" when
  the company has projects that are not attached to a client.
- **SEO project selector** — narrows to the projects belonging to the chosen client. A client with
  several projects can be viewed together or one at a time.
- **A plain summary line** — "Showing *Acme Plumbing* · *All projects*" — so the context reads as a
  sentence rather than two dropdowns.
- **A clear message for a client with no active SEO projects**, which says what to do about it. That
  is a different situation from "no content yet", and the fix is different too.

Everything from Phase 1 is untouched: month/week/day/agenda, Today, previous/next, the mini
calendar, search, status filters, the "+N more" collapse, the item panel, navigation into the
existing content page, and the responsive behaviour.

One thing was deliberately **removed**: the rail's client and project checkbox lists. Client and
project are now the page's context, chosen at the top, so having them a second time in the rail
would be two controls doing one job. A project filter remains in the rail only where it still helps
— when the current context spans more than one project.

---

## How client and project context works

The hierarchy already existed and was reused as-is:

**Company → Client → SEO Project → Content**

No new client, workspace, tenant or content model was added.

Choosing a client changes the page address, which makes the **server** decide what may be read. The
selection is turned into an explicit list of project ids, and the calendar queries are bounded by
that list. Narrowing on the browser side would have looked the same and protected nothing.

Clients are listed with the same helper the Lead and Project forms already use. That was a
deliberate change from Phase 1, which derived the client list from whichever projects happened to
have one — a client with no project yet was invisible. Now it is selectable and can be told plainly
that it has nothing.

---

## Security

Every request re-derives the company from the signed-in user, then:

1. Fetches that company's live clients and live SEO projects.
2. Treats the requested client and project as **untrusted input**, whether they came from the
   address bar or from the remembered selection.
3. Keeps a client or project only if it appears in those server-built lists.
4. Bounds the calendar queries by the resulting, already-verified project ids.

That single rule covers every bad case with one behaviour — fall back to something safe:

| Attempt | Result |
|---|---|
| Another company's client or project | Falls back to All clients / All projects |
| A deleted client or project | Same — deleted records never reach the option list |
| A malformed or empty id | Same |
| A real project belonging to a **different** client of the same company | The client is kept, the mismatched project is dropped |
| A client with no live projects | Valid, but reads nothing, and says so |

The last two matter most. The mismatched pair is the subtle case — both ids are real and both belong
to the company, but the combination does not. And an empty project list must mean *nothing*, never
*everything*: if the restriction were simply omitted when empty, the query would silently widen back
to the whole company. It returns nothing instead.

Verified in the browser with real data: content from a client-assigned project did not appear while
viewing unassigned projects, content from a soft-deleted project stayed excluded throughout, and
five separate tampering attempts through the address bar all fell back safely.

---

## Persistence

Two mechanisms, in the order the roadmap asked for.

**The address bar is the source of truth.** The client, project and current view all live in the
page address, so a link can be shared or bookmarked and opens on the same context.

**A cookie remembers the last selection**, so arriving at a plain `/content` — from the sidebar, for
instance — returns to the client last worked on. A cookie was chosen because it is the *only*
UI-state persistence this application already has (the sidebar's own open/closed state works exactly
this way), and because the server can read it.

No database column was added. The cookie holds a display preference and nothing else: whatever id it
contains is re-checked against the company on every request, so a tampered or stale cookie can only
ever preselect a different one of the user's own clients — verified by test.

---

## Read-only guarantee

Unchanged from Phase 1. No server actions, no create, edit, delete, reschedule, status change or
publish. Choosing a client only changes what is read.

Verified by counting twelve tables before and after a full run covering client switching, project
narrowing, five tampering attempts, all four views, search, the item panel and navigation into a
content page. Every count identical.

---

## Browser verification

Verified against the real company, its two real clients, its live projects and one soft-deleted
project. Everything passed: the page opens with the context bar; only this company's clients are
offered; the project list follows the client; switching client changes the data with no leakage; a
client with no projects says so and disables the project selector; narrowing to one project shows
only its content; five tampering attempts fall back safely; the selection survives navigating away
and returning; every Phase 1 control still works; content detail navigation still works; nothing
overflows at mobile, tablet or desktop; and zero database writes.

**One real bug was found and fixed during verification.** Choosing a project while viewing all
clients produced an address containing only the project — and the page ignored it, because it keyed
off the client being present. Sharing such a link silently lost the project. The page now honours
either part of the selection, and a test pins the round-trip so it cannot regress.

---

## Shared-shell maintenance findings

Recorded, not fixed — these belong to the shared application shell and affect pages this work never
touched.

1. **Mobile hydration warning.** At small widths the sidebar renders its desktop form on the server
   and swaps to the mobile form in the browser. Present on every dashboard page tested, including
   the dashboard itself, clients, SEO and the AI workspace. First recorded in Phase 1.
2. **Tablet-width page overflow**, same cause: the desktop sidebar still occupies its full width at
   that breakpoint. Also reproducible on the untouched SEO page.
3. **An intermittent browser error** (`Cannot read properties of null`) appeared twice across
   several full verification runs and could not be reproduced in thirty-two targeted attempts, nor
   in the final instrumented run, nor on any single page load at any width. Untouched pages behave
   identically under the same conditions, and the production build is clean. It appears to follow
   the hydration recovery above rather than anything in this work, but it is recorded rather than
   dismissed.

All three deserve their own authorised change to the shell.

---

## Database impact

Nothing changed. No writes, no schema change, no migration, no records created for testing.

---

## Limitations

1. **Still read-only** — no creating, editing, scheduling or publishing.
2. **Switching client reloads the calendar** and returns the view to its default period. The chosen
   view itself is preserved; the date position is not.
3. **Search and status filters remain per-visit** — they are not carried in the address or
   remembered. Only the client, project and view are.
4. **A client is only as useful as its projects.** In the current data both real clients have no
   live SEO project, so selecting either correctly shows the "no active projects" message. The
   multi-project case is covered by tests rather than by real data.
5. **Still only published pages appear on the grid**, because content has no scheduled date. That
   remains Phase 5.

---

## Next roadmap phase

**Phase 3 — calendar views and filtering.** Then the expanded item panel, and after that Phase 5's
scheduled date, time zone and scheduled status, which is the first schema change of this roadmap.
