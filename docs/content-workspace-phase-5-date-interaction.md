# Content Workspace — Phase 5, date interaction slice

**Status:** Date interaction COMPLETE and browser-verified (55/55). **Scheduling foundation NOT implemented — it needs a schema change and separate authorization.**
**Route:** `/content` (unchanged) — no new route, no new page.
**Zero database writes. Prisma schema unchanged. No migration.**

---

## 1. What was wrong

The calendar's date cells were display-only. Every other part of the workspace was interactive — chips, filters, views, the rail's mini calendar — but the dates themselves did nothing, so the grid read as a picture of a calendar rather than a calendar.

## 2. Discovery: there was already a date mechanism

| Finding | Consequence |
|---|---|
| `anchor` state is already the single date context, and the rail's mini calendar already set it through `onPick` | The main grid simply never called it. Reused — no second mechanism was created. |
| The `date=` URL parameter (Phase 3) was written **only** when client/project changed | Stepping a period or picking a date was lost on refresh. Now every date change echoes into the same parameter through the same `buildWorkspaceHref`. |
| `ContentStatus` has no `SCHEDULED`; `Content` has no `scheduledAt` | **The scheduling model does not exist.** Only `ContentCalendarEntry.scheduledDate` exists, and that is planning, not Content scheduling. |

## 3. What was implemented

**One handler, `pickDate`,** used by the grid *and* the mini calendar. It sets the anchor day and echoes it into the URL. It performs no write, and `resolveDateClick` cannot hand it anything that would — the result type has exactly two fields, `anchorIso` and `view`.

**Per view:**

| View | Behaviour |
|---|---|
| Month | The whole usable cell selects the date, not just the number. |
| Week | The day row selects that day. |
| Agenda | The date heading selects the date **and moves to Day view** — selecting a date in a list that already shows every day would otherwise look like nothing happened. |
| Day | The day is already the view; no selection control exists there, so nothing can unexpectedly move the date. |

**Nested-interaction safety.** The date target is a real `<button>` stretched behind the cell, a *sibling* of the item stack rather than its ancestor, so an item click can never reach it — no `stopPropagation`, no handler ordering to get wrong, and the target is keyboard-reachable and announces the day (`aria-label`, `aria-pressed`).

**Selected day panel.** Names the day, gives its relative label, counts content and planned items separately, lists what is on it, and offers "Open this day" / "Back to today". Empty days get real context and the note *"Nothing is dated on this day."* — deliberately not an invitation to create anything.

**URL state.** `globalThis.history.replaceState` (Next supports this and integrates it with its router; `globalThis` because this component has a local `window` — the date range — that shadows the global). A `router.push` would re-run the server page, and the feed is loaded per project, not per date, so a navigation would refetch identical data on every click. Client, project and view all ride along via the existing `buildWorkspaceHref`.

## 4. What was deliberately NOT implemented

**The scheduling foundation.** Selecting 20 September must never turn a draft into something scheduled, and today it cannot: there is nothing to write to. Delivering "select date → choose content → confirm → SCHEDULED" requires

- `Content.scheduledAt` (a new column), and
- a `SCHEDULED` value on the `ContentStatus` enum,

both of which are Prisma schema changes requiring a migration. The standing instruction is to stop and report when a schema change appears necessary rather than implement it, so this stops here.

In its place the day panel names the gap without a control, following the Content Detail page's "Not available yet" precedent:

> Scheduling is not available yet. Content records have no scheduled date, so a date can be selected for context but nothing can be scheduled onto it. A publish date is recorded only once content is actually published.

Two of the requested tests — "explicit scheduling action" and "scheduled Content appearing on the correct calendar date" — therefore **cannot be written yet**. They are not stubbed or faked.

## 5. Defect found and fixed during verification

The Week view's item column is `flex-1`, so it spanned the entire row and intercepted every click meant for the date behind it — the day was unselectable. Fixed by making item **containers** `pointer-events-none` and the items themselves `pointer-events-auto`, in both Week and Month. Browser hit-testing now confirms a click at a cell's centre *and* low in the cell body both resolve to the date control.

## 6. Files changed

| File | Change |
|---|---|
| `features/content-workspace/services/date-selection.ts` | **New.** Pure: `resolveDateClick`, `isDateSelected`, `dayContext`, `SCHEDULING_FROM_DATE_UNAVAILABLE`, `DAY_PANEL_ACTIONS`. |
| `features/content-workspace/services/date-selection.test.ts` | **New.** 31 tests. |
| `features/content-workspace/components/ContentWorkspaceCalendar.tsx` | `pickDate`; selectable Month cells, Week rows and Agenda headings; pointer-event layering; the selected-day panel; URL echo on pick/step/view change. |

## 7. Verification

**55/55 browser checks pass, zero console errors, zero database writes.** Beyond row counts, every Content row's `status`, `publishedAt` and `updatedAt`, and every planned entry's `status` and `scheduledDate`, were fingerprinted before and after and are byte-identical. No Content became `SCHEDULED` — the status does not exist.

Covered: month date click, week date click, empty-date selection, URL date update, client and project preservation, view switching after selection, refresh after selection, item-click versus date-click, and the honest absence of scheduling.

**Gates:** typecheck exit 0 · 137 files / 3740 tests pass · lint 0 errors (1 pre-existing warning, untouched file) · production build compiled successfully.

## 8. Test-data limitations

- **No dated items exist in any live project.** All nine calendar entries sit under a soft-deleted calendar and the only dated Content sits under a soft-deleted project — both correctly excluded from the workspace. So **clicking a populated date could not be exercised**, and no data was fabricated to manufacture one. The item-versus-date separation was instead verified by DOM hit-testing plus a real click on an existing undated Content item, which opened the item and left the selected date unchanged.
- For the same reason the **Agenda heading** could not be clicked in the browser (no dated groups render). Its behaviour is unit-tested (`AGENDA` → `DAY` for the chosen date).
- Only one company exists, so cross-company checks remain unexercised.

## 9. Out of scope, and not implemented

Drag-and-drop, automatic scheduling, content creation from the calendar, campaigns, social publishing, platform variations, media, approvals, previews, analytics, Data Stronghold. No Prisma migration was created.
