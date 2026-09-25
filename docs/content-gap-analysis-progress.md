# Content Gap Analysis — Stage C Baseline (2026-09-04)

The ninth AI Workspace tool. Stage A (detailed discovery) → Stage B (implementation) → Stage C (nullable classification) are each separately approved and complete. **Nothing is committed and nothing is pushed** — the entire tool sits uncommitted in the working tree on top of `f2b374e`. This doc records the approved Stage C state as the frozen baseline for any later stage.

## Approved scope (Stage A)

Turns the content-gap data a project's existing Website Analysis audit already produced into an organized, cross-referenced set of content opportunities. Deliberately **not** competitor analysis: this repository has no competitor-page data, so the tool never claims a competitor ranks for or covers a topic, and never states a search volume, keyword ranking, keyword difficulty, or traffic figure — none of that data exists anywhere in the schema.

Grounded only in: `WebsiteAnalysisJob.resultJson.audit.contentGaps`, `audit.keywordIntelligence.contentClusters`, `resultJson.crawledPages` titles, and existing `Content` titles. Generate-and-review only — no Apply/Save, matching Schema Markup Generator's precedent.

## Architecture

- **Input**: `{seoProjectId}` only. The underlying Website Analysis is resolved server-side — the most recent `SUCCEEDED` job that actually carries content-gap data, not merely the most recent one (a job can succeed with `audit: null` when the crawl worked but AI enrichment didn't; several such rows exist live).
- **Job input**: `{seoProjectId, websiteAnalysisJobId}`, stored in `AiGenerationJob.inputJson`. `AiGenerationJob` has no `websiteAnalysisJobId` column and needed none — no new Prisma model or column.
- **Migration**: `20260903162327_add_content_gap_analysis_task_type` — one additive line, `ALTER TYPE "AiTaskType" ADD VALUE 'CONTENT_GAP_ANALYSIS'`.
- **Runner**: one new `dispatchContentGapAnalysis` plus one `TASK_HANDLERS` entry. The dispatch mechanism itself is untouched.

## The core design rule (Stage C)

The result is built **from the deterministic gaps outward**, overlaying whatever valid classification the model supplied — not by walking the model's response and keeping what matches.

- Always deterministic, never AI-authored: `topic`, `opportunity`, `reason` (verbatim audit text), `relatedCluster`, `existingCoverageStatus`, `matchedExistingTitle`.
- Optional AI judgment, nullable: `suggestedContentType`, `recommendedNextAction`.
- The model can only **enrich** an opportunity — never remove, reorder, or alter one.

Stage C exists because of a live failure: with Gemini quota-limited, the weak local fallback model returned no usable classifications, and the original all-or-nothing contract discarded every genuine audit opportunity and showed an empty result. Null now means "not supplied" — never a fabricated fallback classification.

The two null cases are distinguished deterministically by `existingCoverageStatus`, with no extra field:

| State | Meaning |
|---|---|
| `suggestedContentType` = value | valid AI suggestion |
| `suggestedContentType` = null | applicable, but the model returned nothing valid |
| `recommendedNextAction` = value (only when `POSSIBLE_MATCH`) | valid AI suggestion |
| `recommendedNextAction` = null with `POSSIBLE_MATCH` | applicable, but not returned |
| `recommendedNextAction` = null with `NOT_FOUND` | **not applicable** — no existing page to update, so no verdict is invented |

`UPDATE_EXISTING` is therefore structurally impossible whenever the deterministic coverage check found no match.

## Coverage heuristic — and the two false positives fixed in live testing

Matching is title-text only: `Content.url` is unpopulated on every row in this database, so URL matching is impossible. Two real defects were found and fixed during Stage B live verification (both regression-tested):

1. **Site-wide common words.** The FAQ gap matched the unrelated homepage ("Institutional Self-Storage Investments") on `self` + `storage` alone. Fixed with a corpus-frequency filter — words appearing in ≥50% of the site's titles carry no discriminating signal and are excluded. Only engages with ≥4 titles, since frequency is meaningless below that.
2. **Description noise.** After that fix, "Local Business Pages" matched an investment-opportunities page via words from the gap's own *description* ("...local market trends and investment opportunities"). Fixed by matching on the gap **title** only — the title is what actually names the topic.

The heuristic is deliberately conservative and is labeled in the UI as "a simple title-text match, not a full content review." It cannot detect a topic covered under a completely different title; that limitation is stated, not hidden.

## Files (all uncommitted)

**Created (9)**: `features/ai-workspace/schemas/content-gap-analysis.schema.ts`, `features/ai-workspace/services/content-gap-analysis.service.ts` (+ `.test.ts`), `features/ai-workspace/actions/content-gap-analysis.actions.ts` (+ `.test.ts`), `features/ai-workspace/components/ContentGapAnalysisPicker.tsx` (+ `.logic.test.ts`), `app/(dashboard)/ai/content-gap-analysis/new/page.tsx`, `prisma/migrations/20260903162327_add_content_gap_analysis_task_type/migration.sql`.

**Modified (4)**: `prisma/schema.prisma` (enum value + doc comment), `features/ai-workspace/schemas/ai-generation-job.schema.ts` (one validator), `lib/jobs/ai-generation-job-runner.ts` (one dispatcher + one handler entry), `app/(dashboard)/ai/page.tsx` (flipped to available; description rewritten to drop the competitor claim, and the "eight tools" comment updated to nine).

**Untouched, verified**: `lib/ai/structured-output.ts`, `lib/ai/providers/*`, `content-revision.service.ts`, and every completed AI Workspace tool.

## Verification at this baseline

- Focused tests 64/64; AI Workspace suite 832/832; full repo suite **2509/2509**.
- Typecheck clean. Lint 0 errors (1 pre-existing unrelated warning in `ReportForm.tsx`). Production build succeeds with `/ai/content-gap-analysis/new`. 36 migrations, schema up to date.
- **Live, real Storage Moguls data** (audit job `01a01c02-e834-771c-85bc-784a64dceddb`, 3 real gaps, 3 clusters, 14 existing titles): all 3 opportunities returned with correct classifications (`LANDING_PAGE`, `CASE_STUDY`, `FAQ_PAGE`), each with `recommendedNextAction: null` (not applicable). All 3 correctly report `NOT_FOUND` coverage — the false-positive fixes hold.
- **Weak-model scenarios against the real prepared gaps — all 5 pass**: empty array, garbage/non-objects, invalid enum values, hallucinated unknown topic, and only-1-of-3 classified. Each asserts all 3 opportunities present, order and topics intact, audit text intact, no phantom next-action, and zero forbidden-claim matches (competitor / ranking / search volume / keyword difficulty / traffic / impressions / CTR).
- `Content` 8→8 and `ContentRevision` 5→5 across every live run.

One issue caught during Stage C verification: the build reported "Compiled successfully" and then **failed type check** (TypeScript could not narrow the coverage union through an intermediate boolean). Fixed by narrowing on the discriminant directly, then fully re-verified.

## Not yet done

- **No browser-based UI verification.** All live verification so far is service-level (direct calls against the real database and real providers). The rendered page, the three classification display states, and the empty/no-usable-audit error states have not been exercised in a real browser.
- No commit, no push.

## Repository state (2026-09-04)

HEAD is `f2b374e` (`fix(ai-workspace): correct Press Release Generator null-result message`). The three untracked `docs/*-progress.md` files besides this one are pre-existing and unrelated — they must not be staged or committed alongside this tool.
