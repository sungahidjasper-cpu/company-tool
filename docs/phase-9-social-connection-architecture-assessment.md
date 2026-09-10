# Phase 9 — real social account connections: architecture assessment

**DISCOVERY ONLY. No code changed, no migration run, no database touched.** This is a proposal awaiting approval.

---

## 1. Discovery — what exists today

### The `SocialAccount` model

```prisma
model SocialAccount {
  companyId   String              // ownership root
  clientId    String              // the business it belongs to (REQUIRED)
  platform    SocialPlatform
  displayName String?             // "Storage Moguls"
  handle      String              // "@storagemoguls" — comment says "Display only"
  status      SocialAccountStatus // ACTIVE | DISCONNECTED
  @@unique([clientId, platform, handle])
}
```

Answers to the twelve discovery questions:

| # | Question | Finding |
|---|---|---|
| 1 | How is an account identified? | By `(clientId, platform, handle)`. The handle is **typed by a human** and is the identity. |
| 2 | Which fields are identity? | `platform`, `handle`, `displayName`. All three are free text the user supplies. |
| 3 | What's needed for a real connection? | The platform's own account id, an access token, its expiry, the granted scopes, and when it was last checked. **None exist.** |
| 4 | Where should credentials live? | A separate credential model — the pattern this repo already uses for publishing (§below). |
| 5 | How encrypted? | `lib/crypto/publishing-credential-crypto.ts` — AES-256-GCM, Node built-in, versioned key from env. **Already exists and is sound.** |
| 6 | How does it belong to Company → Client? | Correctly already: `companyId` **and** `clientId` are both required, and every query filters on both. This is the most client-first model in the schema. |
| 7 | How would the composer know it's connected? | **It cannot.** It filters on `status: "ACTIVE"`, which only means "the user has not disabled this". |
| 8 | Disconnected/expired/revoked behaviour? | Only `DISCONNECTED` exists, and it means "the user turned it off in Settings" — not "the platform revoked us". |
| 9 | Reconnect? | No concept of it. |
| 10 | Platform-specific info stored? | None. `social-platforms.ts` holds static per-platform *rules* (limits, media, link support) — nothing per-account. |
| 11 | Can the model be safely extended? | **Yes.** Additive fields plus a separate credential model. No replacement needed. |
| 12 | Schema changes genuinely required? | Five additive fields on `SocialAccount`, one new credential model, one small OAuth-state model. Detailed in §4. |

### Infrastructure already in place — this matters a lot

| Capability | Status |
|---|---|
| Credential encryption | ✅ AES-256-GCM, `PUBLISHING_CREDENTIAL_ENCRYPTION_KEY` **is set** in `.env`, versioned, fails closed on tampering |
| Separate credential model | ✅ `PublishingCredential` — `encryptedPayload`, `encryptionKeyVersion`, `expiresAt` *(its own comment says `expiresAt` is "unused until an OAuth-based destination exists — reserved now")* |
| Connection + status + `lastVerifiedAt` | ✅ `PublishingConnection` |
| "Validate before you claim it works" | ✅ Publishing already refuses to persist a connection unless the credential validates first |
| Route handlers for a callback | ✅ six exist (`app/api/**/route.ts`) |
| Server-side authorization helpers | ✅ `requireUser`, `Permissions.manageClients` |
| Audit logging | ✅ `logActivity` with company/client refs |
| OAuth client library | ❌ none — and none is needed (Node `fetch` + `crypto`) |
| Meta app credentials | ❌ **none** (§Blockers) |

**The architecture you hypothesised already exists in this codebase**, for WordPress: identity and status in one model, encrypted credentials in another. Phase 9 should copy that pattern rather than invent one.

## 2. The problem

Adding an account runs:

```ts
data: { companyId, clientId, platform, handle, displayName, status: "ACTIVE" }
```

and the composer selects accounts with:

```ts
where: { companyId, clientId, deletedAt: null, status: "ACTIVE" }
```

So **typing a handle produces an ACTIVE account that the composer treats as usable.** One field is doing two unrelated jobs:

- *"I want to use this account"* — a user preference
- *"this account actually works"* — a fact about the outside world

Nothing in the system can tell them apart, and nothing has ever spoken to a platform. The Settings screen is honest that no platform is connected, but the data model cannot express the difference.

## 3. Proposed architecture

**Keep `SocialAccount` as the client-facing identity and the user's enable/disable switch. Add a connection state to it, and put credentials in their own model.**

- `status` (ACTIVE/DISCONNECTED) keeps its current meaning — the user's switch. Phase 8's enable/disable is unchanged.
- `connectionState` is new and describes reality.
- Credentials never sit on `SocialAccount`.

### Connection states — the smallest set that can actually be produced

