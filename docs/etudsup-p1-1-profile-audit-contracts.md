# EtudSup P1.1 — Account profile audit and implementation contracts

Audit date: 2026-10-12. Workspace: `/home/yasso/irm-platform`. Inspected Git HEAD: `e2e6ec8`, with substantial modified and untracked implementation work. **This report describes the working tree, not just HEAD.**

P1.1 is source inspection and documentation only. All endpoints, validators, policies, migrations and UI work labelled **proposed** below are implementation contracts for later tasks, not delivered functionality. No application code, generated artifacts, dependencies, environment, deployment or databases were changed. No database connections, queries, server starts, test runs, staging, commits, pushes or deployment were performed. `/home/yasso/etudsup` was not entered or modified.

## 1. Scope, evidence and current account behavior

### Scope and instructions

Read `AGENTS.md` and `frontend/AGENTS.md`. The root instructions retain a small IRM deployment and prohibit unrelated refactors; this task explicitly authorizes auditing the already-present independent community memberships and specifying an account-wide summary. That is not authorization to build communities, a community switcher, or platform administration. The community Delegate dashboard and its authorization stay outside these profile changes. The frontend instruction to read version-specific Next.js guides applies before later frontend coding; no frontend code was written here.

Initial `git status --short` showed 55 modified tracked files and extensive untracked source, migrations, tests and documentation. These were treated as existing work and preserved. The requested report did not exist at initial inspection. Reads were sequential snapshots of a shared workspace, not an atomic checkout; later implementation must recheck the tree and migration head.

### User data inventory

Source: `backend/app/models/user.py`, `backend/app/schemas/user.py`, `backend/app/services/user.py`, and users migration `dd021d7df98f`.

| User field | Storage / constraint | Current account response | Exposure elsewhere |
| --- | --- | --- | --- |
| `id` | UUID primary key, generated with `uuid4` | Returned | Referenced by content author/uploader IDs; stable ownership key |
| `username` | Non-null `varchar(50)`, `uq_users_username` | Returned | Current content author label; Delegate member lists |
| `email` | Non-null `varchar(320)`, `uq_users_email` | Returned to account owner | No email field on inspected author/member response schemas |
| `password_hash` | Non-null `varchar(255)` | Never returned by `UserResponse` | Internal Argon2 hash only |
| `first_name`, `family_name` | Non-null `varchar(100)` each | Returned | Account names on Delegate pending/active lists |
| `created_at`, `updated_at` | Non-null timezone-aware datetimes; Python defaults, update hook | Returned | Account metadata, not application metadata |

There is no User avatar field, platform role, administrator flag, account status, email-verification marker, password-reset token, or password-change timestamp in this model or migration history. Community roles and permissions belong to memberships, not to User. Do not introduce these as editable profile fields.

User relationships currently cover sessions, memberships, documents, announcements, document votes, saved documents, document readings, announcement replies, posts, post replies, discussion messages and discussion reactions. Relationships use User UUID foreign keys; many have deletion cascades. Renaming an account does not invoke deletion and must not alter these IDs or associations.

### Current routes and responses

All paths below include the actual router prefix `/api/v1`.

| Method / path | Authentication | Current request | Current success response / effects |
| --- | --- | --- | --- |
| `POST /api/v1/auth/register` | Guest allowed | `username`, `email`, `password`, `first_name`, `family_name` | 201 `UserResponse`; no session created |
| `POST /api/v1/auth/login` | Guest allowed | `email`, `password` | 200 `UserResponse`; creates a new session and sets cookie |
| `GET /api/v1/auth/me` | Session required | None | 200 `UserResponse`, `Cache-Control: private, no-store` |
| `POST /api/v1/auth/logout` | No mandatory current-user dependency | No declared JSON body | 200 `{"detail":"Successfully logged out"}`; revokes the valid presented session, clears cookie; also succeeds with no/invalid cookie |

`UserResponse` contains exactly `id`, `username`, `email`, `first_name`, `family_name`, `created_at`, `updated_at`. It contains no password, membership, capability or avatar data. Register and login do not explicitly set no-store; `/auth/me` sets it on success only. Auth routes use ordinary `APIRouter`, so current auth/dependency/validation error responses do not receive the private-response wrapper automatically.

Registration validation is currently length-only for username (3–50 code points), account names (1–100), password (at least 8), plus `EmailStr`. There is no account string trimming, character policy, Unicode normalization, password complexity requirement, or password maximum in application schemas. Whitespace-only usernames/names can satisfy lengths. `UserCreate` and `UserLogin` do not forbid extra fields; Pydantic's default ignores them. Unknown fields are not used to grant privileges, but silent acceptance is unsuitable for the new contracts.

Email handling is shared by registration and login through `EmailStr`. Inspected installed dependency source strips outer whitespace, applies email-validator normalization (including local-part NFC and normalized domain/IDNA handling), and disables deliverability checks. Local-part case is generally preserved, with specific standards-defined mailbox-name exceptions in email-validator; there is **no application-wide lowercasing of the whole email**. `authenticate_user` queries `User.email == login_in.email`. Thus full-email case-insensitive login/uniqueness is not established. Dependency versions and deployed collation were not verified at runtime. Email format acceptance does not verify mailbox ownership.

Username is stored as supplied today. Named unique constraints use ordinary string columns, with no `lower(username)`, `CITEXT`, canonical-name column or explicit collation. The source-intended uniqueness is exact-string and case-sensitive under ordinary PostgreSQL string equality; deployment collation is unverified. `Sara` and `sara` should remain distinct in the proposed contract. **Login uses email, not username**, so username edits cannot change login credentials. No inspected API route addresses an account by username. Delegate provisioning CLI explicitly takes User UUID; content and membership routes use UUIDs and community/module slugs. Usernames are display text, not authorization keys. Old literal mentions or names typed into a content body remain text and are not rewritten.

`create_user` rolls back `IntegrityError` and maps string matches from driver errors to 409 `Username is already taken.`, `Email is already registered.`, or a generic creation conflict. This avoids returning raw SQL but is less precise than the structured constraint-name handling already used in membership services. Login returns generic 401 `Incorrect email or password` for unknown email or invalid password. No dummy password verification is performed for unknown emails. HTTP exceptions use `{"detail": ...}`; validation uses FastAPI's default 422 detail array. The installed FastAPI handler serializes `exc.errors()` unchanged, which can include submitted `input`; new password routes must explicitly prevent secret echo rather than assuming default validation is safe.

### Author identity and current privacy boundaries

| Surface | Actual author/member fields | Resolution / access |
| --- | --- | --- |
| Announcement create/list | `author_id`; no author label in `AnnouncementResponse` | Stable User UUID; active community access and creation permission |
| Announcement detail | Above plus nullable `author_username` | Property reads current `author.username` |
| Announcement replies | `author_username`; no author email/account names | Current User relationship; active community members |
| Post feed/detail and post replies | `author_username`; no author email/account names | Current User relationship; active community members |
| Discussion history/create/WebSocket message event | `author_username`; no email/account names | Current User relationship when serialized; active community members |
| Document response | `uploader_id`; no username/name/email | User UUID linkage; document-specific access rules |
| Delegate pending applications | `username`, account first/family names and submitted application fields | Community Delegate-only pending read |
| Delegate active member list | `username`, account first/family names; no application fields | Community Delegate-only read |
| Delegate bounded directory | Membership ID, `username`, status, role, membership timestamps | Community Delegate-only; no account names/email/application fields |

The five author models implement `author_username` as a property, not a stored historical snapshot. Services eagerly load User where needed or explicitly serialize that property. After renaming, a fresh response displays the new username on old content, with its original author UUID unchanged. Existing client state and already-serialized/queued WebSocket events can retain the previous label until refetched; there is no identity-change event. Account name edits affect fresh Delegate lists; they do not change author labels, which currently use username.

### Sessions, cookies, origin checks and actual gaps

`get_current_user` reads the configured session cookie, validates it and queries User by the session's `user_id`. Missing, invalid, expired, revoked or orphaned sessions yield 401 `Not authenticated`. Profile ownership must use this dependency, without requiring an active IRM membership.

Sessions have UUID ID, indexed User UUID, unique indexed token hash, `is_revoked`, creation and expiration times. Tokens use 32 random bytes via `secrets.token_urlsafe(32)`; only SHA-256 token hashes are stored. Validation checks revocation and expiration; the current code rejects expiration strictly earlier than now. There is no sliding renewal, session-device inventory, revoke-all helper, user-accessible session-management route or cleanup policy in the inspected account code. Multiple login sessions may coexist. Login does not revoke an old browser token before creating another. Logout revokes only the presented session.

