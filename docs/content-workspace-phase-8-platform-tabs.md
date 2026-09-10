# Content Workspace — Social Composer: client platform tabs, per-platform content, and account settings

**Migration:** `20260909180129_social_platform_content` — three nullable columns, no existing row touched.
**Still true:** no OAuth, no credentials, no platform API, nothing published.

---

## 1. The one thing that could not be built as asked: official logos

**EVERY SOCIAL PLATFORM MUST HAVE ITS OWN VISUAL IDENTITY** — that part is done. **"Use the correct official platform logo/icon"** is not, and could not be, under the constraints given.

| What was checked | Result |
|---|---|
| `lucide-react` 1.28.0 brand icons | **None.** `Facebook`, `Instagram`, `Linkedin`, `Twitter`, `Youtube` are all absent — lucide removed brand marks. Its `X` export is the *close* icon, not the platform. |
| Any other icon pack in `node_modules` | None installed. |
| Local assets in `public/` | `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` — no platform logos. |

That leaves three routes, and the brief closed two of them: *"If a new editor dependency is genuinely necessary: STOP before installing it and report"* (a licensed logo pack is a new dependency) and *"Do NOT manually draw logos. Do NOT generate images."*

**What was built instead:** each platform gets its real brand colour, a short monogram and its real name, rendered by one component, `PlatformMark`. It is visually distinct per platform, consistent everywhere, and honest about being Cloud Compass's own mark rather than a trademark. The preview says so in words.

**To fix it properly:** install a licensed brand-icon set, then change `PLATFORM_REGISTRY` and `PlatformMark`. Nothing that renders a platform changes — that is what the registry is for. **This needs your decision, since adding the dependency is a stop condition.**

## 2. The central registry

`features/social/services/social-platforms.ts` is now the single definition of a platform: name, account noun (Page / Profile / Channel / Location), brand colour, monogram, caption limit, supported media, whether a link is meaningful, and a handle placeholder.

It does **not** redefine what already existed — `name` and `captionLimit` are read from `SOCIAL_PLATFORM_LABELS` and `PLATFORM_CAPTION_LIMITS` in `social-composer.ts`, which validation already uses, so the two can never disagree. A test asserts exactly that.

**Adding a ninth platform is one entry plus a `SocialAccount` row.** Settings, the composer chips, the tabs, the preview header and Content Detail all read from here, so none of them changes. Tests hold this: every enum value must have a complete definition, and no two platforms may share a colour+monogram.

## 3. Schema change

Three nullable columns, additive only:

```sql
ALTER TABLE "SocialAccount"    ADD COLUMN "displayName" TEXT;
ALTER TABLE "SocialPostTarget" ADD COLUMN "caption" TEXT, ADD COLUMN "link" TEXT;
```

| Question | Answer |
|---|---|
| Current limitation | A post stored ONE caption for every account. `SocialAccount` had only a handle, so a Facebook Page's real name could not be recorded. |
| Why required | "Each platform has its own caption" cannot be expressed in a column shared by all targets. |
| How existing records are preserved | Every column is nullable and **NULL means "inherit"** — which is exactly what every pre-existing target already did. No backfill, no default, no row rewritten. A backup was taken first (`backup-2026-09-09T18-01-39-927Z.json`) and the row count was identical after (`count=12`). |

## 4. Settings → Clients → [client] → Social accounts

Two new routes, following the `/settings/publishing` precedent exactly: `/settings/clients` (choose a client, with its live account count) and `/settings/clients/[id]/social-accounts` (`SocialAccountManager`).

Add · edit handle/name · enable · disable · remove. `Permissions.manageClients` (MANAGER+), enforced in the page **and** in every action.

**There is no account creation anywhere in the composer** — it links here instead.

**No credential is accepted or stored.** There is no password field, no "Connect with…" button and no token column. A test asserts that a `password`/`accessToken`/`apiKey` smuggled into the action input never reaches the database, and that what comes back to the browser has exactly seven fields, none of them a secret.

Two behaviours worth naming:
- **Disabling** removes an account from new posts and changes nothing else. Content is never deleted, schedules are never cancelled.
- **Removing** is refused outright while any saved post targets the account, and says to disable it instead. Otherwise it is a soft delete, and re-adding the same handle later **restores that row** rather than creating a second one, so its history stays attached.

## 5. Per-platform content in the composer

Tabs derive from the accounts selected for **this project's client**. `All accounts` holds the shared caption, media, link and internal name; each account gets a tab.

`null` means inherit — that single rule is the whole model:

| | Stored | Shown |
|---|---|---|
| Untouched tab | `caption = NULL` | The shared caption, dashed border, *"Following the shared caption"* |
| Typed in | `caption = '…'` | Its own text, a **Custom** badge on the tab, and a *Use the shared caption* reset |
| Reset | `caption = NULL` written | Back to following — the stored version is genuinely cleared |

**Changing Instagram does not change Facebook.** Each platform's text lives under its own account key, is validated against its own platform only, and is written to its own `SocialPostTarget` row. Verified in unit tests, in action tests, and in the browser.

