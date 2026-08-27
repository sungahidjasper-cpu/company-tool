# AI Platform Roadmap (Phases 18–30)

Tracks the roadmap produced by the post-Phase-17 architectural review of the AI Workspace and surrounding AI infrastructure. That review covered current architecture, technical debt, production readiness, multi-provider strategy, observability, and scalability, and proposed Phases 18–25 below. Phases 18 and 19 were flagged as essential before a real multi-tenant launch; this file is the persistent tracker for status as each phase ships (the review itself was delivered as a point-in-time analysis, not saved as a file).

Phases 26–29 fall outside that original architectural review's scope — they were later, separately-driven phases (record lifecycle, trash/recovery, company/user visibility, search, and test-coverage backfill) that this file has been extended to also track, since they shipped using the same phase-numbered convention. Phase 30 is a future placeholder, not yet scoped or approved.

Note: as actually delivered, Phase 21 diverged from this roadmap's original "Enhanced Observability" placeholder — it shipped instead as *Configurable Content Brief & Long-Form Draft Generation* (see below). Enhanced Observability was not part of what shipped under that name and remains unscoped. Phase 22 ("Streaming") matched its original placeholder.

| Phase | Name | Priority | Status |
|---|---|---|---|
| 18 | Background Job Architecture for AI Generation | Essential | **Complete** — `6756ddb` |
| 19 | Per-Company AI Cost Controls & Rate Limiting | Essential | **Complete** — `0dda410` |
| 20 | Multi-Provider Production Readiness | High | **Complete, committed & pushed** — `420d806` |
| 21 | Configurable Content Brief & Long-Form Draft Generation (renamed from "Enhanced Observability" — see note above) | High | **Complete, committed & pushed** — `e582f87`. Post-ship content-quality fixes: see [phase-21-content-quality-fixes.md](phase-21-content-quality-fixes.md) |
| 22 | Streaming | Medium | **Complete, committed & pushed** — Stages 1–4: `2d4d2d2`, `0ce088a`, `270566b`, `b5e104b` |
| 23 | UX Maturation | Medium | **Complete, committed & pushed** — Stages 1–5: `f311ab8`, `d5b7b43`, `207ec67`, `cc3c79a`, `5b0c998` |
| 24 | Publishing / Distribution | Low | **Complete, committed & pushed** — Stages 1–2 + hardening: `a115450`, `857453f`, `25551a0` |
| 25 | Version History | Low | **Complete, committed & pushed** — Stages 1–4: `c571f96`, `2fc7b23` |
| 26 | Record Lifecycle Consistency | — | **Complete, committed & pushed** — `60cc43e` |
| 27 | Trash and Recovery System | — | **Complete, committed & pushed** — `75f741a` |
| 28 | Company/User Lifecycle Visibility | — | **Complete, committed & pushed** — `2fe6c00` |
| 29 | Global Search + Action-Layer Test Coverage | — | **Complete, committed & pushed** — closing commit `78caeda` |
| 30 | Native AI Engine | Future | **Not started — unscoped placeholder** (see below) |

## Phase 18 — Background Job Architecture for AI Generation