Cookie defaults in source: name `session`, lifetime 7 days, HttpOnly, SameSite=Lax, path `/`, no Domain (host-only); Secure depends on configuration and defaults false. Actual deployed settings are unknown. Keep HttpOnly database sessions; require Secure for a later HTTPS deployment, without changing settings during this audit.

REST CORS currently allows configured `frontend_url` and `http://127.0.0.1:3000`, credentials, all methods and headers. CORS is not server-side CSRF validation. REST has no explicit Origin/Referer guard or CSRF-token check in inspected app/routes/dependencies. SameSite=Lax and JSON preflights help but do not substitute for a mutation guard, particularly for multipart avatar uploads or same-site untrusted origins. The unconditional REST localhost allowance differs from environment-gated WebSocket origins; a targeted production-origin alignment is a future security dependency, not an audit edit.

Discussion WebSockets require trusted, non-null Origin and a valid session with active membership in that community. The allowlist is derived from `frontend_url`, development/test localhost entries and explicit extra WebSocket origins. Every **30 seconds**, a fresh short-lived database session rechecks both session and membership. Revocation closes with 1008 and drains/unregisters the connection. The broadcaster's send-time check concerns content visibility, not session validity; a socket may receive messages between revocation and the next periodic check. The broadcaster is process-local and documents a single-worker constraint.

The periodic loop catches cancellation, but does not handle an exception from its database authentication check. A failed check can terminate the background task without closing the socket; therefore the source does not guarantee bounded revocation during database failures. The later password/WebSocket task should close and clean up on revalidation failure with a bounded timeout, without claiming that this correction exists today.

No application rate limiter, throttle persistence, Redis/limiter dependency, REST CSRF framework, email verification, password recovery/reset/change API, avatar pipeline, account-wide membership summary, or `/account` page was found in the inspected source. No configured proxy or runtime behavior is assumed to fill these gaps.

Current account tests cover successful registration, duplicate username/email, invalid email/short password, login failures/success, cookie attributes, logout/idempotency, `/auth/me` ownership fields and no-store success, Argon2 correctness/malformed hashes, and individual session creation/expiration/revocation. They use SQLite for those cases. No dedicated User-model test file appeared in the enumerated model tests, and inspected account tests do not establish trimmed/Unicode/case rules, strict extra-field rejection, profile updates, change-password races, avatar behavior or account-wide membership privacy. Those need new targeted coverage, not a claim based on existing test names.

### Migration evidence

Static AST inspection of all 27 migration files found one source head, `f4b8c1d2e390`, and a continuous chain from `dd021d7df98f`. This was done without importing app settings, running Alembic or connecting to a database. It is **not evidence that any database has been upgraded**.

Relevant sequence: initial users and sessions; initial unique `(user_id, community_id)` membership rows; `2b032f8c674b` added global PENDING/ACTIVE uniqueness; application fields `d7a9b6c4e213` made CNE nullable and added submitted names/type/promotion; `98b4d2a6f731` added identifier type; `d9a1f3c7b205` added Programme and nullable community linkage; **`e4b6c8d0f219` removes global membership exclusivity** while preserving per-community pair uniqueness and one active Delegate per community; `f4b8c1d2e390` adds nullable module Programme linkage. The removal migration refuses an unsafe downgrade if multi-community current memberships exist. No subsequent users alteration adds avatars or canonical usernames.

## 2. Proposed common account API rules

These are proposed defaults for later implementation. Keep the existing `/auth/me` convention for own-account data instead of introducing caller-addressed profile updates.

| Concern | Required contract |
| --- | --- |
| Identity | Resolve authenticated User from session; no caller User ID, email, username lookup or community authority used to select target |
| Authorization | Any authenticated account, including no memberships or restricted memberships, can manage its own profile/security/avatar and read its memberships |
| Cache | `Cache-Control: private, no-store` on success and failure, including dependency, parsing, validation, origin, limit and server errors; no personalized shared cache |
| Requests | Strict allowlists; forbid extras and wrong scalar types; reject unknown query keys on the new routes rather than accepting `user_id` selectors |
| JSON mutations | Require `application/json` (parameters allowed); 415 `Unsupported media type` otherwise. Proposed total body cap 16 KiB with 413 `Request body too large` |
| CSRF/origin | Before parsing or performing unsafe operations, require non-null Origin matching an explicit browser frontend allowlist by scheme/host/port; no suffix/prefix matching or Referer fallback. Missing/untrusted/null Origin: 403 `Untrusted request origin` |
| Validation | 422 `detail` array containing only `loc`, `type`, `msg`; never echo `input`, raw body, validator context, secrets or unknown field values |
| Errors | 401 only for invalid authentication; stable human-readable `detail` strings for domain errors; generic 500 `Account operation failed` for unexpected server/storage failures |
| Atomicity | Roll back on failure; do not apply some supplied fields before rejecting others |

Use existing error envelopes and frontend `ApiError`, with account-scoped sanitization/private-response handling. `PrivateContentRoute` provides a reusable pattern for no-store errors but does **not** sanitize validation inputs or cover arbitrary unhandled exceptions itself. A targeted account wrapper/handler must finish those responsibilities, including malformed JSON. Avoid logging validation exceptions/raw request bodies. Authentication/origin checks must precede body validation for these routes; valid-body guest tests alone do not prove denial precedence.

Proposed REST trusted origins: configured `frontend_url`, with exact localhost entries only in development/test. Do not automatically grant REST mutation authority to WebSocket-specific extra origins. This browser-only contract intentionally rejects missing-Origin command-line calls; tests supply an explicit trusted Origin. No new CSRF dependency is necessary for this exact-Origin strategy. Reuse credentialed `fetchApi`; never expose/read session tokens in JavaScript.

Example sanitized error:

```json
{
  "detail": [
    {"loc": ["body", "username"], "type": "string_too_short", "msg": "Username must contain 3 to 50 characters"}
  ]
}
```

## 3. Proposed profile editing contract

| Item | Contract |
| --- | --- |
| Endpoint | **`PATCH /api/v1/auth/me`** |
| Request | JSON object with only `username`, `first_name`, `family_name`; each supplied value must be a strict non-null string |
| Success | 200, full current `UserResponse` allowlist, including read-only email and timestamps; same UUID |
| Omitted field | Leave the stored value byte-for-byte unchanged |
| Explicit `null` | 422; no clearing of non-null account fields |
| Empty / whitespace-only | 422 after normalization |
| Empty object | 200 no-op; return current account, retain `updated_at` |
| Other no-op | If all supplied normalized values equal current values, no update/commit solely to change timestamp, no session rotation/revocation |
| Actual update | Only assign changed allowlisted User columns; update User `updated_at`; membership/content rows and their timestamps untouched |
| Conflict | 409 `{"detail":"Username is already taken."}`; rollback all supplied changes |

Request:

```json
{"username":"sara_elm","first_name":"Sara","family_name":"El Mansouri"}
```

Response (illustrative UUIDs/timestamps, not queried account data):

```json
{
  "id":"11111111-1111-4111-8111-111111111111",
  "username":"sara_elm",
  "email":"sara@example.com",
  "first_name":"Sara",
  "family_name":"El Mansouri",
  "created_at":"2026-10-01T10:00:00Z",
  "updated_at":"2026-10-12T11:00:00Z"
}
```

Partial request `{"first_name":" Sara "}` changes only first name to `Sara`. `{"email":"other@example.com"}`, `{"user_id":"..."}`, `{"role":"DELEGATE"}`, permissions, status, admin flags, `avatar_url`, password or membership/application keys all yield sanitized 422 `extra_forbidden`; do not silently ignore them. Reject arrays and other non-object bodies. Email remains read-only until a separate verified-email-change flow exists.

### Validation and compatibility correction

Proposed shared registration/profile validator:

1. Require strings; check the raw string for Unicode categories `Cc` (controls), `Cs` (surrogates), `Zl`/`Zp` (line/paragraph separators), and directional embedding/override/isolate characters U+202A–U+202E and U+2066–U+2069; reject them with 422. This rejects tabs/newlines rather than trimming them into valid names.
2. Trim boundaries using Python `str.strip()`; preserve internal spaces, punctuation, Unicode letters/marks, digits and other allowed Unicode characters. No ASCII-only restriction is invented. This applies to username as well as names; interior spaces remain permitted because registration currently permits them and usernames are not URL identifiers.
3. Count Unicode code points after trimming: username 3–50, first/family names 1–100. Preserve case; no lowercase, casefold, NFC/NFKC transformation, transliteration or whitespace collapsing. NFC-equivalent but differently encoded usernames remain distinct, matching current raw-string uniqueness; a future canonicalization policy needs a collision plan.