| State | Produced by | Detectable? |
|---|---|---|
| `NOT_CONNECTED` | the default; every existing manual record | trivially |
| `CONNECTED` | a completed OAuth exchange that returned a usable token | yes |
| `NEEDS_RECONNECT` | `expiresAt` passed, or a Graph call returned an auth error | yes |
| `DISCONNECTED` | the user disconnected it in Cloud Compass | yes |

Deliberately **not** included: `EXPIRED` and `REQUIRES_REAUTH` as separate states (same cause, same remedy, same UI — one state), and `ERROR` (a failed check is an *event*, not a connection state; it belongs in `lastCheckedAt` + `lastCheckError`).

## 4. Database impact — proposed, NOT applied

```prisma
enum SocialConnectionState { NOT_CONNECTED  CONNECTED  NEEDS_RECONNECT  DISCONNECTED }

model SocialAccount {
  // ...everything existing, unchanged...
  /// The platform's OWN id for this page/profile. Null for identity-only records.
  externalId      String?
  connectionState SocialConnectionState @default(NOT_CONNECTED)
  connectedAt     DateTime?
  lastCheckedAt   DateTime?
  lastCheckError  String?
  disconnectedAt  DateTime?
  credential      SocialAccountCredential?

  @@unique([companyId, platform, externalId])   // one Cloud Compass record per real page
}

/// Mirrors PublishingCredential exactly. Never selected into any client component.
model SocialAccountCredential {
  id                   String   @id @default(uuid(7)) @db.Uuid
  socialAccountId      String   @unique @db.Uuid
  companyId            String   @db.Uuid
  encryptedPayload     String   // AES-256-GCM: { accessToken, ... }
  encryptionKeyVersion Int      @default(1)
  expiresAt            DateTime?
  /// Granted scopes — NOT secret, and needed to detect a missing permission.
  grantedScopes        String[]
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  socialAccount        SocialAccount @relation(fields: [socialAccountId], references: [id], onDelete: Cascade)
  @@index([companyId])
}

/// Single-use, short-lived CSRF nonce for the OAuth round trip.
model SocialOAuthState {
  state       String   @id            // random, unguessable
  companyId   String   @db.Uuid
  clientId    String   @db.Uuid
  platform    SocialPlatform
  startedById String   @db.Uuid
  expiresAt   DateTime
  consumedAt  DateTime?
  createdAt   DateTime @default(now())
  @@index([expiresAt])
}
```

**All additive.** `SocialAccount` is extended, never replaced. Every existing row gets `connectionState = NOT_CONNECTED` by default — see §9.

An alternative to `SocialOAuthState` is a signed, expiring cookie (no table). I recommend the table: it makes the nonce genuinely single-use, records *who* started the connection for audit, and matches this repo's server-first habits.

## 5. Security

Credentials live **only** in `SocialAccountCredential.encryptedPayload`, encrypted with the existing AES-256-GCM utility.

- No token ever enters a server action's return value, a prop, or a client component. The existing `ACCOUNT_SELECT` discipline in `social-account.actions.ts` (one place decides the response shape) extends to this.
- The app secret lives in an env var, read server-side only, never in a route that renders.
- The callback is a **route handler** (server-only). The `code` is exchanged server-side; it never reaches the browser.
- `state` is validated against `SocialOAuthState`: must exist, be unconsumed, be unexpired, and its `companyId`/`clientId` must match the authenticated actor's company. Consumed atomically.
- The company/client on the account come from the **state record**, re-checked against `requireUser()` — never from a query parameter.
- Tokens are never logged. `logActivity` records the event and the page name, not the credential.
- Following the publishing precedent: **an account is marked `CONNECTED` only after a real Graph call succeeds.** No optimistic state.

## 6. Facebook flow (verified against Meta's documentation, not guessed)

Endpoints quoted verbatim from Meta's docs, Graph API **v25.0**:

1. **Start** — `POST` server action creates a `SocialOAuthState` row, then redirects to
   `https://www.facebook.com/v25.0/dialog/oauth` with `client_id`, `redirect_uri`, `state`, `scope`.
2. **User authorizes** on Facebook.
3. **Callback** — route handler receives `code` + `state`; validates and consumes the state.
4. **Exchange** — server `GET https://graph.facebook.com/v25.0/oauth/access_token` with `client_id`, `client_secret`, `redirect_uri`, `code`.
5. **List Pages** — `GET https://graph.facebook.com/{user-id}/accounts`, which Meta documents as returning "a list of Pages you have a role on, including the Page category, your permissions on each Page, and the Page access token".
6. **User picks the Page** — identity (`name`, `id`) comes from Meta, not typed.
7. **Persist** — upsert `SocialAccount` (`externalId` = Page id, `displayName`/`handle` from Meta), encrypt the Page token into `SocialAccountCredential`, set `connectionState = CONNECTED`, `connectedAt`, `lastCheckedAt`.

**Scopes:** `pages_show_list` (list the Pages a person manages) plus `pages_read_engagement`. `pages_manage_posts` is the publishing permission and should **not** be requested in this phase — publishing is explicitly out of scope, and asking for a permission we do not use is both a review risk and bad practice.

