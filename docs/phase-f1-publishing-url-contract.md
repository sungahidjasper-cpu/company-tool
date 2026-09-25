# Phase F.1 — Publishing URL Ownership Contract

Discovery only. No code, schema, or data was changed.

Date: 2026-09-05

---

## 1. Current Architecture

```
PublishingConnection ──belongs to──> Company
SEOProject           ──belongs to──> Company   (and has a `domain`)
Content              ──belongs to──> SEOProject
ContentPublication   ──belongs to──> Company + Content + PublishingConnection
```

The two things we now need to compare — a connection's `baseUrl` and a project's
`domain` — are only related through the Company. Nothing else connects them.

The four URL-ish fields, as they are actually defined and validated today:

| Field | Validation | Reality |
|---|---|---|
| `PublishingConnection.baseUrl` | **Strict.** Must parse as a URL and be `https:` | Always a well-formed absolute HTTPS URL |
| `SEOProject.domain` | **`z.string().min(3)`** — free text | Anything at least 3 characters |
| `Content.url` | "looks like a URL" only, optional | Currently always empty |
| `ContentPublication.externalUrl` | **None.** Stored as returned | Whatever the CMS reports |

---

## 2. Domain Ownership Problem

### Real data (development database)

`SEOProject.domain` is genuinely inconsistent — this is measured, not hypothetical:

| Project | Stored domain | Shape |
|---|---|---|
| Acme Plumbing SEO | `acme-plumbing.example.com` | bare hostname |
| Playwright QA Verification | `qa-verification.example.com` | bare hostname |
| No-Analysis QA Project | `no-analysis-qa.example.com` | bare hostname |
| Activity Fix Verify Project | `activity-fix-verify.example.com` | bare hostname |
| **Storage Moguls** | `https://www.storagemoguls.com/` | **protocol + www + trailing slash** |

Four of five are bare hostnames that `new URL()` cannot parse at all. One is a full
URL. So a rule based on raw string comparison would fail immediately.

`PublishingConnection.baseUrl` and `ContentPublication.externalUrl` have no real
examples yet — there are zero connections and zero publications.

### Why this has not bitten us before

**`SEOProject.domain` is currently used only as display text inside AI prompts**
(`Website: ${domain}`). It is never parsed, never compared, never used to build a URL.
That is exactly why its format was free to drift.

The moment we compare hosts, that format becomes load-bearing for the first time.

### What each field may contain

| | protocol | www | path | trailing slash | port | query | fragment | bare host |
|---|---|---|---|---|---|---|---|---|
| `SEOProject.domain` | sometimes | sometimes | possible | sometimes | possible | possible | possible | **usually** |
| `PublishingConnection.baseUrl` | **always** | possible | possible | possible | possible | possible | possible | never |
| `ContentPublication.externalUrl` | expected | possible | **usually** | possible | possible | possible | possible | unlikely |
| `Content.url` | expected | possible | possible | possible | possible | possible | possible | possible |

---

## 3. Recommended Project/Connection Compatibility Rule

### Option assessment

| Option | Security | SEO correctness | Multi-project | Complexity | Migration | Wrong-domain risk |
|---|---|---|---|---|---|---|
| **A. Same company only** (today) | Tenant-safe | **Poor** — no relationship between where content lives and where it publishes | One connection serves all projects | None | None | **High** once URLs are written back |
| **B. Same company + host match at publish time** | Tenant-safe | **Good** — a page can only be published where its project actually lives | One connection can serve several projects sharing a domain | Small, pure comparison | **None** | **Low** |
| **C. Explicit project→connection link** | Tenant-safe | Good | Explicit but rigid; needs a row per pairing | Schema change + UI + backfill | **Yes** | Low |
| **D. Other existing approach** | — | — | — | — | — | No other mechanism exists |

### Recommendation: **OPTION B**

At publish time, compare the connection's `baseUrl` host with the project's `domain`
host. Refuse the publish if they differ.

Chosen because it requires **no schema change and no migration**, it directly prevents
the actual hazard (a project's link inventory filling with someone else's domain), and
it keeps the existing company-scoped connection model intact. Option C is more
explicit but buys little extra safety for a system with one provider and zero
connections, at the cost of a new relation and a backfill.

### The comparison rule this requires

Both sides must be reduced to a comparable host before comparing — never raw strings:

1. Try to parse the value as a URL. If that fails (a bare hostname), retry with
   `https://` prefixed.
