# Phase 11C — Enterprise AI Provider Management & Cost Optimization

Status: implemented, unit-tested (69 tests passing), lint/typecheck/build clean; live-verified per the report delivered alongside this document.

## Context

Phase 11B already built the core architecture this phase extends: a multi-provider abstraction (`lib/ai/providers/`), a shared error taxonomy with a fallback-worthy gate, a provider-priority fallback loop (`lib/ai/structured-output.ts`), a retry helper that only retries transient malformed-JSON output, and an "AI is optional enrichment" pipeline where the crawl + deterministic issue detection always produce a real, viewable result regardless of AI availability. Phase 11C turns that into something closer to what a SaaS SEO platform runs in production: a 5th provider, health-aware selection, cost/usage analytics, a result cache, independent per-task failure, a few more deterministic signals, and a UI that shows deterministic results the moment they exist rather than waiting for AI.

## Provider architecture

Every provider (`lib/ai/providers/{anthropic,openai,gemini,ollama,openrouter}.provider.ts`) implements one interface (`lib/ai/providers/types.ts`):

```ts
interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  generateRaw(request): Promise<{ data, usage: {promptTokens, completionTokens}, model, retried }>;
  healthCheck(): Promise<ProviderHealthStatus>;
  supportsJson(): boolean;
  maxContext(): number;
  cost(usage): number;
}
```

`embed()`/`supportsVision()` were deliberately left out of this interface — nothing in this app does embeddings or vision today, so they'd be interface methods with zero real callers. Every method above **is** called by real code: `healthCheck()`/`supportsJson()` by the registry's filtering, `maxContext()` by `structured-output.ts`'s pre-flight size check, `cost()` for `AiUsageLog` rows.

**Selection** is still `lib/ai/providers/registry.ts` + `lib/ai/structured-output.ts` working together — no new "ProviderManager" class replaced them, since a class wrapping "registry lookup → health filter → try in order → fall back" would just be the same two files with an extra layer. `getConfiguredProviders()` now:
1. Filters to providers with required env vars set (`isConfigured()`).
2. Filters out anything the in-memory health cache currently marks unhealthy (`healthCheck()` → `health-cache.ts` — never a live network probe, just the cached result of the *last real attempt*).
3. Returns the rest in fallback order.

`structured-output.ts` additionally pre-filters by `maxContext()` against a rough token estimate of the request, so a provider whose context window is clearly too small for a large audit prompt is skipped rather than attempted and failed.

## Fallback order

Default: `gemini, ollama, openai, anthropic, openrouter` — Gemini first (primary configured provider), Ollama second (free/local, worth trying before paying), OpenAI third, Anthropic fourth, OpenRouter last (a paid aggregator — the catch-all once every direct provider has failed). Override per deployment with the `LLM_PROVIDER_ORDER` env var (comma-separated), no code change needed.

## Health monitoring

`lib/ai/providers/health-cache.ts` — an in-memory `Map` (module-level singleton, same pattern as each provider's own SDK-client cache), six statuses: `HEALTHY | UNAVAILABLE | AUTHENTICATION_ERROR | QUOTA_EXCEEDED | RATE_LIMITED | DISABLED`. On a fallback-worthy failure, `recordProviderFailure()` marks that provider unhealthy for a TTL: 60s for rate-limit/timeout/service-unavailable (these frequently self-clear within seconds), 10 minutes for auth/quota problems (these need a human to fix a key or add funds — they don't self-resolve in a minute). A real success (`recordProviderSuccess()`) clears the mark immediately rather than waiting out the TTL. `DISABLED` means unconfigured — checked directly via `isConfigured()`, never cached.

## Retry policy (unchanged, extended to OpenRouter)

`lib/ai/providers/retry.ts`'s `withRetry()` retries **only** a malformed/truncated JSON parse failure (verified live in Phase 10.5b to be genuine run-to-run model variance, not a systemic bug) — up to 3 attempts. Authentication, invalid API key, quota-exceeded, and billing errors are never retried; they go straight to classification and, if fallback-worthy, the next provider. Each `generateRaw()` now also reports whether more than one attempt was needed (`retried: boolean` on `GenerateRawResult`), logged and stored on `AiUsageLog`.

## Cost & usage analytics

