# Client-first content ownership

**Migration:** `20260909210219_content_client_first_ownership`
**The rule:** Company owns (security root) · Client owns (business context, optional) · SEO Project is optional specialised context.

---

## 1. The migration

Hand-written rather than Prisma-generated, because the order matters: Prisma refuses to add a `NOT NULL` column to a table with 13 rows, and the backfill has to run *between* adding the column and constraining it.

```sql
ALTER TABLE "Content" DROP CONSTRAINT "Content_seoProjectId_fkey";
ALTER TABLE "Content" ADD COLUMN "companyId" UUID;   -- nullable for now
ALTER TABLE "Content" ADD COLUMN "clientId"  UUID;

UPDATE "Content" c SET "companyId" = p."companyId", "clientId" = p."clientId"
  FROM "SEOProject" p WHERE c."seoProjectId" = p."id";

-- Refuses to continue rather than constraining a half-filled column.
DO $$ ... RAISE EXCEPTION 'Backfill incomplete: % Content row(s) have no companyId' ... $$;

ALTER TABLE "Content" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Content" ALTER COLUMN "seoProjectId" DROP NOT NULL;
-- …indexes, then the three FKs.
```

**`onDelete` for `seoProjectId` changed CASCADE → SET NULL.** Deleting a project must never destroy the client's content asset.

## 2. Backfill results — verified row by row

A snapshot of all 13 rows was recorded *before* the migration and compared after:

| Check | Result |
|---|---|
| Row count | 13 → 13 |
| Every pre-migration row still exists | ✅ |
| Every `companyId` matches its project's company | ✅ |
| Every `clientId` matches its project's client (NULL where none) | ✅ |
| Every `seoProjectId` unchanged | ✅ |
| Rows with NULL `companyId` (raw SQL) | **0** |
| Column nullability (raw SQL) | `companyId` NO · `clientId` YES · `seoProjectId` YES |
| Delete rules (raw SQL) | `seoProjectId` **SET NULL** · `clientId` SET NULL · `companyId` CASCADE |

**2 rows became client-owned**, both from the soft-deleted "Acme Plumbing SEO" project — so Acme gains visible content in the client-first calendar. **11 stayed company-only** because their project genuinely has no client. No client was invented.

## 3. Authorization

Rooted at `Content.companyId` — which *simplifies* the 19 sites that previously joined through the project. The rules from the brief are enforced as written:

- `Content.companyId === actor.companyId`
- a supplied project must be the actor's company's **and** belong to the same client
- an existing record's `clientId` must match the client being saved for, so a post cannot be moved between clients by editing an id
- **the URL's own client wins over the project's**, so a URL naming a client and a project that disagree is refused rather than silently resolved (see §7)

## 4. Calendar

`loadWorkspaceFeed(companyId, { clientId?, projectIds? })` queries `Content.companyId` + `clientId` directly. The project is applied only when one is chosen, and only ever narrows — an empty project list still returns nothing rather than widening back to the client.

The UI changed accordingly: the project select is labelled **"(optional filter)"** and is replaced by a plain sentence when the client has none; the amber *"…has no active SEO projects, so there is nothing to show here"* became a quiet, accurate note. The empty state no longer treats "no project" as a reason to be empty, and points at what can be created.

## 5. Social and blog without a project

Both actions now take `clientId` (required) and `seoProjectId` (optional). Both pages resolve the client first. The creation dialog no longer demands a project; what it requires is a **specific client**, because content belongs to one.

`SocialPost`, `SocialPostTarget`, `SocialAccount`, platform tabs, per-platform captions, media staging, preview and scheduling are all untouched.

## 6. SEO behaviour preserved

Tools that genuinely need a project still require one, and now say so instead of assuming it:

| Feature | Behaviour |
|---|---|
| Long-form generation (action **and** background runner) | Refuses without a project — it grounds the article in the project's name and domain |
| Publishing | Refuses without a project — the destination is checked against the project's domain, and no domain is invented |
| Keyword attachment | No project means no keywords to attach |
| AI pickers (rewriter, meta tags, internal links, schema, newsletter, snippets) | Group by project; projectless rows are skipped, not forced into a bucket |
| Permanent delete from Trash | Offered only for project content, whose impact check is project-scoped |

## 7. Routing

**One `ContentDetail` component, two addresses.** `/seo/[id]/content/[contentId]` is unchanged — including its check that the project in the URL is the record's actual project — and `/content/[contentId]` is the client-first address, the only one a projectless record can have. `contentDetailHref` / `contentRevalidatePaths` decide which, so no call site has to.

## 8. Tests

**4068 pass** across 149 files, including new coverage for: both addresses and backward compatibility; a projectless row as a first-class calendar item; client-first feed scoping (`clientId`, `null`, and "no client" as distinct scopes); a project filter narrowing and never widening; `NO SEO PROJECT IS REQUIRED` for both social and blog; and the client — not the project — being the editing boundary.

Gates: typecheck 0 · lint 0 errors (1 pre-existing warning in untouched `ReportForm.tsx`) · build succeeds with both routes.

## 9. Limitations

- A **soft-deleted (trashed) project no longer hides its content** from the workspace. Under the old model the project was the owner, so trashing it hid the content; the content is now the client's and survives. This is a deliberate consequence of the approved model, and it is how Acme's two rows become visible.
- Planned items (`ContentCalendarEntry`) remain project-scoped, because a `ContentCalendar` belongs to an `SEOProject`. A client with no project has none — which is the truth, not a gap.
- Rollback is clean only until the first client-only row exists; after that, dropping the columns would orphan it.
