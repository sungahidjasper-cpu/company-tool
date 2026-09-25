# Competitor Content Analysis — Implementation Progress

**Status:** FUNCTIONAL — implemented, tested, live-verified
**Date:** 2026-09-05
**Position:** eleventh AI Workspace tool
**Baseline commit:** `9a9077b` (all work below is uncommitted)

---

## 1. Discovery

Before writing anything, the existing building blocks were inventoried so this tool would reuse
them rather than grow parallel machinery.

| Need | Existing component found | Decision |
|---|---|---|
| Fetch competitor pages | `crawlWebsite()` in `features/seo/services/website-crawler.service.ts` | **Reuse.** No second crawler. |
| Refuse unsafe fetch destinations | `assertSafePublicUrl()` in `features/publishing/services/ssrf-guard.service.ts` | **Reuse unchanged.** Not weakened, not forked. |
| Background generation | `AiGenerationJob` + `TASK_HANDLERS` in `lib/jobs/ai-generation-job-runner.ts` | **Reuse.** One new dispatcher entry. |
| Client generate → poll → stream | `useAiGenerationLifecycle` | **Reuse.** Identical lifecycle to every other picker. |
| Competitor URLs already on file | `BrandProfile.competitorUrls` | **Offer as suggestions**, never mandatory, never auto-submitted. |
| Existing-coverage comparison | `computeExistingCoverage` pattern from Content Gap Analysis | **Reuse the approach** — deterministic title matching in code. |
| Hand-off into Content Brief | `BriefHandoff` + `buildBriefHandoffHref` in `content-gap-to-brief.ts` | **Reuse the contract.** No third hand-off mechanism. |

Nothing new was introduced at the infrastructure layer. The only genuinely new pieces are this
tool's own schema, prompt, result builder, URL normalizer, action, dispatcher branch and UI.

---

## 2. Architecture

```
Picker (client)
  └─ normalizeCompetitorUrl()          pure shape check — no network, gates the Generate button
       └─ startCompetitorContentAnalysisAction()   "use server"
            ├─ authenticated actor → companyId       (never from the client)
            ├─ getOwnedSeoProject(projectId)         (ownership + deletedAt re-verified server-side)
            ├─ normalizeCompetitorUrl()              (again — the client's result carries no authority)
            ├─ assertSafePublicUrl()                 (DNS-resolving; refuses before any job is created)
            ├─ label source USER vs BRAND_PROFILE    (by comparing normalized origins)
            └─ create AiGenerationJob(COMPETITOR_CONTENT_ANALYSIS)
                 └─ dispatchCompetitorContentAnalysis()   (job runner)
                      ├─ re-verify project ownership + deletedAt from the STORED job row
                      ├─ for each stored origin:
                      │     ├─ assertSafePublicUrl()      ← again, immediately before the fetch
                      │     └─ crawlWebsite(origin)       ← robots.txt-respecting, capped
                      ├─ if zero pages → fail with a CRAWL message (never an AI message)
                      ├─ load this project's Content + Keywords (scoped, deletedAt: null)
                      └─ generateCompetitorContentAnalysis()
                           └─ buildCompetitorAnalysisResult()   ← rebuilds output from crawl evidence
```

**Files added**

| File | Role |
|---|---|
| `features/ai-workspace/services/competitor-url.ts` | Pure URL normalizer/refuser |
| `features/ai-workspace/schemas/competitor-content-analysis.schema.ts` | Form input, job input, loose provider output, canonical result |
| `features/ai-workspace/services/competitor-content-analysis.service.ts` | System prompt, prompt builder, deterministic result builder |
| `features/ai-workspace/actions/competitor-content-analysis.actions.ts` | Server action (auth, ownership, SSRF, job creation) |
| `features/ai-workspace/services/competitor-opportunity-to-brief.ts` | Content Brief hand-off (pure) |
| `features/ai-workspace/components/CompetitorContentAnalysisPicker.tsx` | UI |
| `app/(dashboard)/ai/competitor-content-analysis/new/page.tsx` | Route |

**Files modified:** `lib/jobs/ai-generation-job-runner.ts` (one dispatcher branch),
`features/ai-workspace/schemas/ai-generation-job.schema.ts`, `app/(dashboard)/ai/page.tsx`,
`prisma/schema.prisma`.

---

## 3. Inputs

