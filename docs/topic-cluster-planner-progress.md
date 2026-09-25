# Topic Cluster Planner — Implementation & Enhancement

The tenth AI Workspace tool.

- **Stage 1** (2026-09-05): built as a single pillar + flat supporting topics.
- **Stage 2** (2026-09-05): enhanced into a full topical cluster planner with
  hierarchy, multi-select, and a hand-off into the existing Content workflow.

---

## 1. Existing implementation (Stage 1, preserved)

Select a project → enter a seed topic → optionally tick real project keywords →
generate → review → copy. Review-only, no persistence, no new Prisma model
beyond one `AiTaskType` enum value.

**All of that still works.** Stage 2 extended it rather than replacing it: the
same route, action, job runner, task type, project-selection rule, grounding
doctrine, error presentation and Copy action. A plan generated *before* the
enhancement still opens correctly (see §4).

---

## 2. Enhancement scope

| Before | After |
|---|---|
| One pillar | 2–5 recommended clusters |
| Flat supporting topics | Cluster → supporting topics → subtopics |
| — | Related content ideas per cluster |
| — | Multi-select clusters and individual topics |
| — | Selection review summary |
| — | Hand-off into the existing Content Brief workflow |
| — | Deterministic near-duplicate (cannibalization) detection |
| Copy: flat text | Copy: full hierarchy |

**No Prisma change and no migration were needed for the enhancement** — the
task type already existed and the plan is still review-only.

---

## 3. UI changes

The top of the screen is deliberately unchanged: SEO project → topic →
existing keywords → audience → notes → generate button. The only edit there is
the label, now **Primary topic**, with helper text clarifying it is the user's
own input rather than a keyword discovered from their data.

Everything new sits *below* the generation controls:

- **Recommended clusters** — one card per cluster, collapsible, with the first
  expanded so the result is never a wall of collapsed rows.
- Each card shows the cluster's purpose, its relationship to the primary topic,
  intent/format badges, real related keywords, and a hedged coverage note.
- Expanding reveals supporting topics, each with its own checkbox, relationship,
  rationale, subtopics, keywords, coverage note and any overlap warning.
- **Selected content plan** — a review area listing what is selected, with one
  "Create brief" action per topic.

Selection is never indicated by colour alone: the checkbox state, an "n
selected" count on each cluster, and the summary counts all carry it. Long
titles wrap, cards do not overflow, and the expander is a real
`aria-expanded` button with visible focus.

---

## 4. Topic hierarchy

```
Primary topic (user input)
└── Cluster
    ├── Supporting topic  ← a distinct page-level target (selectable)
    │   └── Subtopics     ← angles/questions inside that page (not pages)
    └── Content ideas     ← further possibilities (not selectable)
```

The hierarchy is explicit in the data, the prompt, the UI and the copied text.
The prompt defines each level and forbids flattening or padding.

**Backward compatibility:** `parseTopicClusterPlanResult` reads either shape. A
Stage 1 plan is presented as a single cluster rather than discarded.

> This is where browser verification earned its keep. Because `clusters` carries
> `.default([])`, the *current* schema parses a Stage 1 payload quite happily —
> into a plan with **zero clusters** — so a real, already paid-for plan was
> silently shown as though nothing had been returned. The parser now treats a
> successful-but-empty parse as inconclusive and tries the legacy adapter first.
> Tests 50–53 pin that order.

---

## 5. Selection model

Pure functions in `topic-cluster-selection.ts`, keyed by
`(clusterName, topic)` rather than array index, so expanding or re-rendering
can never shift what is selected.

- Toggling one topic never affects another.
- A cluster checkbox selects/clears only its own topics — never destructive to
  other clusters.
- Three cluster states: none / partial / all.
- The summary reads from the **plan**, not the selection set, so a stale key
  from a previous generation can never contribute a phantom topic.

---

## 6. Keyword mapping

Unchanged from Stage 1 and still computed in code: real project keyword terms
are matched by conservative containment against each cluster and topic. The
model is never asked for keyword ids and never supplies them.

Selected keyword ids on the form are re-verified server-side against the chosen
project; an id that does not resolve **rejects the request** rather than being
silently dropped.

---

## 7. Grounding

The model is asked for topics, relationships, rationale, subtopics, ideas and
two classifications — and nothing else. There are no id, URL or metric fields on
the provider contract, so fabricating one is structurally impossible.

Computed in code, never accepted from the model: existing coverage, related
keywords, overlap notes, and every enum (invalid → `null`, never a guess).