New `AiUsageLog` table — one row per provider attempt (success or failure): `provider`, `taskType`, `promptVersion`, `model`, `promptTokens`/`completionTokens`, `estimatedCostUsd`, `succeeded`, `errorType`, `latencyMs`, `retried`, optionally linked to a `WebsiteAnalysisJob` (`SetNull` — this table outlives any one job's lifecycle for aggregate reporting). Written by `structured-output.ts` after every attempt; a write failure is logged and swallowed, never allowed to break the AI call it's describing.

Cost is estimated (never billed) via `lib/ai/providers/pricing.ts` — a small per-provider, per-model USD/1M-token table. **This table will drift** as providers change pricing; an unrecognized model falls back to a documented default rate with a logged warning rather than silently guessing. OpenRouter gets one blended default rate rather than a per-model table, since it routes to whichever model is configured and its real pricing varies far more than the other four providers' own small lineups.

## AI task separation & independent failure

The pipeline's 5 AI calls (`AiTaskType`: `EXTRACTION`, `SCORES`, `RECOMMENDATIONS`, `CONTENT_INTELLIGENCE`, `EXECUTIVE_SUMMARY`) already existed as separate `generateStructuredOutput()` calls before this phase. What Phase 11C fixed: `seo-audit.service.ts`'s 3 parallel tasks ran via `Promise.all`, so one rejecting discarded the other two's results. Now `Promise.allSettled` + independently-nullable sections mean a `CONTENT_INTELLIGENCE` failure no longer erases `SCORES`/`RECOMMENDATIONS` that already succeeded. `EXECUTIVE_SUMMARY` is generated only when both `SCORES` and `RECOMMENDATIONS` succeeded (it summarizes them — summarizing missing data would be actively misleading). If **all 3** fail, `generateSeoAudit()` rethrows (the `SCORES` task's reason) — functionally identical to the pre-11C "AI audit entirely unavailable" path already verified in Phase 11B, so that scenario's UI (the amber advisory banner) is unchanged. A *partial* failure gets no job-level banner — the UI's per-tab null-guards (`CategoryScoreBar`, `SeoOverviewTab`, `SeoScoresTab`, `SeoKeywordsTab`, `SeoContentGapsTab`, `SeoStructuredDataTab`) show "AI unavailable for this run" only on the specific missing section, since the sections that did succeed are genuinely complete.

## Background execution & the deterministic/AI UI split

The crawl + deterministic issue detection already persisted independently of the AI phase before this change (`runCrawlPhase` writes `crawlResultJson` + `WebsiteAnalysisIssue` rows well before `runAiPhase` starts) — but the workspace UI only rendered *any* results once the job reached `SUCCEEDED`, so a user watching a `RUNNING` job saw nothing but a progress bar even though real crawl data had been sitting in the database since ~50% progress. `WebsiteAnalysisWorkspace.tsx` now computes the 4 deterministic category scores client-side (the exact same pure functions `seo-scoring.service.ts` uses server-side) as soon as `crawlResultJson` exists, and renders SEO Scores/Issues/Crawled Pages tabs immediately — with a "still generating" banner in place of the old progress-bar-only view. Once the job reaches `SUCCEEDED`, the full result-driven tabs take over exactly as before. The job's execution model itself didn't change — still one background `void runWebsiteAnalysisJob()` call, still one `RUNNING → SUCCEEDED` transition — only the UI's willingness to render partial data changed.

## Caching (Objective 10)

Reuses `WebsiteAnalysisJob` history — no new cache table. `website-analysis.service.ts` computes a SHA-256 hash of the canonicalized crawl result (`crawlHash`, a new column) right after crawling. Before calling any AI provider, it looks up the most recent prior **SUCCEEDED** job for the same domain + company whose `crawlHash` matches **exactly** and which has a succeeded `SCORES` `AiUsageLog` row at the current `PROMPT_VERSION` (a proxy for "this whole prior audit is still valid to reuse" — a prior job whose AI failed, or whose AI ran under an older prompt version, never matches). On a match, the prior job's `resultJson`/`overallScore` are copied directly and **zero AI provider calls are made** for that run. Any mismatch — different crawl content, or a bumped `PROMPT_VERSION` — always regenerates; there is no partial/fuzzy reuse.

