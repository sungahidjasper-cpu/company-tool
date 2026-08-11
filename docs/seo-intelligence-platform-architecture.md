# SEO Intelligence Platform — Technical Architecture Proposal

**Status:** Proposal / not yet approved for implementation
**Author:** Prepared for Cloud Compass OS, following Phase 10 (SEO Workspace)
**Scope:** Research and architecture only — no code changes are included in or implied by this document

---

## 1. Executive summary

Phase 10 built the SEO Workspace as a CRUD system: a human enters SEOProjects, KeywordClusters, Keywords, and Content by hand. This proposal turns project creation into an automated research pipeline — a user enters a domain, and the system crawls the site, infers what the business does, generates seed keywords, pulls live metrics from an external keyword API, filters and clusters the results, scores each keyword's opportunity, and hands the user a curated shortlist to import — replacing the manual SEMrush/Ahrefs/DataForSEO CSV workflow SEO specialists currently do by hand.

**Recommendations at a glance:**

| Decision | Recommendation | Why (short) |
|---|---|---|
| Keyword data provider | **DataForSEO** | Only one of the four providers is architecturally built for resale inside a third-party SaaS; the other three restrict this in their Terms of Service (see §3). |
| Clustering approach | **Hybrid: embeddings + LLM refinement** | Pure LLM clustering doesn't scale in cost/latency across concurrent tenants; pure embeddings miss intent nuance. Hybrid keeps LLM usage at the cluster level, not the keyword level. |
| Crawl execution model | **Postgres-backed job table + polling worker** | Crawls run 30–120+ seconds — too long for a synchronous request, but the app has no existing job queue and doesn't yet need Redis/BullMQ-scale infrastructure. |
| Classification source | **Mostly internal logic, seeded by API + AI** | See the source matrix in §7 — no single source (API, AI, or internal rules) is a good fit for all six classification fields. |
| Phasing | **Split into three sub-phases (10.5a/b/c) before Phase 11** | The combined scope here is larger than Phase 10 itself; a single monolithic phase would be the largest and riskiest phase this project has attempted. |

---

## 2. Current state — what this builds on

Confirmed directly from the codebase before writing this proposal:

- **`features/seo/`** already has full CRUD for `SEOProject → KeywordCluster/Keyword/Content`, following the same `schemas/services/actions/components` layering as every other module (Companies, Projects, Reports).
- **`features/ai/`** exists but is an empty scaffold (`.gitkeep` files only) — no AI provider client, no SDK installed. The `/ai` page is a static "coming soon" placeholder.
- **`AIConversation`** is already modeled in `prisma/schema.prisma` (`companyId`, `userId`, `title`, `model`, `context: Json?`, `messages: Json?`) — schema was authored ahead of Phase 11, but nothing consumes it yet. Its own doc comment establishes the project's precedent: *store AI transcripts/context as JSON rather than a normalized child model, until per-row querying becomes a real requirement.* This proposal follows that same precedent for AI-analysis records (§11).
- **No background job infrastructure exists anywhere in the app** — no BullMQ, no Inngest, no cron package, no queue table. Every current server action is fully synchronous.
- **No AI/LLM SDK, no embeddings library, no HTML-parsing/crawling library** is installed (`openai`, `anthropic`, `langchain`, `cheerio`, `playwright`, `robots-parser`, `sitemapper` — none present in `package.json`).
- The existing CSV import pattern (`lib/csv.ts` + per-row zod validation + a `{created, errors}` summary, established in Phase 10 for Keyword/Content bulk import) is the closest existing precedent for "take a large, messy external list and let the user review/fix/import it" — the keyword-review-and-import step of this proposal reuses that shape rather than inventing a new one.

This means the AI Workspace (Phase 11) and this SEO Intelligence proposal are **both greenfield for AI/job infrastructure**. Building shared AI-provider and job-queue infrastructure once, here, and having Phase 11 reuse it, is more efficient than either module rolling its own — this is called out explicitly in §14.

---

## 3. Keyword data provider comparison

All four were researched for current (2026) pricing, limits, scalability, accuracy, and integration complexity. **The single most important finding is not a pricing or accuracy difference — it's a Terms of Service difference in whether the data can legally power a multi-tenant SaaS product's end customers at all.**