Content Brief and Long-Form generation moved from fully-synchronous (blocking one HTTP request for the whole AI call, including Phase 17's retry) to a job-row-plus-fire-and-forget pattern, mirroring Website Analysis's proven `WebsiteAnalysisJob` architecture. New `AiGenerationJob` model, `setInterval` polling UI, startup reaper, and an `inputHash`-based duplicate-prevention check beyond a literal port of the source pattern.

## Phase 19 — Per-Company AI Cost Controls & Rate Limiting

Added a per-company monthly USD budget cap (Postgres-backed) and a per-minute request rate limit (in-memory), enforced by one `lib/ai/ai-limit.service.ts` gate at the top of `generateStructuredOutput()`, before any provider is contacted. SUPER_ADMIN-only configuration surface, separate from the shared company-edit form. Every existing company is unaffected until explicitly configured.

## Phase 20 — Multi-Provider Production Readiness

Closed the Anthropic hardcoded-model gap (`ANTHROPIC_MODEL` is now env-configurable, matching every other provider); extended `pricing.ts`'s per-model tables with context windows for Gemini/OpenAI/Anthropic so `maxContext()` follows whatever model is actually configured instead of a static constant; added a new `MODEL_UNAVAILABLE` error type (fallback-worthy, unlike `INVALID_REQUEST`) so a deprecated/unknown model on one provider correctly falls back to the next rather than failing outright; populated `.env.example` with every env var the app reads; added startup-time validation for `LLM_PROVIDER_ORDER` typos and unrecognized configured models (warnings, never blocks); folded in a missing page-level permission gate on the AI Workspace content-brief pages and documented the existing prompt-injection risk-acceptance rationale.

Live-verified with two real, live providers: Gemini's key was deliberately invalidated, and a real generation request genuinely fell back to a locally-installed Ollama instance (`llama3.2:1b`) and completed successfully — confirmed via the `AiUsageLog` audit trail (a failed `gemini`/`AUTHENTICATION_ERROR` row followed by a succeeded `ollama` row). Also preceded by a full architecture review (Project vs. SEOProject data-source question, AI-tool infrastructure-sharing audit, UI/performance/security audit) that found no blockers for this phase and surfaced several pre-existing, out-of-scope backlog items tracked separately.

## Phase 21 — Configurable Content Brief & Long-Form Draft Generation

Made the previously fixed-shape Content Brief / Long-Form generation fully configurable per request: word-count target, reading level, brand voice, outline structure (H2/H3 counts, comparison table/checklist/numbered-process/pros-cons toggles), FAQ count/style, per-section toggles (FAQ, conclusion, CTA, key takeaways, internal links, external sources, schema suggestions, statistics, examples), quality controls (EEAT, featured-snippet/AI-overview/GEO/AEO/semantic-SEO optimization), and draft options (image placeholders, alt text, featured-image prompt, social snippets, excerpt). `ContentBriefSettings` schema plus `buildContentBriefOutputSchema`/`buildLongFormOutputSchema` narrow the AI structured-output schema to exactly what's enabled per request. A CTA trust boundary was established: the model is only ever asked to suggest CTA *placement*, never CTA copy — the user's literal CTA fields are spliced in deterministically by `formatLongFormContentAsMarkdown`/`formatCtaBlock`, never by the AI.

Committed and pushed as `e582f87`. Live testing after ship surfaced content-quality defects in the generated output (short articles, metadata leaking configuration values, factual/structural issues) — tracked and largely fixed across two follow-up rounds, documented in full in [phase-21-content-quality-fixes.md](phase-21-content-quality-fixes.md). **One defect remains open going into the next session**: a severe form of prompt-instruction text leaking into the `metaTitle` field, found during Round 3 live verification — see that doc's "Round 4 (not started)" section for the exact repro and constraints.

## Phase 22 — Streaming (Complete)

Stage 1 added live SSE-based streaming preview of in-progress AI generation, without touching the production non-streaming path (`generateStructuredOutput`) at all — a fully parallel `generateStructuredOutputStreaming` orchestrator plus a new self-contained, DB-polling SSE route (`app/api/ai-workspace/jobs/[jobId]/stream/route.ts`) with zero in-process shared state, so it's correct regardless of server process topology. Gated behind `AI_STREAMING_ENABLED`; the client always attempts `EventSource` and silently no-ops if streaming is off or the route 404s. The existing 3-second polling loop remains the only path that ever detects terminal job state — streaming is purely a presentation layer on top of it. `AiGenerationJob` gained a `partialResultText` column (ephemeral, reset before any retry/fallback) and a genuinely-used `progress` field.

Live-verified with real Gemini streaming and a real Ollama fallback mid-stream; SSE auth, cross-tenant isolation, terminal-state closure, and client disconnect were all independently verified. Committed and pushed as `2d4d2d2`.

Stage 2 closed the remaining provider gap: `generateRawStreaming` was added to `openai.provider.ts`, `openrouter.provider.ts`, and `ollama.provider.ts` (which previously only had the non-streaming `generateRaw`), bringing every configured provider to streaming parity with Anthropic and Gemini from Stage 1. Live-verified with real OpenRouter and Ollama generations, a Gemini regression check, and a genuine organic Gemini→OpenRouter fallback captured mid-stream. Committed and pushed as `0ce088a`.

Stage 3 added a field-level live preview beneath the existing character/progress indicator: a schema-agnostic, structural-boundary JSON parser (`partial-json-preview.service.ts`) that safely exposes already-complete top-level fields — and already-complete elements of top-level arrays such as `sections`/`faq` — from the still-accumulating streamed text, never repairing or guessing an incomplete value. Wired into `ContentBriefPicker.tsx` and `ExistingBriefLongFormGenerator.tsx`, cleared on stream open/reset/close exactly like the existing indicator; strictly cosmetic and never a source of truth for the saved result. Live-verified across Gemini, OpenRouter, and Ollama, including a genuine mid-stream provider fallback with correct preview reset. Committed and pushed as `270566b`.

Stage 4 closed the one remaining test-coverage gap: `anthropic.provider.ts` and `gemini.provider.ts` had implemented `generateRawStreaming` since Stage 1 but had no dedicated unit tests, unlike the coverage Stage 2 added for the other three providers. New `anthropic.provider.test.ts` / `gemini.provider.test.ts` mirror those same test patterns against each provider's real event shape (Anthropic's snapshot-based `MessageStream.on("text")`, Gemini's delta-accumulated async generator), verified directly against the installed SDK types rather than assumed. Committed and pushed as `b5e104b`.

All five providers (Anthropic, Gemini, OpenAI, OpenRouter, Ollama) now implement `generateRawStreaming` with dedicated unit test coverage, and the client-side field-level preview is live-verified across every configured provider. Phase 22 is complete.

## Phase 23 — UX Maturation (Complete)

Stage 1 restored streaming-status and field-preview visibility across the AI Workspace's job-based generation/regeneration entry points — the Phase 22 streaming indicators only rendered in each component's pre-result branch, so a result already being on screen (regenerating a brief, or generating/regenerating long-form content) silently lost that feedback even though the same streaming-capable functions were still running. Committed and pushed as `f311ab8`.

Stage 2 added structured LLM job-failure presentation using the existing `errorType`/`describeLlmError` taxonomy already used by Website Analysis, showing a title/message/recommended-action block when a failed job's `errorType` is known, while preserving the original flat-error string as the fallback when it isn't. Committed and pushed as `d5b7b43`.

Stage 3 added a real generation progress bar (`components/ui/progress.tsx`) driven by the existing, already-computed `streamProgress` value — never a fabricated percentage — with lifecycle behavior verified to match the existing status text exactly, after live testing caught and fixed a brief bar/text desync. Committed and pushed as `207ec67`.

Stage 4 broadened the Recent Generations widget to show both `CONTENT_BRIEF` and `CONTENT_DRAFT` activity instead of briefs only, while explicitly preventing Website Analysis's own task types (which share the same `AiUsageLog` table) from leaking into the AI Workspace view. Committed and pushed as `cc3c79a`.

Stage 5 closed the two remaining polish items found during final audit: an accessible name on the Stage 3 progress bar, and a visible in-progress affordance for per-field regeneration (previously only a button-label change). Committed and pushed as `5b0c998`.

All five stages were delivered as presentation-only changes to five AI Workspace component files, without reopening the protected AI-generation architecture (`lib/ai/`, the SSE route, the job runner/table), the Prisma schema, the shared `ActionResult`/`actionError` layer, or the Website Analysis implementation. Phase 23 is complete.

## Phase 24 — Publishing / Distribution (Complete)

What it delivered, in plain terms: a way to connect the platform to external publishing destinations and push generated content out to them, instead of content only ever living inside Cloud Compass OS. Stage 1 added connection management (linking, listing, relabeling, and disconnecting destinations). Stage 2 completed the actual publishing workflow. A follow-up hardening pass improved error handling around persisting a publication, so a failure partway through doesn't leave things in a confusing state.

Why it mattered: generating good content is only half the value — teams need it to actually reach the place it's meant to be published, without a manual copy-paste step.

Committed and pushed as `a115450` (Stage 1), `857453f` (Stage 2), `25551a0` (hardening).

## Phase 25 — Version History (Complete)

What it delivered: every time a piece of Content is edited — by a person, by AI regeneration, or via an explicit restore — the system now snapshots the prior title/meta title/meta description/body before the overwrite happens, via a new `ContentRevision` model. Users get a Version History view on the Content detail page showing every past revision (who changed it, when, and how), with a one-click Restore that itself snapshots the pre-restore state first, so restoring is never a one-way door. Revision numbering stays correct even under concurrent edits.

Why it mattered: AI-assisted content editing makes it easy to overwrite something good with something worse; without version history there was no way back.

Committed and pushed as `c571f96` (the revision model, snapshot wiring, and restore action) and `2fc7b23` (the Version History UI).

## Phases 26–29

Four phases that, together, brought record lifecycle handling (archive, delete, restore) and everyday visibility features up to a consistent standard across the whole app.

### Phase 26 — Record Lifecycle Consistency (Complete)

Fixed an edge case where bulk-deleting Content could fail entirely if even one item in the batch had version history protecting it — now those items are safely skipped instead of blocking the whole batch. Switched File deletion from permanent removal to soft-delete, so a deleted file isn't unrecoverably gone. Added the ability for a note's author (or a manager) to edit or delete a note they'd left on a Lead, Project, Client, SEO Project, piece of Content, or Task — consistently, across all six.

Committed and pushed as `60cc43e`.

### Phase 27 — Trash and Recovery System (Complete)

Added a centralized Trash page giving Content, Keywords, Files, and Notes a real, visible place to recover something that was deleted — Files and Notes previously had no restore path at all once removed, even after Phase 26 made their deletion "soft." Also improved the permanent-delete confirmation for Content and Keywords to show an accurate preview of exactly what will be lost (notes, files, activity history) before the user commits, correctly protecting anything with version history from being purged.

Committed and pushed as `75f741a`.

### Phase 28 — Company/User Lifecycle Visibility (Complete)

Brought the Company and User detail pages up to the same standard as the rest of the app: Companies gained an Archive/Restore control, and both Companies and Users gained an Activity Timeline showing what's happened on that record over time. Also standardized the wording used when confirming a permanent delete, so it reads consistently across Content, Keywords, and Trash.

Committed and pushed as `2fe6c00`.

### Phase 29 — Global Search + Action-Layer Test Coverage (Complete)

Started as a single feature: a global search box in the sidebar, so users can jump straight to a Lead, Project, Client, or other record by name instead of navigating through menus, plus its own regression tests. That work naturally grew into a much larger, methodical effort to backfill automated regression tests across every server-side action in the app — the functions that actually create, update, archive, restore, and otherwise change data — so that future changes are far less likely to silently break existing behavior. By the end, every action file in the codebase has meaningful test coverage except the Publishing feature's connection-management actions, which remain intentionally out of scope for this pass.

Search feature committed as `26f7db2`, `179139c`, `7168253`. The test-coverage effort closed with `78caeda`.

## Phase 30 — Native AI Engine (Future / Unscoped)

**Status: Not started. Not scheduled. Not approved for implementation.** This is a placeholder recording a future direction under consideration, in the same spirit Phases 24–25 were originally carried as unscoped placeholders before being picked up.

The concept: reduce the platform's dependence on third-party AI provider API keys by supporting self-hosted, open-weight models as a first-class option — not just as the emergency fallback Phase 20 already proved works (a live Gemini→local-Ollama fallback). This would extend the existing provider-abstraction layer rather than replace it. Alongside that, the concept includes building an internal SEO/GEO/AEO knowledge base, source-backed recommendations (citing where a claim or suggestion comes from), deeper website intelligence, and content research/verification — with model fine-tuning or customization only considered later, if and when it's actually justified by real usage.

This overlaps meaningfully with `docs/seo-intelligence-platform-architecture.md` — a detailed, previously-written proposal (automated website crawling, AI-assisted keyword clustering, opportunity scoring) that was never approved or built. Phase 30, when eventually scoped, should treat that document as prior research to build on rather than starting over, while extending it to cover the self-hosted/open-weight model angle that document doesn't address.

No design or implementation work has been done against this phase. It exists here only so the idea isn't lost and isn't confused with any currently active work.

Enhanced Observability (deeper structured logging/tracing across the AI pipeline beyond today's `AiUsageLog` table and console-JSON `logger`) was this roadmap's original Phase 21 placeholder; it was superseded by the configurable-generation work above and remains unscoped.
