# Phase 10.5c — SEO Platform Stabilization

Status: implemented and live-verified. This doc is the deliverable requested before any further SEO feature work: an architecture summary, SEO findings, what was fixed, what's left, and a Phase 11 roadmap.

## 1. Architecture summary

**Rendering.** Cloud Compass OS is a Next.js 16 App Router app. Every route under `app/` is a Server Component — there is no `"use client"` at the top of any `page.tsx`/`layout.tsx` (the only client boundary in `app/` is the Next.js-required `error.tsx`). Pages fetch data server-side (`await requireUser()` → a service call) and pass it down as props; there is no broad `useEffect`/client-fetch pattern. **The "mostly JavaScript in Page Source" observation is normal RSC/hydration chrome, not a CSR-SPA problem** — there was no rendering-architecture bug to fix.

**Auth surface.** `proxy.ts` (Next.js 16's renamed `middleware.ts`) gates 13 route prefixes covering ~45 of the app's ~47 routes, redirecting unauthenticated requests to `/login` and setting `Cache-Control: no-store` on protected responses. **The only route reachable without logging in is `/login`.** `app/page.tsx` (`/`) is a bare `redirect("/dashboard")` — there is no public marketing/landing page.

**AI layer (this phase's main change).** The LLM integration was a single hardcoded Anthropic client with no failure classification. It's now a provider-abstraction layer:

```
lib/ai/
  structured-output.ts       — orchestrator: tries configured providers in priority
                                order, falls back on availability-class failures,
                                validates every provider's output against one zod
                                schema regardless of provider
  providers/
    types.ts                 — LlmProvider interface
    errors.ts                — LlmErrorType taxonomy + LlmProviderError + user-facing
                                descriptions
    anthropic.provider.ts    — existing, proven call path, now with classification
    openai.provider.ts       — new
    gemini.provider.ts       — new
    ollama.provider.ts       — new (local, opt-in via OLLAMA_HOST — see Phase 10.5d for a naming-mismatch fix here)
    registry.ts               — getConfiguredProviders(): env-driven order, skips
                                any provider missing its required env vars
```

**Website Analysis pipeline.** Was one monolithic try/catch (crawl → extract → audit) where any AI-stage failure discarded the already-crawled data. Now split into `runCrawlPhase` (crawl + deterministic scoring, persists `crawlResultJson` immediately) and `runAiPhase` (extraction + audit, classifies failures) — so an AI failure never loses the 30-120s crawl, and a new "Retry AI analysis" action redoes only the AI stage.

## 2. SEO findings

| Area | Finding |
|---|---|
| Public surface | ~96% of routes are behind auth; `/login` is the only page a crawler can reach |
| Metadata | Root layout still had scaffold defaults (`title: "Create Next App"`) on every page; no page had `generateMetadata` |
| robots.txt / sitemap.xml | Neither existed |
| JSON-LD | None anywhere in the app's own markup (the only `ld+json` reference in the codebase is the crawler *reading* other sites' JSON-LD for the product's own SEO-analysis feature) |
| OG / Twitter cards | None on any route |
| Semantic HTML — `/login` | Zero headings at all — the "Cloud Compass OS" text used `CardTitle`, which renders a `<div>` |
| Semantic HTML — dashboard | An `<h1>` exists (site brand in `AppHeader`), but each page's title (`PageTitle`) renders `<h2>`, with further sibling `<h2>`s for subsections — a hierarchy nit, not a missing-heading bug |
| Landmarks | `<main>`/`<header>` exist; the sidebar has no `<nav>` wrapper |

**Because the public surface is essentially just `/login`, classic SEO investment (JSON-LD, OG, canonical tags, per-route metadata) across the ~45 authenticated dashboard routes would have had zero payoff** — search engines can't index what they can't reach, and those responses are already `no-store`. Fixes below are scoped to what's actually public plus low-risk, broadly-applicable hygiene.

## 3. Implemented fixes

**AI provider abstraction & error handling** (`lib/ai/providers/`, `lib/ai/structured-output.ts`):
- 4-provider abstraction with automatic fallback on `AUTHENTICATION_ERROR | INSUFFICIENT_CREDITS | RATE_LIMIT | TIMEOUT | SERVICE_UNAVAILABLE`; `INVALID_REQUEST` stops immediately (retrying elsewhere won't help a malformed request).
- Every provider classifies its own SDK's errors into the shared taxonomy; the UI (`WebsiteAnalysisWorkspace.tsx`) shows a title/message/recommended-action from `describeLlmError()` — never raw JSON.
- **Live-verification caught a real bug**: Anthropic's documented `error.type` union includes `billing_error` for out-of-credits, but the account's actual failure (confirmed against the org's genuinely over-the-limit account) came back as `400 invalid_request_error` with the balance message in the text, not `billing_error`. Fixed by also checking message text for credit-related phrases before falling back to `INVALID_REQUEST`; the same defensive check was added to the OpenAI and Gemini classifiers as a precaution, since this proved that a provider's documented taxonomy can't be fully trusted. Re-verified live after the fix — `errorType` now lands correctly as `INSUFFICIENT_CREDITS`.

**Partial-success persistence & retry** (`website-analysis.service.ts`, `lib/jobs/job-table.ts`, `WebsiteAnalysisWorkspace.tsx`):
- `crawlResultJson` persists as soon as crawling succeeds, independent of the AI stage's outcome.
- New "Retry AI analysis" action + button — live-verified to skip re-crawling (progress jumps straight to 55%, not restarting at ~10%).

**Schema**: `WebsiteAnalysisErrorType` enum + `crawlResultJson`/`errorType` columns (migration `20260811200139_multi_provider_error_handling`).

**Logging** (`lib/logger.ts`, new): structured JSON-line logging (no framework added — none existed anywhere in the app before this) instrumenting job lifecycle (crawl start/success/failure, AI phase start/success/failure) and provider fallback decisions (attempt, failure+classification, fallback-to-next, exhaustion). Raw provider errors are logged server-side only, never surfaced to the client.

**SEO/metadata fixes**:
- `app/layout.tsx` — real title (with `%s | Cloud Compass OS` template) and description, replacing the scaffold defaults; added `robots: {index: false, follow: false}` site-wide as defense-in-depth.
- `app/robots.ts` — `Disallow: /` for all user agents. **Deliberate choice, confirmed with the product owner**: this is an internal tool with no public signup funnel, so nothing about it should appear in search results.
- `app/(auth)/login/page.tsx` — real `metadata` export ("Log in | Cloud Compass OS") and a genuine `<h1>` for the page's title (previously a styled `<div>` via `CardTitle`).

**Verification**: lint/typecheck/build clean throughout. Two live Playwright passes against the real (genuinely over-its-spend-limit) Anthropic account confirmed: friendly, non-raw error messaging; `crawlResultJson` populated on AI-stage failure; retry-without-recrawl; and the corrected `INSUFFICIENT_CREDITS` classification. All test data and temporary tooling were cleaned up after each pass.

## 4. Remaining recommendations

- **Only Anthropic has been live-tested.** OpenAI/Gemini/Ollama providers are typed against their SDKs' actual definitions (not guessed) but have no API keys configured in this environment, so real-provider fallback (as opposed to the fallback *logic*) is unverified end-to-end. Configure a second provider's key + model env vars when one becomes available and re-run a forced-failover test.
- **Dashboard heading hierarchy** (`PageTitle` → `<h2>` with sibling `<h2>`s for subsections) is an accessibility nit, not an SEO issue (these pages aren't crawlable). Worth a pass if accessibility compliance matters, not urgent.
- **No `<nav>` landmark** around the sidebar menu — same accessibility-only, low-urgency category.
- **Concurrency under provider failure**: the AI phase fires 4 LLM calls (1 extraction + 3 parallel audit calls + 1 sequential summary); the first live-verification run observed one instance of an `UNKNOWN`-classified retry alongside the `INVALID_REQUEST` misclassification, consistent with different concurrent calls surfacing slightly different error shapes from an exhausted account. The message-text fix likely closes this, but it's worth a follow-up check once a real usable account (or a second provider) is available to force a clean multi-call failure and confirm classification is deterministic under concurrency.
- **Retry has no cooldown** — a user can click "Retry AI analysis" repeatedly against a still-broken provider. Minor UX polish, not urgent.
- **Logging is console-only.** Fine for local/dev; if this app moves to a hosted platform with its own log aggregation, no code change is needed (it's already structured JSON lines to stdout/stderr) but it's worth confirming that platform actually captures it.

## 5. Phase 11 roadmap

1. Get a usable AI provider back (restore Anthropic credits and/or configure OpenAI/Gemini as a real tested fallback) — this unblocks actually using the SEO Intelligence pipeline again, which is otherwise fully built and verified.
2. Resume the original Phase 10.5b/10.5c feature backlog for the SEO Workspace now that the platform issues motivating this stabilization pass are resolved.
3. Accessibility pass: dashboard heading hierarchy, sidebar `<nav>` landmark.
4. If/when a public marketing or self-serve signup surface is ever added, revisit `robots.txt` (currently blocks everything) and invest in real on-page SEO (OG cards, Organization JSON-LD, sitemap) for that surface specifically — not before, since there's nothing public to optimize yet.
