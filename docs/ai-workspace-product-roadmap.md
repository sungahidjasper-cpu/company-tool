# AI Workspace Product Roadmap — Connected Workflow & Data Foundation (2026-09-04)

Tracks the AI Workspace's evolution from a set of nine independent generators into a connected Content + SEO workflow. Complements [`ai-platform-roadmap.md`](ai-platform-roadmap.md) (which tracks the numbered infrastructure phases 18–30) and [`phase-c1-ai-workspace-workflow-spec.md`](phase-c1-ai-workspace-workflow-spec.md) (the workflow specification this roadmap executes against).

Baseline: `9a9077b` (`feat(ai-workspace): complete AI workspace stabilization`). C2 and C3 are implemented and uncommitted at the time of writing.

## Completed tools (9)

| Tool | Writes | Contextual to |
|---|---|---|
| SEO Content Brief | creates Content | SEO project |
| Long-Form Content Draft | creates **or** updates Content (+ revision) | a Content record |
| Meta Tag Optimizer | updates Content (+ revision) on apply | a Content record |
| Content Rewriter | updates Content (+ revision) on apply | a Content record |
| Schema Markup Generator | review-only | project, optionally a Content record |
| Internal Link Analyzer | review-only | a Content record |
| Social Snippet Generator | review-only | a Content record |
| Press Release Generator | review-only | SEO project |
| Content Gap Analysis | review-only | SEO project |

All nine passed B1–B5 stabilization: server-authoritative ownership, soft-delete write protection, runtime validation of saved AI data, neutral failure messaging, a shared error presentation, provider-switch visibility, and a consistent SEO-metric/competitor grounding guard.

## The connected workflow (C2 + C3, implemented)

```
Content Gap Analysis
      │  [Create Content Brief]        ← contextual action, C2
      ▼
SEO Content Brief   (prefilled, editable)
      │  [Save as Draft]
      ▼
   ONE Content record                  ← canonical carrier
      │  [Generate Long-Form Content]  ← contextual action, pre-existing
      ▼
SAME Content record updated (+ ContentRevision)
```

**Design rules that hold this together**

- **No workflow engine, no workflow table.** The Content record *is* the workflow state; the stage is derived from its own columns (`deriveContentWorkflowStage`).
- **Human approval at every hop.** Four explicit gates: choose an opportunity, save the brief, start the draft, save the draft. Nothing auto-advances, nothing auto-writes.
- **One Content record.** The connected path only ever routes through `updateLongFormContentAction`; `saveLongFormAsNewContentAction` stays available for the standalone flow but is never a workflow step. Regression tests assert `content.create` is never called on the update lane.
- **Hand-offs carry ids and editable text only.** Never `companyId`, project/company names, domain, or actor identity; the server re-derives ownership every time.
- **Actions appear only when their input exists.** `BRIEF_ONLY` offers long-form generation; `MANUAL` never does.

## Next integrations (Tier 1 — all tools already built)

These are integration-only: each tool exists, is stabilized, and needs a contextual entry point from the Content record plus a prefilled hand-off, exactly like C2's. **Conditions determined during C3:**

| Action | Condition | Notes |
|---|---|---|
| Generate Long-Form | `BRIEF_ONLY` (brief saved, no body) | **implemented** |
| Optimize Meta Tags | `HAS_ARTICLE` | updates Content + revision; preserve no-op short-circuit |
| Rewrite Content | `HAS_ARTICLE` and a non-empty body | the action already re-checks the body server-side |
| Generate Schema | `HAS_ARTICLE`, or brief-only with title/meta present | review-only; stays review-only absent an explicit product decision |
| Find Internal Links | `HAS_ARTICLE` **and** the project has other Content with populated `url` | see the data limitation below |
| Generate Social Snippets | `HAS_ARTICLE` | preserve platform dedup, partial-result notice, Copy |

