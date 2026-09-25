# Content Calendar Assistant — Progress

**Status:** Working — built, tested, and verified in the browser with real generations
**Date:** 2026-09-08
**Position:** the fourteenth AI Workspace tool, and the last one that was marked "coming soon"

---

## 1. Discovery

Before writing any code, the existing data model and tools were inspected to find the smallest safe design.

**What already existed and was reused:**

| Need | Reused |
|---|---|
| Background generation | The existing AI job system and its dispatcher |
| Generate → poll → stream in the browser | The shared AI generation lifecycle |
| Talking to the AI provider | The existing provider layer — no new client, no provider change |
| Comparing two topics for overlap | `topicsSubstantiallyOverlap`, already written for the Topic Cluster Planner |
| Matching topics to real keywords | `matchProjectKeywords`, from the same place |
| Cleaning up AI output | The existing sanitisers and the shared grounding rules |
| Hand-off into a Content Brief | The existing brief hand-off used by three other tools |
| Date fields in forms | The existing date input used elsewhere in the app |
| Recording what happened | The existing activity log |

**What did not exist:** anything that could represent a calendar. `Content` has only a "published at"
date, and there was no schedule, plan or calendar model anywhere. So this feature genuinely needed
new storage — the first of the recent tools that did.

---

## 2. Design

The most important decision: **the AI never chooses a date.**

The user picks a date range and how often they want to publish. The application works out the real
publishing dates from those two things. The AI is asked only for *what to write and in what order* —
item one takes the first date, item two the second, and so on.

This means a wrong or impossible date cannot reach the database, because no date the AI produces is
ever used. It also makes the plan predictable: the same range and rhythm always give the same dates.

Everything else follows from that:

- The AI is also never asked for an id of any kind. When it suggests a keyword it must name it using
  the exact keyword text it was given, and the application looks that text up to find the real
  keyword record.
- The proposal is shown for review and editing. Nothing is stored until the user presses Save.
- Overlapping ideas are flagged for the user to judge, never quietly deleted.

---

## 3. Data model

Two new tables, and no changes to any existing table.

**Content calendar** — belongs to one SEO project, and has a name, a start date, an end date and
optional notes. It has no company column of its own: ownership comes through the project, which is
how `Content` and `Keyword` already work, so there is only one place company ownership is decided.

**Calendar entry** — belongs to one calendar, and has a scheduled date, a topic, a content type, a
role (pillar, supporting or related), a status, optional notes, and optional links to a real page, a
real keyword and a real cluster.

Three small lists of allowed values were added for the content type, the role and the status.

**Deliberately not stored:** the AI's reasoning. It is useful while reviewing the proposal and has no
purpose afterwards, so it is shown on screen and then discarded.

Both tables are soft-deleted, matching every other record in the application.

---

## 4. Workflow

```
Choose SEO project
   ↓
Name the calendar
   ↓
Choose start and end dates
   ↓
Choose how often to publish
   ↓
Choose where topics come from — project keywords and pages, a topic cluster, or topics you type
   ↓
Generate schedule
   ↓
Review: edit any date, topic, type or role; remove anything; copy the plan
   ↓
Save calendar
   ↓
Open it later: change an entry's status, or start a Content Brief from it
```

The user stays in control throughout. Every proposed entry is editable, and the Save button stays
disabled while any entry is invalid.

---

## 5. The AI's role

The AI **organises and recommends**. It proposes topics, an order, a content type, a role and a short
note for whoever writes the piece.

The AI is **not** the source of truth for anything that matters:

| Decided by | What |
|---|---|
| The application | every date, from the user's range and rhythm |
| The application | which project and company the calendar belongs to |
| The application | which keyword record a topic links to |
| The application | which pages already exist |
| The application | every status |
| The application | whether two ideas overlap |
| The AI | what to write about, and in what order |

---

## 6. Grounding

Real project data, the user's own input and AI recommendations are kept clearly separate in the
prompt, each under its own heading, with a note on how much each is worth.

The prompt forbids inventing anything, and forbids stating a search volume, difficulty, ranking,
traffic figure, click count, impression count, conversion rate or competitor claim — none of which
the platform has any data for. It also forbids promising that publishing something will improve
rankings or traffic.

Those are instructions, so the application also checks the output itself:

- A topic that states a made-up figure is dropped.
- A note that states a made-up figure is cleared, keeping the entry.
- A keyword the project does not really have is simply not linked.
- Any id the AI tries to supply is ignored entirely.
- An exact duplicate topic is dropped rather than scheduled twice.

The review screen carries a plain statement that the schedule is a recommendation, that Compass has
no ranking, traffic or search-volume data, and that publishing on a date guarantees nothing.

---

## 7. Preventing competing pages

Every entry is checked against the others and against the project's existing page titles.

- Two planned topics that look substantially the same are both flagged.
- Two entries aiming at the same keyword are both flagged — the case plain wording can hide.
- A topic that looks like an existing page's title is flagged, described honestly as a title match
  rather than a full comparison.

Nothing is deleted on the basis of these checks. They appear as warnings for the user to act on, and
pillar, supporting and related entries are visually distinct so the intended hierarchy is obvious.

---

## 8. Security

The established chain is followed, and every authority decision is made on the server:

authenticated user → permission → owned project → project not deleted → project-scoped data →
validated AI output → validated calendar → database write.

- The company is always taken from the signed-in user, never from the browser.
- A project belonging to another company, or a deleted project, is refused.
- Every keyword, page and cluster link is re-checked against the selected project **before** the
  write. A link the project does not own is refused outright rather than quietly dropped — silently
  discarding something the user can see on screen would be worse than telling them.