| Field | Required | Notes |
|---|---|---|
| SEO project | Yes | **Starts unselected.** Auto-selecting the first project would let a user analyse against one they never consciously chose. |
| Competitor URLs | Yes, 1–3 | `MAX_COMPETITOR_URLS = 3`. Extra fields added on demand. |
| Focus topic | No | Free text, carried through as the user's own input and labelled as such. |
| Notes | No | Free text. |

Brand Profile competitor URLs are rendered as one-click **suggestions**. They are never
pre-filled, never auto-submitted, and go through exactly the same normalization and SSRF checks
as a typed URL — a stored URL earns no extra trust.

---

## 4. Crawler

`crawlWebsite()` is reused unchanged. No second crawler exists, and robots.txt is not bypassed.

- Respects `robots.txt`; when absent, the crawler says so in a warning rather than silently
  assuming permission.
- Sitemap-aware, falling back to the homepage when no sitemap is found.
- Hard cap of `MAX_PAGES = 12` per site.
- Its own `warnings[]` are surfaced **verbatim** in the UI and in the copied text, so the
  sample size is visible rather than implied away. The UI states plainly: *"Only the pages
  listed below were read — this is a sample, not the whole site."*

A crawl that yields zero pages fails the job with a crawl-specific message
(`"No pages could be read from the competitor site(s) supplied. …"`), never with an
AI-quality message. This was an explicit requirement and is covered by a dedicated test that
asserts the message does **not** match `/AI response/`.

---

## 5. Security

Every authority decision is made server-side from the authenticated actor.

- **`companyId` is never accepted from the client.** It is derived from the session.
- **Project ownership is re-verified twice** — once in the server action, and again in the job
  dispatcher from the *stored* job row, so a job row cannot be replayed against a project the
  actor no longer owns.
- **Soft-deleted projects are refused** (`deletedAt` guard) at both points.
- Project `Content` and `Keyword` rows are loaded scoped to that project with `deletedAt: null`.
- The Content Brief hand-off carries **ids and editable text only** — no company, user, role or
  ownership value. The Brief's own action re-derives the company and re-verifies the project, so
  a hand-crafted URL can only prefill a field the user could have typed.

Tests assert that a project belonging to another company and a soft-deleted project both fail
**before** `assertSafePublicUrl` or `crawlWebsite` is ever called.

---

## 6. SSRF protection

Two independent layers, neither of which relies on the other:

**Layer 1 — `normalizeCompetitorUrl()` (pure, no network).** Refuses:
non-string/empty input; malformed input that already carries a scheme (it never re-prefixes a
broken string); URLs carrying `username:password@` userinfo; any non-`https:` scheme (with a
specific message for `http:`); and single-label hosts such as `localhost`.
It returns a normalized `origin`, so only that origin is ever stored or fetched.

**Layer 2 — `assertSafePublicUrl()` (DNS-resolving), used unchanged.** Runs in the server action
*before a job row is created*, and again in the dispatcher *immediately before every
`crawlWebsite` call*. It refuses loopback, private, link-local and other internal destinations
after resolution, so a public hostname that resolves inward is still refused.

The guard was **not weakened, not forked, and not bypassed**. A test asserts the guard's
invocation order precedes the crawler's, and that an unsafe origin means the crawler is never
called at all.

Live browser results (see §11) confirm both layers: shape-invalid URLs are refused in the UI,
and loopback / private / link-local addresses reach the server and are refused there —
with **zero jobs created** by any refused URL.

---

## 7. Data grounding

Doctrine followed: **loose provider schema in, strict deterministic filter out; reject, never repair.**

- `buildCompetitorAnalysisResult()` **rebuilds every page from the crawl evidence**, then indexes
  the model's classifications by URL. Any URL the model returns that is not in `crawledUrls` is
  **dropped**. The model cannot add a page, invent a URL, or change a title.
- `url` and `title` are observations from the crawler; classification fields (`observedTopic`,
  `format`, `searchIntent`, `keyCoverage`) are AI analysis and are **nullable** — null means
  "not classified", never a guessed value. A weak fallback model returning nothing usable does
  not discard a page the crawler genuinely found.
- `containsFabricatedMetric()` is applied asymmetrically and deliberately: a metric claim in the
  page's `observedTopic` discards **the whole classification**; a metric claim in a single
  coverage bullet costs **only that bullet**.
- `existingCoverage` and `relatedKeywords` are computed **in code** against the project's real
  `Content` titles and `Keyword` rows — never model-supplied.
