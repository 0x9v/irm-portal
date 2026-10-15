# ETUDSUP CS1 — Custom sticker contracts

## Scope and result

This is a proposed first-release implementation contract only. No application code, schema, migration, database, dependency, frontend or environment was changed for CS1. The worktree was already broadly dirty, including the D1.3, avatar and U6 work; those files were preserved. The requested D1.1–D1.3 and P4.1A–P4.1C reports were present and inspected. No separate S1 report was found under `docs/` (the repository search for S1/sticker reports found D1 sticker references only).

## Current capability inventory

- `backend/app/core/discussion.py` defines six built-in sticker string IDs: `pepe_thumbs_up`, `cat_heart_eyes`, `blob_party`, `doge_classic`, `programmer_coffee`, and `rubber_duck_coding`.
- `DiscussionMessage` currently supports `TEXT` and `STICKER`; its DB check makes text/content and built-in sticker ID mutually exclusive. `DiscussionMessageCreate` rejects extra JSON fields, validates built-in sticker IDs, and retains `client_message_id` idempotency scoped by community and author.
- History uses a bounded 1–50 page and `(created_at,id)` ordering, eager-loads the author and batches reactions. POST returns the stored UUID author and only new messages are broadcast after commit. The event serializer is manually built. `message_removed` only carries type, community slug and message ID. Removed messages are excluded from history and retries for their idempotency key return concealed 409.
- Active membership guards history, sends, reactions, catalog and WebSocket access. WebSocket queued message visibility is rechecked against a fresh DB read, and removed content is suppressed. Reaction state is stored separately with one reaction per user/message and the fixed whitelist.
- Avatar processing in `backend/app/services/avatar.py` accepts one static JPEG or PNG, checks decoder/type and bounds, applies EXIF orientation and canonicalizes to a 256-square JPEG. It center-crops and composites on white. That white matte and crop are avatar policy and must not be used for stickers. Reusable protections are bounded multipart intake, actual Pillow decoding, single-frame rejection, metadata stripping through fresh canonical pixels, CPU work in a thread pool, generated immutable keys, owner checks, private responses and narrow failure cleanup.
- Existing storage has a generic `StorageProvider`, but durable immutable publication and bounded/symlink-safe reads are specifically implemented for avatar key grammar. Sticker storage needs its own constrained immutable namespace and operations; do not store sticker keys in `User.avatar_storage_key` or broaden avatar helpers.
- `backend/app/api/avatar_routes.py` demonstrates a route-specific wrapper that validates Origin, bounds the complete streamed multipart body, authenticates before parsing, sanitizes errors and sets private cache headers. Avatar Origin policy is specific to account mutations; sticker API should follow the applicable existing authenticated API/browser policy rather than copy its Origin allowlist blindly.
- Discussion/auth/frontend clients use credentialed API calls and the established `/api/v1/communities/{slug}/discussion/...` routes. Guarded PostgreSQL acceptance uses `backend/acceptance/isolation.py`, which hardcodes current head `c96b4731ea20` and an explicit list of tables; any future migration must update this guard/table list and migration acceptance intentionally. The inspected Alembic graph has one head, `c96b4731ea20` (confirmed by `alembic heads`).

Pillow verification in `backend/.venv`: Pillow 12.3.0 reports WebP support; a lossless RGBA WebP in-memory encode/decode round-trip retained RGBA mode and transparent alpha. The installed feature probe did not recognize `webp_anim`/`webp_mux` feature names; independently, upload policy below rejects every multi-frame/animated input regardless of encoder feature flags. No dependency addition is proposed.

## Recommended first-release policy and limits

Each authenticated account has a private, owner-managed library. Owners can upload/convert, list, preview and remove their own stickers. A user can send a library sticker only to a community where they have the existing active membership. A sent sticker is a static immutable asset reference and remains visible through authorized history after removal from that user's library. Libraries are neither public nor shareable/copyable in this release.