Boundary trimming and rejecting unusable/control text are an **explicit correction** to current permissive account registration. Applicant-name validation already trims and rejects `Cc`/`Zl`/`Zp`; share the relevant pure validation logic without connecting account edits to Membership. Applying the same account rules to registration in a later narrowly scoped task avoids divergent contracts. Do not bulk normalize existing users, rename accounts, or modify historical applications. Omitted legacy values stay untouched; explicitly supplied legacy values must satisfy the new validator even if equal to stored values. Legacy leading/trailing whitespace usernames may remain until that owner edits them; exact database conflicts still govern.

### Uniqueness, concurrency and identity refresh

Keep `uq_users_username` and exact-string case-sensitive uniqueness. Do not introduce a case-insensitive index in this profile task. Exclude the caller's UUID from an optional friendly availability check, but rely on the database constraint as authority. Inspect PostgreSQL `diag.constraint_name` plus unique-violation SQLSTATE 23505; only `uq_users_username` maps to the username 409. Use a precise SQLite fallback in unit tests. Do not translate unrelated integrity failures into “username taken” or expose SQL/driver details. Two users racing for the same exact username produce one success and one 409; the loser retains its previous names and username. A claim racing with registration has the same result.

For one account, lock and refresh its User row before applying the supplied patch so unrelated omitted fields are not overwritten by stale ORM state. Concurrent successful changes to the same field use last committed update; no ETag/version API is proposed. No-op response still requires auth/origin checks. Profile changes preserve every session, as account UUID remains stable.

**Never rewrite** `Membership.applicant_first_name`, `applicant_family_name`, `cne`, `identifier_type`, `applicant_type`, or `promotion`. Those are submitted application values for manual review. A later community reapplication can replace its own values via the existing membership service; profile editing cannot. Existing content keeps the same User UUID and displays the current username on fresh reads; no new historical author snapshots or body-text substitutions.

Frontend after confirmed 200: reset the form's saved baseline to the returned normalized profile, then refresh shared auth via `useAuth().refresh()` and check its returned result (it often catches errors internally). Ensure older pre-save refresh requests cannot later overwrite newer identity; use a request-generation invalidation or a scoped account-update helper in a later task. Do not reload the page or treat an IRM membership-refresh failure as logout. Invalidate/refetch mounted own-author content as needed; other clients update on normal refetch/reconnect, with no promise of instant global label changes. On auth-refresh network failure after a successful mutation, preserve the confirmed save and show a separate refresh retry; do not report the save as failed or discard new values. A definitive 401 clears account-specific state and returns to sign-in. Never copy account names into application form values as a save side effect.

## 4. Proposed password-change contract and policy

| Item | Contract |
| --- | --- |
| Endpoint | **`POST /api/v1/auth/me/password`** |
| Allowed body | Exactly required strict strings `current_password`, `new_password`; no confirmation/User ID/email/reset token fields |
| Current password | At least one code point; no trim/Unicode transformation; validate with existing Argon2 verifier against fresh locked User hash |
| New password | Existing minimum of 8 Unicode code points, no complexity rules; proposed maximum 1024 UTF-8 bytes to bound hashing input, applied to registration too as an explicit correction |
| Same password | After successful current verification, reject with sanitized 422 at `new_password`, type `password_unchanged`, message `New password must differ from the current password`; hash/sessions unchanged |
| Wrong current | 400 `{"detail":"Current password is incorrect."}`; no password/hash/token exposure; account and sessions unchanged |
| Invalid session | 401 `{"detail":"Not authenticated"}`; distinct from wrong-current failure |
| Success | 200 `{"detail":"Password changed. Sign in again."}`; clear session cookie, revoke every session for this User, including initiating session |
| Throttle | 429 `{"detail":"Too many password change attempts. Try again later."}`, integer-seconds `Retry-After`; account/password unchanged |

Example request (synthetic secrets solely to illustrate the shape):

```json
{"current_password":"Example-old-pass!","new_password":"Example-new-pass!"}
```

The 1024-byte new-password maximum is proposed, not existing behavior. Count the minimum without trimming: spaces remain significant, and composed/decomposed Unicode remains different. Current-password verification has no new 1024-byte field cap, to avoid rejecting a legacy password only because a new rule was introduced; the proposed 16 KiB body limit bounds the request. Extremely large legacy passwords remain an explicit compatibility limit, not a promise of unlimited future authentication input. Do not add password transformations, password reset, email verification or recovery endpoints.

### Concrete session policy

Recommend **revoke all sessions and require sign-in again**, including this browser. Before submit, tell the user that all devices will be signed out. On success clear sensitive form memory, invalidate pending auth/profile/membership/content work, clear shared authenticated state, close discussion sockets and navigate to `/login` with a non-secret success message. The user's next step is to sign in with the new password and existing email. Do not call logout as a separate prerequisite or create a replacement token in this policy.

Password-hash replacement and revocation of every non-revoked Session row for this User must commit in **one transaction**. Refresh User under a row lock, revalidate the initiating session after acquiring that lock, verify current password, reject equality, hash with existing `hash_password`, update hash, bulk-mark sessions revoked, commit, then clear the cookie with the same path/SameSite/Secure settings as login/logout. On failure rollback both hash and revocation. Existing `revoke_session` commits independently and is not a transaction-safe revoke-all implementation. Never loop through that helper to claim atomic revocation.

Close the login race: currently `authenticate_user` and `create_session` are separate and the latter commits. A login that verifies the old password just before a password change could otherwise create an unrevoked token afterward. Later password work must make login verification plus session creation serialize on the same User lock and transaction, with fresh hash verification under that lock. A token issued before the change is revoked; an old-password login after it fails. Two simultaneous changes serialize; a waiting request rechecks its now-revoked initiating session and cannot change the password again. These are targeted authentication dependencies, not general refactors. Profile/avatar row locks use the same User-first ordering and must not assign an old password hash accidentally.

### WebSocket interaction

All old cookies become invalid for REST immediately after commit. Existing periodic session revalidation will close corresponding discussion sockets at the next 30-second check (plus scheduling/DB delay); the original connection is not saved merely because it initiated the change. Old-token reconnect fails even where membership remains ACTIVE. Members in different communities retain membership records, but all their old sessions/sockets lose account authentication.

Proposed baseline acceptance is existing bounded periodic socket closure, explicitly accepting the short interval during which queued/new discussion events can still be delivered. The current sender does not validate session authorization on every send, so do not claim instantaneous socket revocation. The initiating frontend closes its socket immediately upon confirmed success. Instant server-wide disconnect/no-post-commit delivery would require additional socket/session tracking or send-time authorization and is a separate product choice; no shared broadcaster infrastructure is introduced here.

For this baseline to hold under authentication-check failure, add targeted fail-closed handling around periodic revalidation and a bounded check timeout in the later security task. A database error/timeout must call the existing connection cleanup path rather than leave a connected socket with a dead revalidation task. Test this failure separately from ordinary successful revoked-token detection.

### Origin, throttling and secret handling dependencies

Apply the common exact-Origin guard to this POST and profile/avatar mutations. Keep SameSite=Lax and HttpOnly sessions. Proposed auth response hardening should also cover login/register/logout no-store and redact their password-bearing validation errors; current default errors are not proof of non-disclosure.

No current limiter was found. Recommended small pre-alpha default: count **all** password-change attempts before Argon2 work, allowing 5 per authenticated User UUID per rolling 15 minutes and 20 per trusted client IP per rolling 15 minutes. IP guarding also bounds malformed/unauthenticated attempts. Requests exceeding either budget get 429 and `Retry-After`; success does not automatically clear the budget. No permanent account lockout. Limit raw body before decoding/hashing. Do not trust arbitrary `X-Forwarded-For`; use the peer address unless a trusted-proxy policy exists.

A bounded, concurrency-safe process-local limiter using existing Python facilities requires no new dependency and matches the broadcaster's documented single-worker pre-alpha model. It is a **new implementation dependency**, loses counters on restart and does not enforce aggregate budgets across workers. Verify worker topology before accepting it; a multi-worker deployment requires a reviewed shared-store or database-backed limiter decision rather than silently claiming global protection. Do not introduce Redis or a new provider in this audit. Optional profile/avatar mutation limits can reuse that later limiter; they do not replace password throttling.