`containsFabricatedMetric` drops any entry claiming volume, difficulty, ranking,
traffic, impressions, clicks, CTR, authority or backlinks. Reject, never repair.
It requires a digit beside a metric word, so ordinary prose ("drives traffic to
the pillar") survives.

---

## 8. Cannibalization safeguards

Three layers, all conservative:

1. **Exact duplicates removed globally** across clusters — the same page-level
   target appearing twice is exactly the competing-content problem this tool
   exists to prevent.
2. **A supporting topic that merely restates its cluster** is dropped.
3. **Near-duplicates are flagged, not removed**: *"Potential overlap with
   \"X\" — consider consolidating them into one page."*

The wording is deliberately constrained. A test asserts the note never contains
"ranks", "ranking", "traffic" or "cannibaliz" — the platform has no data to
support any of those claims.

---

## 9. SEO / GEO / AEO

- **SEO** — explicit hierarchy, distinct page-level targets, intent and format
  per topic, real keyword mapping, overlap warnings.
- **GEO** — clusters give comprehensive, non-repetitive coverage of one subject
  with clear relationships, which is what entity/context clarity needs.
- **AEO** — the prompt asks for question-shaped subtopics where natural, so
  concise answerable sections fall out of the structure.

The prompt explicitly forbids promising a ranking, a featured snippet,
AI-assistant visibility, or any performance outcome. This is planning, not a
performance guarantee.

---

## 10. Content workflow hand-off

Reuses the **existing** Brief → Content → Long-Form workflow. No second
generation path was built.

Each selected topic gets its own "Create brief" link built with the existing
`BriefHandoff` type and `buildBriefHandoffHref` from `content-gap-to-brief.ts` —
the Brief route already reads exactly those params, so a second contract would
be two things to keep correct instead of one.

**One brief per topic** is deliberate: a brief describes one page, and bundling
several topics would produce a page trying to be several pages — the outcome
this planner exists to prevent.

The hierarchy travels in the Brief's existing `notes` field (visible and
editable, so the user reviews it). Content types map onto the Brief's existing
enum; types with no honest equivalent become `OTHER` rather than being forced.
**No enum was widened.**

Nothing is created by following the link. The user still reviews the brief and
explicitly generates; Content is only created by the existing save action.

---

## 11. Security

Unchanged and re-verified: `requireUser` → `manageSeoProjects` → company-owned
project → **not soft-deleted** → project-scoped data → job created with
server-derived company and project ids. The dispatcher re-resolves the project
and re-checks company match and soft-delete as defence in depth.

The hand-off carries `seoProjectId`, `notes` and `contentType` only — no company
identity, no ownership claim, no ids in the notes. The Brief's own action
re-derives ownership regardless.

---

## 12. Persistence decision

**Still none.** No `TopicClusterPlan` model. The plan lives in
`AiGenerationJob.resultJson`; selection is ordinary in-memory UI state; Copy and
the brief hand-off get the work out. Existing `Keyword` and `KeywordCluster`
records are never mutated.

---

## 12b. Phase 3 additions (specification gap-fill)

Comparing the implementation against the full specification surfaced two
genuine gaps, both closed:

1. **An explicit "Clear selection" control** in the selection summary. The
   spec lists clearing selections as a required capability, and cluster-level
   deselection alone did not cover it.
2. **Runner-dispatcher security tests** (6, in `ai-generation-job-runner.test.ts`)
   covering the boundary the action tests cannot reach: a job naming another
   company's project, an archived project, malformed stored input, and the
   project-scoped, soft-delete-excluding loading of keywords, clusters and
   content. One proved a stronger property than first written — the dispatcher
   uses the **server-resolved** project id, never the id carried in
   `inputJson`, and the test now asserts exactly that.

## 12c. Visual QA against the UI baseline

All ten input-state checks passed: page title, description, SEO project
selector, **Primary topic** label (no "Seed topic" anywhere), user-input
helper text, Target audience, Notes, the Generate button, left navigation and
header. Layout measured as expected (960px card, 32px control heights, no
horizontal scroll).

Accessibility: all four form controls correctly labelled; the cluster expander
is a real `<button>` whose `aria-expanded` flips both ways; checkboxes carry
descriptive `aria-label`s, are focusable, and toggle with Space; selection is
never signalled by colour alone.

Responsive: at 390px there is no horizontal overflow, the cluster and summary
remain visible, and all 11 topic checkboxes stay reachable.

## 13. Tests

**121 tests for this tool** plus 6 runner-dispatcher tests; full suite **113 files / 2981 passing**.