Accept only PNG and JPEG uploads. Preserve PNG alpha in the output, including transparent pixels; do not promise background extraction. “Convert to sticker” means orient, fit, resize and safely re-encode the full image. It does not remove a photograph's background. No external URL import, AI background removal, audio, video or animated image is in scope.

Recommended conservative limits for the current small-server deployment:

| Limit | Recommendation |
| --- | ---: |
| Declared/streamed multipart request body | 2,228,224 bytes (2 MiB file plus 128 KiB multipart overhead) |
| Uploaded image file | 2,097,152 bytes (2 MiB) |
| Each decoded dimension | 32–4096 pixels |
| Decoded pixel count | 16,000,000 maximum |
| Frames | Exactly one |
| Canonical canvas | 256 × 256, contain-fit, transparent padding |
| Canonical output | Lossless WebP; maximum 262,144 bytes |
| Personal library | 100 available assets and 25 MiB canonical bytes/account |
| Library list page | 1–50 rows, default 30 |
| Preview/media response | One object bounded to 262,144 bytes |

The output/account limits bound disk and response memory for the initial deployment. The 25 MiB aggregate quota is based on canonical bytes, not source upload bytes. Keep removed library rows/assets that messages reference outside the active-library quota; report retained-message storage separately for operational capacity. Enforce an additional deployment-wide disk budget and alert before the filesystem is exhausted. If the expected active user count makes these limits inadequate, tune them before implementation and document the changed acceptance values.

Use lossless WebP for alpha-preserving canonical output: it is already available and verified in the backend environment. If a deployment image lacks the WebP encoder, fail service startup/readiness or reject uploads with a generic unavailable error; do not silently switch to JPEG. Decoding policy should accept only detected PNG/JPEG, including correct declared MIME match; WebP is the server output format, not an accepted input format for initial release.

## Proposed routes and HTTP behavior

All endpoints require a valid session and return `Cache-Control: private, no-store`; image responses also send `Vary: Cookie` and `X-Content-Type-Options: nosniff`. Never emit storage keys or physical paths. Use session-derived user ID for library ownership. UUIDs are identifiers, not bearer credentials.

| Method and route | Contract |
|---|---|
| `POST /api/v1/auth/me/stickers` | Multipart request containing exactly one file part named `file`; no other parts. Performs safe conversion and creates an available library asset without sending a message. `201` returns `{ "id": "<asset UUID>", "preview_url": "/api/v1/auth/me/stickers/<asset UUID>/image", "width": 256, "height": 256, "media_type": "image/webp", "byte_size": 12345, "created_at": "..." }`. |
| `GET /api/v1/auth/me/stickers?limit=30&before=<opaque cursor>` | Owner-only bounded descending cursor list, returns `{ "items": [<upload response fields>], "next_cursor": "<opaque or null>" }`. Cursor is signed/opaque or is a stable created_at+UUID tuple scoped to owner; never offset pagination. |
| `DELETE /api/v1/auth/me/stickers/{asset_id}` | Owner-only, idempotent library removal. `204` when available entry is removed; repeated removal returns the same success. It marks the library asset unavailable and never deletes an object with a retained message reference. |
| `GET /api/v1/auth/me/stickers/{asset_id}/image` | Owner-only preview of an asset that is still available in that owner's library. Removed/foreign/unknown IDs all return the same `404`. Returns only canonical image bytes. |
| `GET /api/v1/communities/{community_slug}/discussion/messages/{message_id}/sticker` | Message-scoped image read. Requires active membership in that community and a visible, non-removed `CUSTOM_STICKER` message referencing the asset. Foreign community, absent membership, removed message, wrong kind or missing asset must not disclose whether the asset exists; use existing community authorization status policy, and a concealed `404` for message/asset misses. Returns only canonical image bytes. |

Upload errors: `401` no valid session; `413` declared, streamed, file or canonical output limit exceeded; `415` unsupported request/input media type; `422` malformed image, MIME mismatch, extra/missing/duplicate parts, dimensions/pixels/frame violations; `409` library capacity/quota reached (stable machine code such as `sticker_quota_exceeded`); generic sanitized `500` on storage/database failure. No response may contain decoder exception text. List errors retain normal validation status and do not disclose other users' rows. Image missing/corrupt errors are concealed as `404` on preview and message-scoped reads. Do not set public or long-lived shared-cache headers; private no-store avoids stale visibility after removal/revocation.

