# Phase F Publishing Readiness

Discovery and architecture audit only. No code, schema, or data was changed.

Date: 2026-09-05

---

## 1. Executive Conclusion

**The publishing architecture is real, well-built, and ready to support recording a
verified published URL. Phase F is READY WITH OPEN QUESTIONS.**

This is a genuinely positive result, and a different situation from C4.4. The
publishing layer already handles the hard parts properly: tenant ownership, safe
credential handling, SSRF protection, row-level locking against concurrent publishes,
a strict "never claim what we cannot verify" rule, and a startup recovery process for
jobs interrupted mid-flight. It has 92 passing tests.

The reason no URLs exist today is **not** that publishing is broken. It is that:

1. **Publishing has never actually been used** — zero connections, zero jobs, zero
   publications in the database.
2. **Publishing deliberately never writes back to the Content record.** A successful
   publish records the external URL on `ContentPublication` and leaves
   `Content.url`, `Content.status`, and `Content.publishedAt` untouched.

So the missing piece is small and well-defined: connect a real destination, and
associate the verified published URL with the Content record.

Before that can be done safely, three genuine gaps need decisions — most importantly
that **a publishing connection is not tied to an SEO project**, so nothing currently
guarantees that a page published from Project A lands on Project A's own domain.

---

## 2. Existing Publishing Architecture

The full path, as it exists today:

```
PublishContentPanel (UI, on Content Detail)
        ↓
publishContentAction / retryPublishAction   (authorization, ownership, idempotency)
        ↓
publishContentToWordPress                    (SSRF-guarded outbound POST)
        ↓
WordPress REST API
        ↓
PublishingJob + PublishingAttempt            (audit trail)
        ↓
ContentPublication.externalUrl               (the verified public URL)
```

| Layer | File | Responsibility |
|---|---|---|
| UI | `features/publishing/components/PublishContentPanel.tsx` | Publish / Retry buttons on Content Detail |
| UI | `features/publishing/components/ConnectionManager.tsx` | Manage destinations (Settings → Publishing) |
| Action | `features/publishing/actions/publishing-content.actions.ts` | Authorization, ownership, eligibility, idempotency, persistence |
| Action | `features/publishing/actions/publishing-connection.actions.ts` | Create/verify/disable destinations |
| Service | `features/publishing/services/wordpress-publish.service.ts` | One guarded POST; returns a narrowly-typed result |
| Service | `features/publishing/services/wordpress-connection.service.ts` | Connection verification |
| Service | `features/publishing/services/ssrf-guard.service.ts` | Blocks unsafe/internal destinations |
| Service | `features/publishing/services/publishing-errors.ts` | Conservative failure classification |
| Service | `features/publishing/services/content-publication-state.service.ts` | Read-only publication state for the UI |
| Recovery | `lib/startup.ts` → `reapStalePublishingJobs()` | Resolves jobs interrupted mid-flight |

**Only one provider exists: WordPress.** There is no Shopify or other CMS adapter, no
webhook or callback handling, and no background queue — a publish runs inline inside
the server action while the user waits.

---

## 3. Content Publication Model

`ContentPublication` is best described as **a successfully published resource, one per
(Content, destination) pair** — a combination of options B and D from the question.

| Field | Meaning |
|---|---|
| `contentId` | The Content that was published |
| `connectionId` | Which destination it went to |
| `externalId` | The CMS's own post ID |
| `externalUrl` | The public URL the CMS reported (nullable) |
| `publishedAt` | When it was recorded |
| `companyId` | Tenant ownership |
| `@@unique([contentId, connectionId])` | One publication per destination |

What it is **not**:

- It is **not** an attempt log — that is `PublishingAttempt`.
- It is **not** historical. Because of the uniqueness constraint there is exactly one
  row per destination, and nothing ever updates or replaces it. Republishing to the
  same destination is refused rather than creating a new record.
- It has **no status and no error fields** — a row exists only if the publish
  genuinely succeeded.

Notably, it is **not linked to an SEO project**. Ownership is company-level only.

---

## 4. Current Content Lifecycle

`ContentStatus` is `DRAFT → IN_REVIEW → APPROVED → PUBLISHED → ARCHIVED`.

**Content status and external publication are completely decoupled.** This is the most
important finding in this section.

1. **Can Content become "published"? Yes — but only as an internal label.**
2. **What changes it?** `advanceContentStatus` (the manual status stepper) and
   `bulkPublishContent`, which sets `status: PUBLISHED, publishedAt: now` on many rows
   at once. Neither contacts any CMS.
