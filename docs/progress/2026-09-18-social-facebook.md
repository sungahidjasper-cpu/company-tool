# Social / Facebook progress — 2026-09-18

Plain-language status for picking this back up tomorrow. Nothing here was committed or pushed.

## What is working

1. **Facebook OAuth is working.** The connect flow completes and a real Page authorization is stored.
2. **Facebook Page connection is working.** The client's Page ("Cebu Drum & Bugle Vibes") connects successfully when the flow is run.
3. **Facebook post/image publishing is working.** A real test today published a post with a caption and image, and it appears correctly on the real Facebook Page (confirmed by screenshot and by the stored `SocialPublication` row — real external post id `583826778150378_122232193424792307`).

## First Comment feature — built, not yet working end-to-end

4. **First Comment UI is implemented.** The composer has a real "First comment" field (no longer marked "not yet supported"), it's saved with the post, and it shows in the preview.
5. **First Comment backend flow is implemented.** New `SocialComment` model (own status: PENDING/PUBLISHING/PUBLISHED/FAILED), a new `publishComment()` call in the Facebook publisher (`POST /{post-id}/comments`), and wiring in `publishSocialPostTargetAction` to attempt the comment right after a successful post publish, with idempotency (a retry reuses an already-published comment instead of creating a duplicate).
6. **A real persistence bug was found today — identified, NOT yet fixed.** In `SocialComposer.tsx`, `publishNow()` only calls `persistPost()` (the function that actually saves caption/link/first-comment to the database) when the post has never been saved before:
   ```js
   if (!targetId) {
     const persisted = await persistPost(false);
     ...
   }
   ```
   Once a target already exists, clicking Publish Now skips straight to publishing whatever is *already stored* — it does not re-save first. This means an edit made after the first save (including typing a first comment on an already-published post) is silently never sent to the server before the next Publish Now click. **This is a pre-existing gap that predates First Comment** — the same thing would happen to a caption edited after the first save. It affects `publishNow()` generally, not just the comment field. **No fix has been applied yet** — this needs explicit authorization before touching it, since it touches the shared publish path.
7. **Today's real test result:** post published successfully to the real Page; the "First comment: Test" text typed in the browser never reached Facebook. Root cause is confirmed as the persistence gap above (#6) — the database had no first-comment text at all when the publish call ran, so nothing was ever attempted. This was NOT a Meta rejection and NOT a Cloud Compass false-success — the app correctly reported no comment outcome because there was genuinely nothing to publish.

## Facebook token / permissions

8. **Current stored token's granted scopes:** `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`. **`pages_manage_engagement` is NOT present** on the currently stored token, even though it has been added to the code's requested scope list — the existing connection predates that change and hasn't been reconnected under it. No token value, secret, or credential content is recorded here or anywhere in this file.
9. **Meta comment testing is paused for now**, per instruction, until the persistence gap and the token/reconnection are both sorted out.
10. **We will continue this investigation later** — no further Meta-side work (permissions, Tech Provider, reconnects) is planned until then.
11. **Open question, not yet answered:** whether Meta requires anything beyond `pages_manage_engagement` for comment publishing at this app's current access level. Earlier investigation found `pages_read_user_content` listed as a dependency of `pages_manage_engagement` in Meta's own reference, and that permission is documented as requiring App Review/Tech Provider. **This has NOT been confirmed as an actual blocker for this feature** — it has not been tested, because no comment publish attempt has actually reached Meta yet (see #7). Do not assume Tech Provider is required until a real attempt is made under a token that actually carries `pages_manage_engagement` and is rejected for a documented reason.

## Tests

- Focused Social suite: 432/432 passing (as of the last code change this session — nothing has changed since).
- Full suite: 4375/4375 passing.
- Typecheck: 0 errors.
- Lint: 0 errors (1 pre-existing, unrelated warning in `ReportForm.tsx`).
- Build: succeeded.
- No real Meta API test suite exists or is intended — real-provider testing is always manual, in the browser, against the real connected Page.

## Uncommitted work

Everything is uncommitted — this project has operated entirely uncommitted since Phase 9D. As of today, `git status` shows 231 changed/untracked paths, spanning unrelated prior work (AI workspace, content workspace, etc.) as well as today's social/First-Comment changes. Nothing was reset, stashed, cleaned, or discarded today. No commit or push has been made.

Directly relevant to First Comment (today's actual new/changed files):
- `prisma/schema.prisma` + migration `20260917220403_social_first_comment` (adds `SocialPost.firstComment`, `SocialPostTarget.firstComment`, `SocialCommentStatus` enum, `SocialComment` model — additive only)
- `features/social/services/social-composer.ts` (`effectiveFirstComment`)
- `features/social/services/social-publisher.ts` (optional `publishComment` on `SocialPublisher`)
- `features/social/services/publishers/meta-facebook.publisher.ts` (`publishComment()`)
- `features/social/actions/social-post.actions.ts` (persists `firstComment`)
- `features/social/actions/social-publish.actions.ts` (`attemptFirstComment()`, wired into the publish flow)
- `features/social/schemas/social-publish.schema.ts` (`CommentOutcome`, `PublishOutcome.comment?`)
- `features/social/services/social-account.queries.ts` (reads `firstComment` + `comment` relation)
- `features/social/services/providers/meta-facebook.provider.ts` (added `pages_manage_engagement` to requested scopes)
- `app/(dashboard)/content/create/social/page.tsx` (passes the new fields through)
- `features/social/components/SocialComposer.tsx` (real First Comment UI; **still contains the unfixed persistence gap described in #6**)
- Matching test files for all of the above

## Tomorrow's starting point, in order

1. Decide whether to authorize the `publishNow()` persistence fix (#6) — the smallest form is: always call `persistPost()` before publishing, not only when no target exists yet.
2. Once fixed, reconnect Facebook and confirm (via a direct, read-only database check) that the stored token's `grantedScopes` actually includes `pages_manage_engagement` this time.
3. Only then attempt a real First Comment test, and read whatever Meta actually says — do not assume `pages_read_user_content`/Tech Provider is required until a real rejection under a correctly-scoped token proves it.
4. Do not restart the Meta "App not active" investigation from scratch — that was resolved (Facebook OAuth and Page connection are both confirmed working as of today).
