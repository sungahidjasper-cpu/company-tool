# Phase 13 — SEO Audit Report

Status: implemented, tested, and live-verified. Committed in `82aa0e6`.

## Context

Phase 12A froze the relationship layer (`WebsiteAnalysisJob.seoProjectId` reliably populated, standalone analysis still supported, duplication preserves the link) and confirmed via a real query that a project's entire Website Analysis issue history is already reachable through that relationship with zero new code. Phase 13 is the first feature to consume that plumbing: a new Reports type that generates a complete SEO audit for one SEO Project, sourced entirely from data that already exists.

**Explicitly, by design: no new AI calls, no new crawling.** The report reads the project's most recent **SUCCEEDED** `WebsiteAnalysisJob` (crawl result, persisted issues, and whatever AI enrichment that run happened to have) and reshapes it — it never triggers a fresh analysis.

## What was built

- **New `ReportType` value: `SEO_AUDIT`** (one additive migration, `20260812220144_phase13_seo_audit_report_type` — no data migration, no other schema change).
- **New required scope kind** (`scopeKind: "seoProjectRequired"`), distinct from `SEO_PERFORMANCE`'s existing optional `"seoProject"` picker — an audit is inherently per-website, so there's no "company-wide" option; the form requires a real project selection.
- **`getSeoAuditReportData(companyId, seoProjectId)`** (`features/seo/services/website-analysis.service.ts`) — the only new business logic in this phase:
  - Validates the project exists and belongs to the caller's company; finds its latest `SUCCEEDED` job; throws a specific, actionable error if neither exists (surfaced through `generateReport`'s existing error-handling path — no new error handling was needed).
  - Reuses the existing `parseWebsiteAnalysisResult` parser unchanged.
  - Produces: summary cards (domain, overall/technical/on-page scores or "Unavailable" if that run's AI never succeeded, total/critical issue counts), a severity-breakdown bar chart (reusing the existing fixed-shape chart component as-is), and the full issues table (reused by the existing generic CSV/table renderer unchanged).
- **`ReportData` gained two optional fields** — `executiveSummary` and `recommendations` — populated only by this report type; every other report type is completely unaffected.
- **Report detail page** gained an Executive Summary section and a Recommendations section (reusing the existing `SeoRecommendationsTab` component from the Website Analysis workspace as-is, not a new component), rendered only when present.

## Verified

- `npm run lint` / `typecheck` / `test` (79 tests — 74 prior + 5 new for `getSeoAuditReportData`) / `build` all clean.
- Live: the required-project picker correctly has no "company-wide" option (unlike `SEO_PERFORMANCE`'s); a project whose latest analysis never got AI enrichment produces a complete report with scores marked "Unavailable" and no Executive Summary/Recommendations sections, while issues table and severity chart render fully; a project with full AI audit data renders real scores, the executive summary paragraph, and the recommendations list exactly as stored; a project with no completed analysis yet fails with a specific, named error rather than a crash; CSV export succeeds and contains the issues table; every pre-existing report type still generates correctly (regression-checked).
- **Zero new AI calls / zero new crawling**, confirmed by inspecting the dev server's full log across every report generated during verification — no provider-selection or crawl-phase log line appears anywhere outside the one-time server-startup check.
- The crawler, AI pipeline, provider architecture, caching, and Phase 11A/11B/11C/12A behavior are untouched — this phase's diff is limited to the Reports feature plus the one new function in `website-analysis.service.ts` plus the additive migration.
- The full 16-migration history (including this phase's) was deployed from scratch to a genuinely empty database (a separate, temporary `prisma dev` instance, not the real dev database) and applied cleanly in order.

## Remaining recommendations

- No "pick a specific historical analysis" picker — the report always uses the latest succeeded run for a project. If a use case for auditing an older run emerges, this would need a second picker (deliberately deferred per the approved plan).
- No PDF/rich export — only the existing CSV mechanism (tabular issues only, same as every other report type). Executive summary/recommendations are visible on the detail page but not in the CSV.