3. **Is publishing state separate from `Content.status`? Yes, entirely.** The publish
   action never reads or writes `Content.status`, `publishedAt`, or `url`.
4. **Multiple publications per Content? Yes** — one per destination.
5. **Republish to the same destination? No.** Blocked by the uniqueness constraint and
   an explicit pre-flight check.
6. **Replace a publication? No.** Nothing updates or deletes a publication row.
7. **On failure?** A `PublishingAttempt` and a FAILED `PublishingJob` are recorded. No
   publication row is created. Only `NETWORK_TIMEOUT` may be retried.
8. **Editing after publishing?** Nothing happens externally. The published page keeps
   the old content, and Compass shows no drift warning.
9. **Current vs historical publication?** No distinction exists, because publications
   are never superseded.

This explains the data exactly: 1 record with status `PUBLISHED` and 0 publications.
Someone marked it published internally; nothing was ever sent anywhere.

---

## 5. Current URL Flow

There is exactly one source of a real public URL:

```
WordPress 201 response
        ↓
parsed.link  (a plain string in the JSON body)
        ↓
result.externalUrl
        ↓
ContentPublication.externalUrl
```

That is the end of the chain. **Nothing copies it onto `Content.url`.**

The only other candidate — the Website Analysis crawler — produces real URLs but they
describe the live site, not Compass Content records, and nothing links the two.

---

## 6. URL Source-of-Truth Assessment

**Is `ContentPublication.externalUrl` authoritative? Mostly yes — with caveats.**

| Question | Answer |
|---|---|
| Authoritative? | Yes in origin — it comes from the CMS that created the page, not from a guess. |
| Always absolute? | In practice yes (WordPress returns absolute links), but this is **not enforced**. |
| Validated? | **No.** It is accepted if it is a string. It is never parsed or checked as a URL. |
| Domain checked against the project? | **No.** Nothing compares it to `SEOProject.domain`. |
| Can it point to another domain? | **Yes** — see Section 7. |
| Can it be null? | The column is nullable, though the success path always supplies a string. |
| Can it change later? | Not in Compass. If someone renames the page in WordPress, the stored URL silently goes stale. |
| Provider-specific? | Yes — `parsed.link` is WordPress's field. |
| Canonical URL returned? | No. WordPress's `link` is the permalink, not a declared canonical. |
| Preview vs public URL? | Not distinguished. The app always posts with status `publish`, so `link` is the public URL. |

### Option assessment

| Option | Assessment |
|---|---|
| **A. Leave `Content.url` manual; publishing does nothing** | Status quo. Keeps C4.4 blocked forever and leaves the workflow open-ended. **Rejected.** |
| **B. Successful publish writes the verified URL into `Content.url`** | Uses a real, CMS-confirmed value. Gives one simple field every existing feature can already read (the AI tools, Internal Link Analyzer, and future analytics all expect `Content.url`). Requires no schema change. Needs a domain-ownership check and a rule for multiple destinations. **Recommended.** |
| **C. Derive it from `ContentPublication` on demand** | Avoids duplication and never goes stale relative to the publication, but every consumer must learn to resolve it, and with several destinations there is still no rule for which one wins. More work, same open question. |
| **D. Separate canonical-URL model** | Cleanest long-term for multi-destination publishing, but it is a new model and a large migration for a system that currently has one provider and zero publications. Premature. |
| **E. Slug + domain generation** | Invents URLs that may not exist — the exact fabrication risk the Internal Link Analyzer was built to prevent. Requires schema change. **Rejected as unsafe.** |

**Recommendation: OPTION B** — a successful publish writes the CMS-verified URL onto
`Content.url`, gated by a domain-ownership check.

Chosen because the URL is genuinely verified rather than derived, it needs no schema
change, and it puts the value where everything else already looks for it. Option D
becomes the right answer later, if and when a second provider is added.

---

## 7. Security and Ownership Assessment

**Existing protections are strong.** The publish action performs a genuine three-part
ownership check: the Content must belong to the actor's company, the connection must
belong to the actor's company, and the Content's company and the connection's company
must be the same company. Credentials are decrypted only in the moment before the
outbound call, never logged or persisted. The SSRF guard blocks internal and unsafe
destinations. A role permission (`managePublishingConnections`) gates the action.

Cross-company access is properly prevented. Cross-project access is not a concern for
publishing itself, because publishing is company-scoped by design.

**Three genuine gaps:**