**Known data limitation:** `Content.url` is empty on every row in the current dataset, and the Internal Link Analyzer's dispatcher filters the link inventory to `url !== null`. It therefore cannot return recommendations here regardless of AI quality. The integration should surface the action only when a usable inventory genuinely exists — **not** by fabricating URLs to make the workflow look complete.

## Blocked tools & their unlock conditions

| Tier | Tool | Blocked on |
|---|---|---|
| 2 | Topic Cluster Planner | Meaningful project keyword/cluster data. Currently **4 keywords, 1 cluster** database-wide. The future tool must *organize* real keyword evidence (volume, difficulty, intent, rank, cluster, target URL, existing Content), not invent a hierarchy. |
| 3 | Competitor Content Analysis | A real competitor data model — competitor → pages → topics → keywords → performance. `BrandProfile.competitorUrls` exists but is empty and unused. **A competitor URL alone is not evidence of competitor performance.** |
| 3 | Content Calendar Assistant | Persistent calendar data (content, topic, target keyword, type, status, assignee, due date, publish date). AI should assist with scheduling, not invent a calendar. |
| 4 | Image Alt Text Generator | A real image inventory linked to Content. No Content body currently contains images. |
| 4 | Email Newsletter Drafter | Published-content volume. Currently **0** rows are both `PUBLISHED` and have a body. |

None of these should be built before its unlock condition is met; building earlier produces a tool that cannot be honestly grounded or meaningfully tested.

## Product architecture direction

The intended end state is a feedback loop rather than a toolbox:

```
SEO Project → Project Data (Content, Keywords, Performance)
      → AI Intelligence
          ├── Identify opportunity → Brief → Draft → Content
          └── Optimize content → Meta / Schema / Internal Links / Rewriter / Social
      → Human Review → Publish → Performance → Next optimization
```

The loop currently closes only on the left branch. The right branch exists as tools but is not yet contextual to Content; the Performance leg does not exist at all.

## Data foundation — the real constraint

Stabilization and C1 discovery both converged on the same conclusion: **the limiting factor is structured data availability, not AI capability.** A future data-foundation phase should be scoped before further AI tools.

**Keyword intelligence — partially exists.** `Keyword` already carries `term`, `searchVolume`, `difficulty`, `currentRank`, `intent`, `priority`, `status`, `targetUrl`, an optional `clusterId`, and a many-to-many link to `Content`; `KeywordCluster` carries `name` and `description`. The schema is broadly adequate — the gap is **volume, not shape**: 4 keywords and 1 cluster exist, and none of those fields is passed into any prompt today. Realistic ingestion would mean CSV import or a rank-tracker/keyword-tool integration.

**Performance data — does not exist.** There is no structured rankings, impressions, clicks, CTR, traffic, or conversion data anywhere in the schema. Every such number in the product today would be fabricated, which is exactly why B5.2's grounding guard forbids stating them. Eventually this requires a Search Console / analytics integration and new models.

**Competitor data — does not exist.** Only `BrandProfile.competitorUrls` (empty, unused, and not evidence of performance).

## Proprietary AI direction

Not started, and correctly so. The nine stabilized tools are now a useful evaluation surface, but the prerequisite sequence is: real project data → grounded tasks → expected outputs → an evaluation dataset → quality scoring → model experimentation. The existing provider abstraction (`lib/ai/providers/*`, with fallback, retry and health tracking) should remain intact so that a future proprietary model can be added as **another provider** rather than requiring an application rewrite.

## Deferred defects (carried, not fixed)

- `saveContentBriefAction`'s `logActivity` is not wrapped in try/catch, unlike its Long-Form and apply-path peers.
- `restoreContentRevisionAction` shares the soft-delete gap B1 closed inside the AI Workspace.
- Internal Link Analyzer and Social Snippet still auto-select the first Content within a chosen project.
- Internal Link Copy remains browser-unverified pending Content rows with populated `url`.