2. Take the `hostname`.
3. Lowercase it.
4. Strip a single leading `www.`.
5. Compare for exact equality.

Verified against the real values:

| Input | Resulting host |
|---|---|
| `https://www.storagemoguls.com/` | `storagemoguls.com` |
| `www.storagemoguls.com` | `storagemoguls.com` |
| `storagemoguls.com` | `storagemoguls.com` |
| `https://www.storagemoguls.com/blog/my-post/` | `storagemoguls.com` |
| `acme-plumbing.example.com` | `acme-plumbing.example.com` |
| `https://blog.storagemoguls.com/post` | **`blog.storagemoguls.com`** |

**Open question (see §12):** the last row does not match `storagemoguls.com`. Strict
host equality rejects publishing to a blog subdomain, which is a common real-world
setup. A decision is needed on whether subdomains are allowed.

---

## 4. URL Validation Rule

Before any URL is copied to `Content.url` it must:

1. Parse as a URL.
2. Use `http:` or `https:` only.
3. Be absolute.
4. Have a host that matches the project's expected domain by the §3 rule.
5. Come from a publication that was actually persisted for this Content and company.

### Reuse rather than duplicate

`assertSafePublicUrl` in `features/publishing/services/ssrf-guard.service.ts` already
parses the URL, enforces `https:`, blocks localhost and private/internal addresses,
and — importantly — **returns the parsed `hostname`**. It is already called on the
connection's `baseUrl` during every publish.

**Reuse it for the connection side.** For the returned `externalUrl`, note that
`assertSafePublicUrl` performs a **DNS lookup**, which is appropriate when we are
about to send a request somewhere but is unnecessary and slow for a URL we are merely
recording. A small pure host-extraction helper — no DNS, no network — is the right fit
there, and no such helper exists anywhere in the repo today.

---

## 5. `Content.url` Overwrite Policy

Recommended deterministic rule, case by case:

| Case | Situation | `Content.url` should |
|---|---|---|
| **1** | Currently `null`, publish succeeds and the URL is verified | **Update.** The main path. |
| **2** | Already equals the verified URL | **Remain unchanged.** No write, no noise. |
| **3** | Holds a *different* URL, publish returns another verified URL | **Update, and record the change.** A CMS-confirmed URL outranks a stored one, but the previous value should be visible in the activity trail rather than vanishing silently. |
| **4** | Was entered manually, publish returns a verified URL | **Update.** A verified URL from the system that actually created the page is more trustworthy than a typed one. Same activity-trail note as case 3. |
| **5** | Republish to the same destination returns a new URL | **Cannot occur today** — republishing to the same connection is refused, so no new URL is ever returned. If republishing is ever added, the newest verified URL should win. |
| **6** | Publish fails | **Remain unchanged.** No publication row exists, so there is nothing verified to copy. |
| **7** | `AMBIGUOUS_RESPONSE` | **Remain unchanged.** See §6. |

The single governing principle: **`Content.url` is only ever written from a
`ContentPublication` row that was successfully persisted.** Never from a provider
response held only in memory, and never from a guess.

---

## 6. Failure / Ambiguous Publication Policy

Confirmed current behaviour: if the CMS publishes successfully but Compass fails to
save the result, the code catches the error, returns an honest message, and leaves the
job `RUNNING`. `reapStalePublishingJobs()` later marks it `FAILED` /
`AMBIGUOUS_RESPONSE`, which is deliberately not retryable.

**Required rule: `Content.url` must remain unchanged in this situation.**

The reasoning is exactly the reasoning already in the code — Compass cannot confirm
what happened, so it must not record what it cannot verify. Since the write is bound
to a persisted `ContentPublication` row (§5), and no such row is created on the
ambiguous path, this rule holds automatically rather than needing a special case.

The known consequence, unchanged from Phase F: a page can be genuinely live while
Compass has no URL for it. That is the correct trade-off, but it means some form of
manual reconciliation will eventually be wanted.

---

## 7. Soft-Delete Requirements

| Entity | Currently checked at publish? | Assessment |
|---|---|---|
| **Content** (`deletedAt`) | ✅ Yes — "This content has been archived and cannot be published." | Correct |
| **SEOProject** (`deletedAt`) | ❌ **No** | **Real gap.** Same pattern already corrected in the four connected AI tools. Content under a trashed project can still be published. |
| **Company** (`deletedAt`) | ❌ No | Theoretical — a live session for a soft-deleted company could still publish. Low priority. |
| **PublishingConnection** | ✅ Yes — requires `status: ACTIVE` | Correct. There is no `deletedAt`; disconnect sets `REVOKED` and deletes the stored credential. Well handled. |