The hash is computed once at crawl time and threaded explicitly through to the AI phase and stored on the row (rather than recomputed later from a database read-back), because a `jsonb` round-trip isn't guaranteed to preserve object key order byte-for-byte, which a naive recompute would be sensitive to.

## Prompt versioning

One `PROMPT_VERSION` constant in `seo-audit.service.ts`, bumped whenever any prompt template in that file changes. Stored on every `AiUsageLog` row alongside `model`/`provider`/`temperature`/`createdAt`, and used as the caching exact-match key above.

## Deterministic coverage (Objective 7)

Audited against the objective's full list. Already deterministic before this phase: titles, headings, broken links, image sizes, alt text, schema detection, robots, sitemap, redirects, canonical, internal/external links. Three real gaps closed:
- **OpenGraph + Twitter Card tags** — new `ogTags`/`twitterTags` extraction in `website-crawler.service.ts`; two new issue types (`MISSING_OG_TAGS`, `MISSING_TWITTER_CARD`).
- **Page speed** — `loadTimeMs` now measured around each page fetch (no new network call, just timing the existing one); a new "Slow-loading pages" finding in `computeTechnicalSeoScore` for pages over 3s.
- **Crawl-depth sampling** — an informational (non-penalizing) finding when the sitemap lists more URLs than were actually sampled, so a partial-crawl analysis is never mistaken for a complete one.

AI remains reserved for judgment calls that genuinely need it: executive summary, recommendations, business understanding, EEAT, GEO/AEO readiness, content strategy, semantic/topic analysis.

## Adding a new provider (OpenRouter as the worked example)

1. Create `lib/ai/providers/<name>.provider.ts` implementing `LlmProvider`. If the provider is OpenAI-API-compatible (OpenRouter is), copy `openai.provider.ts`'s structure and just change the SDK client's `baseURL` and the error-classification `provider` name.
2. Add pricing to `pricing.ts` (or a single blended rate if the provider routes to many underlying models, like OpenRouter).
3. Register it in `registry.ts`'s `ALL_PROVIDERS` map and `DEFAULT_ORDER`.
4. Add `<NAME>_API_KEY` + `<NAME>_MODEL` env vars (or the provider's own auth convention, like Ollama's `OLLAMA_HOST`).
5. Add classification tests mirroring `errors.test.ts`'s existing `describe.each(["openai.provider", "openrouter.provider"])` pattern.

## Testing

69 tests total (up from 30 before this phase): `health-cache.test.ts` (new — TTL expiry via fake timers, per-provider independence, success clears immediately), `openrouter.provider` classification (new, `describe.each`-shared with `openai.provider`'s existing cases — this is what caught a real bug: OpenRouter's `RateLimitError` handling initially checked only message text, not the SDK's `code: "insufficient_quota"` field like OpenAI's does), `seo-audit.service.test.ts` (new — independent task failure, executive-summary-skip logic, all-3-fail rethrow), `seo-issue-detection.service.test.ts` (new — the 2 new social-tag issue types), plus 2 new cases in `seo-scoring.service.test.ts` (slow-page finding, partial-crawl-sample note). The crawl-hash cache lookup and end-to-end `AiUsageLog` writes are exercised by live verification rather than a DB-mocked unit test — this project's testing pattern to date is pure-function/mocked-boundary unit tests plus live verification for real integration behavior, not a DB-mocking framework, and this phase didn't introduce one.

## Remaining recommendations

- **Pricing table drift.** `pricing.ts` needs a human to update it when providers change published rates — there's no live pricing API integrated. A stale rate degrades gracefully (a logged warning, not a crash) but silently under/over-estimates cost until updated.
- **No cross-job/company cost dashboard yet.** `AiUsageLog` has everything needed for one (provider, task, tokens, cost, latency, time), but no UI reads it yet — a natural Phase 11D-or-later addition.
- **OpenRouter is typed against its real SDK shape (it reuses the `openai` package) but has not been live-tested against a real OpenRouter account** — the other 4 providers have each been live-verified in earlier phases; OpenRouter's classification is unit-tested but its `generateRaw()` path against the real API is unverified until a real key is available.
- **`maxContext()` values are static per-provider constants**, not queried per-model — accurate for the currently-configured models, but would need a manual update if a deployment switches to a materially different context-window model.
