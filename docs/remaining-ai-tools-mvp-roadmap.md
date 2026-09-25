# Remaining AI Tools — MVP Roadmap

Discovery only. No code, schema, or data was changed.

Date: 2026-09-05

---

## 1. Executive Summary

**All six remaining tools can be built. None is genuinely implementation-blocked.**

The earlier "data-blocked" labels described *today's sparse database*, not missing
capability. This review looked at what the platform can actually do, and found more
existing infrastructure than expected:

- **Competitor analysis already has both halves it needs.** `BrandProfile.competitorUrls`
  is an existing persisted field, and `crawlWebsite()` is a real, robots-respecting
  page fetcher already used by Website Analysis.
- **Image alt text already has its storage.** The `File` model supports `image/jpeg`,
  `image/png`, `image/webp` and `image/gif`, and links to Content.
- **Topic clustering already has its persistence.** `Keyword` and `KeywordCluster`
  exist with the right fields.

The one genuine capability gap is **vision**: the provider layer is text-only
(`StructuredOutputRequest` accepts a `prompt` string; there is no image, vision, or
base64 support anywhere in `lib/ai`). That shapes Tool E's design but does not block it.

Four of six tools need **no new Prisma model**. Two need a small addition. Every tool
needs one new `AiTaskType` enum value, which is the same pattern all nine existing
tools followed.

---

## 2. Product Direction

Build functional first, harden second. A tool is functional when it produces
trustworthy output from the data it genuinely has — including honestly reporting when
optional platform data is absent.

The rule that does not bend: **never fabricate.** No invented URLs, rankings, search
volumes, traffic, competitor metrics, or image contents. Where data is missing, the
tool says so.

---

## 3. Tool Readiness Matrix

| Tool | New Prisma model? | New enum value | Existing infrastructure it reuses | Readiness |
|---|---|---|---|---|
| **A. Internal Link Analyzer (contextual)** | No | No (already exists) | Handoff helper, existing analyzer | **READY NOW** |
| **B. Topic Cluster Planner** | No | Yes | `Keyword`, `KeywordCluster`, Brand Profile | **READY NOW** |
| **C. Competitor Content Analysis** | No (run-scoped MVP) | Yes | `crawlWebsite()`, `BrandProfile.competitorUrls`, SSRF guard | **READY NOW** |
| **D. Content Calendar Assistant** | **Yes (one small model)** | Yes | `Content`, `SEOProject` | **READY, needs persistence** |
| **E. Image Alt Text Generator** | No | Yes | `File` (images already allowed) | **READY WITH A STATED LIMIT** (no vision) |
| **F. Email Newsletter Drafter** | No (MVP) | Yes | `Content`, CGA output, Brand Profile | **READY NOW** |

---

## 4. MVP Design for Each Tool

### A. Internal Link Analyzer — contextual integration

**Purpose:** recommend links from one page to other real pages on the same site.

The analyzer itself already works correctly and already refuses to invent targets.
The only problem is that the candidate inventory (`Content.url`) is empty, so it can
only ever return nothing — and today it blames the AI for that.

**MVP:**
- Add the "Analyze Internal Links" contextual action on Content Detail using the same
  hand-off helper as the other four tools.
- Before generating, count the project's linkable pages (other Content with a valid
  URL). **If zero, show a data-readiness state and do not call the AI at all** —
  explaining that pages need URLs, which publishing now provides (Phase F.3).
- Fix the misleading empty-result message so it distinguishes "no linkable pages yet"
  from "the AI returned nothing usable".
- Bring its ownership checks in line with the other tools (it still lacks
  soft-deleted project and content guards).

**Persistence:** none. Review-only.
**Later:** once publishing produces URLs, this becomes useful with no further change.

### B. Topic Cluster Planner

**Purpose:** turn a seed topic into a pillar-and-supporting-topics plan.

**Input:** user-entered seed topic (required), optional existing keywords/cluster,
project, Brand Profile.
**Existing data used:** `Keyword` terms and `KeywordCluster` rows when present;
existing Content titles to avoid proposing duplicates.

**Output:** a pillar topic, supporting topics, each with search intent, suggested
content type, its relationship to the pillar, and a rationale.

**Must not output:** search volume, difficulty, or ranking — the platform has real
values for only 4 keywords and the AI must never estimate them.

**Persistence:** optional and deferred. MVP is generate → review → copy. A later
"save as cluster" step can write into the **existing** `KeywordCluster` + `Keyword`
models — no new model needed.