Use existing Argon2id hashing and verification; hashes use fresh salts. No plaintext passwords, hashes or raw session credentials in logs, responses, storage keys, analytics, URLs, exception strings, browser persistence or audit events. A limited internal security event may contain User UUID, time and outcome only. Password confirmation, if offered, stays a frontend comparison and is not a third API field.

## 5. Proposed minimal avatar flow

### Existing infrastructure

`StorageProvider` offers save/read/delete/exists/get_path. `LocalFileSystemStorage` constrains relative paths to the root, rejects traversal and writes via a temporary file plus `os.replace`; delete is idempotent for a missing file. Current documents use community/module keys, declared MIME checks, a configured 50 MiB upload cap and PNG/PDF preview generation. Pillow and python-multipart are already declared dependencies. Image previews call Pillow and thumbnail/re-encode, but are **not an avatar security validator**: they do not implement the proposed avatar dimensions/frame/metadata policy. Document role/permission/status rules are unrelated to ownership of an account avatar. Reuse storage operations, not document authorization, document records, document limits or preview error exposure.

### Proposed API

| Method / path | Contract |
| --- | --- |
| `PUT /api/v1/auth/me/avatar` | Authenticated owner; exact trusted Origin; multipart with exactly one part `file`, no duplicate/extra fields; 200 `{"avatar_url":"/api/v1/users/<User UUID>/avatar/<version UUID>"}` |
| `DELETE /api/v1/auth/me/avatar` | Authenticated owner; exact trusted Origin; no body; idempotent 200 `{"avatar_url":null}` including already absent avatar |
| `GET /api/v1/users/{user_id}/avatar/{version}` | Proposed authenticated image-only delivery; any signed-in account may view the sanitized picture; no community-membership requirement; matching current version required |

PUT/DELETE responses expose only nullable `avatar_url`; do not return email, names, application values, session data or storage keys. Media GET returns only re-encoded image bytes, never a User JSON response or an account lookup endpoint. Current/no avatar, wrong version, invalid UUID or absent storage object should produce the same generic 404 `Avatar not found` for an authenticated caller; guest receives 401. The new account UUID media URL is a proposed route, not an existing user API. Require both identifiers to be valid UUIDs before any storage read; no client-supplied path or arbitrary external URL.

When avatar support ships, add nullable `avatar_url` to the shared own-account `UserResponse` and frontend User type (`/auth/me`, login and registration, including null for new/legacy users). Profile editing still cannot accept it. Use a separate minimal image descriptor for future author rendering; never reuse full `UserResponse` for authors. Adding author-avatar fields to every content API is a later explicit scope decision, not required to enable own-account upload.

### Validation and output rules

| Item | Proposed default / required behavior |
| --- | --- |
| Input formats | JPEG and PNG only; declared media type must agree with decoder-detected format. Filename extension is not evidence |
| Upload limits | At most 2 MiB (2,097,152 bytes) file data; stream/read at most limit+1; proposed multipart request cap 2 MiB + 64 KiB to bound overhead and excessive fields |
| Image dimensions | Width and height each 32–4096 pixels, and width × height at most 16,000,000 pixels, checked before full pixel decode |
| Decoding | Restrict decoder formats, inspect dimensions, `verify`, reopen and fully `load`; reject truncated/corrupt images, decompression-bomb warnings/errors and unsupported decoders |
| Animation | Reject multiple frames/APNG even if first frame appears valid; reject GIF/WebP/AVIF and all other unsupported formats |
| SVG | Always reject, including disguised SVG or MIME/extension spoofing; no SVG sanitization dependency |
| Sanitation | Apply EXIF orientation in memory, center-crop square, resize to 256×256, convert/composite to fresh RGB pixels on fixed white background, encode JPEG quality 85 |
| Metadata | Retain only pixels; drop EXIF/GPS, XMP, ICC profiles, text/comment chunks, original filename and all original bytes; never save the source upload |
| Encoded output | Require valid 256×256 JPEG and at most 256 KiB; otherwise 422 generic invalid-avatar error |

Use a fresh image object for encoding, not merely `save` on an image carrying `info`. Explicitly handle Pillow bomb detection and own lower pixel bounds rather than relying on its installed defaults. Decoder/encoder work must be bounded and run off the async event loop if the endpoint is async. Multipart parsing has to enforce field/part/body bounds before a malicious request is fully buffered; reading the accepted UploadFile at limit+1 alone does not bound parser spooling. Existing python-multipart handles transport, not decoded-image trust.

Statuses: 413 `Avatar upload too large`; 415 `Unsupported avatar format` for unsupported declared/decoded format; 422 `Invalid avatar image` for empty/corrupt/animated/dimension-invalid data or MIME mismatch; sanitized 422 for missing/extra/duplicate parts; 500 generic account-operation error for storage/persistence failure. Do not return Pillow exceptions or physical paths. All responses have `private, no-store`.

### Schema, keys, replacement and removal

Proposed minimal migration: nullable `users.avatar_storage_key varchar(255)`, default null. No backfill image generation, new tables, provider, public filesystem mount or extra dependency. Server generates `avatars/<User UUID>/<fresh version UUID>.jpg`; derive the version from that validated server-owned key. Store the relative key internally; construct URL from identifiers. User UUID, not mutable username, owns the namespace. Never accept filenames/keys from clients. Source output is always JPEG; a separate stored MIME/dimensions/version column is unnecessary with the fixed encoding contract.

Replacement: validate and encode before mutation; serialize on User row; save to a new key; update the pointer and User timestamp in a transaction; on failed save/commit retain the previous pointer/avatar and delete the new object where possible. After confirmed commit delete the old key. Never delete old content before commit or overwrite its immutable version key. Concurrent upload/delete operations serialize; cleanup targets only the captured superseded key, never the current key.

Removal: commit null pointer first, then delete the captured old object; repeated removal is a no-op and preserves timestamp. Failed post-commit cleanup cannot roll back a confirmed new pointer/removal. Record a non-secret cleanup failure and retry; do not misreport the successful account mutation as failed. Filesystem and PostgreSQL are not one atomic transaction: crashes can leave orphans. A small future dry-run/retry cleanup routine must inspect only the `avatars/` namespace, preserve keys referenced by User, and remove unreferenced files older than a 24-hour grace period while coordinating against active writers. Record failed cleanup durably through an existing reliable log/retry procedure or decide a cleanup-job mechanism before avatar acceptance; no such mechanism currently exists. Never sweep documents or arbitrary storage paths.

### Visibility, cache and fallback

Recommended initial visibility: sanitized avatar pictures readable by authenticated accounts, without exposing profile/application data. Public guest-readable avatars are an unresolved product choice; default to authenticated delivery. This is broader than a community-scoped picture permission and must be stated to the uploader. Both account metadata and image delivery use `private, no-store`, with `Vary: Cookie`, `Content-Type: image/jpeg` and `X-Content-Type-Options: nosniff` on successful media delivery. The changed version URL also prevents reuse of stale in-memory/browser image references. Check the requested version against the current pointer on every delivery: superseded/removed versions are 404, not a historical avatar gallery. Already downloaded images cannot be recalled. Relative response URLs must be resolved against the configured API origin; authenticated image delivery must avoid an image optimizer/cache that drops cookies or shares pixels across users.

Reuse a small initials fallback for missing, loading or failed images. Current `AccountPanel` uses the first uppercase username character, with `E` fallback, and has no shared Avatar component. Proposed default retains that established username-based initial; do not derive another author's initials from private account first/family names. An image beside a visible username is decorative (`alt=""`); standalone controls require an accessible account/action label. Upload/removal supports keyboard operation and accessible feedback; no crop-editor dependency is required.

## 6. Proposed My communities contract

### Current membership facts

There is one Membership row per `(User UUID, Community UUID)` across all statuses: PENDING, ACTIVE, REJECTED, REMOVED, BANNED. Roles are MEMBER, MODERATOR, DELEGATE. ACTIVE/PENDING rows may now coexist in different communities. Creation/approval/provisioning services scope lifecycle conflicts to the target community; a BANNED row blocks reapplication only there. REJECTED/REMOVED reapplication reuses the same community row and replaces its submitted application fields; pending withdrawal can physically delete that row. Therefore this is a summary of **existing membership rows**, not a complete application-history ledger. A removed/banned community row must not suppress another community's valid row.

