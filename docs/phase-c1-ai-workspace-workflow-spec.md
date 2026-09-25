# Phase C1 — AI Workspace Workflow Integration: Discovery & Specification (2026-09-04)

Discovery and specification only. No application source, schema, prompt, provider or test was modified while producing this document. Baseline is `9a9077b` (`feat(ai-workspace): complete AI workspace stabilization`).

## 1. Executive summary

The nine AI Workspace tools are today nine independent entry points that share a job runner, a lifecycle hook, and an ownership pattern — but never hand off to one another. The one exception is already instructive: the Content detail page renders a **"Generate Long-Form Content"** button when a row has a saved brief but no article, linking to `/ai/content-brief/[contentId]/long-form`. That single, already-shipped link is the seed of the workflow model this document recommends generalising.

**Recommended first workflow: Content Gap Analysis → SEO Content Brief → Long-Form Draft.** Discovery confirms the existing implementation supports it with **no new database model, no migration, and no change to any AI tool's behaviour** — provided the chain always routes through the *update* lane once a Content row exists. Two small compatibility gaps must be closed in C2 (a topic carrier and a content-type mapping); both are non-structural.

The critical constraint uncovered is the **duplicate-Content hazard**: two different actions create Content rows, and today they are kept apart only by a navigation side effect, not by a guard.

## 2. Existing tool map

Verified by reading schemas, actions, services, dispatchers and route pages — not inferred.

| Tool | Route | Creates Content | Updates Content | Revision | Activity | Review-only |
|---|---|---|---|---|---|---|
| SEO Content Brief | `/ai/content-brief/new` | **yes** (`saveContentBriefAction`) | no | no | `content.ai_brief_saved` | no |
| Long-Form Draft | `/ai/content-brief/[contentId]/long-form` + in-page fresh flow | **yes** (`saveLongFormAsNewContentAction`) | **yes** (`updateLongFormContentAction`) | **yes** (update path) | `content.ai_long_form_saved` | no |
| Schema Markup | `/ai/schema-markup/new` | no | no | no | none | **yes** |
| Internal Link Analyzer | `/ai/internal-link-analyzer/new` | no | no | no | none | **yes** |
| Social Snippet | `/ai/social-snippet-generator/new` | no | no | no | none | **yes** |
| Meta Tag Optimizer | `/ai/meta-tag-optimizer/new` | no | **yes** (`applyMetaTagSuggestionAction`) | **yes** | `content.ai_meta_tags_applied` | generate only |
| Content Rewriter | `/ai/content-rewriter/new` | no | **yes** (`applyContentRewriteAction`) | **yes** | `content.ai_rewrite_applied` | generate only |
| Press Release | `/ai/press-release-generator/new` | no | no | no | none | **yes** |
| Content Gap Analysis | `/ai/content-gap-analysis/new` | no | no | no | none | **yes** |

**Content writers — the complete set.** Creates: `saveContentBriefAction`, `saveLongFormAsNewContentAction`. Updates: `updateLongFormContentAction` (title, metaTitle, metaDescription, generatedByAi, body), `applyMetaTagSuggestionAction` (metaTitle, metaDescription), `applyContentRewriteAction` (title, metaTitle, metaDescription, body). All three updates run inside `$transaction` with `SELECT … FOR UPDATE`, re-read the row, and snapshot to `ContentRevision` (`changeSource: "AI_REGENERATION"`) before writing. The other six tools write only their `AiGenerationJob` row.

**Project selection** is now explicit in all eight selector-based tools (B5.1); Long-Form's existing-brief route derives the project from the Content row instead.

## 3. First workflow — recommended

```
Content Gap Analysis  (review-only, project-scoped)
        │  user picks one opportunity          ← APPROVAL 1
        ▼
SEO Content Brief     (prefilled from the opportunity)
        │  user reviews the brief, clicks Save ← APPROVAL 2
        ▼
   ONE Content row     (status DRAFT, generatedByAi, aiBriefDetails)
        │  user clicks Generate Long-Form      ← APPROVAL 3
        ▼
Long-Form Draft       (update lane, same row)
        │  user reviews, clicks Save as Draft  ← APPROVAL 4
        ▼
   SAME Content row    + ContentRevision #1
```

**Why this sequence rather than the full nine-tool chain:** it is the only span where every step already exists, every ownership boundary is already server-enforced, and the end state is a single Content record that the remaining tools (Meta Tag, Schema, Internal Links, Social) already accept as *their* input. Those later tools are all `contentId`-based, so once one Content row exists they become independently reachable — they do not need to be chained to be usable, and chaining them would add sequencing complexity for no capability gain. Press Release and Content Rewriter are deliberately outside this chain: Press Release takes user-supplied facts and grounds in nothing upstream, and Content Rewriter operates on already-published content.

## 4. Input/output contracts

