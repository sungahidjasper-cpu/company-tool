# Email Newsletter Drafter — Implementation Progress

**Status:** FUNCTIONAL — implemented, tested, live-verified with a real generation
**Date:** 2026-09-05
**Position:** twelfth AI Workspace tool
**Baseline commit:** `9a9077b` (all work below is uncommitted)

---

## 1. Discovery

The placeholder was found at `app/(dashboard)/ai/page.tsx` (`status: "coming-soon"`, `href: null`).
No `EMAIL_NEWSLETTER` task type existed. Before writing anything, the existing pieces were
inventoried so this tool would reuse them rather than grow parallel machinery.

| Need | Existing component found | Decision |
|---|---|---|
| Background generation | `AiGenerationJob` + `TASK_HANDLERS` in `lib/jobs/ai-generation-job-runner.ts` | **Reuse.** One dispatcher entry. |
| Client generate → poll → stream | `useAiGenerationLifecycle` | **Reuse.** Identical lifecycle to every other picker. |
| Provider abstraction | `generateStructuredOutput` / `…Streaming` | **Reuse.** No new AI client, no provider bypass. |
| Content-grounded action shape | `social-snippet-generator.actions.ts` | **Reuse the pattern** (`getOwnedSeoProject` + `getOwnedContent`). |
| Brand-Profile-fed prompt shape | `press-release-generator.service.ts` | **Reuse the pattern**, including the conditional-field asymmetry. |
| Brand Profile data | `getBrandProfileByCompanyId` | **Reuse.** No duplicate storage. |
| Grounding doctrine | `CONTENT_QUALITY_DOCTRINE`, `SEO_METRIC_GROUNDING_GUARD` | **Reuse both** verbatim as prompt prefixes. |
| Output sanitization | `stripConfigurationArtifacts`, `stripHtmlTags`, `looksLikeInstructionEcho` | **Reuse.** |
| Fabricated-metric detection | `containsFabricatedMetric` (topic-cluster-planner.service) | **Reuse** — already shared with Competitor Content Analysis. |
| Error presentation | `AiGenerationError`, `AiGenerationStatusNote` | **Reuse.** |
| Copy control | `PressReleaseReview`'s copy pattern | **Reuse the pattern.** |
| Content hand-off contract | `content-optimizer-handoff.ts` (`buildSocialSnippetHref` etc.) | **Extend** with one sibling builder. |

The only genuinely new pieces are this tool's own schema, prompt, result builder, action,
dispatcher branch and UI.

---

## 2. Architecture

```
Picker (client)
  └─ computeCanDraft()                       gates Generate; calls the SAME
     └─ hasEnoughSourceMaterial()            rule the server uses
          └─ startEmailNewsletterAction()    "use server"
               ├─ requireUser() → companyId              (never from the client)
               ├─ Permissions.manageSeoProjects
               ├─ getOwnedSeoProject()                   (company match + deletedAt)
               ├─ getOwnedContent()                      (company match + deletedAt)
               ├─ content.seoProjectId === project.id    (cross-project refusal)
               ├─ hasEnoughSourceMaterial(RE-FETCHED body)  ← refused BEFORE a job exists
               └─ createAiGenerationJob(EMAIL_NEWSLETTER)
                    └─ dispatchEmailNewsletter()          (job runner)
                         ├─ re-verify project company + deletedAt from the STORED row
                         ├─ RE-FETCH Content; re-verify project match + deletedAt
                         └─ generateEmailNewsletter()
                              ├─ getBrandProfileByCompanyId()
                              ├─ buildPrompt()            ← four labelled material sections
                              └─ buildEmailNewsletterResult()  ← deterministic filter
```

**Files added**

| File | Role |
|---|---|
| `features/ai-workspace/schemas/email-newsletter.schema.ts` | Form/job input, loose provider output, canonical result, `hasEnoughSourceMaterial` |
| `features/ai-workspace/services/email-newsletter.service.ts` | System prompt, prompt builder, claim detector, deterministic result builder |
| `features/ai-workspace/actions/email-newsletter.actions.ts` | Server action (auth, ownership, source-material gate, job creation) |
| `features/ai-workspace/components/EmailNewsletterPicker.tsx` | Form UI + lifecycle |
| `features/ai-workspace/components/EmailNewsletterReview.tsx` | Draft rendering + Copy |
| `app/(dashboard)/ai/email-newsletter/new/page.tsx` | Route |