- Reading a saved calendar joins through the project to the user's company, so another company's
  calendar simply does not exist as far as the page is concerned.
- The whole save happens in one transaction, so a half-saved plan cannot exist.
- Changing an entry's status requires the entry to belong to the named calendar; an entry id on its
  own is never enough.

---

## 9. Topic cluster integration

The completed Topic Cluster Planner is reused; no second clustering system was built. When the user
chooses a cluster, its real name and its real keywords are passed to the generator as context, and
the cluster is verified as belonging to the selected project first.

Only page-level topics become calendar entries. Sub-topics stay as supporting context.

---

## 10. Content integration

A saved entry offers **Create Content Brief**, using the same hand-off three other tools already use.
No second content-creation path was built.

The hand-off passes only the project id and prefilled text. Opening it creates nothing — verified in
the browser by checking the page count before and after. The brief's own notes explain what the entry
is, when it is scheduled and what role it plays, so a supporting page is not written as though it
were the pillar.

Where an entry is linked to a real page, that page is shown and linked.

---

## 11. Status handling

Six statuses: planned, brief created, draft, in progress, published, completed.

An entry starts as **planned** and only ever changes because someone chooses a new status. A date
passing does nothing. Marking an entry published records where the *plan* has got to — it does not
touch the page itself, which was verified.

---

## 12. Tests

Covering: project ownership, another company's project, a deleted project, date validation, invalid
ranges, impossible dates, duplicate topics, duplicate entries, keyword ownership, page ownership,
cluster ownership, AI output validation, fabricated ids, fabricated dates, invented keywords,
overlap warnings, calendar creation, editing, deletion, cross-project data, permissions, empty
states, copy output, and the malformed-id fix described below.

The whole suite passes, including every earlier tool's tests.

---

## 13. Browser verification

Verified against the real application and database, with two genuine AI generations.

**Everything checked passed**, including: the page opening; the project starting unselected; a
reversed date range being refused with a clear message and blocking Generate; a valid range being
accepted; topic selection; Generate only becoming available when the inputs make sense; the schedule
rendering; entries being editable; an out-of-range edit being refused and blocking Save; Save being
re-enabled once fixed; copy; saving; reopening the saved calendar; the brief hand-off creating
nothing; status changes persisting without touching any page; the saved calendar appearing in the
list; soft delete with a confirmation step; another project's clusters not being offered; no
horizontal overflow on a narrow screen; and no console or page errors.

**A real generation, checked in detail.** Nine entries across a two-month range at once a week:

- Every date was a real date, inside the chosen range, in ascending order.
- No duplicate topics.
- No made-up figures anywhere.
- Every attached keyword was a genuine project keyword, with a genuine id.
- The overlap warnings fired correctly on four entries that were genuinely close to one another or
  to an existing page — and none of them was deleted.

**One real bug was found and fixed.** A calendar address containing something that is not a proper
id (`/ai/content-calendar/not-a-uuid`) reached the database and produced "Something went wrong"
instead of a clean "page not found". The same weakness affected the status-change and delete actions,
which also accept an id from the browser. It was fixed in the one shared place all three go through,
and now every malformed address shows a normal "Page not found" with no errors. A test was added so
it cannot come back.

**Two apparent failures turned out to be faults in the test script, not the application:** one check
looked for entry topics in the page text when they are shown inside editable fields (whose values
page text does not include), and one waited seven seconds for a page that was being compiled for the
first time in development. Both were re-checked and pass.

---

## 14. Database impact

- Pages, keywords and page revisions were all **unchanged** by every part of this work.
- Two new tables were added. No existing table was altered.
- One calendar with nine entries was created during verification and then soft-deleted as part of
  testing the delete step, so it remains in the table marked as deleted. Nothing else was left
  behind, and no cleanup is required.

---

## 15. Limitations

1. **Editing a saved calendar is limited to statuses.** Changing a saved entry's date or topic means
   deleting the calendar and generating again. Fuller editing is a sensible next step.
2. **A plan holds at most forty entries**, and at most just over a year.
3. **The schedule spaces entries evenly.** It does not know about holidays, campaigns or team
   capacity.
4. **Overlap detection compares wording**, so it catches similar titles and shared keywords but not
   two differently-worded pieces that would compete in practice.
5. **No metrics of any kind.** The platform has no ranking, traffic or search-volume data, so the
   calendar shows none and cannot prioritise by opportunity size.
6. **A calendar entry does not automatically link to the page** later written from it — the link
   exists in the model, but connecting them is still a manual step.

---

## 16. Future improvements

Recorded as ideas only; none should be built without approval.

1. Full editing of a saved calendar — move, add and remove entries after saving.
2. Automatically linking an entry to the page created from its brief, so the plan tracks itself.
3. A month-grid view alongside the current list.
4. Team capacity and holidays as inputs, so the spacing reflects reality.
5. Real search metrics, once available, so a plan can be ordered by opportunity rather than by
   sequence.
6. Recurring plans — rolling a finished quarter forward into the next.

---

## 17. Status

| Item | State |
|---|---|
| New tables | Content calendar, calendar entry |
| Existing tables changed | None |
| Migration | Created and applied |
| Typecheck | Pass |
| Lint | No errors (one pre-existing warning elsewhere, untouched) |
| Build | Successful, both new pages included |
| Tests | All passing |
| Fresh generation | Verified twice with real output |
| Topic Cluster Planner | Preserved |
| Competitor Content Analysis | Preserved |
| Email Newsletter Drafter | Preserved |
| Image Alt Text Generator | Preserved |
| Commit | **Not authorized** |
| Push | **Not authorized** |
