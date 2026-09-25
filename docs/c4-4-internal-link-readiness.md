# C4.4 Internal Link Analyzer — Readiness Audit

Discovery only. No code, schema, or data was changed.

Date: 2026-09-05

---

## 1. Executive conclusion

**C4.4 is data-blocked. Do not connect the Internal Link Analyzer to Content Detail yet.**

The tool needs a list of other real pages, each with a URL, to recommend links to.
Right now **not one Content record in the database has a URL** — all 10 are empty.
The tool's own safety filter (correctly) throws away any recommendation that does
not point at a real supplied URL, so with no URLs it can only ever return nothing.

This is not a bug. The safety design is working exactly as intended. The problem is
that there is no trustworthy URL data for it to work with, and nothing in the app
currently produces any.

Connecting it today would add a button that always leads to an empty result.

---

## 2. Authoritative Content URL source

**There isn't one today.**

`Content.url` is the only field that looks like a public URL, but it is not
authoritative:

- It is optional and free-text, typed in by a person.
- Nothing generates it automatically.
- Publishing never writes it back.
- There is no slug field anywhere, so no URL can be derived from the content itself.

`SEOProject.domain` does exist and is required, so every project has a base domain.
But domains are stored inconsistently — Storage Moguls is saved as
`https://www.storagemoguls.com/` (full URL with a trailing slash) while others are
saved as bare hostnames like `acme-plumbing.example.com`. There is no normalization.

There is a **better** candidate that already exists: `ContentPublication.externalUrl`,
which stores the real URL returned by the CMS when a page is actually published.
That is a genuinely authoritative value — but there are currently **zero**
publication records, because publishing has never been run.

Answers to the specific questions asked:

| Question | Answer |
|---|---|
| Authoritative source of a public URL? | None today. `ContentPublication.externalUrl` is the best candidate but is unused. |
| What is `Content.url` meant to be? | Undefined. It is a free-text field with only "is this a valid URL" validation. Not marked canonical, public, or draft. |
| When is it populated? | Only when a person types it in. |
| Can users edit it? | Yes — create form, edit form, and CSV import. |
| Generated automatically? | No. |
| Populated after publishing? | No. Publishing stores its URL separately and never copies it back. |
| Separate slug field? | No. |
| Project domain available? | Yes (`SEOProject.domain`, required) but not normalized. |
| Publishing system that could establish the final URL? | Yes, the WordPress publishing feature — but it has never been used. |
| Draft URL vs public URL? | No distinction exists. |

---

## 3. Current URL data inventory

Measured directly against the development database (read-only).

**Content records**

| Measure | Count |
|---|---|
| Total Content records | 10 |
| Active (not deleted) | 9 |
| Soft-deleted | 1 |
| **With a non-null URL** | **0** |
| With a non-empty URL | 0 |
| Valid absolute URLs | 0 |
| Valid relative paths | 0 |
| Duplicate URLs | 0 |
| URLs on another domain | 0 |
| Published (status) | 1 |
| Draft (status) | 8 |

**Storage Moguls** (our main verification workspace): 4 active records plus 1 in the
trash. **Every single one has an empty URL.** Its linkable inventory is zero.

Every other project is the same: zero linkable targets, across all five projects.

**Publishing data**

| Measure | Count |
|---|---|
| ContentPublication rows | 0 |
| Rows with an external URL | 0 |
| Publishing connections configured | 0 |
| Publishing jobs run | 0 |

**One promising source does exist.** The Website Analysis crawler has already
collected **12 real crawled pages for Storage Moguls**, with genuine absolute URLs on
the project's own domain. These are real site pages — but they are crawler results,
not Content records, and nothing currently links the two together.

---

## 4. URL lifecycle

Every place that writes `Content.url`:

| File | Function | Trigger | Source of value | Validated? | Can go stale? |
|---|---|---|---|---|---|
| `features/seo/actions/content.actions.ts` | `createContent` | User creates content | Typed by user | Format only | Yes |
| `features/seo/actions/content.actions.ts` | `updateContent` | User edits content | Typed by user | Format only | Yes |
| `features/seo/actions/content.actions.ts` | `importContentCsv` | CSV import | CSV column | Format only | Yes |

That is the complete list. Notably:

- **AI-created Content never sets a URL.** Both the brief-to-content and
  long-form-to-content paths create records without one. Six of our nine active
  records were made this way, which is exactly why they are all empty.
- **Publishing never writes it back.** A successful publish stores its URL on
  `ContentPublication` and leaves `Content.url` untouched.
- **Restoring a revision cannot affect it.** `ContentRevision` does not store a URL
  at all, so restore never changes it.
- Validation is only "does this look like a URL". Nothing checks that it belongs to
  the project's own domain, that it is unique, or that the page actually exists.

So a URL can only ever appear if a person types it in, and once typed it can silently
become wrong.

---

## 5. Internal Link Analyzer readiness

The tool itself is well built. Its pieces:

- **Input:** a project and one source page.
- **Candidate list:** built by the job runner as
  *"every other page in this project that has a URL"* — records without a URL are
  filtered out entirely.
- **Safety filter:** after the AI responds, every recommendation whose target URL is
  not a character-for-character match against that supplied list is discarded. It is
  never repaired or guessed at.

**Can it safely recommend links with empty URLs? No — but it fails safely.**

With no URLs the candidate list is always empty, so every recommendation is dropped
and the result is always zero. It cannot invent a link, which is the correct
behaviour. It simply cannot do anything useful.

**Minimum data required to make it genuinely work:** at least two pages in the same
project, each with a real, trustworthy URL. Realistically that means either a real
publishing step that records the final URL, or URLs deliberately attached to Content
records from the crawl data we already have.