`GET /api/v1/communities/{community_slug}/membership/me` remains the detailed own-membership route: private application fields plus the three existing scoped capabilities, or null membership and false capabilities when none exists. Missing community is 404; no active-membership dependency is required for this self-read. Keep that detailed route unchanged.

Community has UUID, name, unique slug and nullable Programme UUID. Programme has UUID, unique slug, name, `institution_slug`, `institution_name`; it is not another membership. Programme context should come from `Community.programme`, not inferred from module labels or fabricated IRM defaults. IRM is linked by migration/seed source; actual installed rows are unverified.

### Proposed endpoint and allowlist

| Item | Contract |
| --- | --- |
| Endpoint | **`GET /api/v1/auth/me/communities?limit=20&after=<membership UUID>`** |
| Authentication | `get_current_user` only; caller User UUID is always query owner; no community active-membership/delegate dependency |
| Query | `limit` integer 1–100, default 20; optional `after` UUID; unknown query keys rejected with 422 |
| Item | `community: {id, slug, name, programme}`, plus `membership: {status, role}` only |
| Programme | Null if absent; otherwise `{id, slug, name, institution_slug, institution_name}` from actual related row |
| Envelope | `{items: [...], next_cursor: UUID-or-null}`; no total counts, invented communities or capabilities |
| Ordering | Existing-style keyset order: Membership `created_at DESC, id DESC`; stable across status/name/role changes and reapplications |
| Bound | SQL limit+1; eager/explicit join Programme to avoid per-item queries; no unbounded User.memberships serialization |
| Cursor | Validate cursor against caller's memberships; never look up another owner's cursor to reveal their data; 400 `Invalid pagination cursor` for absent/foreign/deleted cursor |
| Other errors | 401 `Not authenticated`; sanitized 422 invalid bounds/UUID; generic 500; no community-specific 403 for this account-wide read |
| Cache | `private, no-store` for success and failures; frontend fetches without persistent private-data cache |

Opaque cursor membership UUID is pagination metadata, not a second exposed applicant record. Item contains no membership ID/timestamps, User ID/email/names, CNE, applicant names/type, identifier type, promotion, permissions or management events. Use explicit projection and response schema allowlists. Do not accept caller `user_id`, status filter or a singleton current-community selector. Include all existing statuses; stored role is descriptive and conveys no capability when status is not ACTIVE. Community identity is safe structural metadata; no private applicant promotion is relabelled as “programme context.”

Example (only IRM; illustrative community UUID, programme identity from source):

```json
{
  "items": [
    {
      "community": {
        "id":"22222222-2222-4222-8222-222222222222",
        "slug":"irm",
        "name":"IRM",
        "programme": {
          "id":"9e85c0d8-08a8-4a25-8ca6-13fcaf412c20",
          "slug":"irm",
          "name":"IRM",
          "institution_slug":"fst-mohammedia",
          "institution_name":"FST Mohammedia"
        }
      },
      "membership":{"status":"ACTIVE","role":"MEMBER"}
    }
  ],
  "next_cursor": null
}
```

No memberships: `{"items":[],"next_cursor":null}`. A community with null programme returns `"programme":null`; do not invent an institution. Additional-community test fixtures are synthetic test data, not new deployment communities.

The frontend's existing `AuthContext.membership` is explicitly **IRM-scoped**. Keep it for existing IRM navigation and capabilities; do not populate it from the first summary item. `/account` obtains a separate bounded summary. A failure/restriction in IRM is not account logout, a global ban or a reason to hide other summary rows. Detailed application links go to an existing implemented community route only; unknown/future slugs can have a read-only summary without generating nonexistent destinations.

## 7. Account/application privacy matrix

This matrix separates current exposure from proposed account additions; it does not grant new permissions to existing Delegate or author endpoints.

| Data | Owner's account/profile | Other users / content | Community Delegate surfaces | Proposed My communities / avatar |
| --- | --- | --- | --- | --- |
| User UUID | Current self response | Current announcement author/document uploader IDs | Indirect membership associations | Not a summary field; media URL uses UUID |
| Username | Current self, editable proposed | Current author labels, fresh User value | Current pending/active/directory reads | Avatar fallback uses visible username client-side |
| Account first/family names | Current self, editable proposed | Not in inspected author response contracts | Current pending/active reads | Excluded |
| Email | Current owner response, read-only proposed | Excluded | Excluded from inspected member response schemas | Excluded |
| User timestamps | Current owner response | Not author profile fields | Membership timestamps are separate | Excluded |
| Password/hash/raw session token | Password inputs only; hash/token never response fields | Excluded | Excluded | Excluded |
| Membership status/role | Detailed community self-read | Not an account-wide public directory | Current authorized community reads | Owner-only summary, all statuses |
| Membership permissions/capabilities | Existing scoped self capabilities | Backend checks authorize operations | Existing scoped permission management | Excluded; no global capabilities |
| Applicant first/family names | Existing detailed community self-read, not profile fields | Excluded | Existing pending review read | Excluded |
| CNE / identifier type | Existing detailed community self-read | Excluded | Existing pending review read | Excluded |
| Applicant type / promotion | Existing detailed community self-read | Excluded | Existing pending review read | Excluded; not programme context |
| Community / Programme / institution identity | Proposed own summary | Structural context, not applicant secrets | Existing community structure | Allowlisted own rows and actual nullable Programme |
| Avatar image | No current support; proposed owned upload/delete | Proposed authenticated sanitized image-only delivery | No new Delegate edit permission | URL-only metadata / sanitized JPEG; no private fields |

Account names are not universally private today because scoped Delegate lists reveal them. Conversely, application values are submitted records, not live aliases for account identity. UI copy must make that distinction clear: editing account names does not change submitted application details.

## 8. Frontend handoff — current EtudSup implementation only

### Actual theme and reusable pieces

The source of truth is **current** `globals.css` plus the styles applied by `ApplicationShell`, particularly `FeatureIdentity.module.css` and navigation styles. Older previews and historic reports were not used as theme contracts. Account settings must be a restrained feature/settings page inside the authenticated shell, not the public login/register marketing layout or a new hero.

| Existing resource | Reuse / observed limits |
| --- | --- |
| `app/globals.css` | Semantic page/surface/text/border/accent/focus/feedback/disabled tokens; `.ui-label`, `.ui-field`, `.ui-field-error`, `.ui-surface`, heading and button classes |
| `layout/FeatureIdentity.module.css` | Active non-Home workspace theme; flat surfaces, responsive container/type rules, focus and overflow treatment; overrides global shadows/some tokens |
| `layout/ApplicationShell.tsx` | Signed-in desktop Sidebar/ContextBar and mobile Header/BottomNav; one page-owned main landmark |
| `PageContainer.tsx` | Width/padding/min-width contract; default 768px is suitable settings starting point; feature overrides affect final dimensions |
| `ui/Button.tsx` | Native button props/ref, primary/secondary/quiet/destructive variants; pending/disabled labels remain caller-owned |
| `FeedbackMessage.tsx` | Semantic error/success/info/warning styling, error alert vs polite status, optional retry |
| Login/register fields + `auth/AccountPage.module.css` | Real label/input/helper/invalid/feedback/autocomplete patterns; page-specific public layout is not a reusable settings wrapper |
| `navigation/NavIcons.tsx`, `home/GuestBrandMark.tsx` | Existing stroke-icon and EtudSup monogram treatment; no new icon library or brand system |
| `navigation/ThemeSelector.tsx` + CSS | Compact 44px sun/moon action, native details for System recovery, Escape/focus return |
| `ThemeContext.tsx`, `lib/theme.ts`, root layout | Light/dark/System store, pre-hydration root attributes, cross-tab changes and storage failure handling; retain `irm-theme` key |
| `AuthContext.tsx`, `lib/api.ts`, `lib/validation.ts` | Credentialed requests, current session and IRM state, latest-request guards, existing error envelopes; need account-specific error mapping/refresh completion handling |
| `lib/useAsyncScope.ts` | Account/target epoch invalidation pattern to reject obsolete async completions |
| `AccountPanel`, `SidebarNav`, `MobileHeader`, `NavigationLinks` | Existing identity and navigation disclosure; account destination/link is currently missing |
| `MobileBottomNav.tsx`, `MobileShell.module.css` | Actual bar measurement, safe-area padding, workspace bottom clearance and input-focus hiding; retain these behaviors |

