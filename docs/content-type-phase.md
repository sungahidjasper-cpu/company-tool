# Content Type — a first-class field on Content

**Migration:** `20260910155312_content_type`
**One nullable enum column. No second content model. No change to Social, Blog, publishing, AI or planned items.**

---

## 1. What was discovered

`Content` could not say what kind of asset it was. The calendar derived `SOCIAL_POST` from the presence of a `SocialPost` half and reported `null` for everything else, so a blog article, an SEO page and a hand-made record were indistinguishable. The type filter existed but carried the note *"Planned items only — published pages do not record a type"*, and selecting a type silently hid every real page except social posts.

Everything needed to *consume* a type already existed — `WorkspaceFilters.contentTypes`, `buildContentTypeOptions`, `planTypeLabel`, the filter group, the Content Detail row. Only the field itself was missing, which is what made this the smallest useful change.

### How existing records prove their type

| Signal | Proves? | Why |
|---|---|---|
| `SocialPost` relation present | **Yes** | It has been the de-facto discriminator since Phase 6 |
| `aiBriefDetails` present | **Yes** | Written **only** by `content-brief.actions.ts`, `long-form-content.actions.ts` and the long-form job runner — all the keyword-driven SEO workflow. Verified that the Blog Studio writes neither `aiBriefDetails` nor `generatedByAi` |
| A body, a url, a keyword, a project | **No** | The Blog Studio sets a body and keywords too, and all 13 rows have a project. Classifying on these would be a guess |

## 2. The five migration decisions

| | Decision |
|---|---|
| Enum values | `SOCIAL_POST`, `BLOG_POST`, `SEO_CONTENT` — nothing else |
| Nullable? | **Nullable**, so "not recorded" stays expressible instead of guessed |
| Classification | Proof only (table above) |
| Data impact | Purely additive; no row deleted or rewritten |
| Rollback | Drop the column and the enum; nothing else depends on it |

**Newsletter and press release are deliberately absent.** Those tools generate text and create no `Content` row, so listing them would put types on the calendar that nothing can produce.

## 3. Backfill result

13 rows in, 13 rows out:

| Type | Rows | Basis |
|---|---|---|
| `SOCIAL_POST` | 2 | Social half present |
| `SEO_CONTENT` | 7 | AI brief present |
| `BLOG_POST` | 0 | No pre-existing Blog Studio content |
| **Not recorded** | **4** | **No proof available — reported, not guessed** |

The four unclassified rows: *Emergency Plumbing FAQ*, *How Much Does a Water Heater Installation Cost?*, *Activity Fix Verify Content*, *self storage investments*.

Verified after the migration: every `SOCIAL_POST` really has a social half · no row with a social half was left unclassified · every `SEO_CONTENT` really has an AI brief · **no unclassified row had proof available.**

## 4. Creation records the type

| Path | Records |
|---|---|
| Social Composer | `SOCIAL_POST` |
| Blog Studio | `BLOG_POST` |
| SEO project's content form | `SEO_CONTENT` |
| CSV import into a project | `SEO_CONTENT` |
| AI content brief | `SEO_CONTENT` |
| AI long-form saved as new content | `SEO_CONTENT` |

The type comes from the workflow that created the record, never inferred from the project — a social post with no project is still a social post.

## 5. Calendar

- **Type badges** on calendar cards: `SOCIAL`, `BLOG`, `SEO` — **text**, so they survive colour-blindness, greyscale and print. An item with no recorded type shows no badge rather than a fabricated one. The badge is also in the card's tooltip.
- **The type filter is now real** and applies to social, blog and SEO content. It **narrows only** — it can never add an item the client scope excluded.
- The misleading *"Planned items only"* note is gone. In its place, when a type is selected the filter says how many older items have no recorded type and are therefore hidden — because an item with no type genuinely cannot satisfy a type restriction.

## 6. Content Detail

Shows the recorded type next to Client and SEO Project, using the same label map as the calendar. An unclassified record reads **"Not recorded"**.

## 7. Creation flow

The chooser now offers three types. **SEO content appears only when the client has an SEO project** — that form lives under a project and the record joins its page inventory, so offering it otherwise would be a button that cannot work. Social and Blog need no project, as before. The selected date, time and zone flow through unchanged, and each type routes to its **existing** studio; no second creation system was built.

## 8. What was deliberately not touched

`SocialPost`, `SocialPostTarget`, `SocialAccount`, platform tabs, per-platform captions, media-before-save, preview, scheduling, the Blog Studio editor, publishing, AI provider architecture, and `ContentCalendar`/planned items. Ownership is unchanged: company is still the security root, client the primary context, project optional. The type filter narrows and never widens.

## 9. Attribution — the 768px overflow is not this phase

An early verification run showed a 7px page-level overflow at 768px on the workspace. Measured properly, back-to-back in one session at that width:

| Route | Page overflow |
|---|---|
| `/clients` (untouched) | 256px |
| `/seo` (untouched) | 256px |
| `/users` (untouched) | 256px |
| **`/content?client=…` (this phase)** | **0px** |

With badged items rendered, the elements extending past the viewport were `HEADER`, the shell wrapper and the user menu — **no calendar cell or chip appeared in the list**. The workspace is cleaner at 768 than routes this phase never touched, so the overflow is pre-existing app-shell behaviour on wide-table pages. The responsive check now measures the workspace against an untouched route rather than asserting a bare number.

## 10. Limitations

- **4 existing rows carry no type** and read "Not recorded". They are hidden while a type filter is active, which the UI states. Classifying them would require guessing, or a human deciding row by row.
- **Newsletter and press release still create no `Content` row**, so they cannot appear on the calendar or be given a type. Closing that gap is its own piece of work.
- **Planned items** (`ContentCalendar`) keep their own separate `CalendarContentType` (ARTICLE, GUIDE, …) and remain project-scoped. Both type vocabularies share one label map so they read consistently, but they are still two different things.
