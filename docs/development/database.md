# Database: architecture, migrations, seeding, backups

## Architecture

**Tenancy.** Every company-owned model scopes to `Company` — either directly (`companyId` column) or by walking a parent relation (e.g. `Contact` scopes through `Client`). Query-layer scoping (`where: { companyId }`) is the primary enforcement; `lib/authorization.ts`'s `assertCompanyAccess`/`canAccessCompany` back it up at the action/page layer as defense-in-depth, not a replacement.

**Soft deletes.** `Client`, `Project`, `Task`, `Lead`, `SEOProject`, `Content`, `Keyword`, `File`, `Report`, `User`, `Company`, `Role`, `Contact`, and `AIConversation` all carry `deletedAt`. `Activity` (append-only audit trail) and `Notification` (no delete feature exists) intentionally don't. Every list query against a soft-deletable model should filter `deletedAt: null` — this was confirmed correct everywhere except one dead-code gap (`dashboard.service.ts`'s `getRecentCommentsList`, fixed).

**Two permission systems coexist — only one is wired up.** `lib/authorization.ts`'s `Permissions` matrix (a static, coarse `EMPLOYEE < MANAGER < ADMIN < SUPER_ADMIN` hierarchy) is what the app actually checks against today. The schema also has a real `Role`/`Permission` relational model (`schema.prisma`) for future fine-grained, per-feature checks — it exists and is seeded (empty by default) but nothing reads from it yet. Don't assume both are active; pick one deliberately before building on either further.

**Shared attachments.** `Note`, `Activity`, and `File` each carry one nullable FK per attachable entity (client, project, task, lead, seoProject, content, contact) rather than a polymorphic `(entityType, entityId)` pair, since Prisma has no native polymorphic relation. "Exactly one of these should be set" is an application-level invariant, not database-enforced.

**Background jobs.** `WebsiteAnalysisJob` is a Postgres-backed job queue (`lib/jobs/job-table.ts`), but jobs are only ever advanced by the same request that created them (`void runWebsiteAnalysisJob(job.id)`, fire-and-forget in-process) — there's no separate worker or poller. If the process restarts mid-analysis, the job would be stuck `RUNNING` forever with nothing to reap it, **except** `instrumentation.ts` now sweeps and fails any stale `RUNNING` job at every server boot (see below). This is a mitigation, not a real job queue — see the production recommendations at the bottom.

## Migrations

Standard Prisma workflow: `npx prisma migrate dev --name <description>` creates and applies a migration, regenerating the client. **After any schema change, restart `next dev`** — the long-running dev server caches a `PrismaClient` singleton (`lib/prisma.ts`) at process start and won't pick up new columns/enum values without a restart. This has bitten this project three times; if something is throwing "column does not exist" or a TS error about a missing enum member right after a migration, restart the dev server before debugging anything else.

The local dev database is a `prisma dev` Postgres proxy, not a real Postgres install. After a machine restart, it needs `npx prisma dev --detach` to come back up before migrations/the app can reach it (`DIRECT_DATABASE_URL` in `.env` points at it).

## Seeding

`npm run db:seed` (`prisma/seed.ts`) creates one Super Admin, one Company, a Manager and two Employees, two Clients, two Projects, one SEO Project with a keyword cluster/keywords/content, and one completed Website Analysis example with a full, realistic audit result. **It's idempotent** — every row uses a fixed, well-known UUID and `upsert`s, so running it repeatedly never duplicates data; it just re-affirms the same rows. Login credentials are printed on completion (`superadmin@demo.cloudsherpas.test` / `ChangeMe123!`, etc. — change this before ever using this seed pattern anywhere non-local).

## Backups & restore (local dev safety net)

`pg_dump` isn't installed on this machine, so backups are plain JSON snapshots taken through Prisma Client instead:

- **`npm run db:backup`** — writes `backups/backup-<ISO-timestamp>.json`, one array of rows per model, in dependency order. Captures implicit many-to-many relation IDs (Role↔Permission, User↔Role, Tag↔{Client,Project,Task,SEOProject,Content}, Project↔User(assignedUsers), Keyword↔Content) so restore can reconnect them.
- **`npm run db:restore [path] [--force]`** — without `--force`, prints what it would do (row counts per model) and makes no changes. With `--force`, wipes every table (reverse dependency order) and restores from the snapshot (dependency order), reconnecting M2M relations via `connect`. `Task.parentTaskId` (the one self-referencing FK in the schema) is restored in a deferred second pass. Defaults to the most recent file in `backups/` if no path is given.
- **`npm run db:reset`** — the only sanctioned way to wipe and rebuild the dev database. Backs up first, unconditionally, then runs `prisma migrate reset --force --skip-seed`, then reseeds. Refuses to run at all unless `CONFIRM=yes` is set (`CONFIRM=yes npm run db:reset`) — printing what it would do otherwise.

**This is a local dev safety net, not a production DR strategy.** It exists specifically because a raw `npx prisma dev rm` was run directly during this project's development (to "fix" what looked like a broken DB proxy) and destroyed all local data with no backup — the incident that motivated building this tooling. The rule going forward: **raw `prisma migrate reset` / `prisma dev rm` are never run directly** — always through `npm run db:reset`, which backs up first. In production, use the hosting provider's managed backups / point-in-time recovery instead of this JSON tool — it has no support for large datasets, concurrent writes during restore, or partial/incremental backups.

## Development workflow

1. `npx prisma dev --detach` (once per machine session, or after a restart).
2. `npx prisma migrate dev` after any schema change, then **restart `next dev`**.
3. `npm run db:seed` any time you need known-good demo data back (safe to re-run).
4. Before any manual/destructive Prisma CLI command you're tempted to run directly: `npm run db:backup` first, no exceptions.

## Production recommendations

- Real managed Postgres (RDS/Neon/Supabase/etc.) with its own backup/PITR — not this repo's JSON tool.
- A real background-job system (a dedicated worker process or a scheduled poller claiming via `claimNextPendingWebsiteAnalysisJob`'s existing `SELECT...FOR UPDATE SKIP LOCKED` logic, which is implemented but never invoked today) instead of in-process fire-and-forget, with proper dead-letter handling for jobs that fail repeatedly.
- Decide between the two coexisting permission systems (the `Permissions` matrix vs. the relational `Role`/`Permission` model) and remove the unused one, rather than carrying both indefinitely.
- Add rate limiting to `/login` and other auth-adjacent routes — currently none exists anywhere in the app.
