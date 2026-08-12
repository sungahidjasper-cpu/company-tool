# Phase 12A — Relationship Integrity

Status: implemented, tested, and live-verified. Committed alongside Phase 11C (both were built in the same working tree before either was committed) in `3da39de`.

## Context

A read-only architecture audit (performed before this phase) found the data model already supported linking a Website Analysis to an SEO Project (`WebsiteAnalysisJob.seoProjectId`) and a Report to an SEO Project (`Report.seoProjectId`), but two real, narrow gaps existed in the application code that used that schema:

1. The only UI that starts a new Website Analysis (`/seo/website-analysis`) never set `seoProjectId`, even though the field, the action, and the service layer already accepted it.
2. The "SEO Performance" report's scope picker let a user select a specific SEO Project, but `generateReport`'s write path silently dropped that selection — `Report.seoProjectId` was never actually persisted.

This phase fixed exactly those two gaps, without touching the crawler, AI pipeline, provider architecture, caching, or Phase 11A/11B/11C behavior.

## Fixed

- **Website Analysis → SEO Project**: `WebsiteAnalysisWorkspace` gained an optional `seoProjectId`/`seoProjectName` prop pair; when present, the form shows "This analysis will be linked to the SEO project…" and threads `seoProjectId` into `startWebsiteAnalysisAction`. Standalone analysis (no project) remains fully supported and is still the default. The SEO Project detail page gained an "Analyze new website →" link (`/seo/website-analysis?seoProjectId=...`) alongside the existing "View analysis history →" link, giving the project-scoped flow a real entry point where none existed before.
- **Report → SEO Project**: `generateReport` gained the one missing write branch (`scopeKind === "seoProject" && scopeId ? { seoProjectId: scopeId } : {}`), matching the existing `project`/`client` branches exactly.

## Verified

- `npm run lint` / `typecheck` / `test` (74 tests, unchanged) / `build` all clean.
- Live, DB-verified (not inferred from UI alone): a project-scoped analysis persists the correct `seoProjectId`; a standalone analysis persists `null`; the analysis appears in that project's history immediately; duplicating a project-scoped analysis carries the association forward to the new job, and both jobs appear together in the project's history; a generated SEO Performance report for a specific project correctly persists `Report.seoProjectId`; every other existing report type is unaffected; the AI-unavailable/deterministic fallback (Phase 11B/11C) still works exactly as before.
- A follow-up orphan-path audit enumerated every code path that creates or mutates a `WebsiteAnalysisJob` (exactly two: the form action and duplicate) and every `prisma.report.create` call site (four, only one relevant) — confirmed no other bypass exists anywhere in the app (no API route, no cron, no script creates these rows outside the audited paths), and confirmed no mutation function ever clears `seoProjectId`/`clientId` once set.
- Confirmed the exact query shape a future report consuming Website Analysis data would need (`WebsiteAnalysisIssue.findMany({ where: { websiteAnalysisJob: { seoProjectId } } })`) already works today with zero new code — this became the foundation Phase 13 built on directly.

## Remaining recommendations

None specific to this phase — see Phase 13's own doc for what was built on top of this foundation, and the original architecture audit for broader, still-open items (AI usage cost dashboard, provider health UI) that remain deliberately unaddressed.
