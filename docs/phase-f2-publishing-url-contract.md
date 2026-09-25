# Phase F.2 — Final Publishing URL Contract

Design only. No code, schema, or data was changed.

Date: 2026-09-05

Supersedes the open questions in `phase-f1-publishing-url-contract.md`. That report
and the Phase F / C4.4 reports are unchanged.

---

## 1. Final Domain Matching Policy

A publishing connection is compatible with an SEO project when **all** of the
following hold:

1. Both belong to the same Company.
2. The connection's `baseUrl` parses as a safe public URL.
3. The project's `domain` normalizes to a hostname.
4. The connection hostname is **either** exactly the project hostname **or** a genuine
   subdomain of it.

### The exact comparison rule

Both values are reduced to a comparable hostname before anything is compared:

1. Try `new URL(value)`. If that throws (a bare hostname like `example.com`), retry as
   `new URL("https://" + value)`.
2. Take **`.hostname`** — never `.host`.
3. Lowercase it.
4. Remove a single trailing dot (the FQDN form `example.com.`).
5. On the **project** side only, strip one leading `www.`.
6. If either side cannot be reduced to a hostname, **reject** (fail closed).

Then:

```
allowed = connectionHost === projectHost
       || connectionHost.endsWith("." + projectHost)
```

### Verified against attack strings

I tested two candidate rules against 16 cases. Results:

| Rule | Incorrect results |
|---|---|
| `endsWith(projectHost)` — no dot separator | **2 failures** |
| `endsWith("." + projectHost)` — dot separator | **0 failures** |

The naive version wrongly **allowed** `evil-example.com` and `notexample.com` for a
project at `example.com`. **The leading dot is mandatory, not cosmetic.**

All allowed cases passed: exact host, `www` on either side, `blog.`/`shop.`
subdomains, deep subdomains (`a.b.example.com`), uppercase input, paths and trailing
slashes, ports, and the FQDN trailing-dot form.

All attacks were rejected by the dotted rule: `evil-example.com`,
`example.com.evil.com`, `www.example.com.evil.com`, `notexample.com`, unrelated
domains, and the userinfo trick `https://example.com@evil.com/` (which parses to host
`evil.com`).

### Three implementation details that are security-relevant

- **Use `.hostname`, not `.host`.** `.host` includes the port, so
  `blog.example.com:8443` would never match `blog.example.com`. Confirmed by test.
- **Compare parsed hostnames, never raw strings.** Raw string matching is what makes
  the userinfo trick (`https://example.com@evil.com/`) dangerous.
- **Fail closed.** `SEOProject.domain` is unvalidated free text; if it cannot be
  reduced to a hostname, the publish must be refused, never allowed by default.

Internationalised domains are handled safely for free: `new URL()` converts them to
punycode consistently on both sides, and a homograph lookalike produces a different
punycode host, so it fails closed.

### One genuine flaw in the proposed policy: shared hosting suffixes

**Subdomain matching is unsafe when the project's own domain is a shared hosting
suffix.** Confirmed by test:

| Project domain | Rule would accept |
|---|---|
| `wordpress.com` | `someone-elses-site.wordpress.com` |
| `myshopify.com` | `someone-elses-site.myshopify.com` |
| `github.io` | `someone-elses-site.github.io` |
| `com` | `someone-elses-site.com` |

This matters here specifically because **WordPress is our only provider**, so a
project domain of `wordpress.com` is entirely plausible.

**Severity, stated honestly:** this is *not* a cross-tenant authentication bypass in
Compass. Publishing still requires valid, company-owned, encrypted credentials for the
destination site, so nobody gains access they did not already have. The real harm is
**SEO correctness** — a project's internal-link inventory could come to include
another customer's site as though it were internal.

**Mitigation without adding a dependency** (a public-suffix list would be a new
dependency, which is out of scope):

1. Require the project hostname to have **at least two labels** — this alone rejects
   `com`.
2. Keep a small internal constant listing well-known shared hosting suffixes
   (`wordpress.com`, `myshopify.com`, `github.io`, `blogspot.com`, and similar). When
   the project hostname is one of these, require an **exact host match** and disable
   subdomain expansion.

This is a short constant list, not a dependency, and it fails safe: an unlisted shared
host degrades to the SEO-correctness issue above, never to an access-control issue.

---

## 2. Final `Content.url` Policy

The governing principle: **`Content.url` is only ever written from a
`ContentPublication` row that was successfully persisted and whose URL passed
validation — and it is never silently replaced.**

| Case | Situation | Behaviour |
|---|---|---|
| **A** | `Content.url` is null/empty | **Populate** with the verified published URL |
| **B** | Already equals the verified URL | **Leave unchanged** (no write) |
| **C** | Differs from the verified URL | **Preserve the existing value.** Do not overwrite. Report the conflict via the existing activity/result mechanism |
| **D** | Publishing fails | **Unchanged** |
| **E** | `AMBIGUOUS_RESPONSE` | **Unchanged** |
| **F** | Publish succeeded but URL validation failed | **Unchanged**, and the returned URL must not be treated as a valid Content URL |
| **G** | Manually entered URL that matches the verified URL | **No change required** (same as B) |

### How a conflict is reported without a new model

Two existing mechanisms are sufficient:

- **`logActivity`** already accepts a free-form `action` string plus a JSON `metadata`
  object and links to `contentId`. A conflict can be recorded there (for example an
  action such as `content_publication.url_conflict` carrying both URLs), exactly as
  publishing already logs its successes and failures.
- **`PublicationSummary`**, the action's return type, is a plain TypeScript type with
  no database backing. It can carry a conflict flag so the UI can surface it.

