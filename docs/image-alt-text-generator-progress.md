# Image Alt Text Generator — Implementation Progress

**Status:** FUNCTIONAL — implemented, tested, browser-verified against the real (empty) image inventory
**Date:** 2026-09-05
**Position:** thirteenth AI Workspace tool
**Baseline commit:** `9a9077b` (all work below is uncommitted)

---

## 1. Discovery

The placeholder was at `app/(dashboard)/ai/page.tsx` (`status: "coming-soon"`, `href: null`). No
`IMAGE_ALT_TEXT` task type existed. (`MISSING_ALT_TEXT` exists but is a `WebsiteAnalysisIssueType`
— an audit finding, unrelated.)

Three findings shaped the whole design:

| Finding | Consequence |
|---|---|
| **`File` has no `altText` column** | There is **no existing safe update path**, so the tool is review-only. Adding a column would mean building persistence to serve the AI tool — explicitly out of scope. |
| **A `File` attaches to exactly one target** — `seoProjectId` *or* `contentId`, never both (`buildEntityWhere`) | The project's image inventory is the **union** of both, with the second resolved through the Content relation. |
| **The provider abstraction is text-only** | The model never sees the image. The user's written description is the only evidence, and the UI must say so. |

Everything else was reused: `AiGenerationJob` + `TASK_HANDLERS`, `useAiGenerationLifecycle`,
`generateStructuredOutput`, `getBrandProfileByCompanyId`, `CONTENT_QUALITY_DOCTRINE`,
`SEO_METRIC_GROUNDING_GUARD`, `stripConfigurationArtifacts` / `stripHtmlTags` /
`looksLikeInstructionEcho`, `containsFabricatedMetric`, `containsUnsupportedMarketingClaim`,
`AiGenerationError` / `AiGenerationStatusNote`, and the existing `File` model. **No second file
model, no media library, no vision support.**

---

## 2. File integration

`IMAGE_MIME_TYPES` and `isImageMimeType` were added to the **existing**
`features/files/schemas/file.schema.ts` and spread into `ALLOWED_MIME_TYPES`, so the image list and
the allow-list are one definition and cannot drift apart.

Supported: `image/jpeg`, `image/png`, `image/webp`, `image/gif`. Every other allowed type —
PDF, Word, Excel, PowerPoint, CSV, plain text, ZIP — is excluded, as are unsupported image types
(`image/svg+xml`, `bmp`, `tiff`, `avif`).

`PROJECT_IMAGE_WHERE(seoProjectId)` is the single filter shared by the route, the action and the
dispatcher:

```ts
{
  deletedAt: null,
  mimeType: { in: [...IMAGE_MIME_TYPES] },
  OR: [{ seoProjectId }, { content: { seoProjectId, deletedAt: null } }],
}
```

Both branches are scoped by the **already-verified** project id, so ownership is inherited from the
caller's own project check rather than re-derived from anything the client sent. It carries no
`companyId` clause by design — a file of another company cannot reach an owned project's id.

---

## 3. Content relationship

When an image is attached to Content, the picker shows the page title
(`desk-photo.png — PNG — on "How Self Storage Investing Works"`) and the prompt receives the page
title and meta description as **CONTENT CONTEXT**.

That context is explicitly labelled *"relevance and terminology only, NOT evidence of image
contents"*, and the system prompt spells out the failure it prevents: *"an article about
self-storage investing does not mean the picture shows a storage unit."* Content context never
overrides the user's description.

Images not attached to any Content are fully supported; the prompt says so plainly rather than
leaving a blank section.

---

## 4. No-vision limitation

The single most important property of this tool.

- The system prompt opens with **"CRITICAL — YOU CANNOT SEE THE IMAGE. No image data has been given
  to you"** and forbids writing or implying otherwise.
- **No image bytes are read, fetched or sent anywhere.** The dispatcher reads file *metadata* only.
- The UI states it directly next to the description field: *"Describe what the image shows so the AI
  can create accurate alt text. The AI cannot see the image — your description is the only thing it
  works from."*
- The result panel repeats it: *"Written from your description — the AI did not see the image, so
  check it against the picture before using it."*
- **No OCR, real or implied.** The prompt forbids claiming to have read words, signs, captions,
  labels or numbers in the image; the additional-context field says *"The AI cannot read text in the
  image, so type it here if it should be described."*
- The phrases "AI analyzes your image", "AI vision analysis" and every equivalent are **absent** —
  asserted by a browser check against 10 banned patterns and by a unit test over every user-facing
  message.