Owner preview reads require the asset's active library row to belong to the caller. Message reads authorize through the community and visible message relation first, then resolve the immutable asset. Knowing an asset UUID or copied owner preview URL does not grant access to a sent image. Both image paths return the same WebP content type and canonical image meaning, but use distinct authorization routes.

## Discussion message contract

Preserve existing `TEXT` and built-in `STICKER` request and response shapes. Add a `CUSTOM_STICKER` kind with exactly one UUID `custom_sticker_id`; keep built-in IDs as strings and never overload `sticker_id`. Do not accept `author_id`, storage keys, or an image URL in request JSON. Session identity remains the author. Extend the DB kind/field check to the three mutually exclusive shapes, retaining text normalization/limits and built-in catalog validation.

Proposed request for a first custom send:

```json
{
  "client_message_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "kind": "CUSTOM_STICKER",
  "custom_sticker_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
}
```

TEXT requires non-empty normalized `content`, and both sticker kinds require `content: null`/omitted. `STICKER` requires a valid built-in `sticker_id` and no `custom_sticker_id`; `CUSTOM_STICKER` requires `custom_sticker_id` and no `sticker_id`; `TEXT` permits neither identifier. Reject all conflicting combinations with 422. On a new custom send the service verifies asset owner and current library availability. Only the owning account can send its library asset.

Representative history item (same fields in successful creation/retry response; reactions/caller reaction remain as today):

```json
{
  "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "kind": "CUSTOM_STICKER",
  "content": null,
  "sticker_id": null,
  "custom_sticker_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "author_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "author_username": "samira",
  "created_at": "2026-10-13T10:20:30Z",
  "reactions": [],
  "caller_reaction": null
}
```

Representative `message_created` event:

```json
{
  "type": "message_created",
  "community_slug": "irm",
  "message": {
    "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "kind": "CUSTOM_STICKER",
    "content": null,
    "sticker_id": null,
    "custom_sticker_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "author_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    "author_username": "samira",
    "created_at": "2026-10-13T10:20:30Z",
    "reactions": []
  }
}
```

The response/event ID and author UUIDs are synthetic. REST and manually serialized WebSocket JSON must encode UUIDs in the same canonical string form. The frontend should render the scoped `.../messages/{message_id}/sticker` path, never an owner preview URL. Existing page cursors, reaction payloads, `client_message_id` uniqueness, author UUID comparison, post-commit broadcast, queued visibility checks, and message removal rules stay intact. `message_removed` remains only `{type, community_slug, message_id}`; it must not include `custom_sticker_id`, image URL, asset metadata or original content.

## Image processing and storage