Neither requires a schema change.

---

## 3. URL Validation Requirements

Before a published URL may reach `Content.url` it must:

1. Parse as a URL.
2. Be **absolute**.
3. Use **`https:`** (matching what connections already require).
4. Reduce to a hostname that satisfies the §1 domain rule against the project.
5. Originate from a `ContentPublication` row that was actually persisted for this
   Content, connection and company.

`Content.url` must **never** be populated from:

- an unverified provider response held only in memory,
- a failed publication,
- an ambiguous response,
- the connection's `baseUrl` (that is a destination, not a page),
- an AI-generated URL,
- a URL derived from a title or slug.

---

## 4. Security Boundaries

Already enforced by the existing publish path and to be preserved unchanged:

- Role permission (`managePublishingConnections`).
- Three-part ownership: Content's company, connection's company, and the requirement
  that both are the *same* company.
- Credentials decrypted only immediately before the outbound call; never logged or
  persisted.
- SSRF protection on the outbound destination.
- Row-level locking against concurrent publishes.

Added by this contract:

- Connection host must match the project host (§1).
- Returned URL must pass validation before touching `Content.url` (§3).

---

## 5. Failure Behaviour

A failed publish records a `PublishingAttempt` and a `FAILED` `PublishingJob` with a
classified error type. **No `ContentPublication` row is created, so no URL write can
occur.** `Content.url` is untouched. Only `NETWORK_TIMEOUT` remains retryable. None of
this changes.

---

## 6. Ambiguous Behaviour

If the CMS publishes successfully but Compass cannot persist the result, the job is
left `RUNNING` and the startup reaper marks it `FAILED` / `AMBIGUOUS_RESPONSE`, which
is deliberately not retryable.

**`Content.url` must remain unchanged.** Because the write is bound to a persisted
publication row, and no such row exists on this path, this holds automatically — no
special case is needed.

Known consequence, unchanged: a page can be genuinely live while Compass has no URL
for it. That is the correct trade-off; manual reconciliation may be wanted later.

---

## 7. Conflict Behaviour

Under Case C, an existing different URL always wins over a newly verified one. This
deliberately protects a live, indexed SEO URL from being silently replaced by an
automated process. The conflict is surfaced, not resolved automatically. A human
decides.

---

## 8. Soft-Delete Requirements

The future implementation must refuse to publish when:

| Condition | Currently enforced? |
|---|---|
| `Content.deletedAt` is not null | ✅ Yes |
| `SEOProject.deletedAt` is not null | ❌ **No — gap to close** |
| Connection is not `ACTIVE` (`INVALID` / `REVOKED`) | ✅ Yes |

The project gap is the same pattern already corrected across the four connected AI
tools, and should be closed as part of this work.

---

## 9. Provenance Decision

**NOT REQUIRED for the initial implementation.**

The schema has no field distinguishing a manually entered URL from a publication-derived
one — `Content` carries only `url` and `generatedByAi` (which describes AI authorship,
not URL origin).

That does not matter here, because under the Case C policy **`Content.url` is only ever
written when it is empty**. A value is never replaced, so nothing needs to know where
the existing one came from. The activity trail independently records every publish and
every conflict.

Provenance would only become necessary if a future phase wanted to *automatically*
update a URL when the CMS changes it. That is out of scope. If it is ever taken up, the
minimum design would be a single nullable column recording the origin — but it should
not be added speculatively now.

---

## 10. Minimum Implementation Scope

1. A small **pure** host-normalization helper (parse, `https://` fallback, `.hostname`,
   lowercase, strip trailing dot, strip one leading `www.` on the project side).
   No network, no DNS, no schema change.
2. A project/connection host compatibility check, including the ≥2-label rule and the
   shared-suffix exact-match constant.
3. Close the soft-deleted-project gap in the publish path.
4. Validate the returned publication URL (§3).
5. Populate `Content.url` **only when empty**.
6. Preserve the existing URL on conflict and report it via activity/result.
7. Leave existing failure, ambiguity, idempotency and retry behaviour exactly as it is.
8. Tests per §11.

---

## 11. Required Test Matrix

**Domain matching (pure function — cheap, exhaustive):**
exact host · www vs non-www on both sides · uppercase host · valid subdomain ·
deep subdomain · deceptive suffix (`evil-example.com`) · suffix domain
(`example.com.evil.com`) · `notexample.com` · unrelated domain · userinfo trick ·
protocol variation · trailing slash · path · port · trailing dot · malformed project
domain · malformed connection URL · empty/whitespace · single-label domain (`com`) ·
shared-suffix host (`wordpress.com` + someone else's subdomain).

**Publication:**
success with empty `Content.url` (populates) · success with identical URL (no write) ·
success with conflicting URL (preserved + conflict reported) · failed publish ·
ambiguous publish · invalid returned URL · wrong-domain returned URL · non-https
returned URL · soft-deleted project · soft-deleted Content · revoked connection.

**Security:**
cross-company connection · cross-project destination · competitor/external domain ·
concurrent publication (lock holds, one write) · retry · `alreadyPublished` idempotent
path.

Every rejection test must also assert that **no `ContentPublication` row was created
and `Content.url` was not modified**.

---

## 12. Intentionally Out of Scope

- Republishing and republish-driven URL updates.
- Drift detection when a page is edited after publishing.
- Multi-provider canonical URL rules (revisit if a second provider is added).
- A public-suffix list dependency.
- Any `Content.status` / `publishedAt` change on publish.
- `bulkPublishContent` behaviour (still misleading — marks content `PUBLISHED` with no
  external publish; worth revisiting separately).
- Internal Link Analyzer implementation.
- Performance analytics.