The **file name is treated as a label, not a description**, in the prompt and in the UI. The prompt
uses the spec's own example: *"storage-investing-final-v2.png is not proof the image shows storage
investing."*

---

## 5. User description workflow

```
Select project (blank)  →  Select image  →  Describe what it shows  →  Generate  →  Review  →  Copy
                                     └─ or tick "decorative" → deterministic empty-alt recommendation
```

`hasEnoughImageEvidence` is the shared rule: **only the user's own description counts.** Content
context and Brand Profile deliberately do **not** satisfy it, because treating an article's subject
as evidence about a picture is exactly the invention this tool must not commit.

A missing description is refused **before a job is created**, so the user is never charged a
generation — and never shown a provider or AI-quality error — for a missing input.

---

## 6. Decorative images

Handled **deterministically, with no AI call at all.** The correct answer is fixed by the
accessibility standard, so asking a language model would cost a generation and risk it inventing a
description for an image that must not have one.

Ticking "This image is decorative" hides the description field and Generate entirely, and shows:

> Use an empty alt attribute: `alt=""`. A decorative image carries no information the surrounding
> text does not already give, so an empty alt tells screen readers to skip it. **Leaving the
> attribute off entirely is not the same** — some screen readers then read the file name aloud.

A "Copy empty alt text" button copies a genuinely empty string (verified in the browser).

---

## 7. Grounding

The prompt separates four kinds of material and states each one's authority:

1. **USER-PROVIDED IMAGE DESCRIPTION** — the only evidence of what the image contains.
2. **CONTENT CONTEXT** — relevance and terminology; *not* evidence of image contents.
3. **BRAND PROFILE** — tone, language, company context; *not* evidence of image contents.
4. **FILE NAME** — a typed label; never a description.

The prompt is advisory; the **guarantees** are deterministic, in `buildImageAltTextResult`:

| Check | Behaviour |
|---|---|
| `findUnsupportedProperNouns` (**new**) | Rejects a capitalised token that appears in *no* supplied evidence — the guard against an invented brand, logo, person, company or place |
| `containsFabricatedMetric` (reused) | Rejects rankings, volumes, traffic, percentages |
| `containsUnsupportedMarketingClaim` (reused) | Rejects best/leading/award-winning/#1/guaranteed/etc. |
| `looksLikeKeywordStuffing` (**new**) | Rejects a content word repeated ≥ 3 times in one short sentence |
| `looksLikeInstructionEcho` (reused) | Rejects echoed prompt text |
| `stripRedundantImagePrefix` (**new**) | **Strips** "Image of / Photo of / Screenshot of …" — a fixed accessibility rule, and the rest of the sentence is usually good |
| `buildLengthGuidance` (**new**) | **Advises**, never rejects — an arbitrary character cap would sometimes force *less* accessible alt text |

