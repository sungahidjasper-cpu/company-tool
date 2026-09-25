# Content Operations — architecture assessment

**Discovery only. No code changed.** Written after the client-first ownership migration, to identify the next safest product step.

---

## 1. Ownership across every model that has one

| Model | companyId | clientId | seoProjectId | Reading |
|---|---|---|---|---|
| **Content** | **REQUIRED** | optional | optional | ✅ client-first |
| **SocialAccount** | REQUIRED | **REQUIRED** | — | ✅ the most client-first model in the schema |
| Contact | — | REQUIRED | — | ✅ client-owned |
| Report, WebsiteAnalysisJob, Note, Activity, File | optional | optional | optional | flexible, works either way |
| AiGenerationJob | REQUIRED | — | optional | ✅ already company-rooted |
| **Keyword** | — | — | **REQUIRED** | project-first |
| **KeywordCluster** | — | — | **REQUIRED** | project-first |
| **KnowledgeSourceLink** | — | — | **REQUIRED** | project-first |
| **ContentCalendar** | — | — | **REQUIRED** | project-first, **and has no company of its own** |

## 2. What is now client-first

Content Workspace calendar (queries `Content.companyId` + `clientId`) · Content Detail (one component, two routes) · Social Composer · Blog Studio · social account management in Settings · content creation flow · authorization (rooted at `Content.companyId`).

## 3. What is still project-first, and whether it should be

| Still project-first | Verdict |
|---|---|
| `Keyword`, `KeywordCluster` | **Should remain.** A keyword belongs to a site's search footprint, not to a business in the abstract. |
| `KnowledgeSourceLink` | **Should remain.** It links a knowledge source to a project's SEO context. |
| Long-form generation, publishing, internal links, meta tags, topic clusters, gap/competitor analysis, schema markup | **Should remain.** Each genuinely consumes project data — the domain, the page inventory, or the keyword set. Verified by reading what each passes to its generator. |
| **`ContentCalendar` (planned items)** | **Genuine open question — see §6.** |
| **Newsletter, press release, social snippets, image alt text** | **Candidates to become client-first.** Verified: these four never read the project's `name` or `domain`. The project is used *purely as an ownership container* — the same leak the Content migration just removed. |

## 4. Conflicting data models

**None found.** There is one `Content` model, one media system (`File`), one scheduling mechanism (Phase 5), one revision system, and one detail view. The client-first migration did not introduce a competing path.

## 5. UX inconsistencies found

1. **The content-type filter is half-real — this is the biggest gap.** `Content` has no type column. The feed derives `contentType: row.socialPost ? "SOCIAL_POST" : null`, so a blog article, an SEO page and a hand-made record are **all `null`** and indistinguishable. `CalendarContentType` (ARTICLE, GUIDE, LANDING_PAGE, …) exists only on *planned* items. Consequence: choosing a content type in the calendar silently narrows to planned items plus social posts, and the **"CONTENT TYPE [ All ▼ ]"** control the product direction calls for cannot be built honestly today.

2. **Newsletter and press release are not content.** Neither persists a `Content` row — they return generated text. So "Newsletter" cannot appear on the calendar as the roadmap assumes, and there is no record to schedule or publish.

3. **12 AI "new" pages are project-first pickers.** You choose an SEO project, then content within it. That contradicts the client-first workspace a user just came from.

4. **`ContentCalendar` is the last model authorized purely through a project** — it has no `companyId`, exactly the shape `Content` had before this migration.

## 6. The planned-items question — NOT acted on

`ContentCalendar` → `SEOProject` (REQUIRED, `onDelete: Cascade`), with no company or client of its own. Its assistant plans from the project's **keywords and clusters**, which are themselves legitimately project-scoped.

So this is genuinely different from the Content case: planned items are an *SEO planning artefact*, not general content. Two defensible readings:

- **Keep project-scoped.** The planner's whole input is keywords. A client with no project has no keywords, so it has nothing to plan from — that is honest, not a gap.
- **Make client-first later.** If planning is meant to cover social and blog too (the Content Operations direction), the calendar would need the same treatment `Content` just had.

**Recommendation: leave it alone for now.** It is not blocking anything today, and it should follow — not precede — a decision about whether *planning* covers non-SEO content. It also carries a `Cascade` that would need the same `SetNull` treatment.

## 7. Recommended next phase — content type as a first-class attribute

**Make `Content` say what kind of content it is.**

Why this one:

- It is the **smallest change that unblocks the most** of the stated direction: the calendar's content-type filter, an honest "what would you like to create", per-type views, and newsletter/press-release becoming real content later.
- It is **additive and low-risk**: one nullable enum column, backfilled deterministically from what the data already proves — `socialPost` present → `SOCIAL_POST`; `body` present → `BLOG_OR_ARTICLE`; otherwise left NULL rather than guessed.
- It touches **no ownership, no publishing, no AI provider, no planned items** — none of the stop conditions.
- It removes the last place the workspace has to say "type not recorded" about its own records.

Deliberately *not* recommended first: making planned items client-first (§6, needs a product decision first), and client-first AI entry (§5.3 — worth doing, but mostly cosmetic until content types exist).

## 8. Nothing requiring an emergency stop

No migration problem, no data inconsistency, no authorization regression, no content-ownership conflict, no routing problem. Post-restart state matches the last verified checkpoint exactly.