- Existing coverage is permanently hedged as a **title match**, because a title match is all the
  matcher actually establishes. It never claims a topic is covered.
- **Compass holds no ranking, traffic or backlink data for any site, so none is displayed** —
  stated explicitly in the UI rather than left as an absence.

---

## 8. Output

`CompetitorAnalysisResult` keeps observation and recommendation structurally separate:

- `competitors[]` — one per site: `origin`, `source` (`USER` | `BRAND_PROFILE`), `pagesAnalyzed`,
  `robotsTxtFound`, `warnings[]`, `pages[]`. All observation or crawler fact.
- `opportunities[]` — `topic`, `whyItMatters`, `suggestedContentType`, `recommendedAction`,
  `existingCoverage`, `relatedKeywords`. All recommendation.

---

## 9. UI

Route: `/ai/competitor-content-analysis/new`. Listed as **available** in the AI Workspace index
(no longer "coming soon").

- Two visually distinct badges enforce the boundary on screen: **Observed** on crawled pages,
  **Recommendations** on opportunities.
- Crawl warnings are shown verbatim with the sample-size caveat.
- Standing disclaimer: *"Competitor pages above were read from the sites you named. Opportunities
  are AI recommendations. Compass has no ranking, traffic or backlink data for any site, so none
  is shown. Nothing has been saved."*
- **Copy analysis** is the only export, since this is a review-only tool. The copied text keeps
  the same separation and omits absent classifications rather than printing `null`.
- `?jobId=` resume works, as it does for every other picker.
- All form controls are labelled; the competitor URL inputs carry `aria-label`s.
- No horizontal overflow at 390px.

---

## 10. Content workflow

**Implemented.** Each opportunity renders a **Create Content Brief** link.

- Uses the **existing** `BriefHandoff` / `buildBriefHandoffHref` contract — no third hand-off
  mechanism was invented.
- `mapCompetitorFormatToBriefType` maps only the formats with an honest equivalent
  (`ARTICLE → BLOG_POST`, `GUIDE → PILLAR_PAGE`, `LANDING_PAGE → LANDING_PAGE`). Formats with no
  honest equivalent — `FAQ_PAGE`, `CASE_STUDY`, `COMPARISON`, `PRODUCT_PAGE`, `OTHER` — map to
  `OTHER` rather than being forced into a shape that misdescribes them. No suggestion yields
  `null` (let the user choose), never a guessed default.
- The opportunity is composed into the Brief's existing free-text `notes` field, which is
  already visible and editable — so the user reviews this context before it influences anything.
  The notes name the competitor sites as pages that were *read*, label the opportunity as an
  *AI recommendation, not a ranking or traffic measurement*, keep coverage hedged as a title
  match, and carry no synthesized metric.
- The link is rendered only when the hand-off actually builds, so a malformed opportunity can
  never start a brief from nothing.

---

## 11. Tests

| Suite | Tests |
|---|---|
| `competitor-url.test.ts` | 19 |
| `competitor-content-analysis.service.test.ts` | 31 |
| `competitor-content-analysis.actions.test.ts` | 22 |
| `CompetitorContentAnalysisPicker.logic.test.ts` | 15 |
| `competitor-opportunity-to-brief.test.ts` | 18 |
| **Competitor-specific total** | **105** |
| `ai-generation-job-runner.test.ts` — competitor dispatcher block | 9 |

Full suite: **118 files / 3095 tests passing.**

The repository has no React rendering test setup (vitest runs `environment: "node"`), so picker
logic is extracted into pure functions and tested directly — the same approach every other
AI Workspace picker uses.

---

## 12. Browser verification (live)

Run against the real dev server, real database and a real network fetch.

**SSRF / refusal boundary**

| Input | Outcome | Jobs created |
|---|---|---|
| `http://example.com` | blocked in UI (Generate disabled) | 0 |
| `localhost` | blocked in UI | 0 |
| `https://example.com@evil.example.com/` | blocked in UI | 0 |
| `ftp://example.com` | blocked in UI | 0 |
| `not a url` | blocked in UI | 0 |
| `https://127.0.0.1` (loopback) | reached the server; refused by `assertSafePublicUrl` | 0 |
| `https://10.0.0.1` (private) | refused by `assertSafePublicUrl` | 0 |
| `https://169.254.169.254` (link-local) | refused by `assertSafePublicUrl` | 0 |

Server-side message: *"…cannot be analysed: The destination URL resolves to a private, internal
address."*

