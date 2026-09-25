# Content Workspace — Phase 5: scheduling foundation & creation entry

**Status:** PASS — scheduling foundation and the first creation-entry workflow, browser-verified 80/80.
**Migration:** `20260908215138_content_scheduling` — one enum value, two nullable columns, one index.
**No later-phase functionality was implemented.**

---

## 1. Discovery

| Finding | Consequence |
|---|---|
| `advanceContentStatus` walked `CONTENT_STATUS_ORDER` with `indexOf` | Inserting SCHEDULED there would let a generic "advance" button set it with no date, time or zone — and for an already-scheduled row `indexOf` returned `-1`, silently "advancing" it back to DRAFT. SCHEDULED is therefore excluded from the linear order, and `nextContentStatus()` replaces the raw `indexOf`. |
| The edit form's status dropdown is free | SCHEDULED is not offered there, and `updateContent` refuses to *introduce* it. A record that already is scheduled keeps its value so an edit cannot silently unschedule it. |
| CSV import maps a status string | Restricted to the manually-selectable statuses — a CSV row carries no date, time or zone. |
| `isContentStatusPublishable` = `{APPROVED, PUBLISHED}` | Untouched. A schedule does not make content externally publishable. |
| `ContentCalendarEntry` is a separate model with its own status enum | PLANNED and SCHEDULED cannot collide; they are different tables. |
| `PublishingProviderType` has only `WORDPRESS` | There is genuinely no social platform to publish through, and the entry point says so from data rather than from a constant. |
| `date-fns` 4.4.0 present, no timezone package | Conversion via `Intl` — no new dependency. |

## 2. Schema decision

Minimum safe change, no new models:

```prisma
enum ContentStatus { DRAFT  IN_REVIEW  APPROVED  SCHEDULED  PUBLISHED  ARCHIVED }

model Content {
  scheduledAt       DateTime?   // the intended instant, UTC
  scheduledTimezone String?     // the IANA zone the user chose
  @@index([seoProjectId, scheduledAt])
}
```

Nothing speculative was added — no campaign, platform, media, variation, approval or analytics model.

## 3. Migration

```sql
ALTER TYPE "ContentStatus" ADD VALUE 'SCHEDULED';
ALTER TABLE "Content" ADD COLUMN "scheduledAt" TIMESTAMP(3), ADD COLUMN "scheduledTimezone" TEXT;
CREATE INDEX "Content_seoProjectId_scheduledAt_idx" ON "Content"("seoProjectId", "scheduledAt");
```

Both columns are nullable, so every existing row is valid unchanged and no backfill was needed. A database backup was taken before applying.

## 4. Scheduling state model

| State | Means | Source of truth |
|---|---|---|
| **PLANNED** | A Content Calendar Assistant entry | `ContentCalendarEntry` — a different model entirely |
| **DRAFT** | Content exists, no publication intent | `status`, with both schedule fields null |
| **SCHEDULED** | An intentional publication date/time | `status = SCHEDULED` **and** both schedule fields present |
| **PUBLISHED** | Actually published | `publishedAt` — never inferred from a schedule |

Enforced invariants:

- SCHEDULED requires **both** fields; a row claiming SCHEDULED without them is reported as unscheduled and is **not placed on any calendar date**.
- Schedule fields on a non-SCHEDULED row are ignored.
- `publishedAt` is never written by scheduling, and a schedule whose moment has passed is still not a publication.
- Cancelling returns the record to DRAFT and clears **both** fields together.
- A schedule must be in the future; a past instant is refused with a message.

## 5. Timezone strategy

The user picks a **wall time** and a **zone**. Both are stored: the exact instant in UTC (`scheduledAt`) and the IANA zone chosen (`scheduledTimezone`).

The instant alone would be redisplayed in whatever zone the reader is in, silently reinterpreting the user's choice; the wall time alone would not name a real moment. Keeping both means the intended local time reads back identically for everyone.

Conversion is two-pass (offset looked up, then re-checked at the resulting instant) so a DST boundary cannot be an hour wrong — covered by tests on both sides of the UK October transition. **The calendar places a scheduled item on the day the user intended, in their chosen zone**, so a 23:00 New York schedule stays on the 20th rather than jumping to the 21st in UTC.