1. **A connection is not tied to an SEO project — this is the important one.**
   `PublishingConnection` belongs to a Company, not a project, and nothing compares
   the connection's `baseUrl` to the Content's `SEOProject.domain`. So Content in a
   project for `storagemoguls.com` can legitimately be published to a WordPress site
   at any other domain the company has connected. Today that only affects where the
   page goes. **The moment we copy the returned URL onto `Content.url`, it becomes an
   SEO correctness problem**: a project's internal-link inventory could fill with URLs
   from an unrelated domain. This must be resolved before Option B is implemented.

2. **`externalUrl` is never validated.** It is stored as whatever string the CMS
   returned. A compromised or misconfigured destination could return anything.

3. **Soft-deleted projects are not checked.** `getPublishableContent` checks
   `content.deletedAt` but not `content.seoProject.deletedAt` — the same gap pattern
   already corrected in the four connected AI tools. Content under a trashed project
   can still be published.

A stale publication is possible in a mild sense: if the page is later deleted or
renamed in WordPress, Compass keeps showing the old URL. Nothing re-verifies.

---

## 8. Publishing Reliability Assessment

This area is unusually well handled.

- **Jobs are synchronous.** There is no queue or background worker; the publish runs
  inline in the server action. Fine at current scale; a long CMS response holds the
  request open.
- **Retries are deliberately restrictive.** Only `NETWORK_TIMEOUT` — a failure proven
  to have occurred before any connection was established — may be retried.
  `AMBIGUOUS_RESPONSE` and all received 4xx/5xx are never retried automatically.
- **Failures are recorded** as a `PublishingAttempt` plus a FAILED `PublishingJob`
  with a classified error type, and surfaced to the user in the panel.
- **Partial success is not possible** — one Content to one destination per job.