**Real crawl + fresh generation** — `https://example.com`, job `SUCCEEDED`:

- `pagesAnalyzed=1`, `robotsTxtFound=false`
- Crawler warnings surfaced verbatim: *"robots.txt not found or unreachable — proceeding without
  crawl restrictions."*, *"No sitemap found — falling back to the homepage only."*
- Page grounded in the real fetch: `https://example.com/`, title `"Example Domain"`
- 3 opportunities produced; **0 fabricated metrics** detected
- The model's reasoning was itself grounded — it noted the competitor page *"contains only
  placeholder text, providing no industry insights"*, which is factually true of example.com
- Server-resolved `seoProjectId` and `companyId` matched the authenticated actor's, not the client's

**Results UI + hand-off** (verified via the `?jobId=` resume path against that real job):

- Observed / Recommendations badges, no-data disclaimer, "Nothing has been saved", Copy analysis — all present
- 3 **Create Content Brief** links for 3 opportunities
- Href carries `seoProjectId` as an id only, with no company/authority params
- Clicking navigates to `/ai/content-brief/new` with the **same** project preselected and 820
  characters of editable prefilled notes, labelled as an AI recommendation, containing no fabricated metric

**Error presentation** — when the provider ran out of credits, the UI showed *"AI provider is out
of credits"*. It was **not** misreported as an invalid AI response and **not** misreported as a
crawl failure; the raw `INSUFFICIENT_CREDITS` enum was not leaked to the user.

**Write safety** — across every run: `Content 10→10`, `Keyword 4→4`, `KeywordCluster 1→1`,
`BrandProfile 1→1`. Nothing persisted. Console/page errors (excluding the known environmental
Prisma dev-proxy flake): none.

**Responsive** — no horizontal overflow at 390px.

---

## 13. Limitations (stated, not worked around)

1. **Sample, not a site audit.** At most 12 pages per competitor, and only what robots.txt
   permits. The UI says so rather than implying full coverage.
2. **No ranking, traffic, backlink or search-volume data exists in Compass**, so none is shown
   for any site. This is a data limitation, not a display choice.
3. **Existing coverage is a title match only** — it is not a content-level comparison, and it is
   labelled that way everywhere it appears.
4. **Nothing is persisted.** No `CompetitorIntelligence` model was created and no crawl result is
   stored, per the explicit instruction. A completed analysis survives only as the job result and
   is reachable via `?jobId=`.
5. **JavaScript-rendered competitor sites** will yield thin text, because the crawler reads HTML
   rather than executing scripts.
6. **Classification quality tracks the provider.** When the small local fallback model is in use,
   fields may come back null — which is displayed honestly as unclassified rather than guessed.
7. **Fresh generation depends on provider credits**, which were exhausted after the verification
   run above. No retry loop was added, and no result was fabricated.

---

## 14. Future Data Stronghold opportunities

Recorded as opportunities only — **not implemented**, and none should be added without explicit
authorization.

1. **Persisted competitor snapshots** — storing crawl results over time would enable
   "what changed on the competitor's site since last month", which is impossible today. Needs a
   deliberate data-retention decision (third-party content, storage growth, deletion policy).
2. **Real search metrics via Search Console / a keyword API** — would replace the current honest
   "no metric available" with actual data, and let opportunities be *ranked* rather than merely listed.
3. **Content-level coverage comparison** — embedding or full-text comparison would upgrade the
   title-match heuristic into a real coverage claim.
4. **Cross-tool competitor context** — a stored competitor corpus could inform the Content Brief,
   Topic Cluster Planner and Content Gap tools instead of each starting cold.
5. **Scheduled re-analysis** — periodic re-crawling to detect new competitor pages. Requires a
   crawl-budget and politeness policy before it would be responsible to build.

---

## 15. Status

| Item | State |
|---|---|
| Prisma enum `COMPETITOR_CONTENT_ANALYSIS` | Added |
| Migration `20260904213034_add_competitor_content_analysis_task_type` | Applied (one `ALTER TYPE … ADD VALUE` line) |
| Typecheck | Pass |
| Lint | 0 errors (1 pre-existing unrelated warning in `ReportForm.tsx`) |
| Build | Compiled successfully, route emitted |
| Tests | 118 files / 3095 passing |
| Topic Cluster Planner | Preserved, untouched |
| Commit | **Not authorized** |
| Push | **Not authorized** |
