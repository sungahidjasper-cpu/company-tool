# Content ownership — dependency map and proposal

**Status: DISCOVERY ONLY. No code changed, no migration run.** This hits the brief's stop conditions (a Content model change plus a backfill of every existing row), so it is a proposal awaiting authorization.

---

## 1. Why the SEO Project blocks creation

It blocks at **three independent layers**, not one. This matters: making the column nullable alone would not fix it, and would break authorization.

| Layer | The dependency | Evidence |
|---|---|---|
| **Database** | `Content.seoProjectId String @db.Uuid` — **NOT NULL**, `onDelete: Cascade` | `prisma/schema.prisma` |
| **Authorization** | `Content` has **no `companyId` and no `clientId`**. The only route to a company is `content.seoProject.companyId` | 19 non-test sites authorize Content this way; 44 Prisma queries `include`/`select` `seoProject` |
| **Routing** | Content detail lives at `/seo/[id]/content/[contentId]` — the project id is *in the URL* | 64 non-test href sites build `/seo/${projectId}/content/…`; there is no client-scoped content route |

Reproduced in the browser against the real client from the screenshot (Catawba Yaupon, no SEO project):

- calendar: *"…has no active SEO projects, so there is nothing to show here"*
- project select: only option is *"No projects for this client"*
- `+ Create content for this day` **is** enabled and the dialog opens — so the dead end is only discovered at the last step
- `/content/create/social?client=…` (no project) → **404**
- `/content/create/blog?client=…` (no project) → **404**

## 2. How bad the data situation already is

| Fact | Value |
|---|---|
| Clients in the database | 3 — Acme Plumbing & HVAC, Northside Dental Group, Catawba Yaupon |
| Clients with at least one SEO project | **0** |
| Content rows whose project has **no client at all** | **11 of 13** |

So the client-first workspace is currently unusable for **every** client, and almost all existing content is not reachable from any client. This is not an edge case.

## 3. Answers to the five discovery questions

1. **Is Content required to belong to an SEOProject?** Yes — NOT NULL FK, cascade delete.
2. **Is it required only because of the database?** **No.** The database is the smallest of the three layers. Authorization and routing both depend on it too.
3. **Which content types genuinely require an SEOProject?** Only those consuming project-scoped data: keyword-driven content (`Keyword.seoProjectId` is NOT NULL), internal-link analysis, SEO reporting, and briefs built from keyword clusters.
4. **Which can belong directly to a Client?** Social posts, blog posts, newsletters, press releases. **Social is already client-first everywhere except the Content row** — `SocialAccount` is owned by `Client`, and the composer already filters accounts by `project.clientId`. The SEO project contributes nothing to a social post except satisfying the FK.
5. **Which features assume every Content has a project?** 163 non-test files reference `seoProjectId`; the content detail route; the calendar feed (builds its hrefs from the project); publishing; every AI tool picker.

## 4. Options considered

| Option | Verdict |
|---|---|
| **C.** Separate Social/Blog records owned by Client | **Rejected** — a second content system. Breaks the unified calendar, Content Detail, scheduling and revisions, and the brief forbids it (Step 9). |
| **D.** Auto-provision a hidden SEO project per client | **Rejected** — the project would appear in SEO Workspace, polluting it with fake records to satisfy an FK. Solves the screen by lying about the data. |
| **B.** Client-content relationship alongside SEOProject | Collapses into A once authorization is considered. |
| **A.** Content belongs to a Company always, a Client optionally, an SEO Project optionally | **Recommended.** |

## 5. Recommended schema (NOT APPLIED)

```prisma
model Content {
  /// NEW, NOT NULL — the authorization root, today only reachable via seoProject.
  companyId    String  @db.Uuid
  /// NEW, nullable — direct client ownership for social/blog/newsletter.
  clientId     String? @db.Uuid
  /// CHANGED to nullable — SEO project becomes optional specialised context.
  seoProjectId String? @db.Uuid
}
```

**`companyId` is the part that makes this safe.** Today authorization is derived through the project; if the project can be absent, that derivation has no root. Adding `companyId` gives every row its own root and actually *simplifies* the 19 authorization sites (`content.companyId` instead of a join).

### Migration and backfill

```sql
ALTER TABLE "Content" ADD COLUMN "companyId" UUID;
ALTER TABLE "Content" ADD COLUMN "clientId"  UUID;

UPDATE "Content" c
   SET "companyId" = p."companyId",
       "clientId"  = p."clientId"
  FROM "SEOProject" p
 WHERE c."seoProjectId" = p.id;

ALTER TABLE "Content" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Content" ALTER COLUMN "seoProjectId" DROP NOT NULL;
```

**Existing data impact: none behaviourally.** Every existing row keeps its `seoProjectId`, so every existing query, URL, AI tool and publishing path continues to resolve exactly as before. The two new columns are derived from the project the row already has.

### Rollback

While no client-only content exists, rollback is: drop the two columns, restore `NOT NULL`. After client-only content exists, rollback would orphan those rows — so the point of no return is the first client-only post, not the migration itself.

### One behaviour change to decide

`Content.seoProject` is `onDelete: Cascade` — deleting a project deletes its content. With the project optional, that should arguably become `onDelete: SetNull` so client-owned content survives. **That is a real behaviour change and needs an explicit decision.**

## 6. Work beyond the migration

- **A client-scoped content route** (`/content/[contentId]`), because `/seo/[id]/content/[contentId]` cannot address a projectless row. The existing route keeps working for project content. This is the largest UI consequence — 64 href sites, though most are project content and stay as they are.
- Authorization updated at 19 sites to prefer `content.companyId`.
- `saveSocialPostAction` / blog save to accept a client without a project.
- Calendar: client-first scoping, a content-type filter, project filter shown only when the client has projects, and the misleading empty state replaced.
- Creation dialog: content-type choice without demanding a project.

## 7. What is NOT proposed

No change to `SocialPost`, `SocialPostTarget`, `SocialAccount`, `File`, publishing, the AI generation architecture, or the SEO Workspace. No new content model. No new dependency.