The first-word exemption in `findUnsupportedProperNouns` was deliberately **removed** during
implementation: exempting it let an invented name at the start of the sentence ("Sarah reviewing a
spreadsheet") through unchallenged. My own test caught this. Common capitalised openers are
stop-listed instead. Erring toward rejection is the right direction for a tool whose purpose is
preventing invention.

---

## 8. Accessibility

This tool's own accessibility was treated as a first-class requirement, and verified in the browser:

- All five controls (`seoProjectId`, `fileId`, `isDecorative`, `imageDescription`,
  `additionalContext`) have an associated `<label for>` — verified in the DOM.
- The decorative control is a **real `<input type="checkbox">`**, not a styled div — verified via
  `type === "checkbox"` — and toggles with the **Space key**, verified by keyboard-only interaction.
- Form controls are keyboard reachable in source order.
- The required-description warning is bound to its field with `aria-describedby`.
- Required fields are marked with an asterisk **and** enforced by the disabled Generate button and
  by the server — never by colour alone.
- The generated alt text sits in its own readable region.
- Focus rings use the shared `focus-visible:ring` tokens.
- No horizontal overflow at 390px.

---

## 9. SEO / GEO / AEO

- SEO context is available for terminology, but the prompt states: *"Only use a project keyword if
  the user's description genuinely supports it — never insert one because it exists in the project."*
- `looksLikeKeywordStuffing` enforces this deterministically.
- **GEO:** contextual description is encouraged only where the user's description supports it.
- **AEO:** no question-oriented pattern is forced. Alt text is a description, not an answer format.
- The prompt forbids claiming the alt text will improve rankings or AI visibility.
- Accessibility and factual accuracy take priority over every SEO consideration.

---

## 10. Security

`requireUser` → `Permissions.manageSeoProjects` → owned SEO project → active project →
project-scoped image → project-scoped Content (through the relation) → server-derived `companyId` →
AI job → deterministic output validation.

- **`companyId` is never accepted from the client** — a test passes one and asserts it is ignored.
- The image is **never looked up by id alone** — always `getProjectImage(fileId, verifiedProjectId)`.
- One `null` from that query covers *missing, non-image, soft-deleted, cross-project, cross-company
  and trashed-Content*, and all six are reported with the **identical** message, so the response
  discloses nothing. A test asserts the messages are indistinguishable.
- **Ownership is re-verified in the dispatcher** from the stored job row, using the same
  project-scoped query — a job cannot be replayed against a project or file the actor no longer owns.
- No AI-generated File or Content id is ever trusted: the model is never asked for one, and the
  result shape has no id field.
- The job stores ids and the user's own words only — never the file name, mime type or storage key.

---

## 11. Persistence

**Review-only, and structurally so.** `File` carries no `altText` column, so there is no existing
safe update path to apply a result through — and none was created, because building persistence to
serve the AI tool was explicitly out of scope.

- No `ImageAnalysis`, `AltTextHistory` or `VisionAnalysis` model.
- No File write of any kind — the action file contains no `file.update`, `file.create` or
  `file.delete` call, asserted by test.
- No Content write, no `ContentRevision`.
- No existing alt text is overwritten — there is none to overwrite.
- The result survives only as the `AiGenerationJob` result, reachable via `?jobId=`.

---

## 12. UI / UX

Route: `/ai/image-alt-text/new`. Listed as **available** in the AI Workspace index.

Same shell and visual language as Topic Cluster Planner, Competitor Content Analysis and Email
Newsletter Drafter — `PageContainer` / `DashboardHeader` / `Card`, the same select/input/textarea
classes, the same `AiGenerationError`, `AiGenerationStatusNote`, `Progress` and Cancel controls.
No separate design system, no global redesign, and deliberately lighter than the multi-panel tools.

Project selection begins blank; changing project clears the image selection; the image selector is
disabled until a project is chosen and while the inventory is empty.

---

## 13. Tests

| Suite | Tests |
|---|---|
| `image-alt-text.service.test.ts` | 51 |
| `image-alt-text.actions.test.ts` | 21 |
| `ImageAltTextPicker.logic.test.ts` | 28 |
| `project-image-inventory.test.ts` | 14 |
| **Alt-text-specific total** | **114** |
| `ai-generation-job-runner.test.ts` — alt-text dispatcher block | 10 |

Covers the required list: all four image MIME types, non-image rejection, soft-deleted file,
cross-project file, cross-company file, unauthorized project, soft-deleted project, unauthorized
image, unauthorized Content association, user image description, Content context, Brand Profile,
unsupported visual claims, invented people, invented objects, invented locations, invented image
text, invented brand/logo, unsupported marketing claims, decorative image, empty alt
recommendation, malformed output, empty alt text, verbose output, keyword stuffing, valid concise
output, no automatic File modification, no automatic Content modification, no revision creation,
blank project, image selection, description required, generate state, result state, Copy, error state.

Full suite: **125 files / 3320 tests passing** (up from 3196).

---

## 14. Browser verification (live)

Run against the real dev server and real database.

| # | Check | Result |
|---|---|---|
| 1 | Page opens | PASS |
| 2 | Project begins unselected | PASS |
| 3 | Select project | PASS |
| 4 | Image inventory loads | PASS (empty — see below) |
| 5 | Non-image files excluded | PASS |
| 6 | Image can be selected | n/a — no images exist |
| 7 | Associated Content shown | n/a — no images exist |
| 8 | Description field required | PASS |
| 9 | Generate blocked without sufficient input | PASS |
| 10 | Valid description allows generation | n/a — no images exist |
| 11 | Alt text concise and grounded | not exercised live |
| 12 | Copy works | PASS (decorative path) |
| 13 | No claim the AI inspected the image | PASS |
| 14 | No Content writes | PASS |
| 15 | No File writes | PASS |
| 16 | No unintended database changes | PASS |
| 17 | No console/page errors | PASS |

**The image inventory is genuinely empty.** The database holds 6 files, all `text/csv`, none
attached to any SEO project:

```
File inventory by MIME: [{"_count":6,"mimeType":"text/csv"}]
IMAGE files in database: 0   (non-image files: 6)
image options offered:   ["Select an image…"]
```

Per the instruction — *"If the database currently contains no images: DO NOT fabricate image
records merely to claim functionality. Verify empty state and deterministic behavior."* — **no image
records were created.** The empty state was verified instead:

- Non-image exclusion is genuinely proven: none of the 6 real CSV files appears in the selector.
- The empty state reads *"This project has no images yet. Upload an image to the project or to one of
  its content records, then come back here."* — a fact and a next step, not an error.
- The selector stays disabled, and Generate stays blocked **even with a valid description typed**.

**Decorative branch, fully exercised live:** `alt=""` recommended, the omit-vs-empty distinction
explained, the description field and Generate correctly hidden, "no AI generation is needed" stated,
and the copied value verified to be a genuinely empty string.

**Accessibility, verified live:** all five controls labelled; the decorative control is a real
checkbox and toggles with the Space key; keyboard order correct; no horizontal overflow at 390px.

**No-vision honesty, verified live:** 10 banned phrasings checked and none present; the page states
the AI cannot see the image and that alt text is written from the user's description.

**Database:** `Content 10→10`, `File 6→6`, `ContentRevision 9→9`, alt-text jobs created: 0. No
console or page errors.

---

## 15. Fresh generation

**ENVIRONMENT-BLOCKED — by the absence of image data, not by provider credits.**

Provider capacity was available (the Email Newsletter Drafter generated successfully earlier the
same day). The block is that no image record exists to generate against, and creating one was
explicitly forbidden. No generation was attempted, none was retried, and none is claimed.

The generation path itself is covered deterministically by 51 service tests and 10 dispatcher tests,
including the full grounding filter set. End-to-end generation can be verified as soon as one real
image exists in a project — either uploaded by you, or by me if you authorise it.

---

## 16. Limitations (stated, not worked around)

1. **The AI does not see the image.** Alt text quality is bounded by the user's description. This is
   stated everywhere it matters rather than papered over.
2. **No OCR.** Text inside an image must be typed into the description or additional context.
3. **Review-only.** There is no Apply, because `File` has no `altText` column to apply into.
4. **No existing alt text can be displayed** for the same reason — the platform stores none.
5. **The proper-noun guard is heuristic.** It reliably catches a capitalised name absent from all
   evidence, but a fabricated *lowercase* detail ("a red mug") cannot be caught this way — the
   prompt, the description-only grounding, and human review remain the other layers.
6. **Rejection is preferred to repair.** A draft that trips any grounding filter is rejected whole,
   because alt text is a single sentence with nothing separable to drop. Users may occasionally need
   to regenerate.
7. **The image inventory is currently empty**, so the tool has no data to operate on in this
   environment until an image is uploaded.

---

## 17. Future multimodal upgrade path

Recorded as an opportunity only — **not implemented**, and not to be added without explicit
authorization as a separate capability.

1. **Vision-capable provider call.** `generateImageAltText` is the single seam: the context already
   carries the file identity, and a multimodal branch would attach the image bytes there. Everything
   downstream — the deterministic filters, the result shape, the UI — is unchanged.
2. **The user description becomes optional, not obsolete.** With vision, the description would
   become corroborating evidence rather than the sole source. The evidence-hierarchy prompt structure
   already accommodates this: a fifth category slots in above the current first.
3. **The no-vision copy must change with it.** The UI statements ("The AI cannot see the image") are
   load-bearing honesty today and would become false — they must be updated in the same change, not
   after it.
4. **Real OCR** would follow from the same capability, replacing the current explicit refusal.
5. **An `altText` column on `File`** plus an explicit Apply action would become worth building once
   there is a reason to store a result — at which point the "no safe update path" limitation
   disappears. That is a persistence decision, not an AI one, and belongs to its own phase.

---

## 18. Status

| Item | State |
|---|---|
| Prisma enum `IMAGE_ALT_TEXT` | Added |
| Migration `20260905090000_add_image_alt_text_task_type` | Applied (one `ALTER TYPE … ADD VALUE` line) |
| New persistence models | **None** |
| Typecheck | Pass |
| Lint | 0 errors (1 pre-existing unrelated warning in `ReportForm.tsx`) |
| Build | Compiled successfully, route emitted |
| Tests | 125 files / 3320 passing |
| Prisma validate | Valid |
| Migration status | 40 migrations, database up to date |
| Email Newsletter Drafter | Preserved, untouched |
| Competitor Content Analysis | Preserved, untouched |
| Topic Cluster Planner | Preserved, untouched |
| Commit | **Not authorized** |
| Push | **Not authorized** |