| | DataForSEO | SEMrush API | Ahrefs API | Google Ads API |
|---|---|---|---|---|
| **Built for resale to your end customers?** | **Yes — this is its core business model.** No resale restriction found. | **No.** ToS explicitly prohibits "sublicensing, reselling, or otherwise commercially exploiting" the data to third parties without written consent; caps caching at 1 month. | **Likely no.** Developer ToS restricts data to "End Users" defined as people holding their own paid Ahrefs seat — your customers wouldn't qualify. Unconfirmed directly with Ahrefs sales. | Ambiguous. Serving external users at scale requires "Standard" access tier, which imposes Required Minimum Functionality obligations (you must be a real advertising tool, not a pure data-resale layer). |
| **Pricing model** | Pay-as-you-go prepaid credits, **$50 minimum deposit**, credits don't expire. Keyword Labs research ≈ $1.10/10,000 keywords; SERP Live ≈ $2/1,000 queries. | Requires **Business plan (~$549/mo)** just to unlock API access, then separate unit purchases (~$50/1M units) on top. | Full API v3 access effectively requires Advanced/Enterprise app tier **plus** a separate API subscription (~$500–$2,000+/mo). Unit costs are base-50-per-call plus per-field costs. | **Free API**, but exact (non-bucketed) search volume requires an actively-spending Google Ads account — a real budget-affecting requirement, not a pricing tier. |
| **Rate limits** | 2,000 req/min (live); 30 concurrent on DB-backed endpoints. | 10 req/sec, 10 concurrent per IP. | ~60 req/min. | Token-bucket, unpublished; Basic tier capped at 15,000 ops/day. |
| **Accuracy** | Blends own crawl + clickstream + Google/Bing data. Mixed reviews vs. competitors, but not an outlier. | Decent; independent comparisons show volume discrepancies vs. others (as does every provider). | Strong reputation, large keyword database (~28.7B), clickstream-based. | The **ground-truth source** every other provider partially derives from — but known to overestimate without ad spend (broad-match aggregation). |
| **Keyword difficulty score** | Yes. | Yes. | Yes (Ahrefs KD, well-regarded). | **No** — only paid-ad `competition_index`, not organic difficulty. Would need pairing with another source regardless of ToS. |
| **Node/TS integration** | Official TS SDK + community package. Synchronous "live" endpoints — no polling needed for our on-demand use case. | No official Node SDK; unofficial packages are unmaintained. | No official Node SDK (Python only officially). | No official Node SDK; best option is a well-maintained unofficial package (`google-ads-api`). OAuth2 + developer token, more setup than a plain API key. |
| **Also useful for website analysis?** | On-Page API is technical-SEO-audit only, not business/topic classification — still need a custom crawler (§4). | Site Audit API — same limitation. | Site Explorer's "top pages" partially helps, but no topic classifier. | N/A. |

### Recommendation: DataForSEO, primary and sole provider for launch

The ToS finding is decisive on its own: SEMrush's and Ahrefs' consumer/agency terms are not written for "an app that pulls their data on behalf of many of its own paying customers who never see SEMrush or Ahrefs directly" — that is explicitly the situation this feature creates. Building the entire feature on a provider whose terms would need a bespoke commercial exception (not yet secured) is a launch risk, not just a cost line. DataForSEO's entire product design — "live" synchronous endpoints, pay-per-call pricing with no seat requirement, an explicit "build your own SEO tool" positioning — is the one built for exactly this shape of usage.

Google Ads API is not recommended as the *primary* source given the RMF/access-tier ambiguity and missing difficulty score, but is worth revisiting later as a **secondary volume-verification source** once usage justifies the Standard-access compliance work — DataForSEO itself blends Google Ads data under the hood, so this isn't blocking anything at launch.

---

## 4. Website analysis architecture

**Goal:** given a domain, automatically extract enough signal to infer business type, services, locations, and topics — without a human downloading anything.

### Pipeline

