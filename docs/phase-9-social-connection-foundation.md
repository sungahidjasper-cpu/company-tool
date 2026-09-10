# Phase 9 — real social account connection foundation

**No commit, no push.** Two additive migrations applied to the dev database. Facebook is the first provider; **no real provider authorization has been performed**, because no Meta app credentials exist yet.

---

## The defect this fixes

`SocialAccount.status` carried two unrelated meanings at once:

- *"the client wants this account available in Cloud Compass"* — a preference someone sets here
- *"this account actually works"* — a fact about the outside world

Adding an account wrote `status: "ACTIVE"`, and the composer selected on `status: "ACTIVE"`. **Typing a handle was therefore enough to make an account look usable.** Nothing in the data could tell a configured account from a connected one.

`status` keeps its Phase 8 meaning, untouched. `connectionState` is new and describes reality.

## Database

Two migrations, both entirely additive — no column dropped or retyped, no row updated or deleted, **no backfill at all**.

**`20260911012126_social_connection_foundation`**

- `SocialConnectionState` — `NOT_CONNECTED` / `CONNECTED` / `NEEDS_RECONNECT` / `DISCONNECTED`
- `SocialCredentialType` — one member, `OAUTH2_ACCESS_TOKEN`, the only shape confirmed against a provider's own documentation
- `SocialAccount` + `externalId`, `connectionState` (default `NOT_CONNECTED`), `connectedAt`, `lastCheckedAt`, `lastCheckError`, `disconnectedAt`; unique `(companyId, platform, externalId)`; index `(companyId, connectionState)`
- `SocialAccountCredential` — mirrors `PublishingCredential`: `encryptedPayload`, `encryptionKeyVersion`, `expiresAt`, `grantedScopes`, one per account, `companyId`-scoped, CASCADE from the account
- `SocialOAuthState` — `stateHash` (unique), company/client/platform, optional account, optional starter, `expiresAt`, `consumedAt`

**`20260911012921_social_oauth_pending_authorization`** — five nullable columns plus one unique index on `SocialOAuthState`: `selectionHash`, `selectionExpiresAt`, `selectionConsumedAt`, `encryptedAuthorization`, `authorizationKeyVersion`.

### One deviation from the discovery document, stated plainly

Discovery said `SocialOAuthState` would hold no secret. It holds one, scoped and deliberate.

Meta's flow does not end at the callback: exchanging the code yields a user-level authorization, the Pages it manages come from a separate Graph call, and only then can a person say which Page this client is. That authorization must survive those few minutes. The browser is not an option (that hands out a token), and `SocialAccountCredential` is keyed by an account that has not been chosen yet.

The alternative was a fourth model, which is outside the three that were approved. So it waits on the row that already represents exactly one in-flight authorization — encrypted with the same AES-256-GCM infrastructure, cleared the moment the flow ends, refused after five minutes. The model's own comment says so rather than leaving the old claim standing.

## Security

- **Encryption is not new.** `lib/crypto/publishing-credential-crypto.ts`, unchanged — the same AES-256-GCM and the same `PUBLISHING_CREDENTIAL_ENCRYPTION_KEY`. No second implementation.
- **Social and WordPress credentials are still logically separate.** Sharing a primitive is not sharing data: every social payload is an envelope tagged `social_oauth2`, and the social read path refuses any envelope without that tag. A publishing ciphertext handed to it fails closed — asserted by a test that encrypts a real WordPress-shaped payload with the same key.
- **No credential in any response.** `ACCOUNT_SELECT` selects `credential: { select: { id: true } }` and reports a boolean. A test pins the summary's exact key list.
- **`state` is stored only as SHA-256**, never verbatim; so is the selection token. A dump of the table cannot be replayed.
- **Single use** by conditional `UPDATE`, so two callbacks racing produce exactly one winner.
- **The callback trusts nothing from the query string** except the state and the code. Company, client, platform and account come from the state's own row. It additionally requires a signed-in actor whose company matches that row.
- **The selection token lives in an httpOnly cookie**, not a URL — so it stays out of history and referrers, and a `selectionToken` sent in a request body is ignored.
- **A page id cannot be typed.** The provider is asked to confirm the chosen page before anything is written; an unconfirmed id is refused. There is no input for one anywhere.
- **`lastCheckError` only ever receives one of a fixed set of short sentences.** Provider error text is logged, never surfaced — Meta's error bodies can echo request parameters back.

## Settings UX

**Settings → Clients → [client] → Social accounts** now states two different facts separately:

- **Enabled / Disabled** — the user's switch, styled neutrally and described as "available to choose when writing a post"
- **Connection state** — its own row: `Not connected` · `Connected` · `Connection needs attention` · `Disconnected`

The existing hand-added account reads **"Not connected — Added by hand, so Cloud Compass has not connected to the platform for this account."**

There is no disabled-looking Connect button. Because no Meta credentials are set, the row says **"Facebook connection is not configured yet."** and — for a user who may manage clients — names the variables to set, never their values. A non-manager sees only the sentence.