Actual light tokens: page `#F4F2EE`, surface white, text `#211F24`, muted `#625D65`, border `#D8D4CE`, accent `#65558F`. Dark: page `#17161B`, surface `#211F25`, text `#F1EEF3`, accent `#B6A8D1`. Controls 12px radius, surfaces 16px, pills 999px. Use token references rather than copying these color values into a new settings palette. Feature-scoped surfaces are flat, despite global shadow tokens. The active desktop sidebar is **260px in NavigationShell CSS**, while the global sidebar-width token says 248px; reuse the shell instead of constructing a competing width calculation.

`ApplicationShell` special-cases only login/register as focused account routes. A future `/account` belongs to the signed-in shell. Desktop breakpoint is 1280px. Below it, workspace padding reserves `var(--mobile-navigation-height, 76px) + 20px`; bottom navigation measures its real height including safe-area/enlarged labels and hides while fields have focus while retaining clearance. Do not place a fixed save bar over it. Preserve the sidebar-collapse option, mobile drawer focus trap/Escape/return and one main landmark. Add only an account utility destination and platform-account context label in a future scoped task: current `ContextBar` hardcodes an IRM prefix and has no account trail. Do not rename or restructure Delegate management into platform administration.

Missing components/contracts: authenticated settings layout/section composition, `/account` route, shared Avatar/image-fallback component, avatar file/preview/removal form, password-change form, account-wide communities list with pagination, account-scoped error mapping, successful-save identity update/invalidation helper, and dirty-form/discard behavior. There is no generic reusable Input component; use the current native `.ui-field` pattern or a minimal later wrapper with the same treatments. No new theme framework or placeholder page is warranted.

### Proposed `/account` sections and behavior

| Section | Content / interaction |
| --- | --- |
| Profile | Username, first/family names, clearly read-only email, avatar and initials; clarify that submitted membership application details remain unchanged; separate avatar action state from profile Save/Cancel |
| Security | Current/new password (optional local confirmation), password guidance and all-devices sign-out notice; own pending/errors/success; no invented reset/session-device management |
| My communities | Bounded actual summary rows, status/role and nullable programme context; empty/loading/retry/load-more states; existing scoped application links where available |

Use a short “Account” heading and stacked settings sections; optional desktop section-anchor links become wrapping links on small screens, not a new complex tab/marketing system. Profile Save/Cancel are adjacent, wrap/stack at 320px, and operate on a saved baseline. Disable Save for unchanged data and during submit; Cancel restores saved values/errors locally. Password Cancel clears sensitive fields. Avatar selection can show a temporary preview with explicit upload/cancel; revoke object URLs after use and never persist source images/passwords. Clear pending and outcome feedback per operation; a communities error must not remove a successful profile state.

Dirty profile/selected-avatar changes need an explicit discard choice for internal navigation, with keyboard focus management; browser unload warning only while dirty where supported. Do not promise warnings on every mobile browser shutdown. Server-normalized values become the new baseline only after confirmed success. Preserve entered non-secret values on validation/network/409 failure. An ambiguous network failure after password submit needs sign-in/session revalidation guidance, not a false success message or blind replay. Map expired-account 401 to sign-in, wrong-current 400 to that field, username 409 to username, 429 to retry guidance. Current `formatFormError` maps every 401 to invalid email/password and knows no `current_password`/`new_password`; update account-specific mapping later without breaking login.

Use labels, autocomplete (`username`, `given-name`, `family-name`, `current-password`, `new-password`), input-linked helper/errors via `aria-describedby`, invalid state, and accessible pending status. Focus the first invalid field/summary after failure without stealing focus during typing. Keep 44px actions, current feedback/icon treatments, visible keyboard focus, reduced-motion behavior, long-name wrapping, file control usability, and input text at readable mobile sizes. Verify 320px and 390px, short-height/virtual-keyboard conditions, 200% text, desktop, light/dark/System and cross-tab theme changes. Preserve current compact sun/moon/System control; do not replace it with old radio previews.

Some existing browser tests lag current source: `account-pages.spec.ts` still selects Light/Dark radio controls although current ThemeSelector uses compact buttons/details. Treat test source as intended past coverage, not proof the current UI passes. Reconcile those selectors in the future scoped frontend test task; do not copy the obsolete controls into `/account`.

## 9. Implementation dependencies, small subtasks and verification

### Required schema/dependency decisions

| Area | Migration / dependency requirement |
| --- | --- |
| Profile | No migration for proposed exact-string uniqueness; shared validation correction plus constraint-specific conflict handling and safe auth refresh |
| Password | No migration for hash replacement/revoke-all using current Session schema; atomic transaction helpers, login serialization, sanitized errors, Origin guard and bounded limiter required |
| Avatar | One nullable User storage-key column migration; Pillow/python-multipart already declared; bounded upload/decoder pipeline, image route, cleanup retry/reconciliation decision and frontend avatar type/component required |
| My communities | No new membership/programme schema; depends on verified future test schema at or beyond source migration `e4b6c8d0f219` (current source head `f4b8c1d2e390`); explicit projection and bounded join/cursor service |
| Shared | Account error/no-store wrapper; exact browser Origin policy; future test-head/layout guard updates if avatar migration advances head |

No JWT, object-storage provider, Redis service, email-change schema, global role/status, new theme system, community switcher or platform administration is part of these contracts.

### Prioritized implementation sequence (separate future tasks)

1. **Account mutation foundations.** Add the narrowly scoped Origin/no-store/sanitized-error behavior and shared account text validator, with registration compatibility correction clearly reviewed. Acceptance: no secret input echo, no caller-selectable ownership, extras rejected, legacy omitted values preserved; auth error responses privately cached. No profile page yet.
2. **Own-profile PATCH.** Add strict schema/service/route using existing User fields and database uniqueness. Acceptance: atomic bounded validation, no-op timestamps, registration/update username races, untouched application values/content UUIDs, stable 409. No email editing.
3. **Password change.** Add verify/change/revoke-all transaction plus targeted login serialization, throttling and cookie clearing. Acceptance: all old sessions denied, old-password login race closed, no plaintext leakage, documented WebSocket periodic closure tested. No reset/session-management UI.
4. **Own-community summary.** Add only the bounded account read/projection. Acceptance: all statuses independently visible, own rows only, null programmes and pagination handled, no applicant fields/capabilities. Do not alter community routes or AuthContext IRM authority.
5. **Avatar backend.** Review visibility/cleanup defaults, add the minimal nullable-key migration and sanitized image flow. Acceptance: decoded limits/frame/metadata validation, robust replacement/removal/failure behavior, private image serving and orphan recovery. Existing storage provider only.
6. **Account settings frontend integration.** Reuse current shell/theme/form patterns for the three sections and minimal account navigation link. Acceptance: safe identity refresh, independent feedback, unsaved changes, read-only email, 320px/390px/keyboard/theme coverage. Preserve Delegate dashboard. Do not build it before required APIs exist.

Each item is intentionally a separate reviewable implementation task. P1.1 stops at this document and does not authorize beginning the sequence automatically.

### Future guarded PostgreSQL framework

Use `backend/acceptance/isolation.py`: `OwnedDatabase`/`disposable_database` and lease-attached `isolated_pg` fixture in `backend/tests/conftest.py`. The guarded target is loopback, exact dedicated database `irm_integration_test`, exact role `irm_test`, and fresh `irm_acceptance_<32 hex>` schema with run ID/nonce ownership marker and journal. Verify live database/role/search_path on checkout, exclusive schema (no public fallback), migration head/layout, and lease before cleanup. Migration env is the caller-supplied guarded connection in `backend/acceptance/migrations/env.py`, not the normal owner-setting Alembic environment. Test files must override both REST `get_db` and WebSocket `SessionLocal` to the guarded factory; storage must use a temporary owned directory. Login concurrency checks need independent sessions/connections, not one shared ORM session.

The framework's source HEAD guard currently equals `f4b8c1d2e390`; review/update HEAD and required layout checks when a future avatar migration is introduced, without disabling identity guards. Use `acceptance/run.py` orchestration/child environment or guarded disposable helpers under a recorded run. Cleanup drops only the owned marked schema after external-dependency checks. If truncation inside a test is needed, use only `AttachedDatabase.truncate` with verified lease and allowlisted schema-qualified tables. **Never truncate a fixed owner/development/production database or unqualified fixed test schema.**

Legacy `test_pg_constraints.py`, `test_pg_concurrency.py` and `test_pg_service_concurrency.py` contain fixed URL/unqualified TRUNCATE patterns; do not use them as new-test templates or run the entire unfiltered suite. The legacy constraints test also expects global current-membership exclusivity that the current migration removes. Source-inspected test presence is not a passing-test claim. No database test was run for this audit.