**Content Gap Analysis output**, per opportunity: `topic`, `opportunity`, `reason`, `relatedCluster`, `existingCoverageStatus` (`NOT_FOUND` | `POSSIBLE_MATCH`), `matchedExistingTitle`, `suggestedContentType` (nullable), `recommendedNextAction` (nullable).

**SEO Content Brief input**: `seoProjectId` (req), `keywordId` (opt), `contentType` (req enum), `notes` (opt), `settings` (opt).

| Question | Answer |
|---|---|
| A. Source produces | topic, opportunity, reason, relatedCluster, suggestedContentType |
| B. Destination requires | seoProjectId, contentType; optionally keywordId, notes |
| C. Compatible? | Partially — see the two gaps below |
| D. Pass directly | `topic` + `opportunity` + `reason` → composed into `notes` (free text, user-editable) |
| E. Re-derive server-side | `seoProjectId` (already re-fetched by every dispatcher), company, actor |
| F. Never trust from client | `companyId`, company/project **names**, `domain`, actor identity — all re-derived today and must remain so |

**Gap 4a — no topic field.** `contentBriefInputSchema` has no `topic`; the only free-text carrier is `notes`. The opportunity must ride in as prefilled `notes`. This needs **no schema change** and keeps the text visible and editable before generation — which is desirable, since the opportunity is AI-generated, not verified fact.

**Gap 4b — content-type enums differ.** CGA emits `ARTICLE | FAQ_PAGE | LANDING_PAGE | CASE_STUDY`; Brief accepts `BLOG_POST | LANDING_PAGE | PILLAR_PAGE | OTHER`. Only `LANDING_PAGE` matches exactly. A deterministic mapping is required, and it must be a *prefill*, not a lock — the user can override:

| CGA | → Brief |
|---|---|
| `ARTICLE` | `BLOG_POST` |
| `LANDING_PAGE` | `LANDING_PAGE` |
| `FAQ_PAGE` | `OTHER` |
| `CASE_STUDY` | `OTHER` |
| `null` (no AI suggestion) | no prefill — user chooses |

**Brief → Long-Form** needs no mapping: the existing route reconstructs the brief server-side from `Content.aiBriefDetails` via `buildBriefFromContentRow`, and re-reads settings from `aiBriefDetails.briefSettings`. The client passes only `contentId`.

## 5. Persistence model

**Recommendation: Option B for the first hop, Option C thereafter. No new model.**

- **CGA → Brief: pass forward transiently (Option B).** CGA opportunities have **no stable identity** — they are regenerated on every run and carry no id. Persisting them would require a new model *and* an identity scheme, for a value that is a paragraph of editable text. Carry the opportunity in the navigation (query params) into a prefilled Brief form.
- **Brief → Content: convert to the existing Content record (Option C).** `saveContentBriefAction` already does exactly this.
- **Long-Form: update that same record.** Already implemented.

**Existing models are sufficient.** `Content`, `ContentRevision`, `AiGenerationJob` and `aiBriefDetails` cover the first workflow. If provenance ("this draft came from gap opportunity X") is wanted later, `Content.aiBriefDetails` is already a JSON column the Brief save path writes — a `sourceOpportunity` key could be added there **without a migration**. Recorded as a future option, not a C2 requirement.

**No workflow/session model is recommended.** Nothing in the first workflow needs cross-request state that `Content` does not already hold.

## 6. Content lifecycle & the duplicate-Content hazard

**This is the most important finding of C1.**

Two actions create Content rows, and both are reachable from `ContentBriefPicker`:
- `saveContentBriefAction` (line ~337) — creates a row from the brief.
- `saveLongFormAsNewContentAction` (line ~393) — creates a row from brief + article.

Today they do not collide, but **only because `handleSave` calls `router.push` to the Content page immediately after saving the brief**, ending the session. That is a navigation side effect, not a guard. A browser Back into a picker that still holds `brief` in state could produce a second row for the same work.

**Required lifecycle for the workflow — one row, updated in place:**

```
opportunity (transient)
      ↓
Brief saved       → CREATE Content #1        (no revision — nothing to snapshot)
      ↓
Long-Form         → UPDATE Content #1        (+ ContentRevision #1)
      ↓
Meta / Rewriter   → UPDATE Content #1        (+ further revisions)
```

**Rule for C2:** once a Content row exists, the workflow must always route Long-Form through `/ai/content-brief/[contentId]/long-form` (the `updateLongFormContentAction` lane) and must never surface `saveLongFormAsNewContentAction` as a workflow step. The fresh in-picker flow stays as-is for the standalone, unsaved path.

## 7. Human approval boundaries

No step may auto-advance. Every AI operation is user-initiated; every write is user-confirmed.

| # | Boundary | User action | What happens without it |
|---|---|---|---|
| 1 | After CGA results | picks one opportunity, clicks *Create brief from this* | nothing — CGA writes nothing |
| 2 | After brief generated | reviews, edits, clicks *Save as Draft* | no Content row is created |
| 3 | On the Content record | clicks *Generate Long-Form Content* | no article is generated |
| 4 | After draft generated | reviews, clicks *Save as Draft* | no update, no revision |

