# AI Platform Roadmap (Phases 18–25)

Tracks the roadmap produced by the post-Phase-17 architectural review of the AI Workspace and surrounding AI infrastructure. That review covered current architecture, technical debt, production readiness, multi-provider strategy, observability, and scalability, and proposed Phases 18–25 below. Phases 18 and 19 were flagged as essential before a real multi-tenant launch; this file is the persistent tracker for status as each phase ships (the review itself was delivered as a point-in-time analysis, not saved as a file).

Note: as actually delivered, Phase 21 diverged from this roadmap's original "Enhanced Observability" placeholder — it shipped instead as *Configurable Content Brief & Long-Form Draft Generation* (see below). Enhanced Observability was not part of what shipped under that name and remains unscoped. Phase 22 ("Streaming") matched its original placeholder.

| Phase | Name | Priority | Status |
|---|---|---|---|
| 18 | Background Job Architecture for AI Generation | Essential | **Complete** — `6756ddb` |
| 19 | Per-Company AI Cost Controls & Rate Limiting | Essential | **Complete** — `0dda410` |
| 20 | Multi-Provider Production Readiness | High | **Complete, committed & pushed** — `420d806` |
| 21 | Configurable Content Brief & Long-Form Draft Generation (renamed from "Enhanced Observability" — see note above) | High | **Complete, committed & pushed** — `e582f87`. Post-ship content-quality fixes: see [phase-21-content-quality-fixes.md](phase-21-content-quality-fixes.md) |
| 22 | Streaming | Medium | **Complete, committed & pushed** — Stages 1–4: `2d4d2d2`, `0ce088a`, `270566b`, `b5e104b` |
| 23 | UX Maturation | Medium | Not started |
| 24 | Publishing / Distribution | Low | Not started |
| 25 | Version History | Low | Not started |

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

## Phases 23–25

Not yet scoped in detail — carried forward from the architectural review's roadmap table as placeholders for future design work:
- **23 — UX Maturation**: polish across the AI Workspace/Website Analysis UI surfaces.
- **24 — Publishing / Distribution**: pushing generated content to external destinations (CMS, social, etc.).
- **25 — Version History**: revision tracking for AI-generated and edited content.

Enhanced Observability (deeper structured logging/tracing across the AI pipeline beyond today's `AiUsageLog` table and console-JSON `logger`) was this roadmap's original Phase 21 placeholder; it was superseded by the configurable-generation work above and remains unscoped.