**Files modified:** `prisma/schema.prisma` (one enum value), `lib/jobs/ai-generation-job-runner.ts`
(one dispatcher + registration), `features/ai-workspace/schemas/ai-generation-job.schema.ts`
(one validator), `features/ai-workspace/services/content-optimizer-handoff.ts` (one href builder),
`app/(dashboard)/ai/page.tsx` (placeholder → available),
`app/(dashboard)/seo/[id]/content/[contentId]/page.tsx` (one hand-off button).

---

## 3. Source Content

`contentId` is **required** — unlike Press Release Generator (no content at all) and Schema Markup
Generator (optional content). A newsletter not grounded in a real page the customer owns would be
pure invention, which is the failure this tool must not have.

Only content that is **active**, **in the selected project**, and **owned by the authenticated
actor's company** can be used. Soft-deleted content is excluded by the route's query, refused by
the action, and refused again by the dispatcher.

The server **re-fetches** the Content row at both stages. The job row stores ids and the user's own
text only — never any resolved Content field — so nothing about the page is ever trusted from
stored JSON. This is asserted by a test that checks the source body does not appear in `inputJson`.

**Empty body.** A title alone (or a 155-character meta description) can only be padded out with
invention, so it is not treated as source material. `hasEnoughSourceMaterial` requires either body
text or user-supplied additional context. When neither exists the request is refused **before a job
is created**, so the user is never charged a generation and never sees a provider or quality error
for what is really a missing-input situation:

> "This content record has no body text yet, so there isn't enough source material for a grounded
> newsletter. Add body text to the content record, or provide additional context below to draft from."

The picker calls the same function, so the button and the boundary cannot drift apart into
"enabled here, refused there". The content dropdown also labels such records `(no body text yet)`.

---

## 4. Brand Profile

Fetched service-side via the existing `getBrandProfileByCompanyId` — no duplicate storage, and
`ctx.companyId` is already server-derived. Brand name, voice, target audience, products/services,
target country and language are used.

The prompt places them in their own section headed **"BRAND PROFILE (tone and company description
only — not a source of new facts)"**, and the section is omitted entirely when no profile exists
rather than being emitted with empty values.

---

## 5. Grounding

The prompt separates the four material kinds explicitly and states how much authority each carries:

1. **SOURCE CONTENT** — the real page; may be summarised, rewritten and reordered, never added to.
2. **USER INPUT** — audience, CTA, campaign angle, additional context, notes; treated as both
   instruction and the user's own material.
3. **BRAND PROFILE** — tone and company description only.
4. **YOUR OWN WRITING** — connective prose that must never introduce a fact.

The prompt is advisory. The **guarantees** are deterministic, in `buildEmailNewsletterResult`:

- `looksLikeInstructionEcho` — reused, unchanged.
- `containsFabricatedMetric` — reused, unchanged (rankings, volumes, traffic, CTR, backlinks, DA).
- `containsUnsupportedMarketingClaim` — **new**, covering unevidenced superlatives
  (best-selling, industry-leading, award-winning, #1, world-class), scale claims (thousands of
  customers, trusted by thousands), guarantees (guaranteed, risk-free, money-back), and fabricated
  performance percentages (increased conversions by 200%, proven results).

Ordinary honest copy is deliberately not matched — the filter exists to catch fabricated evidence,
not to flatten the writing.

**The asymmetry is deliberate**, mirroring the judgement `buildCompetitorAnalysisResult` makes:

| Field | An ungrounded claim causes… | Why |
|---|---|---|
| subjectLine, previewText, headline, introduction, closing | **whole draft rejected** | Load-bearing — contamination reaches the whole newsletter |
| one body section | **that section dropped** | Separable; at least one must survive or the draft is rejected |
| callToAction, when the USER supplied one | **kept verbatim** | The words trace back to the user; only an instruction echo disqualifies it |
| callToAction, when the user supplied none | **cleared to ""** | Fabrication by definition — nothing it could be grounded in |

The prompt additionally forbids claiming the newsletter improves rankings or AI visibility, forbids
forcing keywords in unnaturally, and forbids any wording implying the email was sent, scheduled or
delivered.

---

## 6. Security

The established chain, with every authority decision made server-side:

`requireUser` → `Permissions.manageSeoProjects` → owned SEO project → active project → owned
Content → active Content → cross-project match → server-derived `companyId` → AI job →
deterministic output validation.

- **`companyId` is never accepted from the client** — a test passes one and asserts the
  server-derived value is used instead.
- **Ownership is re-verified twice** — in the action, and again in the dispatcher from the *stored*
  job row, so a job cannot be replayed against a project or page the actor no longer owns.
- **Soft-deleted projects and content are refused** at both points.
- **Cross-project and cross-company content ids are refused**, with the same message, so the
  response does not disclose whether the row exists.