A consequence worth having: the shared caption is measured against **only the platforms still inheriting it**. One X account used to cap every caption at 280; give X its own caption and LinkedIn's 3000 becomes the binding limit. The composer and the server compute this from the same pure function, so the number shown is the number enforced.

A tab offers only what the registry says the platform has: Instagram and TikTok get no link field and a sentence explaining why. Media stays shared, and the tab says so rather than showing a control that does nothing.

**The preview follows the active tab** — one notion of "which platform am I looking at", so the preview can never show one platform while you edit another.

## 6. Ownership — nothing trusts the browser

Every id arriving from the browser is shape-checked (`isUuid`) and then **re-read through the session's `companyId`**. A client or account belonging to another company simply does not come back, and is reported as not-found rather than forbidden.

Per-platform values are keyed off the **surviving** account list, so an override for a foreign or unselected account is dropped with the account itself and can never create a target. A per-platform link goes through the same `assertSafePublicUrl` SSRF guard as the shared one.

## 7. Gates

| Gate | Result |
|---|---|
| Typecheck | exit 0 |
| Full suite | 147 files, **4020 tests** pass |
| Lint | 0 errors (1 pre-existing warning in untouched `ReportForm.tsx`) |
| Build | Compiled successfully; both new routes present |
| New tests | 12 registry · 14 per-platform rules · 20 settings CRUD/tenancy · 11 per-platform persistence |

## 8. Browser verification — 91/91

**82/82** in the main run (A–K), plus **9/9** in a focused re-check of the Content Detail label.

| Section | What was proven against the real database |
|---|---|
| A. Settings entry | `/settings` → Clients → the client's screen; it says no platform is connected and no credentials are stored; **no password field and no OAuth button exist** |
| B. Adding accounts | Facebook, Instagram and X added for a real client; an account with no display name shows its handle; **three visually distinct marks rendered**; a duplicate handle is refused in words and creates no second row; a URL is refused as a handle |
| C. Edit / disable | A display name change persists and the platform is unchanged; disabling sets `DISCONNECTED` and does **not** delete the row |
| D. Composer tabs | The client's accounts are offered; **a disabled account is not selectable**; the composer links to Settings and has no account-creation control; selecting accounts reveals `All accounts` + one tab each |
| E. Per-platform captions | An untouched tab follows the shared caption; typing customizes it and shows **Custom**; **changing Instagram left Facebook and the shared caption untouched**; Instagram offers no link field and says why; Facebook does; switching tabs preserves unsaved text; once Instagram is customized, **Facebook becomes the binding limit** |
| F. Preview | Follows the active tab in both directions, names the right account, still labelled as Cloud Compass's own |
| G. Persistence | DRAFT, `publishedAt` null, shared caption on `SocialPost`, **Instagram's caption on its own target row, Facebook's `NULL`**; reopening restores both tabs exactly; resetting **writes `NULL`**, clearing the stored version |
| H. Content Detail | Labels the caption *Shared caption* when any target differs, marks Instagram *Own caption* and shows it, lists Facebook without a duplicate; with nothing customized the label reverts to plain *Caption* and no badge appears |
| I. Protection | Settings reports "targeted by 1 post"; removal is refused with the disable suggestion and the account is untouched; **disabling deletes no content and no targets** |
| J. Tampering | Malformed, missing and traversal client ids all fail safely |
| K. Responsive | 390 / 768 / 1024 / 1440 on both screens — no sideways scroll |
| Z. Database | **Identical before and after**: `content 12, socialPosts 1, socialTargets 0, socialAccounts 0, files 7, projects 5` |

### Two harness artifacts, investigated rather than assumed

- **`Shared caption` appeared to be missing.** The label carries `uppercase`, so `innerText` returns `SHARED CAPTION` and the case-sensitive regex missed it. Re-checked directly: the element's `textContent` is exactly `Shared caption`, the source renders `>Shared caption<`, and the control case (nothing customized) correctly renders plain `Caption`. **Product correct; test wrong.**
- **Three A-section checks failed on the first run.** `page.click` + `waitForLoadState("networkidle")` returned while the previous document was still current, so the assertions read one page behind. With `waitForURL` they pass. **Product correct; test wrong.**

### One error attributed away from this work

A hydration error appears on a **reload at 390px**. It reproduces identically on `/clients`, `/settings/publishing`, `/dashboard` and `/seo` — four routes this work never touched — so it is the app shell's mobile sidebar, pre-existing and already noted in earlier phases. Every route added or changed here loads with **zero** console or page errors, including the save → `replaceState` → `router.refresh()` → reload path.

## 9. Data limitation

**No SEO project in this database is linked to a client**, and social accounts belong to a client. Rather than fabricate accounts or edit seed data, the verification harness **created one clearly-named QA project against a real existing client**, exercised everything against it, and deleted it. No pre-existing row was modified, and the database was identical before and after.

Only one company exists, so cross-company tampering is proven by the action tests rather than with real rows.

## 10. NOT implemented

Official platform logos (§1) · OAuth · every platform API · publishing · per-platform media · per-platform scheduling · analytics.