**Token lifetime:** Meta documents long-lived tokens as lasting "about 60 days" and warns "do not depend on these lifetimes remaining the same — they may change without warning or expire early." So `expiresAt` is stored, and `NEEDS_RECONNECT` is driven by *both* expiry and a failed check — never by a hardcoded 60 days.

## 7. UX

**Settings → Clients → [client] → Social accounts** becomes per-platform, driven by `social-platforms.ts` as now:

```
FACEBOOK      Catawba Yaupon · @CatawbaYaupon
              ● Connected · checked 2 minutes ago      [Reconnect] [Disconnect]

INSTAGRAM     ○ Not connected                          [Connect Instagram]

LINKEDIN      Storage Moguls · storage-moguls
              ▲ Connection needs attention             [Reconnect]
```

Plain language only — Connect / Connected / Reconnect / Disconnect / Connection needs attention. No OAuth vocabulary in the primary UI.

Identity-only legacy records read **"Not connected — added manually"**, with a Connect action.

**Composer:** each account chip and platform tab gains a status dot — `● Connected` or `○ Not connected`. Selection, platform tabs, per-platform captions, media-before-save, preview and scheduling are all unchanged; connection state is *displayed*, not a gate, because scheduling remains internal. The existing wording that scheduling "does not send the post to any social platform" stays true and stays visible.

## 8. Dependencies

**None to install.** The authorization-code exchange is `fetch`; the nonce is `crypto.randomBytes`; encryption already exists. No OAuth library, no SDK.

**To configure** (yours, not mine):

| Item | Why |
|---|---|
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | absent from `.env` — no real flow is possible without them |
| A registered redirect URI | Meta requires **HTTPS** and an **exact pre-registered match** |
| `NEXTAUTH_URL`-style base URL for building the redirect | to construct the exact registered URI |

## 9. Existing manual accounts — option A

They **remain legacy identity records**, with `connectionState = NOT_CONNECTED` from the column default. No migration of data, no conversion, no fabricated credentials, nothing deleted. Connecting one later upserts onto the same row by `(companyId, platform, externalId)` once Meta supplies the real Page id.

This is why `externalId` is nullable: an identity-only record genuinely has no platform id, and inventing one would be the same mistake as the current `status: ACTIVE`.

## 10. Blockers requiring your decision

1. **No Meta app credentials exist.** `.env` has no `FACEBOOK_*` or `META_*` keys. A real flow cannot be built or tested without an app id and secret from a Meta app you own.
2. **Advanced Access requires App Review *and* Business Verification.** Meta's access-levels documentation states that Standard Access permissions "can only be requested from app users who have a role on the requesting app", while Advanced Access "can be requested from any app user", must be "approved on an individual permission and feature basis through the App Review process", and additionally requires Business Verification. **Until that review passes, only people with a role on your Meta app can connect a Page** — so this cannot serve real clients on day one. That is a product timeline issue, not a coding one.
3. **HTTPS redirect URI.** Meta requires HTTPS and an exact pre-registered redirect URI. Meta's security page does **not** document whether `localhost` is permitted, so I will not assume it is. Local development may need a tunnel (or a dev app configured by you). **Needs confirmation against your app's settings.**
4. **Official platform logos still unavailable.** Unchanged from Phase 8: no licensed brand-icon set, and Meta's brand guidelines govern any "Connect with Facebook" button. `PlatformMark` continues to use brand colours and monograms. If you want the official mark, that is a licensed asset decision.
5. **Approval to touch the database.** The schema in §4 is additive but real; per your instruction I have changed nothing.

## 11. Implementation plan (small, ordered — pending approval)

Each step is independently verifiable, and nothing claims a connection until step 6.

1. **Schema + migration** (§4), additive, with a backfill that sets nothing — the column default does the work. Verify all existing rows read `NOT_CONNECTED`.
2. **Connection-state plumbing, no OAuth.** Extend the queries/actions to carry `connectionState`; Settings and the composer display it. Every account shows "Not connected". *This alone fixes the honesty problem and is shippable without Meta credentials.*
3. **State nonce + callback route skeleton** with full validation (unknown state, expired, consumed, wrong company) and no provider call. Fully testable with fixtures.
4. **Credential storage** using the existing crypto util, plus a `SocialAccountCredential` write/read path that never returns a token.
5. **Meta authorization start + code exchange** behind the env credentials, failing with a clear message when they are absent.
6. **Page selection and connect**, setting `CONNECTED` only after a successful Graph call.
7. **Disconnect / reconnect / check**, driving `NEEDS_RECONNECT` from expiry and failed checks.
8. Tests and browser verification throughout, with real provider authorization clearly labelled as unverified until credentials exist.

**Steps 1–4 need no Meta credentials at all.** If you want progress before the Meta app and App Review are sorted, that is the honest place to stop.