- **No AI-generated id is ever trusted** — the model is never asked for one, and the result shape
  has no id field.
- The Content hand-off carries **ids only**, no authority; the drafter re-verifies everything.

---

## 7. Output

Exactly the newsletter anatomy that was specified, plus the reviewer note every AI Workspace tool
carries. No delivery, scheduling, recipient, list or campaign field exists anywhere in the shape.

| Field | Kind |
|---|---|
| `subjectLine` | required |
| `previewText` | required |
| `headline` | required |
| `introduction` | required |
| `bodySections[]` — `{ heading, body }` | required, ≥ 1 |
| `callToAction` | may be empty |
| `closing` | may be empty |
| `reasoning` | reviewer note; never part of the email or the copied text |

---

## 8. UI

Route: `/ai/email-newsletter/new`. Listed as **available** in the AI Workspace index.

Follows the existing design system exactly — same `PageContainer`/`DashboardHeader`/`Card` shell,
the same select/input/textarea classes, the same `AiGenerationError`, `AiGenerationStatusNote`,
`Progress` and Cancel lifecycle controls as Press Release Generator.

- Project selection **begins blank**; changing project clears the content selection.
- Source content is disabled until a project is chosen.
- Generate is disabled until project + content + real source material all exist.
- The result carries a load-bearing badge: **"Draft only — nothing is sent or saved"**.
- Subject line and preview text are shown in their own panel — they are inbox metadata, not body
  copy, and the copied text labels them accordingly so they are not pasted into a body field.
- **There is no send, schedule, test-send, recipient or list control anywhere**, and none is planned.
- `?jobId=` resume works, as for every other picker.

---

## 9. Content workflow

**Implemented, in the direction that is genuinely useful.**

A "Draft Newsletter" action was added to the Content record page alongside the existing Generate
Schema / Generate Social Snippets actions, using the existing `content-optimizer-handoff.ts`
contract (`buildEmailNewsletterHref`) — no second hand-off mechanism was invented. The drafter
route accepts the same `?seoProjectId=&contentId=` params every C4 tool already accepts.

Eligibility matches Schema Markup and Social Snippets (manage permission, live record, live
project) rather than the Rewriter's stricter non-empty-body rule, because the drafter accepts
user-supplied context when a record has no body yet — so a brief-only record does not dead-end.

**Opening the hand-off creates nothing** — verified in the browser (Content count unchanged).

A hand-off in the *opposite* direction (newsletter → Content Brief) was deliberately **not** added.
The newsletter is derived *from* an existing page; generating a brief for a page that already
exists would be circular, so it would not be the "genuine user benefit" the spec requires.

---

## 10. Persistence

**None.** Draft-and-display-and-copy only.

- No `EmailCampaign`, `NewsletterCampaign`, `EmailSend`, `Subscriber` or `DeliveryLog` model was
  created — those belong to a future marketing/publishing phase.
- No Content row is created or modified; no `ContentRevision` is created.
- The draft survives only as the `AiGenerationJob` result and is reachable via `?jobId=`.
- Duplicate generation reuses an already-active job for identical input rather than generating twice.

---

## 11. Tests

| Suite | Tests |
|---|---|
| `email-newsletter.service.test.ts` | 44 |
| `email-newsletter.actions.test.ts` | 23 |
| `EmailNewsletterPicker.logic.test.ts` | 22 |
| **Newsletter-specific total** | **89** |
| `ai-generation-job-runner.test.ts` — newsletter dispatcher block | 9 |
| `content-optimizer-handoff.test.ts` — hand-off block | 3 |

Coverage of the required list: project ownership, Content ownership, cross-project Content,
cross-company Content, soft-deleted Content, soft-deleted project, empty Content body, valid source
content, Brand Profile, user input, malformed AI output, fabricated facts, fabricated metrics,
unsupported marketing claims, missing required fields, valid newsletter output, Copy, no automatic
Content creation, duplicate generation behaviour.

Full suite: **121 files / 3196 tests passing** (up from 3095).

The repository has no React rendering test setup (vitest runs `environment: "node"`), so picker and
review logic is extracted into pure functions and tested directly — the approach every other
AI Workspace picker uses.

---

## 12. Browser verification (live)

Run against the real dev server and real database.

