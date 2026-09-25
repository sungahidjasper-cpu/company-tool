# Content Workspace — Phase 4

**Status:** FINAL PASS — Content item detail and Content Operations entry point, verified in the browser (first pass 52/52; final focused pass 126/126 functional + 35/36 responsive, the one item attributed to a pre-existing shared component)
**Route:** `/seo/[id]/content/[contentId]` — the EXISTING Content detail page, enhanced
**No new detail system. No Prisma schema change. No migration. No `scheduledAt`.**

---

## 1. Discovery: what already existed

The existing Content detail page ([app/(dashboard)/seo/[id]/content/[contentId]/page.tsx](../app/(dashboard)/seo/[id]/content/[contentId]/page.tsx)) already carried nine sections — Details, Target keywords, Article, AI actions, Saved brief, Version History, Publishing, Notes, Activity timeline, Files — behind a complete authorization chain (`requireUser` → `getContentById` → project-match check → `notFound()` → `assertCompanyAccess`), with role gating through `Permissions.manageSeoProjects` and publish gating through `isContentStatusPublishable`.

Conclusion: **enhance this page.** A second Content detail system would have duplicated the auth chain, the revision integration and the publishing panel for no gain.

Reused as-is, not rebuilt:

| Existing thing | Reused for |
|---|---|
| `ContentVersionHistory` + `getContentRevisions` | All version/revision display. No second revision system was introduced. |
| `deriveContentWorkflowStage` / `readSavedBriefSummary` | The record's stage, derived from its own columns. No workflow table. |
| `canOfferContentOptimizerActions` / `canOfferContentRewrite` | Every eligibility decision. Rules were reused, never restated. |
| `PublishContentPanel` + `getContentPublicationState` | Publishing. Untouched. |
| `buildWorkspaceHref` (Phase 2) | The return leg to `/content`. |
| The five existing hand-off href builders | Meta Tags, Rewriter, Schema, Social Snippets, Newsletter. |

## 2. Which tools were connected, and which were not

An operation was exposed only where all four gates held: the tool's existing implementation accepts this input, authorization is already enforceable, the record belongs to the actor's company/project, and the hand-off needs no unsafe assumption.

| Tool | Connected | Why |
|---|---|---|
| Meta Tag Optimizer | Yes | Existing hand-off builder. |
| Content Rewriter | Yes | Existing hand-off builder; needs a body. |
| Schema Markup Generator | Yes | Existing hand-off builder; review-only. |
| Social Snippet Generator | Yes | Existing hand-off builder; review-only. |
| Email Newsletter Drafter | Yes | Existing hand-off builder; draft-only. |
| Long-Form Content | Yes | Existing `/ai/content-brief/[id]/long-form` route; brief-only records. |
| **Internal Link Analyzer** | **Yes — newly wired** | Its input schema is *exactly* `{seoProjectId, contentId}` (`internal-link-analyzer.schema.ts`), the pair this page already holds. Wiring used the identical `searchParams → resolveContentOptimizerSelection → initial props` pattern the other five routes already use. Nothing was invented for it. |
| **Image Alt Text Generator** | **No** | Keyed on a project **image (File)**, not on Content. Content is not one of its inputs, so no safe hand-off exists — and none was invented. |
| Everything else (Competitor Analysis, Content Gap, Press Release, Topic Cluster, Content Calendar, Content Brief) | No | None of them takes a single existing Content record as its subject. |

## 3. What was implemented

**Identity — what this Content is.** A breadcrumb above the title (`← Content workspace / client / SEO project`) and three new Details rows: **Client**, **SEO project**, **Stage**. The client was previously absent from this page entirely; a record could only be traced to its client by opening its SEO project.

**Content Operations panel.** The former flat row of six buttons is now three labelled sections with descriptions:

- *Improve this page* — Optimize meta tags, Rewrite content, Analyze internal links, Generate long-form article
- *Repurpose this page* — Generate social snippets, Draft newsletter
- *Technical markup* — Generate schema markup

