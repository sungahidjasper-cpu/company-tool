# Phase F.3 — Verified Publish-to-Content.url Implementation

Implemented against the approved Phase F.2 contract. No schema change, no migration.

Date: 2026-09-05

---

## 1. What changed

Three files touched, one new service, one new test file.

| File | Change |
|---|---|
| `features/publishing/services/publishing-domain.service.ts` | **New.** Pure hostname normalization and project/destination compatibility. No I/O, no DNS, no database. |
| `features/publishing/services/publishing-domain.service.test.ts` | **New.** 40 tests, mostly negative/attack cases. |
| `features/publishing/actions/publishing-content.actions.ts` | Soft-deleted project guard, destination-domain gate, and the `Content.url` write inside the existing success transaction. |
| `features/publishing/actions/publishing-content.actions.test.ts` | 21 new tests; two existing fixtures updated for the widened project selection and result type. |

Nothing else was modified. The provider adapter, SSRF guard, job/attempt handling,
retry policy, ambiguity handling and idempotency are all untouched.

---

## 2. Domain matching rule

Both sides are reduced to a comparable hostname before anything is compared:

1. Parse with `URL`. If that fails and the value carries no scheme, retry with an
   `https://` prefix (this is how bare project domains such as
   `acme-plumbing.example.com` are handled). If it already has a scheme and still
   fails, reject — prefixing a malformed value would invent a host.
2. Take `.hostname` (never `.host`, which includes the port).
3. Lowercase; drop a trailing dot.
4. Strip one leading `www.` from the project side only.

Then:

```
allowed = connectionHost === projectHost || connectionHost.endsWith("." + projectHost)
```

**The leading dot is load-bearing.** A bare `endsWith(projectHost)` wrongly accepts
`evil-example.com` and `notexample.com` — both are covered by tests.

A project hostname must have at least two labels, so a domain of `com` can never make
every `.com` site internal.

---

## 3. Shared-hosting protection

On platforms that give every customer a subdomain of one shared parent, a sibling
subdomain belongs to a different customer. For those, subdomain expansion is disabled
and only an exact host match is accepted.

The list is a small internal constant — no dependency, no general public-suffix
system:

`wordpress.com`, `wpcomstaging.com`, `blogspot.com`, `github.io`, `myshopify.com`,
`wixsite.com`, `weebly.com`, `netlify.app`, `vercel.app`, `pages.dev`

The first two matter most: **WordPress is currently the only publishing provider**, so
a project domain of `wordpress.com` is plausible, and without this guard
`someone-elses-blog.wordpress.com` would count as part of the project.

A project hosted *on* such a platform is unaffected — its domain is its own subdomain
(`mysite.wordpress.com`), which keeps full use of its own space while still rejecting
`someone-else.wordpress.com`.

---

## 4. URL validation

Before a CMS-returned URL may become `Content.url` it must parse, be absolute, be
`https:`, and reduce to a host that satisfies the rule above.

**No second DNS lookup.** `assertSafePublicUrl` (which does resolve DNS) is still used
exactly as before on the outbound destination, and is unchanged. The returned URL is
only being *recorded*, not fetched, so it goes through the pure check instead. The
SSRF protection was not weakened or duplicated.

---

## 5. `Content.url` behaviour

| Case | Behaviour |
|---|---|
| A — currently empty (null or whitespace) | Written with the verified URL |
| B — already equals the verified URL | Untouched, no write |
| C — differs | **Preserved.** Never overwritten. Conflict reported |
| D — publish failed | Untouched |
| E — `AMBIGUOUS_RESPONSE` | Untouched, and no publication row is created |
| F — returned URL fails validation | Untouched; the publication itself still stands, because it really did happen |

The write only ever happens from a `ContentPublication` persisted in the same
transaction — never from a provider response held in memory.

---

## 6. Conflict behaviour

A conflict preserves the existing URL and reports it two ways, both using existing
mechanisms with no new model:

- `logActivity` with action `content_publication.url_conflict`, carrying both the
  existing and the published URL.