| # | Check | Result |
|---|---|---|
| 1 | Page opens | PASS |
| 2 | Project begins unselected | PASS |
| 3 | Select project → content enabled, options listed | PASS |
| 4 | Source content selectable | PASS |
| 5 | Optional inputs work and are retained | PASS |
| 6 | Generate available only when appropriate | PASS |
| 7 | Newsletter renders | PASS |
| 8 | Subject line renders | PASS |
| 9 | Preview text renders | PASS |
| 10 | Body renders (both sections) | PASS |
| 11 | CTA renders | PASS |
| 12 | Copy works | PASS |
| 13 | No unsupported factual claims | PASS |
| 14 | Source Content not modified (body + `updatedAt` identical) | PASS |
| 15 | No unrelated writes | PASS |
| 16 | No console/page errors | PASS |

**Fresh generation succeeded.** Real output, grounded in the real source page:

- Subject: *"Insights into Self Storage Investments"*
- Preview: *"Explore how self storage facilities can support portfolio stability and long-term growth."*
- Headline: *"Unlocking Self Storage Investments"*
- 2 sections: *"Portfolio Stability and Economic Resilience"*, *"Navigating Opportunities and Risk"*
- CTA (user-supplied wording honoured), closing: *"Best regards, The Storage Moguls Team"*
- **Fabricated metrics: none. Unsupported marketing claims: none. No delivery language.**

**Source-material gate:** a body-less record disabled Generate and showed the explanatory message
verbatim; supplying additional context unblocked it.

**Hand-off:** the "Draft Newsletter" action on the Content record navigated to the drafter with both
ids as preselection, created no Content, and carried no authority params.

**Copy:** 1197 characters — subject and preview labelled, headline, both sections, CTA and closing
present; the reviewer-only `reasoning` note correctly excluded.

**Database:** `Content 10→10`, `Keyword 4→4`, `BrandProfile 1→1`, `ContentRevision 9→9`; source row
body and `updatedAt` byte-identical; 1 `EMAIL_NEWSLETTER` job created.

**Responsive:** no horizontal overflow at 390px (390 vs 390).

**Three initially-reported failures were defects in the verification harness, not the app** — the
browser context lacked clipboard permission (which also produced the only page error), and one
assertion scanned the whole page for the word "provider", matching the page's own honest
description *"it never sends email, connects to an email provider, or creates a campaign"*. Both
were corrected and re-run; all assertions then passed.

---

## 13. Limitations (stated, not worked around)

1. **This tool drafts and nothing else.** It does not send email, connect to an email provider,
   create a campaign, manage recipients, or report delivery. No such capability exists in the
   codebase.
2. **Nothing is persisted.** The draft lives only as the job result, reachable via `?jobId=`.
3. **One source page per newsletter.** A multi-content "roundup" would need a different input shape
   and is not implemented.
4. **The source body is truncated to 12,000 characters** in the prompt to stay within context on a
   long article. The truncation is stated in the prompt so the model does not treat the cut-off as
   the end of the article.
5. **A body-less record cannot be drafted from alone** — by design. The user must supply context.
6. **Output quality tracks the provider.** With a weak fallback model, the deterministic filters
   reject more drafts, surfacing as "try generating again" rather than a poor newsletter.
7. **The claim filter is pattern-based.** It reliably catches the named claim classes; it cannot
   detect a novel unsupported claim phrased in unusual words. The prompt, the source-grounding
   requirement, and human review before sending remain the other layers.

---

## 14. Future publishing possibilities

Recorded as opportunities only — **not implemented**, and none should be added without explicit
authorization.

1. **Email provider integration** (send/schedule/test-send) — would require `EmailCampaign`,
   `Subscriber` and `DeliveryLog` models, a provider abstraction, consent/unsubscribe handling and
   deliverability policy. Explicitly out of scope here.
2. **Multi-content roundups** — draft one newsletter from several Content rows.
3. **Saved newsletter drafts** — persistence plus versioning, so a draft can be revisited and edited
   rather than only copied.
4. **Send-performance feedback** — open/click data would be the first real metric this tool could
   honestly display; today it has none and shows none.
5. **Template/brand styling** — HTML email output rather than plain text, once a template system
   exists.

---

## 15. Status

| Item | State |
|---|---|
| Prisma enum `EMAIL_NEWSLETTER` | Added |
| Migration `20260905071500_add_email_newsletter_task_type` | Applied (one `ALTER TYPE … ADD VALUE` line) |
| Typecheck | Pass |
| Lint | 0 errors (1 pre-existing unrelated warning in `ReportForm.tsx`) |
| Build | Compiled successfully, route emitted |
| Tests | 121 files / 3196 passing |
| Prisma validate | Valid |
| Migration status | 39 migrations, database up to date |
| Competitor Content Analysis | Preserved, untouched |
| Topic Cluster Planner | Preserved, untouched |
| Commit | **Not authorized** |
| Push | **Not authorized** |
