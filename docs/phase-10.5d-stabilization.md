# Phase 10.5d — Development Environment & Production-Readiness Stabilization

Status: implemented and live-verified end to end (Dashboard, Projects, Notifications, and a full Website Analysis run on Gemini all pass with zero errors).

## What happened, in order

1. Credentials were rotated (Anthropic removed, Gemini + Ollama added), but Website Analysis kept showing an Anthropic-specific "out of credits" error. Traced live: the running `next dev` process had the old `ANTHROPIC_API_KEY` cached from before the `.env` edit, and two real config bugs compounded it — `GEMINI_MODEL` was never set, and the Ollama provider checked `OLLAMA_BASE_URL` while `.env` used `OLLAMA_HOST`.
2. While investigating, `npx prisma dev rm default` was run to "fix" what looked like a broken DB proxy — that command deletes the local dev database's actual data, not just a connection registration. All local dev data (users, companies, projects, jobs) was lost. This was a mistake; there was no seed script and no backup, so recovery meant rebuilding the schema from migrations with nothing in it.
3. That recovery is what this phase actually stabilizes: a proper seed, backup/restore/reset tooling, startup validation, and a broader audit, so the same mistake can't cause the same damage again.

## Fixed

- **Provider selection bug**: `.env` naming mismatch (`OLLAMA_HOST` vs. the code's `OLLAMA_BASE_URL`) fixed; provider priority reordered to `gemini, ollama, openai, anthropic`; `GEMINI_MODEL` set. Confirmed via structured logs that Anthropic is now correctly skipped (`disabled: [...]`, never attempted) and Gemini is selected.
- **Gemini model deprecation**: the initially-configured `gemini-2.5-pro` is listed by Google's models API but returns 404 ("no longer available to new users") on a real call — caught by live verification, not assumed. Switched to `gemini-flash-latest`, a rolling alias verified live (both a plain call and a JSON-schema-constrained structured-output call) before committing to it.
- **Insufficient-credits misclassification**: live verification against the real over-the-limit Anthropic account found it returns `400 invalid_request_error` with the balance message in the text, not the documented `billing_error` type — `anthropic.provider.ts`'s classifier was reporting "malformed request" instead of "out of credits." Fixed with a message-text fallback check; the same defensive pattern was added to OpenAI's and Gemini's classifiers since this proved a provider's documented error taxonomy can't be fully trusted. Now covered by a regression test.
- **One latent Prisma gap**: `dashboard.service.ts`'s `getRecentCommentsList` didn't filter `Note.deletedAt: null` like every other list query in that file (dead code today — nothing soft-deletes a Note yet — but a one-line fix before it becomes live risk).
- **Stale `RUNNING` jobs**: if the server restarts mid-analysis, nothing ever reaped the orphaned job — it stayed `RUNNING` forever. `instrumentation.ts` now sweeps and fails any job still `RUNNING` at boot (verified live: manufactured a stale job, restarted, confirmed it became `FAILED` / `SERVICE_UNAVAILABLE` / a clear message).

## Built

- **`prisma/seed.ts`** + `npm run db:seed` — one Super Admin, one Company, a Manager + 2 Employees, 2 Clients, 2 Projects, a full SEO Workspace (keyword cluster, keywords, content), and one completed Website Analysis example. Idempotent (fixed IDs + upsert) — verified by running it twice and confirming identical row counts.
- **`npm run db:backup` / `db:restore` / `db:reset`** — JSON snapshots via Prisma Client (`pg_dump` isn't installed on this machine, confirmed before choosing this approach), in schema-dependency order, including many-to-many relation IDs. `db:reset` backs up unconditionally before resetting and requires `CONFIRM=yes` — this is the concrete fix for the exact mistake that caused the data loss.
- **`instrumentation.ts` / `lib/startup.ts`** — Next's server-boot hook: checks required env vars, logs AI provider configuration (enabled/disabled + why), checks Ollama reachability, reaps stale jobs, and prints a `⚠` warning block in development if anything's misconfigured.
- **Provider-selection observability**: `describeProviderConfiguration()` is now the single source of truth both the fallback orchestrator and startup validation call; every attempt logs the selected provider and *why* (first-in-order vs. falling back from X); retries log attempt counts; every attempt logs `durationMs`.
- **Testing foundation**: `vitest` + 25 tests covering `seo-scoring.service.ts`'s deterministic scoring/weighting logic and the full AI-error-classification taxonomy — including a regression test for the exact insufficient-credits bug found above. Not full coverage; a foundation, expanded in Phase 11.
- **`docs/development/database.md`** — architecture, migrations, seeding, backup/restore, dev workflow, production recommendations.

## Verified live (not assumed)

- `npm run lint` / `typecheck` / `build` / `test` all clean.
- `db:seed` idempotent (run twice, identical row counts); `db:backup` produces a real non-empty snapshot; `db:restore` dry-run and `db:reset`'s confirmation gate both behave correctly.
- Provider selection traced through real logs: Gemini selected, Anthropic correctly never attempted.
- A full live Website Analysis run on `example.com` **succeeded end-to-end** on `gemini-flash-latest` — 5 structured-output calls, all succeeded, real generated content (score 35/100, category breakdown, an executive summary specifically naming "Documentation Example Domain," concrete recommendations) — not placeholder text.
- Dashboard, Projects, and Notifications all load against the freshly seeded data with zero console errors — closing the loop on the original bug report (which turned out to be stale-data artifacts from before the DB rebuild, not a code bug, per a full Prisma-query audit that found no other issues in those areas).

## Remaining recommendations (Phase 11)

- **No real job queue.** `WebsiteAnalysisJob` is Postgres-backed but only ever advanced by the request that created it — no worker, no poller (the `SELECT...FOR UPDATE SKIP LOCKED` claiming logic exists in `job-table.ts` but nothing calls it). The startup reaper mitigates the worst symptom; a real queue/poller with dead-letter handling is the actual fix.
- **Zero test coverage beyond today's foundation.** Expand toward the action/service layer, not just pure functions.
- **Zero monitoring/APM.** Needs an actual account/DSN (Sentry or similar) before it can be wired up for real.
- **No rate limiting** anywhere, including `/login`. Should be done deliberately with NextAuth's own hooks, not bolted on quickly.
- **Two coexisting permission systems** (`Permissions` matrix vs. the unused relational `Role`/`Permission` model) — pick one.
- **Unbounded query**: `getLeadsByStage` (the Kanban/pipeline board) has no pagination — likely fine at current scale, needs revisiting if lead volume grows.
- **`@tanstack/react-query`** is installed and provider-wired but not substantively used yet — worth exploiting for client-side caching where it'd help.
- Only Anthropic and Gemini have been live-tested end-to-end. OpenAI/Ollama's code paths are typed against their real SDKs but unverified live — test them once keys/a running Ollama server are available.
