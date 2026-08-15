# AI Platform Roadmap (Phases 18–25)

Tracks the roadmap produced by the post-Phase-17 architectural review of the AI Workspace and surrounding AI infrastructure. That review covered current architecture, technical debt, production readiness, multi-provider strategy, observability, and scalability, and proposed Phases 18–25 below. Phases 18 and 19 were flagged as essential before a real multi-tenant launch; this file is the persistent tracker for status as each phase ships (the review itself was delivered as a point-in-time analysis, not saved as a file).

| Phase | Name | Priority | Status |
|---|---|---|---|
| 18 | Background Job Architecture for AI Generation | Essential | **Complete** — `6756ddb` |
| 19 | Per-Company AI Cost Controls & Rate Limiting | Essential | **Complete** — `0dda410` |
| 20 | Multi-Provider Production Readiness | High | Implemented, verified — awaiting commit |
| 21 | Enhanced Observability | Medium | Not started |
| 22 | Streaming | Medium | Not started |
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

## Phases 21–25

Not yet scoped in detail — carried forward from the architectural review's roadmap table as placeholders for future design work:
- **21 — Enhanced Observability**: deeper structured logging/tracing across the AI pipeline beyond today's `AiUsageLog` table and console-JSON `logger`.
- **22 — Streaming**: streaming AI responses to the client instead of waiting for a complete structured-output result.
- **23 — UX Maturation**: polish across the AI Workspace/Website Analysis UI surfaces.
- **24 — Publishing / Distribution**: pushing generated content to external destinations (CMS, social, etc.).
- **25 — Version History**: revision tracking for AI-generated and edited content.