**The dangerous sequence is handled.** If WordPress publishes successfully but the app
fails before saving the result, the code catches the persistence error, logs it,
returns an honest message ("The content was published, but Compass could not record
the result"), and deliberately leaves the job `RUNNING`. On the next startup,
`reapStalePublishingJobs()` marks it `FAILED` with `AMBIGUOUS_RESPONSE` — which is not
retryable, so the app never re-posts a page that may already exist.

**The trade-off, which matters for Phase F:** that safe behaviour means a page can be
genuinely live while Compass has no record and no URL for it. Any "publish → URL"
pipeline will have this known hole, and will eventually want a way for a person to
reconcile it.

---

## 9. Duplicate Publication Assessment

**Duplicate publication is well prevented.**

- **Database:** `@@unique([contentId, connectionId])` on `ContentPublication`.
- **Locking:** the pre-flight takes `SELECT ... FOR UPDATE` on the Content row, so
  concurrent publish requests for the same Content are fully serialized.
- **Idempotency:** if a publication already exists, the action returns success with
  `alreadyPublished: true` instead of posting again.
- **Separate paths:** first attempt and retry are distinct functions. If any job
  already exists, the first-attempt path refuses and directs the user to retry.
- **Retry claiming:** the FAILED → RUNNING transition happens inside the locked
  transaction, so two concurrent retries cannot both claim the same job.
- **Provider identifier:** the CMS post ID is stored as `externalId`.
- **UI:** the button disables while a request is in flight.

The one irreducible risk is external and explicitly acknowledged in the code: if
WordPress processed a POST but the response was lost, no database lock can detect it.
That is precisely why ambiguous outcomes are never auto-retried.

---

## 10. Content → Publish → URL Workflow

| Step | Status | Notes |
|---|---|---|
| Content → Review | **PASS** | Status stepper exists (`DRAFT → IN_REVIEW → APPROVED`) |
| Review → Publish | **PASS** | Publish panel appears for APPROVED/PUBLISHED content with a body |
| Publish → Provider | **PASS** | WordPress adapter, SSRF-guarded, well tested |
| Provider → Verified public URL | **PARTIAL** | A URL is returned and stored, but never validated or domain-checked |
| Verified URL → `Content.url` | **MISSING** | Nothing writes it back |
| `Content.url` → Internal link inventory | **PASS (mechanism) / MISSING (data)** | The inventory query works; there is simply nothing to read |
| Publication → Performance tracking | **MISSING** | No analytics models of any kind |
| Publish → `Content.status` | **MISSING** | Publishing never updates content status |

Everything up to the provider call works. The break is a single missing link:
**verified URL → Content**.

---

## 11. Internal Link Analyzer Dependency

C4.4 becomes possible once all of the following are true:

1. A publishing connection is configured and a real publish succeeds. *(Possible today — never done.)*
2. The publish result is persisted with its verified URL. *(Already works.)*
3. The URL passes a domain-ownership check against the project. **(Does not exist — must be added.)**
4. The URL is associated with the Content record. **(Does not exist — this is Option B.)**
5. The inventory query can read active Content URLs. *(Already works.)*
6. Recommendations are filtered against that inventory. *(Already works, correctly.)*

**Two additional things are required beyond the six listed:**

- **At least two published pages in the same project.** One page has nothing to link
  to. This is a data-volume requirement, not an engineering one.
- **The Internal Link Analyzer's own ownership checks should be brought in line** with
  the four connected tools (it still lacks soft-deleted project and content guards).

Also worth noting: its empty-result message currently blames the AI
("the AI response didn't meet our quality requirements… please try generating again")
when the real cause is an empty inventory. That should be corrected whenever C4.4
proceeds, since retrying can never help and each retry spends AI credit.

---

## 12. Performance Feedback Dependency

**Content has a stable identity that can support this later.** Each record has a
permanent UUID, and once published it gains a durable CMS post ID (`externalId`) and a
public URL — the exact join key that Search Console and analytics platforms use.

So the identity foundation is sound. What is missing is everything else: there are no
analytics, metrics, ranking, or performance models anywhere in the schema, and the
existing SEO performance report only counts content by status — it reads no real
traffic or ranking data.

The practical conclusion: **recording the published URL is the prerequisite for all
future performance work.** Without it there is no way to match a Compass record to a
row of Search Console data.

---

## 13. Remaining AI Tool Readiness

Unchanged from the C4.4 audit — re-confirmed against current data:

| Tool | Status | Reason |
|---|---|---|
| Topic Cluster Planner | **DATA-BLOCKED** | 4 keywords, 1 cluster, only 2 keywords assigned |
| Competitor Content Analysis | **DATA-BLOCKED** | No competitor model or data source |
| Content Calendar Assistant | **DATA-BLOCKED** | No calendar model |
| Image Alt Text Generator | **DATA-BLOCKED** | 0 image files; no vision support in the provider layer |
| Email Newsletter Drafter | **DATA-BLOCKED** | 1 published record, and it has no body |

Five of five remain blocked by missing data rather than missing code.

---

## 14. Recommended Product Priority

**Make publishing real, and associate the verified published URL with the Content record.**

This is the right next step because:

- It is the only capability that unblocks C4.4.
- It closes the workflow's biggest gap — content is created and optimized but never
  actually goes anywhere.
- It produces the join key every future performance feature will need.
- Most of the hard engineering already exists and is well tested. This is a small
  addition to a solid foundation, not a new subsystem.

---

## 15. Smallest Safe Future Implementation

Conceptually, and **not authorized yet**:

1. **Tie a publishing destination to a project's domain, or verify it at publish time.**
   Resolve gap #1 in Section 7 before any URL is written back. This is the one genuine
   prerequisite.
2. **Validate the returned URL** — confirm it parses as an absolute `http(s)` URL and
   that its host matches the project's expected domain. Refuse to record it otherwise.
3. **On a verified success, write that URL to `Content.url`** (and consider setting
   `status`/`publishedAt`, which currently drift from reality).
4. **Close the soft-deleted-project gap** in the publish path.

Everything else — republishing, drift detection, multi-provider canonical rules,
analytics — stays out of scope.

---

## 16. Risks / Open Questions

1. **Connections are not project-scoped.** The blocking design question. Should a
   destination be tied to a project, or should the domain be verified at publish time?
   This needs a decision before implementation.
2. **`bulkPublishContent` is misleading.** It marks content `PUBLISHED` in bulk with
   no external publish and no URL. It is why we have a "published" record that was
   never published. Its name and effect should be reconsidered.
3. **Editing after publishing causes silent drift.** The live page keeps old content
   and nothing warns anyone.
4. **Ambiguous outcomes create untracked live pages.** Correct and safe, but it means
   some published pages may never get a recorded URL without manual reconciliation.
5. **Stale URLs.** If a page is renamed or removed in the CMS, Compass never notices.
6. **Multi-provider is unresolved.** With one provider, `Content.url` can safely hold
   one canonical URL. If a second provider is ever added, "which URL is canonical"
   must be answered — likely by Option D at that point.
7. **Very small dataset.** Even after publishing works, a useful internal-link
   inventory needs at least two published pages per project.