Plain language only. No token, scope, grant or OAuth vocabulary reaches a screen. `PlatformMark` and the platform registry are unchanged; no logo dependency was added.

## Composer

Each account chip now carries its connection state in words (`Not connected`, not a bare coloured dot), and the step hint says writing and scheduling work either way.

`connectionState` is deliberately **not** a filter on selectability. Scheduling here is internal — this phase publishes nothing — so hiding unconnected accounts would break the Phase 8 workflow for no safety gain. `resolveOwnedAccounts` keeps filtering on `status: "ACTIVE"`, with a comment recording that the future publish path, not the draft path, is what must require `CONNECTED`.

Platform tabs, per-platform captions, media-before-save, previews and scheduling are untouched.

## Facebook/Meta readiness

Every endpoint and parameter comes from Meta's own documentation, Graph **v25.0** pinned: `/dialog/oauth`, `/oauth/access_token`, `/me/accounts`. Scopes requested are `pages_show_list` and `pages_read_engagement` — **`pages_manage_posts` is deliberately absent**, since publishing is out of scope and asking for an unused permission is both a review risk and a promise not being kept.

The credential stored for a Facebook account is that **Page's** token, not the user token used to discover it. No expiry is invented: Meta warns long-lived tokens may "expire early", so `expiresAt` is whatever Meta stated, or null.

With no credentials configured, `describeConfiguration` reports that and every other provider method refuses **without making a network call**. There is no mock mode and no branch that returns a successful authorization without a real HTTP response from Meta.

## Tests — 134 new, 4224 total

| Area | Count |
|---|---|
| Connection state wording — only CONNECTED reads as connected | 9 |
| Credential security — encryption, envelope separation, tampering, company scope | 14 |
| OAuth state — single use, expiry, forgery, replay, races, parked authorization | 23 |
| Meta provider — configuration gating, URL construction, exchange, discovery, refusals | 25 |
| Connection actions — role, cross-company, cross-client, cookie handling, diagnostics | 26 |
| Connection lifecycle — connect, reattach, disconnect, check transitions | 30 |
| Redirect URI | 7 |

The existing `social-account.actions.test.ts` was updated where it correctly caught the change: the summary's key list, and removal now dropping the credential.

## Browser verification — 61/61

Against the real app and the real database, one account: Facebook · Catawba Yaupon · @CatawbaYaupon.

- The account appears, says **Not connected**, explains why, and never shows the label "Connected" in its row
- "Facebook connection is not configured yet", with the variable names for a manager
- No Connect button while unconfigured; no password or token input anywhere
- Editing still works, and changed neither the connection state nor the availability switch
- The composer states "Not connected", still saved a draft with a per-platform caption, and the shared caption survived the per-platform edit
- **Live callback validation:** missing, unknown, malformed, expired and **replayed** states all refused; a genuinely valid state passed validation and then stopped at the missing configuration; the state was consumed by that single use
- The page-selection screen with no in-flight flow sends you back and renders no choices
- An unrecognised error code renders nothing rather than echoing itself
- Nothing fabricated: 0 CONNECTED, 0 credentials, 0 external ids, 0 parked authorizations
- Four widths; database identical before and after; no console errors

One check was skipped: cross-company callback rejection needs a second company, and only one exists. It is covered by unit tests.

## Gates

typecheck 0 · **4224 tests** · lint **0 errors** (1 pre-existing warning in `ReportForm.tsx`, unrelated) · build clean, both new routes registered · migrations applied and up to date.

`.env` is gitignored and untouched. `.env.example` documents `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` and the optional `SOCIAL_OAUTH_REDIRECT_BASE_URL` as **empty** placeholders. No secret exists in any source file.

## Remaining blockers

1. **No Meta app credentials.** The foundation is ready for them; nothing beyond the authorize redirect can be exercised until they exist.
2. **Advanced Access needs App Review and Business Verification.** Meta's access-levels documentation: Standard Access permissions can only be requested from people with a role on the app; Advanced Access can be requested from any user, requires App Review per permission, and requires Business Verification. **Until that passes, only people with a role on your Meta app can connect a Page.** The code is identical either way.
3. **HTTPS, exactly-registered redirect URI.** Meta requires it; whether `localhost` is permitted is not documented on their security page, so local development may need a tunnel — hence `SOCIAL_OAUTH_REDIRECT_BASE_URL`.
4. **Official platform logos still unavailable**, unchanged from Phase 8.

## Also worth knowing

The project's `db:backup` script's `MODEL_ORDER` does not include the social models, so the established backup cannot restore a `SocialAccount`. A supplementary snapshot was taken before migrating. Extending that script was out of scope for this phase.

## Out of scope, and not done

No publishing on any platform. No analytics, campaigns, approvals, client portal or reporting. No AI changes. No change to Content or SocialPost ownership, and no redesign of the Phase 8 social architecture.
