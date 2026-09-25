# Content Workspace — Phase 1

**Status:** Working — read-only calendar-first workspace, verified in the browser
**Date:** 2026-09-09
**Route:** `/content`

---

## What was discovered

Three findings shaped the work.

**1. The client hierarchy already exists.** Company → Client → SEO Project → Content. No new tenant
layer was needed; the SEO project is already the per-client container.

**2. Content has no scheduled publishing date.** The only date a page carries is `publishedAt`,
which records when it *actually went out*. There is no "publish this on…" field. That single fact
decided the whole date-handling design.

**3. Live content can belong to a deleted project.** In the current database, two live content rows
sit under a soft-deleted SEO project — including the only row that has a publish date. A query that
filtered just the content's own deleted flag would have surfaced pages from a project the user had
already thrown away. The workspace requires the parent project to be live as well.

Also confirmed and reused rather than rebuilt: the content detail page, the saved calendar routes,
the permission helpers, the design system, and the date helpers already written for the Content
Calendar Assistant.

---

## What was implemented

A calendar-first page at `/content`, plus one new sidebar entry.

**Toolbar** — Today, previous/next, the current period, and a Month / Week / Day / Agenda switcher.

**Calendar** — a month grid with compact item chips. A day showing more than three items collapses
the rest behind a "+N more" link rather than stretching the cell. Week, Day and Agenda views read
the same data.

**Right rail** — a mini month picker (with a dot on days that hold something), a search box, and
filter groups for type, client, SEO project and status. Below `xl` the rail collapses and is opened
by a Filters button.

**Item panel** — clicking an item opens a side panel with its status, date, project, client and
whatever else the record genuinely carries. Its only action is to open the item in the existing page
that already handles it.

Two things were deliberately left out. There is **no "+ New" button**, because Phase 1 has nothing
to create and a button that did nothing would be worse than no button. And there is **no drag and
drop**, because moving an item would need somewhere to save the new date, which does not exist yet.

---

## What existing data is displayed

Two sources, side by side, deliberately not merged.

| | Where it sits | Its date | Its status |
|---|---|---|---|
| **Content pages** | On the day they were published | `publishedAt` only | The content lifecycle: draft, in review, approved, published, archived |
| **Planned items** | On their planned day | The plan's scheduled date | The plan's own progress: planned, brief created, draft, in progress, published, completed |

A planned item is never shown as a published page, and a page is never shown as scheduled. The two
status lists are also kept apart in the filters, because both contain the word "Published" and they
mean different things — filtering pages by "Published" cannot accidentally select plans.

**Content with no publish date is not placed on a guessed day.** It appears in a clearly labelled
"Not on the calendar" list, with a line explaining that it has no publish date yet. Using its
creation or last-edited date would have been an invention.

Content type is shown only for planned items, because only they have one — the Content model has no
content-type field, so none is claimed for pages.

---

## Security

The company comes from the signed-in user and nothing else. Both feed queries scope through the SEO
project to that company **and** require the project to be live. Soft-deleted content, soft-deleted
calendars and soft-deleted plan entries are all excluded.

Verified in the browser against the real database: the two live pages belonging to a trashed project
and the one soft-deleted page were all correctly absent, while all seven legitimate pages appeared.

Filters run in the browser over data the server already decided the user may see, so a filter can
only ever narrow what is displayed — it can never widen it or reach anything new.

---

## Read-only guarantee

Nothing in this feature writes.

- No server actions were added. There is no create, update, delete or status change.
- The queries select only what the calendar needs — no page bodies, no AI brief data.
- The module the browser loads does not import the database client at all; the queries live in a
  separate server-only file.
- Verified in the browser by counting **fourteen tables** before and after a full run covering every
  view, every filter, search, date navigation, the item panel and navigation into a content page.
  Every count was identical.
- No Prisma change, no migration.

---

## Browser verification

Verified against the real application and database. Everything passed:

the page loads from the sidebar; the toolbar, view switcher, mini calendar, search and all four
filter groups are present; real content appears; content from a trashed project and soft-deleted
content are both correctly excluded; all seven undated pages are listed with an explanation; search
narrows and clears correctly and shows a proper empty state; filtering to planned items hides pages;
all four views switch; next/previous and Today work; the item panel opens, says "No date yet" rather
than inventing a date, offers no editing action, and opens the existing content page; the content
region does not overflow at mobile, tablet or desktop widths; the mobile Filters toggle works; and
**zero database writes** occurred anywhere.

**Two problems were found and traced to the shared application shell, not to this work:**

1. At mobile width, the sidebar produces a hydration warning — the server renders the desktop
   sidebar because it cannot know the viewport, and the browser then swaps in the mobile version.
   Reproduced on **six pages**, including the dashboard, clients, SEO and the existing Content
   Calendar Assistant. Not introduced here, and fixing the shared sidebar is outside this phase.
2. At exactly tablet width the page as a whole is wider than the window, for the same reason — the
   desktop sidebar still occupies its full width. Also reproducible on the untouched SEO page. The
   calendar's own content region fits correctly at every width from mobile to desktop.

Both are worth fixing, but as their own authorised change to the shell.

**Two other apparent failures were faults in the test script:** it looked for mixed-case labels that
the design system renders in capitals, and it measured the whole document rather than the content
region this page owns. Both corrected and passing.

---

## Limitations

1. **Read-only.** No creating, editing, scheduling, moving, approving or publishing.
2. **Only published pages appear on the grid.** Everything else is honest but undated, because
   nothing in the data says when it should go out. Scheduling is Phase 5.
3. **No time of day and no time zone** — the data has neither.
4. **No platforms**, because the Content model has no platform field. Nothing is invented.
5. **No campaign filter**, because no campaign data exists yet.
6. **No content-type filter for pages** — only planned items carry a type.
7. **In this environment the month grid is empty**, correctly: the only page with a publish date
   belongs to a trashed project, and the saved plan entries were soft-deleted during earlier
   testing. The undated list and every control were verified with real data instead.

---

## Next phase

**Phase 2 — client/workspace context**: a persistent client selector that drives the whole
workspace, so the calendar, filters and eventually media and approvals all follow the chosen client.

After that, in order: richer views and filtering, an expanded item panel, then the first schema
change of this roadmap — a scheduled date, a time zone and a scheduled status — which is what turns
the calendar from a record of what happened into a plan for what will.