The SEOProject gap should be closed as part of the same change, since a URL written
back from a trashed project would pollute that project's inventory if it were ever
restored.

---

## 8. Republish Behaviour

Confirmed, and **not to be altered**:

| Scenario | Current behaviour | `Content.url` should |
|---|---|---|
| First publication | Job created under a `FOR UPDATE` lock; publication row created on success | Update (case 1) |
| Repeated publish, same connection | Refused — returns the existing publication with `alreadyPublished: true` | Unchanged, or idempotently re-affirmed to the same value |
| Retry | Separate path; only `NETWORK_TIMEOUT` is retryable | Update only if it now succeeds and persists |
| Concurrent publish | Serialized by the row lock; the loser sees the winner's result | Update once, not twice |
| Publish to a *second* connection | Allowed — creates a second publication row | **Open question (§12)** — which URL is canonical |

The existing idempotency design is sound and should be left exactly as it is. The URL
write should simply follow whatever the publication layer already decided.

---

## 9. Internal Link Dependency

The resulting flow would be:

```
Content → Publish → verified externalUrl → Content.url → internal link inventory
```

**This would safely unblock the Internal Link Analyzer**, because its inventory query
already reads `Content.url` and its deterministic filter already rejects any target
not in that list. No change to the analyzer's logic is needed.

Two further things are still required, and neither is part of this contract:

1. **At least two published pages in the same project.** One page has nothing to link
   to — a data-volume requirement, not an engineering one.
2. **The analyzer's own ownership checks** should be brought in line with the four
   connected tools (it still lacks soft-deleted project and content guards), and its
   empty-result message should stop blaming the AI when the real cause is an empty
   inventory.

---

## 10. Performance Feedback Dependency

**Yes — this provides sufficient identity.** After a verified publish, a Content record
would carry three durable identifiers: its own permanent UUID, the CMS post ID
(`externalId`), and the public URL. The URL is the exact join key Search Console and
analytics platforms use.

Nothing else in the schema supports analytics today, and none is proposed here. The
point is simply that recording the verified URL is the prerequisite that makes any
future performance work possible at all.

---

## 11. Smallest Future Implementation

Conceptually, and **not authorized**:

1. A small pure helper that reduces any of these values to a comparable host
   (parse, fall back to `https://` prefix, lowercase, strip one leading `www.`).
   Fully unit-testable, no network, no schema change.
2. At publish time, compare the connection's host to the project's host and refuse
   mismatches.
3. Close the soft-deleted-project gap in the publish path.
4. On a verified, persisted publication, write the URL to `Content.url` following
   the §5 policy, and log the change when it replaces an existing value.

Explicitly **out of scope**: republishing, drift detection, multi-provider canonical
rules, analytics, and any change to the existing idempotency or ambiguity handling.

---

## 12. Risks / Open Questions

1. **Subdomains — needs a product decision.** Strict host equality rejects
   `blog.example.com` for a project at `example.com`, which is a common publishing
   setup. Options: strict equality (safest), allow exact-suffix subdomains, or make it
   configurable. This is the main open question.
2. **`SEOProject.domain` is unvalidated free text.** Four of five real values are bare
   hostnames; one is a full URL. The comparison rule handles both, but the field
   should probably be tightened at some point — carefully, since existing rows would
   need to remain valid.
3. **Multi-provider canonical URL.** With one provider, `Content.url` can safely hold
   one canonical URL. Publishing the same Content to a second connection would create
   a second publication and an unanswered "which URL wins" question. Fine today;
   revisit if a second provider is added.
4. **Stale URLs.** If a page is renamed or deleted in the CMS, Compass never notices.
5. **Ambiguous outcomes leave untracked live pages** — correct and safe, but some
   manual reconciliation will eventually be wanted.
6. **`bulkPublishContent` remains misleading.** It marks content `PUBLISHED` in bulk
   with no external publish and no URL, which is why a "published" record exists that
   was never published. Worth revisiting separately.
7. **Nothing can be verified end-to-end until a real connection exists.** There are
   still zero connections, jobs, and publications, so the first real publish will be
   the first genuine test of this contract.