1. A route-specific multipart wrapper checks one valid request content type/boundary, rejects duplicate `Content-Length`, rejects declared oversize before reading, then counts streamed bytes before constructing the parser body. Close parsed forms/uploads on all paths. Require exactly one `file` part, with bounded filename/header/parser behavior. Do not trust filename or declared MIME without Pillow's detected format match.
2. Run Pillow work in a worker thread, not in the async event loop. Probe format/dimensions/frames, reject decompression bomb warnings/errors, call `verify()`, reopen and fully decode, enforce dimensions/pixels and exactly one frame, apply `ImageOps.exif_transpose`, then contain-fit the complete image into a transparent 256×256 RGBA canvas. For JPEG's lack of alpha, preserve the full rectangular image without cropping and leave only canvas padding transparent. Strip EXIF, ICC, XMP, comments and all source metadata by creating fresh pixels; encode only to WebP lossless and enforce the canonical byte limit.
3. Generate storage keys server-side, e.g. `stickers/{owner_uuid}/{asset_uuid}/{version_uuid}.webp`; enforce canonical UUID grammar and account ownership in storage helpers. Never accept arbitrary key/path from API. Publish immutable content without overwrite (reuse the durable local provider's safe publication pattern after adapting a sticker-specific namespace and bounds). Reads must be bounded and reject symlinks/non-regular files. Do not route through avatar JPEG helpers.
4. Use the DB transaction to register the asset and library row. Filesystem publication and DB commit are not atomic: if DB commit fails, narrowly delete only this operation's newly generated object after confirming rollback. If commit outcome is uncertain, keep the object and record a cleanup candidate rather than risk deleting a committed reference. If publish fails before a DB row exists, clean the known generated key. If post-commit cleanup fails, preserve the successful DB state, log sanitized IDs/outcome only, and let the bounded cleanup job retry.

The existing local provider supplies safe path-resolution and avatar-specific durable publication examples, but the report does not claim stickers can use those avatar-only key checks unchanged. Production availability, volume persistence, backup/restore consistency and shared storage across multiple backend workers remain deployment gates. A single-host filesystem only works while API workers see the same durable volume.

## Minimum data model and lifecycle

Proposed minimum entities (names are conceptual; CS2 should align them with repository naming):

| Table | Minimum columns/constraints |
|---|---|
| `sticker_assets` | `id UUID PK`, `owner_id UUID nullable FK users ON DELETE SET NULL`, `storage_key` unique/non-null, `media_type` constrained to `image/webp`, `width`, `height`, `byte_size`, `created_at`, `orphaned_at nullable`; immutable key/content metadata once created. |
| `user_sticker_library` | `owner_id UUID FK users ON DELETE CASCADE`, `asset_id UUID FK sticker_assets ON DELETE CASCADE`, `created_at`, `removed_at nullable`; PK or unique `(owner_id,asset_id)`, indexed owner and availability. Removal marks unavailable, preserving the asset identity for sent messages. |
| `discussion_messages` extension | nullable `custom_sticker_id UUID FK sticker_assets ON DELETE RESTRICT` (or equivalent durable reference), expanded kind check enforcing exactly one content shape, indexed FK. Keep a retained reference for visible and moderated-removed rows. |

For simpler enforcement, `sticker_assets` may itself be the owner/library row with `available_at`/`removed_at`; avoid duplicating library state. Do not add mutable replacement or in-place overwrite. Rename/metadata additions are unnecessary for the first release. `DiscussionMessage.custom_sticker_id` points to immutable asset metadata/blob independently of library availability. Keep the asset owner ID for library authorization and quota accounting; it is not exposed in message payload.

Lifecycle rules:

- **Upload without sending:** create one immutable asset and available library row. Failed DB registration cleans only the generated object when rollback is known.
- **First send:** under locks, require the asset belongs to the author and library row is active, then create the message reference in one DB transaction. If the message insert fails/rolls back, the library asset remains available and is not deleted.
- **Retry:** check the existing `(community_id, author_id, client_message_id)` row first. A matching retry returns the original visible message even if the owner removed the library entry after the original send. Conflicting payload is 409. A removed original retains existing concealed 409 and never returns message/image details. A retry with no existing row follows first-send ownership/availability checks.
- **Library removal:** set unavailable under the same asset lock used by sends; prevents future first sends. Do not delete immutable object or message reference. Previously sent visible messages keep working.
- **Moderation removal:** soft-removal hides the message; do not expose custom asset metadata via `message_removed`. Keep the asset while the retained message row references it, matching current soft-removal retention. A later authorized message image request for removed content returns concealed 404.
- **Account deletion:** existing message author FK cascades that user's messages and the user/library rows. Set the asset's nullable owner FK to NULL on account deletion; retained messages by other users may still point to it. Do not cascade-delete an asset referenced by any message. Once owner/library membership is deleted, no owner can preview/send it; authorized visible community messages can still resolve it. Unreferenced ownerless assets become bounded cleanup candidates after the grace period.
- **Missing/corrupt asset:** return concealed 404 on image routes; keep message metadata in history but render a neutral unavailable sticker state. Emit sanitized operational alert keyed by internal asset/message IDs. Do not return storage paths or original bytes.
- **Orphans:** assets with no library availability and no message references become cleanup candidates after a 30-day grace period. A periodic bounded job scans a fixed maximum rows and bytes per run, locks/rechecks candidate and reference count before deleting exactly one canonical object and then DB row. Retry failures with backoff and cap attempts; alert and quarantine exhausted candidates. Also reconcile filesystem objects absent from DB using an age threshold and a bounded namespace scan. Never broad-delete a directory. Document that cleanup backlog is finite by scan rate and capacity; monitor oldest candidate and bytes. Do not indefinitely retain unbounded uploaded-but-unsent assets.

Since current Discussion removal keeps rows and original content, a soft-removed message continues to count as a retained asset reference until the row is physically purged by an explicitly defined retention policy. Moderation removal itself cannot trigger blob deletion.

## Concurrency and transaction design

Enforce the 100-row/25-MiB active library quota under concurrent uploads. A per-owner `User` row lock serializes quota reservation and mutation; recheck count and aggregate canonical bytes while locked, insert/update the asset/library record, then commit. If encoding happens before the lock, account for temporary work separately and do not publish an immutable object until quota reservation is granted. A quota counter/reservation table is an alternative only if kept transactionally exact and repaired by reconciliation; the user row is the smallest design.

Coordinate upload/remove/send with one lock order: `User` → `StickerAsset` (or library/asset row) → `DiscussionMessage`. Existing auth validates session without a row lock on normal Discussion calls; where session lock is required for a mutation, use the established User → Session order from avatar mutation and then maintain User → Session → asset/message consistently. Do not acquire User after a message lock. For message sends, first do a non-locking idempotency lookup to preserve retry-after-removal semantics; on a new send lock User then asset/library, recheck the idempotency key under transaction/unique constraint, then insert message. Concurrent identical submissions resolve using the existing unique `(community,author,client_message_id)` constraint and winner fetch. If a winner exists, compare the custom asset UUID as part of complete payload equality and check `removed_at` before returning. Never revalidate library availability on a matching existing retry.

Removal locks User then asset/library and marks it unavailable. Thus send racing removal either commits first (message retains the immutable asset) or observes removal and rejects; it cannot create a new reference after successful removal. Message creation plus reference commit is atomic. Broadcast only after DB commit and retain current fresh visibility check before enqueue/send. Library deletion is independent of sent message rows and cannot win physical deletion while any reference exists.

On database rollback after file publication, narrow cleanup is safe only when rollback/no commit is certain. On unknown commit outcome, retain the candidate and re-read under a fresh transaction before cleanup. Asset storage is immutable; replacement is a new asset UUID/key. A downgrade that would remove custom sticker references or discard any sticker rows/blobs must refuse when custom data exists; downgrade must never silently orphan or delete user content.

## Implementation subtasks

### CS2 — Models, migration and image/storage foundation

- Add minimal asset/library representation, Discussion custom UUID field/check, indexes/FKs and a migration whose actual predecessor is the inspected single Alembic head `c96b4731ea20` (verify head again immediately before migration authoring).
- Add sticker-specific generated immutable keys, safe bounded durable publication/read/delete, and image processor with PNG/JPEG static input, alpha, orientation, metadata stripping, limits and threadpool use. Leave avatar JPEG behavior unchanged.
- Acceptance: model/check/FK uniqueness and query plan checks; verified migration upgrade/downgrade on disposable guarded PostgreSQL; downgrade refuses when asset/message data exists; RGBA transparency round-trip; malformed/truncated/MIME mismatch, oversized stream, bomb dimensions, EXIF rotation, multi-frame rejection, bounded WebP output; path/symlink safety; storage/database failure cleanup and unknown commit preservation. Do not use owner/production DB.

### CS3 — Private library API and upload/conversion

- Implement owner-only upload/list/remove/preview routes, exact multipart policy, cursor bounds, private cache and generic errors; enforce per-account count/byte limits.
- Acceptance: owner can upload without sending; another account cannot list/remove/preview, including with known UUID; exact parts and body limits; quota races cannot exceed limits; duplicate/invalid images leak no paths/metadata; remove is idempotent and keeps referenced immutable objects; rollback cleanup behavior is exercised.

### CS4 — Discussion sending, history/events and protected media reads

- Add additive `CUSTOM_STICKER` field/kind validation and stored reference. Preserve TEXT and built-in STICKER wire shapes. Add message-scoped image read guarded by active community membership and visible message. Update history, POST/retry and manual WebSocket event serializers; keep author UUID and reactions.
- Acceptance: actual endpoint/event serialization for all three kinds; custom ID distinct from built-in string; no caller author/key accepted; send requires owned available library row; retry after library removal returns original message; removed retry concealed; community isolation and removed image 404; queued event visibility/removal race guards; message_removed remains minimal; message and asset retention is correct.

### CS5 — Frontend library/picker/upload integration

- Add account-private library management, accessible upload/preview/remove, and Discussion picker/send UI. Use current authenticated account scope and existing draft/retry behavior. Render static alpha WebP in message-scoped route; display unavailable state on missing media. Preserve text and built-in sticker behavior.
- Acceptance: mobile keyboard/screen-reader picker and upload accessibility, focus/dismissal and loading/error feedback; touch targets; transparent alpha visibly preserved against light/dark surfaces; no cross-account cached library; library remove updates picker without breaking old messages; retry/event merge deduplicates; no public URL or storage key in frontend.

### CS6 — Lifecycle, concurrency and end-to-end acceptance

- Add bounded orphan cleanup/reconciliation, deletion policy, metrics/alerts and explicit retention; exercise races and failure windows. Run isolated two-account browser/API workflow against the updated backend and durable local storage.
- Acceptance: concurrent quota uploads; send/remove ordering; simultaneous identical retries; message rollback after asset check; account deletion with another user's retained message; moderation removal and retention; missing/corrupt media; cleanup never deletes referenced objects and advances bounded orphan backlog; community access revocation; history pagination compatibility; desktop/mobile alpha rendering; upload without send, send/retry/history/event, library removal and older visible message, then account cleanup. Record actual guarded PostgreSQL/browser results separately from mock/unit results.

## Deployment and acceptance gates

- Confirm production uses one durable, permission-restricted storage volume visible to every API worker; determine storage capacity/backpressure and disk-full behavior.
- Define coordinated DB/blob backup and restore, including ordering/reconciliation. The current avatar reports say this behavior is not verified; sticker assets add durable content dependency.
- Decide account deletion retention/tombstone semantics and how long moderated-removed messages/blobs remain before implementation.
- Confirm WebP encoder support on the production image and deployment CPU/memory headroom at the 16 MP decode limit. Add no dependency during this audit.
- Run migration and quota/concurrency tests only against the existing guarded disposable integration target after updating its pinned head/table inventory; never use owner/production databases. Run a real two-account browser workflow, since mocked tests alone cannot prove auth-cookie image fetches, alpha display or removal races.
- Set operational limits/alerts for total storage, orphan candidate bytes/age, failed cleanup and 404/missing object rate before enabling upload.

## Audit actions

- Read the available Discussion D1.1, D1.2, D1.3, avatar P4.1A, P4.1B and P4.1C reports; searched for but did not find a separate S1 report.
- Inspected Discussion models, schemas, services, endpoint/event construction, removal/reaction and membership paths; avatar processor/API wrapper, storage provider, relevant acceptance guard and test names.
- `cd backend && .venv/bin/alembic heads` — **passed**, output `c96b4731ea20 (head)`.
- `cd backend && .venv/bin/python -c '...'` — **passed**: Pillow 12.3.0; WebP feature available; lossless WebP RGBA round-trip retained alpha. The feature probe warned that `webp_anim` and `webp_mux` are unrecognized feature names; policy uses explicit frame checks instead.
- No application tests were run because this task is a contract audit and no implementation changed. No DB, service or browser workflow was run.

Only this report is added by CS1. No files were staged, committed, pushed, deployed or services restarted.