There is deliberately **no** "generate everything" action. The prefilled Brief form at boundary 1 is a *form*, not a submission: the user still sees and can edit the AI-suggested topic and content type before any generation happens. This matters because the opportunity is an AI suggestion, not verified fact.

## 8. Revision & activity behaviour

**Revisions** (unchanged, `content-revision.service.ts` untouched):
- Brief save → **no revision** (correct: a new row has no prior state to snapshot).
- Long-Form update → revision **only if** title/metaTitle/metaDescription/body actually changed.
- Meta apply → revision unless it is a no-op.
- Rewriter apply → revision before every write.
- Restore → snapshots current state first, so restore is itself undoable.

The workflow consumes this model as-is and introduces no new revision semantics.

**Activity**: only four of nine tools log anything — `content.ai_brief_saved`, `content.ai_long_form_saved`, `content.ai_meta_tags_applied`, `content.ai_rewrite_applied`. `action` is a free-form string, not an enum, so no schema work is needed to add more later. For the first workflow the existing two entries already produce a coherent timeline ("Brief saved" → "Long-form draft saved"). **No new activity types are needed for C2.** The deferred `saveContentBriefAction` logging-resilience gap is noted, not fixed here.

## 9. Ownership & security

Every transition follows the B1 standard — the client supplies ids and its own typed text, nothing else:

```
requireUser()  →  Permissions.manageSeoProjects
      ↓
getOwnedSeoProject(seoProjectId, actor.companyId)      // project.companyId === actor.companyId
      ↓
getOwnedContent(contentId, actor.companyId, projectId) // company AND project, rejects deletedAt
      ↓
runner re-fetches every row by id and re-asserts the relationships
```

**Never trusted from the client:** `companyId`, company or project *names*, `domain`, actor identity, or any Content field value. The prefilled Brief `notes`/`contentType` are user-editable form values validated by `contentBriefInputSchema` — they influence the prompt only, never authorization.

The Long-Form route already demonstrates the pattern to copy: it loads the Content row, calls `assertCompanyAccess`, and `notFound()`s unless the row genuinely has a saved brief.

## 10. UX recommendation

**Recommended: Option A + C — contextual next-action buttons anchored on the record — and explicitly *not* Option B (a workflow panel).**

The rationale is that Option C already exists and is already in the premium visual language: `app/(dashboard)/seo/[id]/content/[contentId]/page.tsx` renders a `Sparkles` outline button, *"Generate Long-Form Content"*, precisely when the row has a brief and no body. C2 should generalise that one button rather than introduce a stepper/checklist, which would be a new visual system competing with the existing Card/DashboardHeader/EmptyState vocabulary, and would imply a rigid linear process that the tools do not actually require.

Concretely, two additions:
1. **On each Content Gap Analysis opportunity card** — a *Create content brief* action carrying the opportunity into a prefilled Brief form.
2. **On the Content detail page** — extend the existing next-action area so that, once an article exists, the already-available `contentId`-based tools (Meta Tag, Schema, Internal Links, Social) are reachable from the record they operate on.

This keeps progress legible through the record itself, needs no new layout, and degrades gracefully when a step is skipped.

## 11. Architecture gaps

**Must solve before C2** — none. No blocker was found.

**Can solve during C2**
- **Topic carrier**: compose CGA `topic`/`opportunity`/`reason` into prefilled, editable Brief `notes` (no schema change).
- **Content-type mapping**: the deterministic table in §4, applied as a prefill the user can override.
- **Duplicate-Content guard**: route the workflow exclusively through the update lane; never expose `saveLongFormAsNewContentAction` as a workflow step.

**Future / not needed for the first workflow**
- Opportunity provenance on the Content row (`aiBriefDetails.sourceOpportunity`, no migration).
- Stable identity for gap opportunities (would require a model; only needed to *resume* a specific opportunity later).
- Workflow state/progress tracking across sessions.
- Chaining the four `contentId`-based tools into an explicit sequence.

## 12. C2 implementation plan (proposed)

1. **C2.1** — Deterministic CGA→Brief mapping helper (pure, unit-tested): opportunity → `{notes, contentType}`.
2. **C2.2** — *Create content brief* action on each CGA opportunity card, navigating to the Brief form with prefilled, editable values. No new route, no persistence.
3. **C2.3** — Brief form accepts and displays those prefilled values; server contract unchanged.
4. **C2.4** — Content detail page: extend the existing next-action area to expose the `contentId`-based tools once an article exists.
5. **C2.5** — Tests: mapping helper, prefill round-trip, ownership unchanged, and an explicit regression that the workflow never creates a second Content row.
6. **C2.6** — Browser verification of the full opportunity → brief → draft path on one Content record, confirming exactly one row and one revision.

Each step is independently revertible and none changes an existing tool's generation behaviour.