### C. Competitor Content Analysis

**Purpose:** understand what a competitor's page actually covers, and what to do about it.

This is the biggest positive surprise. Both required pieces already exist:

- `BrandProfile.competitorUrls` — a persisted list of competitor URLs the user already
  maintains, currently used only by the Content Brief.
- `crawlWebsite()` in `features/seo/services/website-crawler.service.ts` — a real
  fetcher that respects `robots.txt`, reads sitemaps, caps at 12 pages, and applies
  fetch timeouts. `extractPageContent()` is already exported and reused elsewhere.

**MVP:** user picks or enters a competitor URL (defaulting to Brand Profile's list),
optionally names a target topic. The system fetches the page with existing crawl
infrastructure and gives the AI **only the observed page text**.

**Output must separate two sections explicitly:**
- **Observed** — title, headings, structure, apparent topic and angle. Grounded strictly
  in fetched text.
- **Analysis** — gaps versus our own Content, and a recommended response. Clearly
  labelled as opinion.

**Must not output:** traffic, rankings, domain authority, backlinks, or any metric —
none is available.

**Security:** the URL is user-supplied and the server fetches it, so it **must** pass
`assertSafePublicUrl` (the existing SSRF guard) first. The crawler currently uses raw
`fetch`, so this guard must be applied at the tool boundary.

**Persistence:** none for MVP — run-scoped, stored in the job result like every other
review-only tool.

### D. Content Calendar Assistant

**Purpose:** plan what to publish, when.

This is the **only** tool where persistence is genuinely essential. A calendar you
cannot save, reopen and edit is not a calendar. Generate-and-copy would not be useful.

**MVP:** user picks a project, a date range and a cadence; optionally seeds it from
existing Content or Content Gap opportunities. The AI proposes entries; the user
reviews, edits and saves.

**Smallest honest persistence:** one model — a calendar entry with project, company,
planned date, title, optional topic/notes, status, and an optional link to a real
`Content` row. Reuse `Content` for anything already drafted rather than duplicating it.

**Must not output:** predicted traffic or performance.

**Later:** cross-project planning, capacity, and campaign grouping.

### E. Image Alt Text Generator

**Purpose:** produce accessible, SEO-appropriate alt text for a page's images.

**The honest constraint:** the provider layer is **text-only**. There is no image,
vision, or base64 support in `lib/ai`. The tool therefore **cannot look at pixels and
must never imply that it has.**

**What already exists:** the `File` model accepts `image/jpeg`, `image/png`,
`image/webp` and `image/gif`, links to `Content`, and stores a URL and filename. So
image *storage and selection* work today — there are simply no image rows yet.

**MVP (genuinely useful without pretending to see):** the user selects an image
attached to a Content record (or uploads one) and supplies a short description of what
the image shows. The AI drafts alt text from that description plus the Content's topic,
target keyword and Brand Profile — clearly framed as *"drafted from your description"*.

This is real, useful work: turning a rough human description into concise, accessible,
keyword-appropriate alt text. What it must never do is invent visual details.

**Persistence:** none for MVP — generate and copy. Storing alt text on the file record
is a later step.

**Later (Data Stronghold):** add vision support to the provider layer, then genuinely
describe images. That is a provider-architecture change and explicitly out of scope now.

### F. Email Newsletter Drafter

**Purpose:** draft a newsletter from what we have written or plan to write.

**MVP:** user supplies a topic or selects one or more Content records (published status
**optional**, not required), plus audience, CTA and campaign notes. Brand Profile
supplies voice. Content Gap opportunities can also seed it.

**Output:** subject line options, preview text, an intro, one section per selected
Content item (with its URL only when one genuinely exists), and a CTA block.

**Must not output:** a link to a page that has no URL, or any open/click statistics.

**Persistence:** none for MVP — generate, review, copy/export. No sending
infrastructure exists and none should be built now.

**Later:** a campaign model with send history.

---

## 5. Data Dependencies

| Tool | Needs platform data? | Behaviour when absent |
|---|---|---|
| A | Yes — Content URLs | Show data-readiness state; **do not call AI** |
| B | No | Works from a seed topic alone |
| C | No | Works from a user-supplied URL |
| D | No | Works from a date range |
| E | No | Works from an uploaded image + user description |
| F | No | Works from a topic alone |

Only Tool A has a hard data dependency, and it is the one Phase F.3's publishing work
is designed to satisfy.

---

## 6. User-Provided Input Strategy

Every tool is designed so the user can supply what the platform lacks:

- Competitor URL instead of a competitor database.
- Seed topic instead of a mature keyword set.
- Image description instead of vision.
- Date range instead of historical cadence data.
- Free-text topic instead of a published-content archive.

User input is treated as **user input** — never promoted to a verified platform fact,
and never persisted as though the system discovered it.

---

## 7. Persistence Requirements

| Tool | MVP persistence | New model needed |
|---|---|---|
| A | None | No |
| B | None (later: existing `KeywordCluster`/`Keyword`) | No |
| C | None (run-scoped job result) | No |
| D | **Required** | **Yes — one small calendar-entry model** |
| E | None | No |
| F | None | No |

Every tool still creates the standard `AiGenerationJob` row, and each needs **one new
`AiTaskType` enum value** — the same minimal schema step all nine existing tools took.

---

## 8. Security Requirements

All six follow the established pattern, unchanged: `requireUser`, permission check,
company ownership, project ownership, project/content match, soft-delete guards on both
Content and project, server-derived ownership (never trusting client-supplied company
ids), and ids-only contextual hand-offs.

Two tool-specific additions:

1. **Tool C must SSRF-guard the competitor URL.** It is user-supplied and fetched
   server-side. `assertSafePublicUrl` already exists and must be applied before any
   fetch.
2. **Tool D's persisted entries** need the same company/project scoping and soft-delete
   discipline as every other record.

---

## 9. AI Grounding Requirements

Each tool must separate **trusted platform data**, **user input**, and **AI analysis**,
and apply a deterministic post-generation filter — the "loose schema in, strict filter
out, reject never repair" doctrine already used across the workspace.

| Tool | Deterministic filter |
|---|---|
| A | Target URL must match the real inventory exactly (already implemented) |
| B | Drop any output containing invented volume/difficulty/rank figures |
| C | Observed claims must be traceable to fetched text; drop unsupported metrics |
| D | Dates must fall inside the requested range; drop entries outside it |
| E | Reject output implying visual inspection beyond the user's description |
| F | Drop any link to Content that has no real URL |

---

## 10. Recommended Implementation Order

Ordered by readiness, reuse and value — not by the original placeholder order.

1. **Topic Cluster Planner (B)** — no new model, no new infrastructure, pure text in/out.
   The cleanest possible reuse of the existing pattern, and immediately useful with our
   sparse keyword data.
2. **Competitor Content Analysis (C)** — high user value, and both required pieces
   already exist. Slightly more work only because of the SSRF boundary.
3. **Email Newsletter Drafter (F)** — no new model; composes existing Content and CGA
   output. Straightforward once B and C establish the pattern rhythm.
4. **Image Alt Text Generator (E)** — no new model, but needs careful UX so it never
   implies it looked at the image. Deliberately after the simpler three.
5. **Internal Link Analyzer contextual (A)** — small work, but its usefulness depends on
   real published URLs existing. Best done once publishing has actually run, so the
   data-readiness state can be verified against both conditions.
6. **Content Calendar Assistant (D)** — last, because it is the only one requiring a new
   Prisma model and a migration.

---

## 11. Data Stronghold Backlog (deferred)

- Vision support in the provider layer → real image understanding for Tool E.
- Persistent competitor intelligence (history, change tracking) for Tool C.
- Search Console / analytics integration → real rankings, traffic, performance.
- A unified media inventory built on `File`.
- Campaign model with send history for Tool F.
- Cross-project planning intelligence for Tool D.
- Keyword enrichment (real volume/difficulty) for Tool B.
- Publishing verification at scale, plus URL drift detection.

---

## 12. Future Cross-Tool Workflow

```
Website Analysis / Competitor Analysis  →  opportunity
        ↓
Content Gap Analysis  →  Topic Cluster Planner  →  Content Calendar
        ↓
Content Brief  →  Content  →  Long-Form Draft
        ↓
Meta · Rewrite · Schema · Social · Internal Links · Alt Text
        ↓
Publish  →  verified URL
        ↓
Newsletter  ·  Internal link inventory  ·  (later) performance feedback
```

The Content record stays the centre. Every new tool either feeds it (B, C, D) or
composes from it (A, E, F).

---

## 13. Validation

Discovery only. Source code unchanged, Prisma unchanged, no migrations, no database
writes, no dependencies added. Full test suite: **108 files / 2848 passing**.