### Meaningful acceptance cases

| Area | Required future evidence |
| --- | --- |
| Authentication/ownership | Guests with valid and invalid bodies get 401; missing/expired/revoked/orphan sessions denied; an authenticated no-membership or IRM-banned account can edit self; requests cannot target another User through body/query/path selectors |
| Origin/errors/cache | Trusted development and configured production origins accepted; missing/null/lookalike/untrusted origins rejected before mutation/parsing; multipart tested separately; all success/401/403/409/413/415/422/429/500 responses no-store; validation/log inspection contains no submitted secrets |
| Strict profile fields | Reject email/password/role/status/admin/permissions/membership/application/avatar/User ID extras, including mixed valid+invalid patches; wrong types/null/empty/non-object bodies rejected atomically |
| Text validation | 3/50 and 1/100 boundaries, outer spaces, whitespace-only, Arabic/accented/combining Unicode, case differences, punctuation/internal spaces, forbidden controls/surrogates/bidi separators; omitted legacy fields unchanged; registration/profile agree |
| Uniqueness/concurrency | Existing-owner no conflict, exact duplicate 409, `Sara` vs `sara` distinct under guarded actual PG collation; two users race to same normalized username and one wins; registration race; unrelated DB errors not labelled username conflicts; loser retains all fields |
| No-op / parallel profile | Empty object and identical normalized patch return 200 without timestamp movement; independent omitted fields preserved during concurrent patches; same-field last committed policy observable |
| Application immutability | Seed student, laureate and legacy memberships in multiple communities; snapshot all six application fields plus IDs/status/role/permissions/timestamps; profile edits leave every value unchanged, while self/review routes keep stored application names |
| Author identity | Create announcement/detail/replies, posts/replies and discussion before rename; fresh responses resolve new username; all author/uploader UUIDs/ownership links unchanged; account-name-only changes do not alter author labels; body literals unchanged; previously cached events may retain old text |
| Password validation | Correct and wrong current, malformed stored hash fails safely, 7/8 minimum and 1024-byte boundaries, Unicode/space significance, same-password rejection, strict extras, sanitized errors, limits applied before expensive work |
| Password transaction | Two or more sessions plus initiating browser; successful change revokes all but keeps rows, clears matching cookie, old password fails/new password logs in; injected commit failure leaves old hash and sessions valid; other users' sessions unchanged; parallel changes and login/change race serialized |
| Password throttle | Account/IP windows, concurrent atomic budget consumption, 429 Retry-After, expiry, bounded key eviction, successful attempts counted, spoofed forwarded IP ignored, declared single-worker/restart limitation acknowledged |
| WebSocket revocation | Connect old sessions in separate communities with ACTIVE memberships; change password; old REST/reconnect denied and all old sockets close with 1008 by periodic check; injected revalidation DB error/timeout closes fail-closed; queues/tasks/registry cleaned; membership rows remain intact; no immediate-closure claim beyond implemented checks |
| Avatar validation | Valid JPEG/PNG decode into fixed metadata-free output; EXIF rotation, GPS/ICC/text removal, transparency compositing; reject empty/corrupt/truncated/bomb/too-large/too-small/too-wide/over-pixel-limit, spoofed MIME, SVG, GIF/WebP/APNG/multiframe, duplicate/extra parts and oversized multipart overhead |
| Avatar lifecycle | Temporary test storage only; no source retained; replacement changes version; failed storage/commit preserves old avatar and cleans new key; delete/idempotent delete; concurrent replacement/delete; post-commit cleanup failure retry; orphan grace/reference checks; never delete current/document objects |
| Avatar privacy/media | Guest denied, authenticated sanitized image delivered without account JSON; absent/old/malformed versions give generic 404; headers/no-store, missing object fallback and no raw paths; API-origin URL rendering preserves cookies; UI initials/alt/keyboard behavior |
| Communities privacy | Own ACTIVE/PENDING in multiple synthetic communities, all restricted statuses, mixed banned+valid rows; foreign User rows absent even when caller Delegate; strict exact response-key assertions recursively exclude applicant/email/permissions; empty and null Programme; no invented counts/capabilities |
| Communities pagination | Limit boundaries, same-created-at tie breaker, limit+1 and bounded query count, own/foreign/deleted/malformed cursor handling; status/role changes do not reorder; reapplication and withdrawal reflect current rows without fabricating history |
| Frontend identity/errors | Confirmed normalized save updates profile/navigation and baseline; delayed pre-save auth responses cannot regress identity; membership refresh failure stays separate; definitive 401 clears private state; 400/409/422/429/network errors map correctly; no double-submit or obsolete completion after account switch/unmount |
| Frontend UX | Save/Cancel, independent pending/errors/success, dirty discard/navigation/unload behavior, password clearing/sign-in notice, avatar preview URL cleanup, communities empty/retry/load-more; no private data persisted across logout/account switch |
| Frontend layout/accessibility | 320px/390px, desktop 1280+ shell/collapse, mobile bottom clearance/safe area/keyboard hiding, short height, 200% text, long names; Tab/Shift-Tab/Enter/Escape, labels/errors/focus/live regions; light/dark/System/blocked storage/cross-tab and reduced motion; existing Delegate navigation unchanged |

### Unresolved choices with recommended defaults

These choices do not block the audit and are not implemented decisions.

| Choice | Recommended default / consequence |
| --- | --- |
| Username case/canonicalization / repertoire | Preserve exact case-sensitive uniqueness and broad Unicode; trim boundary spaces/reject controls for new inputs; no canonical backfill. Case-insensitive handles or NFC require later collision/migration planning |
| Concurrent profile editing | Partial fields with User row serialization; same-field last committed value. Add optimistic conflict UI only if product needs it |
| Password sessions | Revoke all including initiating browser; user signs in again. Keeping/rotating initiator would be a different policy |
| Socket revocation latency | Existing 30-second periodic check, immediate local frontend closure; stricter no-post-commit delivery requires additional targeted work |
| Password maximum/throttle | Proposed 1024 UTF-8 bytes for new passwords and 5/User + 20/IP attempts per 15 min; shared registration correction and verified single-worker limiter deployment |
| Avatar visibility | Authenticated image-only visibility; no public profile directory. State visibility in upload copy |
| Avatar appearance | Fixed 256px square JPEG, center crop/white compositing; initials based on current username; no interactive crop editor |
| Avatar cleanup mechanism | Post-commit best-effort deletion plus reliable retry and guarded 24-hour orphan reconciliation; choose invocation/durable failure tracking in avatar task |
| My communities scope/order | All current rows/statuses, membership creation descending, bounded pages; Programme null when unavailable; no current-membership singleton or capabilities |
| Account navigation/layout | One account utility link in current shell, stacked Profile/Security/My communities; no new bottom-nav slot or platform-admin destination |

## 10. Exact inspected-file inventory and inspection limits

Paths below are workspace-relative unless identified as installed dependency source. **Full/section reads** mean actual content inspected; **targeted searches** mean only matched source/test declarations and nearby evidence, not every line or a test execution. Broad searches also scanned `backend/app`, `backend/scripts`, `frontend/src/lib`, `frontend/src/context` and account/navigation source for usernames, names, sessions, passwords, Origin/CSRF, avatars, rate limiting and future account routes. This inventory distinguishes those searches from full-file review. Historical audit documents/previews were listed, not used as implementation authority.

### Instructions and account/security wiring — full reads

```text
AGENTS.md
frontend/AGENTS.md
backend/app/models/user.py
backend/app/models/session.py
backend/app/schemas/user.py
backend/app/services/user.py
backend/app/services/auth.py
backend/app/core/security.py
backend/app/core/sessions.py
backend/app/core/config.py
backend/app/api/deps.py
backend/app/api/v1/endpoints/auth.py
backend/app/api/v1/api.py
backend/app/main.py
backend/app/database/session.py
backend/app/api/content_route.py
backend/alembic/env.py
backend/pyproject.toml
```

### Membership, authors, storage — full or relevant section reads