Every operation resolves to **either** a link **or** a stated reason. There is no disabled control anywhere in the panel — a refused operation renders as text with its reason, because a disabled button invites clicking and explains nothing.

**Named gaps.** A control-free *Not available yet* list: scheduling a publish date, publishing to social platforms, per-platform variants, performance/analytics feedback — each with the honest reason (e.g. "No social platform integration is configured. The only publishing connection this system supports is WordPress.").

**Return leg.** The calendar has always deep-linked into this page; there was no way back. The breadcrumb link carries the record's own client and project into `/content`, which re-resolves the selection against the actor's own scope.

## 4. Files changed

| File | Change |
|---|---|
| `features/content-workspace/services/content-operations.ts` | **New.** Pure: resolves every operation to an href or a reason; `describeOperationsUnavailable`, `UNAVAILABLE_OPERATIONS`, `describeContentIdentity`. |
| `features/content-workspace/services/content-operations.test.ts` | **New.** 27 tests. |
| `features/content-workspace/components/ContentOperationsPanel.tsx` | **New.** Server component; renders the resolved list. Holds no eligibility rules. |
| `features/ai-workspace/services/content-optimizer-handoff.ts` | Added `buildInternalLinkAnalyzerHref` and `canOfferInternalLinkAnalysis`; routed the Rewriter's body test through a shared private helper. |
| `features/ai-workspace/services/content-optimizer-handoff.test.ts` | +8 tests for the above. |
| `app/(dashboard)/ai/internal-link-analyzer/new/page.tsx` | Accepts the optional hand-off params. |
| `features/ai-workspace/components/InternalLinkAnalyzerPicker.tsx` | Accepts `initialSeoProjectId` / `initialContentId`. |
| `features/seo/services/content.service.ts` | `getContentById` now selects `seoProject.clientId` + `client {id, name}`. Additive. |
| `app/(dashboard)/seo/[id]/content/[contentId]/page.tsx` | Breadcrumb, client/project/stage rows, honest no-content-type note, operations panel, malformed-id guard. |

## 5. Security

- **Hand-off params carry no authority.** Every href carries `seoProjectId` and `contentId` and nothing else — verified in the browser against all six live hrefs. Each target route resolves them against its own company-scoped, non-soft-deleted query, and every server action re-derives ownership and re-checks both soft-delete states before generating or writing.
- **Nothing was weakened.** The detail route's auth chain is unchanged; the only addition is a *stricter* guard (below).
- **Verified by manipulation:** a content id under the wrong project id, a well-formed but non-existent id, a malformed id, and a content id belonging to a different project all render the not-found page and leak no part of the record. A cross-project content id supplied to the analyzer route is not preselected, and neither is a trashed project.
- **Soft-deleted projects stay excluded.** A live Content row under a trashed project (two such rows exist in this database) shows the record but offers zero operations, with the project's trash state named.

## 6. Defect found and fixed during verification

A **malformed (non-UUID) content id** reached `prisma.content.findUnique`, where Postgres rejected the value and Prisma threw `PrismaClientKnownRequestError` — so `/content/not-a-uuid` produced an error page instead of a clean not-found. Nothing leaked (the error boundary caught it), but this is the same defect class already fixed in `seo-project.service.ts` and `content-calendar.repository.ts`. Fixed with the existing `isUuid` guard from `lib/utils.ts`, ordered after `requireUser()` so an unauthenticated visitor is still sent to the login page.

**The same defect exists on `/clients/[id]`**, which Phase 4 did not touch and did not fix — reported here rather than silently expanded into.

## 7. Pre-existing behaviour observed, not changed

- This app's `(dashboard)` routes answer `notFound()` with **HTTP 200** and the not-found UI. Verified identical on untouched routes (`/seo/{missing}`, `/clients/{missing}`); only a genuinely unmatched path answers 404. No data is exposed. Out of Phase 4's scope.
- The shared-shell hydration warning and tablet overflow from Phases 1–3 remain, and were deliberately not touched.

## 8. Database impact