## 6. Calendar interaction

Clicking a date still selects it and updates `date=` in the URL (Phase 5 date-interaction work preserved) **and** now opens the creation workflow. Item clicks still open Content Detail — the date target is a sibling `<button>` behind an inert item stack, so the two never conflict. Day view has the same action as an explicit button. Agenda headings remain pure navigation to the Day view.

## 7–8. Date/time → content type workflow

Two steps, **neither of which writes anything**:

1. **Select date & time** — the clicked date (never silently today), time, timezone, with the chosen moment shown in words. Cancel / Continue.
2. **What would you like to create?** — Social media / Blog post, with the chosen moment still visible, plus Back and Cancel. A project selector appears when the context spans more than one.

Keyboard accessible (Escape closes, focus moves into the panel), responsive, and validated: a past or malformed moment is refused before step 2.

## 9. Blog entry point

Hands off to the **existing** content creation route with the schedule in the query string, shows a "Will be scheduled for …" banner, and `createContent` applies the schedule **in the same action as the create** — one explicit Save. No duplicate Content model, no duplicate detail system, no fake editor. The schedule is validated before the row is created, so an invalid one can never leave a stray record.

## 10. Social entry point

A real route carrying the chosen moment, describing the six steps the editor will have, and reporting from the database that **no social platform integration exists** — the only connection type this system has is WordPress. No platform buttons, no publish or save control, nothing that looks operational. Availability is derived by intersecting the schema's provider types with the company's live connections, so a future social provider becomes available without changing that page.

## 11. Content Detail integration

A Scheduling card shows **Not scheduled** / **Scheduled for 20 Sept 2027 at 10:00 (Europe/London)** / **Published 1 Jun 2026**, with date, time, timezone controls and Schedule / Update schedule / Cancel schedule. The Details card's Publication row reports the same resolved state. The Phase 4 layout is otherwise untouched.

## 12. Calendar integration

Scheduled content appears on its scheduled day in Month, Week, Day and Agenda, and the four states are visually distinct — Planned (dashed outline), Draft, Scheduled (amber outline), Published (solid) — each also printing its state label, so colour never carries the distinction alone.

## 13. Authorization

Every write re-derives ownership from the authenticated actor: role check, `isUuid` shape check **before any query**, company match, and both soft-delete states. The write itself is guarded by the state it was validated against, so a concurrent change refuses the schedule rather than applying it to a row that moved on. Verified by manipulation: malformed id, missing id, wrong project, trashed project, and an invalid hand-crafted schedule URL all fail safely.

## 14–18. Tests and gates

| Gate | Result |
|---|---|
| New tests | 32 scheduling core · 24 scheduling actions · 19 calendar display/social — all pass |
| Full suite | 140 files, **3815 tests** pass |
| Typecheck | exit 0 |
| Lint | 0 errors (1 pre-existing warning in untouched `ReportForm.tsx`) |
| Build | Compiled successfully |

## 19–20. Browser verification and database state

**80/80 PASS**, no console errors beyond the known shell hydration warning.

Row counts identical before and after, and every Content row's status, `publishedAt`, `scheduledAt` and `scheduledTimezone` returned to its exact starting value — the schedule/cancel round trip left the database as it was found. Cancel at any step of the creation flow, and reaching either entry point, wrote nothing.

## 21. Data limitations

- **No social account exists and none can** — the schema has no social provider type. Verified as an honest empty state, not fabricated.
- Only one company exists, so cross-company manipulation remains unexercised with real records.
- The schedule/cancel round trip used one real existing draft; no records were created for testing.

## 22. Environmental issues

The dev server was restarted after the migration so it would pick up the regenerated Prisma client — the same stale-client trap hit in earlier phases.

## 23. Not implemented (later phases)

Complete social editor, captions engine, media library, image/video generation, platform variations, social previews, social OAuth and every platform API, multi-platform publishing, approvals, campaigns, analytics, performance feedback, Data Stronghold. Also not implemented: drag-and-drop scheduling, and any automatic publication of scheduled content — a schedule is an intention, and nothing in this phase acts on it.