- 53 service tests — metric detection, enum validation, keyword matching,
  hierarchy enforcement, global de-duplication, caps, overlap notes, grounding
  (fabricated id/URL/metric all proven absent), sparse data, legacy adaptation,
  and the parse-order regression.
- 20 action tests — permission, auth, validation, cross-company project,
  soft-deleted project, keyword-id ownership, server-derived ids, job reuse.
- 20 selection tests — individual/cluster/partial/multi selection,
  non-destructive clearing, three checkbox states, stale-key immunity.
- 15 hand-off tests — content-type mapping, hierarchy in notes, omitted fields,
  no ids/URLs/metrics leaked, shared route builder, exact param keys.
- 13 picker-logic tests — the Generate gate and the Copy output.
- 6 runner-dispatcher tests — cross-company project, soft-deleted project,
  malformed stored input, project-scoped data loading, keyword narrowing, and
  server-resolved (not client-supplied) project identity.

Four of my own test/script bugs were caught and fixed rather than worked around,
including an unrealistic coverage fixture where the matcher was right and my
expectation was wrong (kept as an explicit "partial overlap does not claim
coverage" test).

---

## 14. Browser verification

**VERIFIED** against real Storage Moguls data:

- Tool opens; project starts **unselected**; "Primary topic" label present;
  existing form (audience, notes, keywords) preserved.
- Project selection and topic entry enable Generate.
- Enhanced UI renders: "Recommended clusters", cluster card with badges,
  relationship text, real keyword references, hedged coverage notes.
- Expand/collapse works (1 cluster expander, 11 topic checkboxes).
- **Individual selection**: 1 topic → "1 cluster · 1 supporting topic";
  2 topics → "1 cluster · 2 supporting topics".
- **Cluster select-all**: → "1 cluster · 11 supporting topics".
- **Clearing is non-destructive**; summary hides when nothing is selected.
- **Hand-off**: 2 selected topics → 2 "Create brief" links, each targeting
  `/ai/content-brief/new` with exactly `contentType`, `notes`, `seoProjectId`,
  carrying the hierarchy, with no ids or metrics.
- **Reaches the existing workflow**: the Brief page opens with notes prefilled
  and the project preselected, and **no Content is created** by opening it.
- **Copy** carries the full hierarchy with no "null".
- **No writes**: Content 10→10, Keyword 4→4, KeywordCluster 1→1.
- **Zero console/page errors.**

**ENVIRONMENTALLY UNVERIFIED — a fresh multi-cluster generation.** The provider
returned `INSUFFICIENT_CREDITS`; the previous task's generation consumed the
remaining capacity. **No fresh generation succeeded and none is claimed.**

The UI above was verified by **replaying a previously generated plan** through
the app's own `?jobId=` resume path — a real stored result, clearly a replay,
not a new generation. Because that plan predates the enhancement, the replay
also verified the backward-compatibility adapter, which is how the parse-order
bug in §4 was found.

---

## 15. Database impact

**None.** Content 10, Keyword 4, KeywordCluster 1 — unchanged throughout. One
`AiGenerationJob` row was created by the (failed) generation attempt, which is
expected. **No Prisma change and no migration in this enhancement.**

---

## 16. Known limitations

1. **Fresh multi-cluster generation is unverified** (provider credits). Every
   path is unit-tested and the UI is verified by replay, but the enhanced prompt
   has not yet produced a live multi-cluster plan.
2. **Sparse data limits richness** — with 4 keywords and 1 cluster
   database-wide, plans lean mostly on the primary topic. By design.
3. **Coverage matching is title-only and conservative**; partial overlap
   deliberately reports nothing.
4. **Overlap detection is word-based**, not semantic — it catches obvious
   near-duplicates, not subtle ones.
5. **No persistence** — a plan is lost once the job result is superseded.
6. **The metric filter is pattern-based**; a purely qualitative false claim
   ("a high-volume term") would pass the deterministic check, though the prompt
   forbids it.
7. **One brief per topic** — creating several briefs means following several
   links. Deliberate, but repetitive for a large selection.

---

## 17. Future Data Stronghold enhancements

- Persistent topic plans and planning history.
- Real keyword volume/difficulty, so clusters can be prioritised.
- "Save as cluster" writing into the existing `KeywordCluster`/`Keyword` models
  behind a review step.
- True cannibalization detection using real ranking data.
- Semantic coverage and overlap matching.
- Topic Cluster → Content Calendar and → Content Gap hand-offs.
- Bulk brief creation from a multi-topic selection.