**Zero writes.** Row counts for content, revisions, activities, jobs, notes and projects were identical before and after the full verification run. No schema change, no migration, no new model, no `scheduledAt`, no fabricated Content.

## 9. Quality gates

| Gate | Result |
|---|---|
| New focused tests | 27 (content-operations) + 8 (hand-off) — all pass |
| SEO / content-workspace / publishing suites | 920 pass |
| Full test suite | 136 files, 3706 tests — all pass |
| Typecheck (`tsc --noEmit`) | exit 0 |
| Lint (`eslint`) | 0 errors (1 pre-existing warning in the untouched `features/reports/components/ReportForm.tsx`) |
| Production build | Compiled successfully |
| Browser verification | **52/52 PASS, 0 console errors** |

## 10. Limitations

- **Only one company exists in this database**, so cross-*company* id manipulation could not be exercised against real data. Cross-project, missing-id, malformed-id and trashed-project manipulation were all exercised and pass. This is a test-data limitation, not a verified behaviour.
- Content still has **no content type** and **no scheduled date**. The page states both facts rather than inferring either.
- Long-form remains available only for a record saved from an AI content brief, because that is the only record with a brief to expand.

## 11. Explicitly out of scope (Phase 5+)

`scheduledAt`, timezone persistence, a `SCHEDULED` status, drag-and-drop scheduling, a campaign model, a platform-variation model, social OAuth, all social publishing, media library redesign, image/video generation, approval-system expansion, platform previews, analytics, performance feedback, Data Stronghold. None was implemented, and none is represented as working.

---

## 12. Final focused visual verification (second pass)

Driven end-to-end through the UI: `/content` → select client/project → click the real Content item →
workspace panel → **Open content** → Content Detail. 126-check functional harness plus a 36-check
responsive harness.

**Result: 126/126 functional PASS, 35/36 responsive PASS** (the one item is attributed below), zero
console errors beyond the known shell noise, zero database writes.

### Defect found and fixed in this pass

Returning to the workspace from a record whose SEO project has **no client** restored the client
filter to *All clients* instead of *No client assigned* — silently widening the view the user came
from. Fixed with a new pure `workspaceSelectionForContent` (+3 tests). The breadcrumb now returns to
`/content?client=unassigned&project=…`, verified in the browser.

### Responsive findings, attributed

Every Phase 4 block — breadcrumb, Details, Article, Content operations, Not available yet, Version
History — fits inside the page container at **390 / 768 / 1024 / 1440**, with no internal sideways
scroll, no overlap, and a usable on-screen breadcrumb at all four widths.

Two elements overflow at 390px, both **pre-existing shared components**, neither Phase 4 markup:

| Element | Evidence it is pre-existing |
|---|---|
| Shared `DashboardHeader` actions row (Advance to In Review / Edit / Archive) — does not wrap | Same overflow on untouched `/seo/[id]` (right edge 432 vs 390 container, from its own Edit/Archive row); absent on `/clients/[id]`, which has no header actions |
| Shared `FileUploadForm` native `input[type=file]` — 341px wide | Byte-identical on untouched `/seo/[id]` and `/clients/[id]` (same 341px width, same right edge) |

Phase 4 added no header actions and no file input. Fixing either means changing a shared dashboard
component used by every page, which this phase deliberately did not do.

### Revisions

Six existing revisions load, the canonical version is marked **Current**, AI revisions are labelled
*AI Regeneration*, and **Restore remains available but was never clicked** — a `confirm()` dismisser
was installed so no accidental write was possible. Reviewing a revision (View) is client-side only:
the canonical title and body were byte-identical afterwards, and no new revision was created.

### Test-data limitations

- Only **one company** exists, so cross-company id manipulation cannot be exercised with real
  records. Cross-project, wrong-project, missing-id, malformed-id and trashed-project manipulation
  were all exercised and pass.
- The chosen record's project has **no client assigned**, which is why the breadcrumb shows
  *No client assigned*; the client-bearing case was verified separately on the Acme record.