1. **Fetch `robots.txt`** — parse with a small, spec-compliant parser (the ecosystem's standard is stable but slow-moving; treat as a "boring, correct, low-maintenance" dependency, not a concern). Respect `Disallow`/`Crawl-delay` for every subsequent fetch.
2. **Fetch and parse `sitemap.xml`** (including nested sitemap-index files, common on larger sites) to enumerate candidate URLs. A well-maintained modern parser package should be selected over older "sitemap generator" packages that treat parsing as secondary.
3. **Select a sample, not the whole site**: homepage + up to ~8–10 top-level navigation pages + 3–5 sample blog/article pages (roughly 8–15 pages total). Research into LLM structured-extraction practice confirms this sample size is sufficient for confident business-category/services/location inference for a typical SMB site — crawling every page has diminishing returns and blows the time/cost budget.
4. **Fetch each sampled page** with a plain HTTP request first. Extract meta title/description, H1/H2 headings, and clean body text (stripped of nav/footer/ads) using a lightweight HTML-parsing approach — not a full browser.
5. **Headless-browser fallback (only when needed):** if extracted body text comes back near-empty while the page visibly should have content (a common signature of JS-rendered single-page apps), re-fetch that one page with a headless browser instead of defaulting to one for the whole crawl. This keeps the expensive path rare rather than the default.
6. **Politeness by design:** identify with an honest, descriptive User-Agent string; cap concurrency at 1–2 simultaneous requests per domain with a short delay between them; if a site returns a bot-challenge response (e.g., a Cloudflare interstitial), degrade gracefully — fewer pages analyzed, flagged to the user — rather than attempting to evade the block.
7. **Structured extraction via LLM:** concatenate the per-page titles/headings/body excerpts (summarizing per-page first if the combined text is large) and make **one** LLM call constrained to a fixed JSON schema (provider-native structured output / tool-calling — not "ask nicely for JSON and regex it out," which is no longer best practice) to produce: business category, services/products, target locations, and primary topics. Validate the response against the app's existing zod-schema convention before persisting.

### Execution model: a Postgres-backed job table, not a queue product

A crawl realistically takes 30–120+ seconds. That's beyond a safe synchronous Next.js request, but this app has zero existing background-job infrastructure, and the actual scale (one crawl per new SEO Project, not thousands of concurrent crawls) doesn't justify introducing Redis and a queue product on day one.

The pragmatic fit: a `WebsiteAnalysisJob` row (see §11) created in the same request that starts the wizard, with `status: PENDING → RUNNING → SUCCEEDED/FAILED`, `progress` and `resultJson` columns. A lightweight polling worker processes queued rows (an approach with well-established prior art for "just use Postgres" job queues, avoiding new infrastructure). The wizard UI polls the job's status the same way any Server Component page already re-fetches on `revalidatePath`, just on a short interval instead of a user action. If usage later grows well past "one analysis per project creation," this table's shape upgrades cleanly to a managed step-based runner rather than requiring a rewrite — but that's a future decision, not a launch requirement.

---

## 5. Intelligent keyword suggestion generation

Manual seed-keyword entry is replaced with automatic generation from the same website-analysis output (§4), not a separate step:

- **From detected services/products** — each detected offering becomes 1–3 seed phrases directly (a service name is very close to a commercial-intent seed keyword already).
- **From page titles and headings** — titles/H1s across the crawled sample are a strong signal of what the business already believes its own topics are.
- **From detected locations** — combined with services to produce local-intent seeds ("service + location") — the single highest-value pattern for local-business SEO that a manual specialist would build by hand anyway.
- **From an AI pass over the aggregated analysis** — one additional LLM call, given the structured business summary from §4, asked to propose seed topics a specialist might miss (adjacent services, common customer questions) — kept as a distinct, clearly-labeled source so the user can tell "detected from your site" apart from "AI-suggested" in the review step.

The user can still add seed keywords manually at the review step (§10, wizard step 4) — this is additive to the automatic list, never a replacement requirement.

---

## 6. Automatic keyword filtering engine

A **reusable, configurable rule set** — not a one-off filter bolted onto the wizard — modeled as data (a `KeywordFilterPreset`, §11), so the same engine runs during the wizard and, later, as a standalone "clean up this keyword list" tool elsewhere in the SEO Workspace.

**Supported rule types**, all combinable and all optional:

| Rule | Behavior |
|---|---|
| Minimum search volume | Drop keywords below a threshold |
| Maximum keyword difficulty | Drop keywords above a threshold |
| Language / country | Keep only metrics matching the target locale (DataForSEO scopes queries by language+location already, so this is largely a query-time parameter, not just a post-filter) |
| Include / exclude intent | Keep or drop by classified `KeywordIntent` (reuses the enum already added in Phase 10) |
| Include / exclude words | Substring/token allow-list and block-list |
| Remove duplicates | Case-insensitive, whitespace-normalized dedupe — the same normalization already used by Phase 10's CSV-import cluster-matching |
| Remove branded/competitor terms | Match against a user-maintained brand/competitor term list (a small new lookup, not a licensed database) |
| Remove irrelevant phrases | A relevance-to-topic check — this one is a judgment call, not a hard rule; recommend implementing it as a *scored* filter (drop below a relevance threshold) computed during clustering (§8), not a separate standalone rule, since "irrelevant" only means something in relation to the site's actual topics |

**Presets are reusable and company-scoped**, not project-scoped — so a specialist who's tuned good defaults for one client's industry doesn't re-configure them for the next project.

---

## 7. Keyword classification — where should each value come from?

The user asked for six classification fields. Not all should come from the same place — the table below is the key design decision this section makes:

| Field | Recommended source | Why |
|---|---|---|
| **Search intent** | API first, AI fallback | DataForSEO and most providers already return an intent classification with keyword metrics — use it directly; only fall back to a lightweight AI/heuristic classification for keywords the API leaves unclassified. |
| **Funnel stage** | Internal logic, derived from intent | Funnel stage (TOFU/MOFU/BOFU) is a fairly mechanical mapping from intent + a few modifier-word heuristics ("best," "buy," "vs," "how to") — no need to pay for an AI or API call for this. |
| **Priority** | Internal logic, derived from opportunity score | Reuses the `Priority` enum already on `Keyword` from Phase 10 — bucket the computed opportunity score (§9) into LOW/MEDIUM/HIGH/URGENT rather than asking the user or an AI to set it per keyword. |
| **Opportunity score** | Internal logic (custom algorithm) | This is exactly why §9 designs a formula instead of trusting a third party's own "opportunity" number, which won't be tuned to this platform's priorities (e.g., local-business relevance) and won't be consistent across providers if the provider is ever changed. |
| **Keyword cluster** | Hybrid AI (embeddings + LLM), per §8 | Needs semantic judgment a fixed rule can't provide. |
| **Parent topic** | Derived from cluster, not classified independently | Once clustering (§8) exists, "parent topic" is just the cluster's representative label — a second independent classification step here would be redundant work solving an already-solved problem. |

The overall shape: **lean on the API only for what it's authoritative on (intent, raw metrics); do everything derived from those in internal logic; reserve AI for the one problem — semantic clustering — that genuinely needs it.** This keeps AI/LLM cost and latency proportional to real need rather than becoming the default hammer for every field.

---

## 8. AI clustering approach

Four approaches were compared (embedding similarity, LLM-based, provider-native SERP-overlap clustering, and hybrid). Full tradeoffs in the research; the operative differences:

- **Embedding similarity** is fast, cheap (roughly $0.01–$0.13 per 1,000 keywords at API-embedding pricing, or free with a local model), and trivially parallelizable across tenants — but purely lexical/semantic similarity occasionally misses cases where Google's actual search results treat two similarly-worded phrases as different intents (or vice versa).
- **Pure LLM clustering** (handing the whole keyword list to an LLM and asking it to group them) is the most context-aware but does not scale: context-window limits force batching, batching produces inconsistent/duplicate clusters across batches, and cost/latency (roughly $1–$10+ per 1,000 keywords) make it impractical as the primary method under concurrent multi-tenant load.
- **Provider-native SERP-overlap clustering** (checking whether two keywords' top-ranking URLs actually overlap) is the most accurate signal, because it reflects what Google itself has already decided — but running it for every keyword for every project is a live SERP call per keyword, which is both slow and the most expensive tier of DataForSEO pricing. Best reserved as a spot-check on high-value clusters, not the default path.

### Recommendation: hybrid, embeddings-first with sparse LLM refinement

1. Embed the filtered keyword list (local or API-based embedding model — a build-time choice, not an architectural one) and cluster with a density-based or agglomerative method.
2. Send only the small number of **cluster centroids and borderline pairs** — not every keyword — to one LLM call per project to name each cluster, merge obvious near-duplicate clusters, and flag mixed-intent clusters for a split.
3. Treat SERP-overlap validation (the provider-native approach) as an optional, later "verify this cluster" action a user can trigger on a specific cluster they're unsure about, not a step that runs automatically for every keyword.

This keeps the expensive resource (LLM calls) scoped to "a handful of calls per project," not "a call per keyword," which is what makes it viable under concurrent multi-tenant load — the same cost-shape reasoning already applied in §7.

---

## 9. Opportunity Score — algorithm design (not implemented here)

Per the request, this is a design, not code. Public scoring approaches converge on a **weighted, normalized multi-factor model**, not a single ratio — because raw metrics live on incompatible scales (volume in the thousands, difficulty 0–100, CPC in dollars) and naive ratios over-favor whichever metric happens to have the largest numbers (almost always search volume).

**Recommended design:**

1. **Normalize every input factor to a common 0–1 scale before combining anything** — log-scale search volume (raw volume is extremely right-skewed; a linear scale lets a handful of head terms dominate every score), min-max or inverse-scale difficulty, and similarly normalize CPC and trend.
2. **Combine normalized factors as a weighted sum**, with default weights the platform ships with but a company can tune (mirroring the filter-preset reusability principle in §6):
   - Search volume (normalized/log-scaled) — moderate weight
   - Inverse keyword difficulty — moderate weight
   - CPC (as a commercial-value proxy) — light weight
   - Intent-match weight — a multiplier or bonus, not a raw additive factor, so an informational keyword doesn't rank above a commercial one purely on volume
   - Trend (rising/flat/falling, when available) — light weight, directional bonus for rising terms
   - Competition (SERP competition, where available) — light negative weight
   - *Current rankings* — explicitly called out by the user as **future**: reserve a factor slot for "already ranking 11–20 = quick-win bonus" once the platform tracks rank history, but the score must be well-defined without it at launch (default to neutral/no bonus when rank data doesn't exist yet).
3. **Bucket the final score into the existing `Priority` enum** (LOW/MEDIUM/HIGH/URGENT) for the classification use in §7, while still storing the raw numeric score for sorting/filtering.
4. **Document the weights as configuration, not constants buried in code** — this is what will let a future "why was this keyword scored this way" explanation feature (a natural companion to the AI Workspace) actually explain the number instead of treating it as a black box.

**Known pitfalls to design around** (from the research): don't let unnormalized volume dominate; don't treat CPC as pure opportunity when it's also a competition signal; don't score an informational keyword the same as a commercial one just because intent isn't a factor.

---

## 10. Content planning integration

The Content entity already exists (Phase 10) with `title`, `url`, `status`, `keywords: Keyword[]` (a real many-to-many). This proposal doesn't need a new content-planning entity — it needs a **generation step that proposes new Content rows**, pre-linked to the keywords that justify them, for the user to accept or discard:

- **Landing page recommendation**: one high-commercial-intent cluster with strong opportunity scores → one proposed Content row (status `DRAFT`), title suggested from the cluster's parent topic, pre-linked to that cluster's top keywords.
- **Supporting article recommendations**: informational/TOFU keywords within a cluster that a landing page wouldn't naturally target → proposed as separate Content rows, positioned as internal-linking support for the landing page.
- **Topic cluster → hub-and-spoke mapping**: each `KeywordCluster` becomes a candidate "hub" (the landing page) with its lower-intent sibling keywords as "spokes" (supporting articles) — this is a presentation of clustering output, not a new schema concept, and reuses `KeywordCluster` exactly as Phase 10 defined it.

None of this requires the user to accept every suggestion — proposed Content rows are created as normal `DRAFT` rows through the *existing* `createContent` action; nothing about content creation itself changes.

---

## 11. Database (Prisma) schema changes

All additive — no existing column removed or retyped, matching the additive-only discipline every prior phase has followed. Presented as field tables, not schema syntax, per the "no code" instruction.

**New model: `WebsiteAnalysisJob`** (backs the crawl, §4)

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| seoProjectId | uuid, nullable | Nullable because analysis can start *before* the SEOProject is created (the wizard analyzes a domain before the project formally exists) |
| companyId | uuid | Tenant scope, set at job creation |
| domain | string | The analyzed URL/domain |
| status | enum | PENDING / RUNNING / SUCCEEDED / FAILED |
| progress | int, nullable | 0–100, for the wizard's polling UI |
| resultJson | json, nullable | Structured output from §4 step 7 — business category, services, locations, topics, crawled-page summaries. Stored as JSON rather than a normalized model, following the same precedent `AIConversation.context` already set in this schema. |
| errorMessage | string, nullable | |
| createdAt / updatedAt | timestamps | |

**New model: `KeywordFilterPreset`** (backs §6)

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| companyId | uuid | Company-scoped, not project-scoped — reusable across projects |
| name | string | |
| rulesJson | json | The rule set itself — same "structured-but-flexible JSON, not one column per rule" reasoning as above, since new rule types will be added over time |
| createdAt / updatedAt | timestamps | |

**`Keyword` model — additive fields** (extends the Phase 10 model, doesn't touch existing ones)

| Field | Type | Notes |
|---|---|---|
| opportunityScore | float, nullable | Output of §9; nullable until scored |
| funnelStage | enum, nullable | New enum: TOFU / MOFU / BOFU |
| parentTopic | string, nullable | Denormalized cluster label copy for fast display without a join; source of truth stays the cluster |
| source | enum, nullable | New enum: MANUAL / SUGGESTED / IMPORTED — lets the UI distinguish "you typed this" from "the system suggested this," which §5 requires |
| trend | enum, nullable | New enum: RISING / STABLE / FALLING, when the provider supplies it |

**`KeywordCluster` model — additive field**

| Field | Type | Notes |
|---|---|---|
| aiGenerated | boolean, default false | Distinguishes clusters from the AI pipeline (§8) from manually-created clusters (Phase 10's existing manual cluster CRUD is unaffected and keeps working exactly as-is) |

**`Content` model — additive field**

| Field | Type | Notes |
|---|---|---|
| contentType | enum, nullable | New enum: LANDING_PAGE / SUPPORTING_ARTICLE / OTHER — backs §10's hub-and-spoke distinction without a new entity |

No changes are proposed to `SEOProject`, `File`, `Note`, `Activity`, or `Report` — the existing polymorphic-attachment and activity-logging plumbing Phase 10 built already covers every new entity here through the same `seoProjectId`/`contentId` foreign keys.

---

## 12. Service layer & folder structure

**Recommendation: extend `features/seo/`, do not create a parallel `features/seo-intelligence/`.** This is genuinely an extension of the same domain (an SEOProject either has intelligence-pipeline data or doesn't — it's not a separate bounded context), and splitting it would force cross-feature imports for things as basic as "does this project have a cluster." New subfolders inside the existing structure, following the estabished `schemas/services/actions/components` layering:

```
features/seo/
  schemas/
    website-analysis.schema.ts       (crawl result + LLM extraction output shape)
    keyword-filter-preset.schema.ts
    keyword-suggestion.schema.ts     (source-tagged: MANUAL/SUGGESTED/IMPORTED)
  services/
    website-crawler.service.ts       (fetch/parse pipeline, §4 steps 1–5)
    website-analysis.service.ts      (orchestrates crawl → LLM extraction → job status)
    keyword-provider.service.ts      (thin DataForSEO client wrapper — the one place a
                                       provider swap would be made, per §3's "revisit later")
    keyword-suggestion.service.ts    (§5)
    keyword-filter.service.ts        (§6, the reusable rule engine)
    keyword-clustering.service.ts    (§8, embeddings + LLM refinement)
    opportunity-score.service.ts     (§9)
    content-planning.service.ts      (§10)
  actions/
    website-analysis.actions.ts      (start/poll a WebsiteAnalysisJob)
    keyword-research.actions.ts      (wizard steps: suggest → fetch metrics → filter → cluster → score)
    keyword-filter-preset.actions.ts (CRUD for reusable presets)
  components/
    wizard/                          (§13's multi-step flow, one component per step)
      SeoProjectWizard.tsx
      steps/DomainStep.tsx
      steps/AnalysisReviewStep.tsx
      steps/KeywordSuggestionsStep.tsx
      steps/FilterStep.tsx
      steps/ClusterReviewStep.tsx
      steps/OpportunityReviewStep.tsx
      steps/ImportStep.tsx
```

**New shared infrastructure** (used by this feature *and* the future AI Workspace — see §14), living outside `features/seo/` since it's genuinely cross-cutting:

```
lib/ai/
  client.ts             (the single AI-provider client — one place an SDK gets wired in)
  structured-output.ts  (schema-constrained generation helper, wraps §4 step 7 and §8 step 2)
lib/jobs/
  job-table.ts           (generic polling-job helpers, backing WebsiteAnalysisJob and any
                          future job row — not SEO-specific)
```

This mirrors how `lib/csv.ts` was pulled out of `features/reports/` in Phase 10 once a second feature needed it — `lib/ai/` and `lib/jobs/` exist from day one *because we already know* Phase 11 will need them, rather than waiting to extract them later.

---

## 13. UI/UX — the SEO Project creation wizard

Replaces the current single-page `/seo/new` form with a multi-step flow. Existing detail/list pages (`/seo/[id]`, `/seo/[id]/keywords`, etc.) are **unchanged** — the wizard is a new *front door* into project creation, not a replacement for anything that already works.

| Step | What happens | Backing service |
|---|---|---|
| 1. Domain | User enters the website URL. Minimal form, same validation conventions as every existing form. | — |
| 2. Analyze | A `WebsiteAnalysisJob` is created and the wizard polls it (§4's execution model) with a progress indicator. | `website-analysis.service.ts` |
| 3. Review business info | Detected business category/services/locations/topics shown as editable fields — the user corrects anything the AI got wrong before it feeds the next step. | (reads the job's `resultJson`) |
| 4. Keyword suggestions | Auto-generated seed keywords shown, grouped by source (from-content / from-AI); user can add manual seeds. | `keyword-suggestion.service.ts` |
| 5. Apply filters | The reusable filter engine (§6) runs against live keyword metrics fetched for the seeds; user can adjust a preset or one-off rules and re-run. | `keyword-provider.service.ts` + `keyword-filter.service.ts` |
| 6. Review clusters | Filtered keywords shown pre-grouped into clusters (§8) with AI-suggested names; user can rename/merge/split before committing. | `keyword-clustering.service.ts` |
| 7. Review opportunity scores | Each keyword/cluster shown with its computed score (§9) and priority bucket; sortable/filterable, same list-table interaction pattern as Phase 10's `KeywordListTable`. | `opportunity-score.service.ts` |
| 8. Select & import | Checkbox multi-select (reusing Phase 10's `BulkActionsBar` selection pattern) over the reviewed list; only checked keywords get created. | Existing `createKeyword`/bulk-create actions |
| 9. Create SEO Project | The SEOProject row is finally created (or, if the wizard started from an existing project, the import attaches to it), selected keywords are created pre-clustered/pre-scored, and suggested Content rows (§10) are proposed on the resulting detail page. | Existing `createSeoProject` action, extended |

A user who wants the old behavior — just create an empty project and add keywords by hand later — keeps that option; the wizard doesn't remove Phase 10's manual CRUD paths, it adds an automated path alongside them.

---

## 14. Future AI Workspace (Phase 11) integration points

Building this proposal first, rather than after Phase 11, sets Phase 11 up rather than competing with it:

- **`lib/ai/client.ts`** (§12) becomes the one AI-provider integration point in the whole app — Phase 11's chat/assistant features consume the same client instead of each feature wiring its own SDK usage.
- **`AIConversation`**, already modeled in the schema, is a natural home for logging the LLM calls this proposal makes (structured extraction, cluster naming) as an audit trail — reusing it rather than inventing a parallel "AI call log" concept.
- **`lib/jobs/`** (§12) is the first background-job infrastructure in the app; anything Phase 11 needs that's slower than a request/response (bulk analysis across many conversations, scheduled digests) has a pattern to extend rather than a blank page.
- The wizard's "AI got this wrong, let me correct it" review steps (§13, steps 3/6) are a template for any future AI Workspace feature that also needs a human-in-the-loop correction UI, rather than each feature designing its own.

---

## 15. Implementation phases, complexity, and risk

| Sub-phase | Scope | Complexity | Primary risk |
|---|---|---|---|
| **10.5a — Foundation** | `lib/ai/`, `lib/jobs/`, DataForSEO client wrapper, website crawler + LLM extraction, `WebsiteAnalysisJob`. No wizard UI yet — verify the pipeline via a simple internal test page. | **High** — first AI SDK integration, first background-job infra, first external paid API integration in the app, all at once. | External API cost surprises during development; crawler edge cases (bot-blocked sites, malformed sitemaps) are numerous and hard to fully enumerate up front. |
| **10.5b — Intelligence layer** | Keyword suggestion generation, filter engine + presets, embeddings + LLM clustering, opportunity scoring. Built and tested against 10.5a's output, still no wizard UI. | **High** — the clustering/scoring logic is the most conceptually novel part of the whole proposal and the hardest to validate without real usage data. | Score/cluster quality is subjective — "is this a good score" has no unit test; needs real trial projects and human judgment before trusting defaults. |
| **10.5c — Wizard & content planning** | The 9-step wizard UI, wiring 10.5a/b into it, Content-suggestion generation, schema fields on `Keyword`/`KeywordCluster`/`Content`. | **Medium** — mostly UI/orchestration over already-proven services, plus the additive schema migration. | Wizard state management across 9 steps (partial completion, going back to edit an earlier step and re-running downstream steps) is the main new UI complexity this codebase hasn't dealt with before. |

**Overall risk note:** this is not a "just add another CRUD module" phase like Reports or SEO Workspace itself — it introduces three genuinely new categories of infrastructure (external paid API dependency, AI/LLM calls, background jobs) that the rest of the app doesn't have yet. Treating it as one phase would be the single largest and riskiest phase attempted so far; splitting it, as recommended, lets 10.5a be fully verified (lint/typecheck/build/live-test, same discipline as every prior phase) before any UI is built on top of it, and lets 10.5b's scoring/clustering quality be judged against real data before the wizard locks in a UX around it.

---

## 16. Recommended order of implementation

1. **10.5a → 10.5b → 10.5c, strictly in that order.** Each is a real dependency of the next, not just a convenient split — 10.5b needs 10.5a's crawler/API output to test against; 10.5c needs 10.5b's scoring/clustering to have something worth reviewing in a wizard.
2. Within 10.5a specifically: build the DataForSEO client wrapper and prove it against a handful of real domains **before** building the crawler — confirming the provider integration works removes the riskiest external dependency first.
3. Within 10.5b: build opportunity scoring before clustering — scoring is well-defined math with no subjective "does this look right" step, while clustering quality needs to be eyeballed against real keyword sets, so get the objective piece done and out of the way first.
4. Defer the Google Ads API secondary-verification idea (§3) and the SERP-overlap cluster-validation idea (§8) entirely — both are explicitly called out above as "later," not part of any of the three sub-phases.

---

## 17. Phase-numbering recommendation

**Split into Phase 10.5a, 10.5b, and 10.5c — do not attempt this as a single Phase 10.5, and do not fold it into Phase 11.**

Reasoning:

- Calling it "Phase 11" would misrepresent what Phase 11 was scoped as (AI Workspace) and would delay AI Workspace indefinitely behind a much larger piece of work — the user's own framing already treats these as separate initiatives, and the codebase evidence (Phase 11's `features/ai/` scaffold and `AIConversation` model sitting ready and unused) suggests AI Workspace was always intended to follow shortly after SEO Workspace, not absorb an unrelated research platform first.
- A single "Phase 10.5" covering all of §4–§13 at once would be, by a wide margin, the largest phase this project has attempted — larger than Reports and SEO Workspace's Phase 10 amendment combined, per §15's complexity assessment — and would be the first phase to introduce three new infrastructure categories simultaneously with no intermediate verification point.
- The three-way split gives each sub-phase the same "implement → lint/typecheck/build → live-verify → sign off" checkpoint discipline every phase from 7 onward has used, rather than deferring all verification to the very end of a much larger effort.

After 10.5c ships and is verified, Phase 11 (AI Workspace) proceeds as originally planned — and starts from a real advantage, since 10.5a will already have built the shared `lib/ai/client.ts` and `lib/jobs/` infrastructure Phase 11 would otherwise have had to build from scratch itself.