---

## 6. Recommended C4.4 option

**Recommendation: OPTION D — do not implement C4.4 yet.**

| Option | Assessment |
|---|---|
| **A. Use `Content.url` only** | Would work mechanically and is secure, but with zero URLs it produces a button that always returns nothing. Adds a dead end. **Rejected.** |
| **B. Derive URLs from domain + slug** | There is no slug field, and project domains are stored inconsistently. We would be inventing URLs that may not exist — exactly the fabrication risk the tool was designed to prevent. Would also require schema changes. **Rejected, and actively unsafe.** |
| **C. Build a URL/publishing abstraction** | This is the right long-term answer, but it is a significant piece of product work, not a contextual hand-off. It belongs in its own phase with its own approval. **Too big for C4.4.** |
| **D. Defer C4.4** | Costs nothing, hides no capability the user currently has, and avoids shipping a guaranteed empty result. **Recommended.** |

Option D is the smallest safe path. C4.4 should be reconsidered immediately after
real URL data exists — at that point it becomes a small, mechanical change identical
to C4.1/C4.2/C4.3/C4.5.

---

## 7. Remaining AI tool readiness matrix

| Tool | Data needed | Exists today? | New model needed? | Status |
|---|---|---|---|---|
| **Topic Cluster Planner** | Meaningful keywords and clusters | 4 keywords, 1 cluster, only 2 keywords assigned | No | **DATA-BLOCKED** (models fine, dataset far too small) |
| **Competitor Content Analysis** | Competitor pages/rankings | Nothing — no competitor model at all | Yes | **DATA-BLOCKED** |
| **Content Calendar Assistant** | Calendar/scheduling persistence | No calendar model; 1 record with a publish date | Yes | **DATA-BLOCKED** |
| **Image Alt Text Generator** | Image inventory + vision-capable AI | 0 image files (all uploads are CSVs); no vision support in the provider layer | Probably | **DATA-BLOCKED** |
| **Email Newsletter Drafter** | Enough published content | 1 published record, and it has no body | No | **DATA-BLOCKED** |
| **Internal Link Analyzer (C4.4)** | Content URLs | 0 of 10 records | No | **DATA-BLOCKED** |

All six remain blocked. Notably, **none of them is blocked by missing code** — five
of six need real data, not new features. Only Competitor Analysis and Calendar would
genuinely need new models.

---

## 8. Current workflow coverage

Intended flow and what actually exists:

| Step | Status |
|---|---|
| Content Gap Analysis → Brief | ✅ Connected (C2) |
| Brief → Content | ✅ Connected |
| Content → Long-Form Draft | ✅ Connected (C3) |
| Content → Meta Optimization | ✅ Connected (C4.1) |
| Content → Rewrite | ✅ Connected (C4.2) |
| Content → Schema | ✅ Connected (C4.3) |
| Content → Social Snippets | ✅ Connected (C4.5) |
| Content → Internal Links | ❌ Blocked (this audit) |
| Content → Publishing | ⚠️ Built but never used — no connections configured, nothing ever published |
| Publishing → Performance feedback | ❌ Does not exist |

The creation and optimization half of the workflow is essentially complete. The
**publish and measure** half is where everything stops.

---

## 9. Most important next product capability

**Make publishing real, and have it record the published URL back onto the Content record.**

This one capability unblocks the most:

- It creates the first trustworthy URLs in the system, which unblocks C4.4 directly.
- It closes the workflow's biggest gap (content is created and optimized but never
  actually goes anywhere).
- It is the only sensible foundation for any future performance feedback, since you
  cannot measure a page you cannot identify.
- The publishing feature is already built — it needs to be connected, used, and made
  to write the resulting URL back.

Everything else on the roadmap is waiting on data that this step starts producing.

---

## 10. Risks and blockers

1. **Empty results look like AI failures.** When the Internal Link Analyzer returns
   nothing, the message shown is *"the AI response didn't meet our quality
   requirements this time. Please try generating again."* With no URLs in the
   project, the real reason is "there are no other pages to link to" — retrying can
   never help, and each retry spends AI credit. This is the same class of misleading
   message we fixed for the Press Release Generator.

2. **`SEOProject.domain` is not normalized.** Some projects store a full URL with a
   trailing slash, others a bare hostname. Any future URL-building work must handle
   this or it will produce broken links.

3. **`Content.url` has no ownership rules.** Nothing checks that a typed URL belongs
   to the project's own domain, so a user could enter a competitor's URL and the
   Internal Link Analyzer would treat it as a valid internal link target.

4. **Internal Link Analyzer's server checks are behind the others.** Its ownership
   helpers do not check soft-deleted projects or soft-deleted content, unlike the
   four connected tools. This should be brought in line whenever C4.4 proceeds.

5. **The dataset is very small overall.** 10 content records, 4 keywords, 1 cluster,
   0 images, 0 publications. Most roadmap decisions are currently limited by data
   volume rather than by engineering.

---

## 11. Recommended next phase

1. **Do not build C4.4 now.** Revisit once real URLs exist.
2. **Next phase: make publishing real and capture the published URL.** Configure a
   publishing connection, publish content for real, and write the resulting URL back
   onto the Content record so the rest of the system can rely on it.
3. **Small, cheap fix worth doing separately:** correct the Internal Link Analyzer's
   empty-result message so it tells the truth when a project has no linkable pages,
   instead of blaming the AI and inviting a pointless retry.
4. **Then reconsider C4.4**, which should become a small mechanical change matching
   the other contextual hand-offs.

Leave the remaining five AI tools parked. They are blocked by missing data, not by
missing code, and building them now would produce tools that cannot give trustworthy
answers.