- `urlConflict: true` on the returned `PublicationSummary`.

A matching URL produces no activity entry and no write.

---

## 7. Soft-delete protection

`checkContentEligibility` now also rejects a soft-deleted **SEO project** — the gap
identified in Phase F, and the same rule already enforced by the connected AI tools.
Existing protections are unchanged and covered by tests: soft-deleted Content is still
blocked, and a non-`ACTIVE` (revoked/invalid) connection is still blocked.

---

## 8. Concurrency

The existing pre-flight `SELECT ... FOR UPDATE` is untouched. The URL decision takes a
**second** lock on the Content row *inside the success transaction*, then reads the
current URL and decides.

This matters because the pre-flight lock is released when its own transaction commits.
Two publishes to two different connections for the same Content could otherwise both
read a null URL and both write. Reading under the lock, in the same transaction that
persists the publication, makes the decision serialized and atomic with it.

Idempotency is unchanged: the already-published path still returns the stored
publication without contacting the provider and without writing.

---

## 9. Tests

**61 new tests.** Full suite: **108 files / 2848 passing** (was 2787).

- 40 in the pure domain service — normalization, allowed cases, and attacks:
  `evil-example.com`, `notexample.com`, `example.com.evil.com`, the userinfo trick
  `https://example.com@evil.com/`, homograph lookalikes, single-label domains, and
  every shared-hosting suffix.
- 21 at the action level — destination eligibility, soft-deleted project (publish and
  retry), all seven `Content.url` cases, the concurrency lock, and idempotency.

**Test-first was genuine.** The new action tests were written and run *before* the
implementation: **10 failed against the old code**, covering exactly the gaps being
closed (unrelated/deceptive destination domains, trashed project, the URL write, and
the conflict report). All pass after.

One test caught a real defect in my own first draft: `toComparableHost("http://")`
fell through to the prefix branch and produced the bogus host `http`. Fixed in the
helper rather than by weakening the test.

Two pre-existing tests needed updating — both because their fixtures overrode the
project without a `domain` (so the new gate correctly failed closed), and one because
the result type legitimately gained `urlConflict`. No test was weakened.

---

## 10. Browser verification

**Browser end-to-end publishing verification was not possible because no publishing
connection is configured.**

There are 0 publishing connections and 0 content rows that could even display the
Publish panel (it requires APPROVED/PUBLISHED status plus a body; the single
`PUBLISHED` row has no body). Creating both would mean fabricating a destination and
credentials, which the instructions rule out — so no publish was performed and none is
claimed.

A regression sanity check was run instead: the Content detail page and the publishing
settings page both render with **zero console or page errors** after the change, and
the database was unchanged by it.

---

## 11. Database impact

**None.** Counts identical before and after: Content 10, Content with a URL 0,
ContentPublication 0, PublishingConnection 0, PublishingJob 0, Activity 47. No test
fixtures were created, so none needed cleanup. No schema change, no migration.

---

## 12. Known limitations

1. **Unverified in the real world.** Every path is unit-tested, but no real publish has
   ever run. The first real publish will be the first true test.
2. **Subdomain policy is broad by design.** Any subdomain of the project domain is
   accepted. That is the approved policy, mitigated for shared hosts by the constant
   list.
3. **The shared-host list is hand-maintained.** An unlisted shared platform degrades to
   an SEO-correctness issue (a project's link inventory could include another
   customer's site), never to an access-control one — publishing still requires valid
   company-owned credentials.
4. **Ambiguous outcomes still leave untracked live pages** — correct and unchanged, but
   such a page will never get a recorded URL without manual reconciliation.
5. **Stale URLs.** If a page is renamed or deleted in the CMS, Compass does not notice.
6. **`Content.status` and `publishedAt` are still not updated by publishing**, and
   `bulkPublishContent` still marks content `PUBLISHED` with no external publish. Both
   were deliberately out of scope.
7. **C4.4 is still data-blocked** — this makes real URLs *possible*, but none exist
   until a connection is configured and at least two pages per project are published.