```text
backend/app/models/membership.py
backend/app/models/community.py
backend/app/models/programme.py
backend/app/models/announcement.py
backend/app/models/announcement_reply.py
backend/app/models/community_post.py
backend/app/models/community_post_reply.py
backend/app/models/discussion_message.py
backend/app/schemas/membership.py
backend/app/schemas/self_membership.py
backend/app/schemas/announcement.py
backend/app/schemas/community_post.py
backend/app/schemas/discussion.py
backend/app/schemas/document.py
backend/app/api/v1/endpoints/communities.py (self-read, review/active, management, directory)
backend/app/api/v1/endpoints/announcements.py (author response/routes)
backend/app/api/v1/endpoints/community_posts.py (author response/routes)
backend/app/api/v1/endpoints/discussion.py (auth, serialization, socket lifecycle)
backend/app/services/membership.py (creation/review, identity lists, directory projection)
backend/app/services/announcement.py (creation/detail/reply User loading)
backend/app/services/community_post.py (creation/User loading)
backend/app/services/discussion.py (author loading/history projection)
backend/app/services/provisioning.py (UUID identity and community-scoped locks)
backend/scripts/appoint_delegate.py
backend/app/core/discussion.py
backend/app/core/broadcaster.py
backend/app/core/storage/base.py
backend/app/core/storage/local.py
backend/app/core/storage/__init__.py
backend/app/services/preview.py
backend/app/services/document.py (upload/preview/cleanup and listing sections)
```

Additional targeted source searches included `backend/app/models/document.py`, `backend/app/models/__init__.py`, `backend/app/models/discussion_reaction.py`, `backend/app/api/v1/endpoints/documents.py`, `documents_global.py`, `modules.py`, `backend/scripts/seed.py`, `frontend/src/app/page.tsx`, `frontend/src/lib/discussion.ts`, `memberManagement.ts`, `moderation.ts`, and author/profile references throughout the scanned directories. These establish reference patterns, not a full audit of document or moderation functionality.

### Migration inventory — all headers/revision links and identity-related matches

Every file below was statically parsed for `revision`/`down_revision`; users, sessions, Programme, module Programme and removal-of-global-membership-index migrations additionally had their relevant bodies read. Application/author/initial-membership constraint bodies were inspected through targeted searches.

```text
backend/alembic/versions/dd021d7df98f_create_users_table.py
backend/alembic/versions/9b0eb59782b9_create_communities_table.py
backend/alembic/versions/6466b3659e3b_create_sessions_table.py
backend/alembic/versions/e51d75b18287_create_memberships_table.py
backend/alembic/versions/95af7394f5be_add_role_to_memberships.py
backend/alembic/versions/a2f015c95d8d_create_modules_table.py
backend/alembic/versions/89d2d5cb2fe2_create_documents_table.py
backend/alembic/versions/87dc5e99ac98_add_moderator_to_membership_role.py
backend/alembic/versions/75c1a93cb232_create_announcements_table.py
backend/alembic/versions/3eeecb92fbc2_add_document_votes_table.py
backend/alembic/versions/92bb2697b74d_add_preview_path_to_documents.py
backend/alembic/versions/2b032f8c674b_add_global_active_pending_membership_.py
backend/alembic/versions/589ce55cec37_add_document_voting_thresholds.py
backend/alembic/versions/35fb40df73f5_add_membership_permissions.py
backend/alembic/versions/b0d0b009b5e7_add_active_delegate_partial_index.py
backend/alembic/versions/86fd7c69425d_create_announcement_replies_table.py
backend/alembic/versions/e7b1a2c3d4e5_create_community_posts_and_replies_tables.py
backend/alembic/versions/f8c2b3d4e5f6_create_discussion_messages_and_reactions_tables.py
backend/alembic/versions/a916c0e16b01_add_delegate_content_removal.py
backend/alembic/versions/c4d8e9f1a2b3_delegate_member_management.py
backend/alembic/versions/d7a9b6c4e213_add_membership_application_fields.py
backend/alembic/versions/98b4d2a6f731_add_membership_identifier_type.py
backend/alembic/versions/b21d7a4c9e60_create_saved_documents.py
backend/alembic/versions/c7e4a9d213f6_create_document_reading_records.py
backend/alembic/versions/d9a1f3c7b205_add_programmes_and_link_irm.py
backend/alembic/versions/e4b6c8d0f219_scope_membership_lifecycle_to_community.py
backend/alembic/versions/f4b8c1d2e390_link_modules_to_programmes.py
```

### Current frontend — full or relevant section reads

```text
frontend/src/app/layout.tsx
frontend/src/app/globals.css
frontend/src/app/login/page.tsx
frontend/src/app/register/page.tsx
frontend/src/context/AuthContext.tsx
frontend/src/context/ThemeContext.tsx
frontend/src/lib/api.ts
frontend/src/lib/validation.ts
frontend/src/lib/theme.ts
frontend/src/lib/useAsyncScope.ts
frontend/src/components/auth/AccountPage.tsx
frontend/src/components/auth/AccountPage.module.css
frontend/src/components/ui/Button.tsx
frontend/src/components/FeedbackMessage.tsx
frontend/src/components/PageContainer.tsx
frontend/src/components/layout/ApplicationShell.tsx
frontend/src/components/layout/FeatureIdentity.module.css
frontend/src/components/home/GuestBrandMark.tsx
frontend/src/components/navigation/AccountPanel.tsx
frontend/src/components/navigation/NavigationLinks.tsx
frontend/src/components/navigation/SidebarNav.tsx
frontend/src/components/navigation/ContextBar.tsx
frontend/src/components/navigation/MobileHeader.tsx
frontend/src/components/navigation/MobileBottomNav.tsx
frontend/src/components/navigation/MobileShell.module.css
frontend/src/components/navigation/NavigationShell.module.css
frontend/src/components/navigation/ThemeSelector.tsx
frontend/src/components/navigation/ThemeSelector.module.css
frontend/src/components/navigation/NavIcons.tsx
frontend/src/components/navigation/useNavigationDisclosure.ts
```

### Tests and guarded framework

Full/section reads:

```text
backend/tests/api/v1/test_auth.py
backend/tests/api/v1/test_auth_me.py
backend/tests/core/test_security.py
backend/tests/core/test_sessions.py
backend/tests/test_pg_constraints.py
backend/tests/conftest.py
backend/acceptance/isolation.py (configuration, lease, migrations, layout, cleanup, fixtures)
backend/acceptance/run.py (suite selection, child environment and orchestration entry)
backend/acceptance/migrations/env.py
backend/tests/services/test_multi_community_memberships_pg.py (migration preservation section)
backend/tests/api/v1/test_membership_applications.py (privacy/persistence section)
frontend/e2e/account-pages.spec.ts (responsive selector section)
```

Targeted test searches (coverage names/guards, not execution):

```text
backend/tests/api/test_deps_authz.py
backend/tests/api/v1/test_discussion.py
backend/tests/api/v1/test_delegate_member_websocket_revocation_pg.py
backend/tests/core/test_broadcaster_revocation_cleanup.py
backend/tests/services/test_multi_community_memberships_sqlite.py
backend/tests/test_pg_concurrency.py
backend/tests/test_pg_service_concurrency.py
frontend/e2e/theme-account-surfaces.spec.ts
frontend/e2e/navigation-shell.spec.ts
frontend/e2e/f7-feature-theme-mobile.spec.ts
frontend/tests/theme.test.mjs
frontend/tests/navigation-model.test.mjs
```

Installed dependency source inspected for validation/error behavior, without executing/importing it:

```text
backend/.venv/lib/python3.14/site-packages/pydantic/networks.py (email validation)
backend/.venv/lib/python3.14/site-packages/email_validator/validate_email.py (normalization)
backend/.venv/lib/python3.14/site-packages/email_validator/syntax.py (domain normalization matches)
backend/.venv/lib/python3.14/site-packages/fastapi/exception_handlers.py (validation envelope)
```

### Inspection limits and audit verification

Source supports the contracts and gaps above; it does not prove deployed collation, migration application, current database rows, actual cookie/environment values, proxy settings, limiter/worker topology, filesystem permissions, installed service availability, network CORS behavior, or passing browser/PostgreSQL tests. Current frontend styles/components were read, not visually rendered. Missing-feature conclusions concern inspected source/router/schema/storage infrastructure; no private environment files or deployment account credentials were consulted. Existing tests demonstrate authored cases only. No broad suite was executed because the audit is read-only and some legacy tests can access fixed databases.

Documentation verification checked all 134 explicit inventory paths, all five JSON example blocks, the 27-file static migration inventory/head and report whitespace. Final Git status still showed the original 55 modified tracked files, with this new report untracked. Repository-wide `git diff --check` flagged pre-existing extra blank lines at EOF in five implementation files; they were left untouched. The only task-authored file is this report. Reverify source, instructions and migration head before every later implementation task; optional defaults here are proposals and must not be silently represented as previously shipped behavior.
