# ETUDSUP CS3 — Private sticker library API

## Result

The authenticated owner-only sticker upload, cursor listing, library removal and preview routes are implemented on CS2's single `sticker_assets` table and immutable WebP storage methods. Upload processing runs in a worker thread. Per-account active-library quotas serialize on the User row and are rechecked before writing bytes. No membership is needed to manage the private library.

No custom-sticker Discussion request acceptance/serialization, message-scoped media route, frontend, migration, dependency, environment or deployment change was made. The current migration head remains `d1e2f3a4b5c6`; CS3 needs no migration. The worktree already contained extensive unrelated and concurrent changes. CS3 edits are limited to the files below; in particular, existing avatar/storage changes were preserved.

## Changed files

- `backend/app/api/sticker_routes.py` — private route wrappers for bounded multipart/empty-body mutations and authenticated no-store reads.
- `backend/app/api/v1/endpoints/stickers.py` — upload, list, remove and preview endpoints.
- `backend/app/api/v1/api.py` — registers the sticker router under the existing `/api/v1` prefix.
- `backend/app/services/sticker_library.py` — locked quota, transaction/file lifecycle, cursor paging, removal and owner preview service.
- `backend/app/core/stickers.py` — validates stored canonical WebP bytes before preview return.
- `backend/acceptance/profile.py` — focused `sticker-api` and `sticker-library-postgresql` suite selectors.
- `backend/tests/api/v1/test_sticker_library.py` — isolated API, privacy, request, quota, cursor, removal and failure tests.
- `backend/tests/services/test_sticker_library_pg.py` — guarded PostgreSQL quota/removal/session race tests.
- `docs/etudsup-cs3-sticker-library-api.md` — this report.

## Routes and wire contract

All JSON responses and errors set `Cache-Control: private, no-store`. No route requires community membership. Mutation requests require exactly one Origin accepted by the existing `is_trusted_account_origin` predicate; its allowlist and global CORS are unchanged. GET does not require Origin. Route wrappers preflight the session before endpoint parsing/target lookup; upload and removal services then lock User followed by Session and revalidate the initiating session before mutating.

| Method and path | Request and result |
|---|---|
| `POST /api/v1/auth/me/stickers` | Exactly one multipart file part named `file`, no other fields. `201` returns only `id`, `preview_url`, `width`, `height`, `media_type`, `byte_size`, `created_at`. |
| `GET /api/v1/auth/me/stickers?limit=30&before=<cursor>` | `limit` defaults to 30 and is 1–50. Returns `{ "items": [...], "next_cursor": "..." }`; only caller-owned, available rows are queried. |
| `DELETE /api/v1/auth/me/stickers/{asset_id}` | Empty body; owner-only. Sets `removed_at`, returns `204` both on first and repeated removal while the retained row belongs to that caller. Never deletes the blob. |
| `GET /api/v1/auth/me/stickers/{asset_id}/image` | Owner-only preview for an available row. Returns canonical image bytes as `image/webp`, inline. Removed, ownerless, foreign and unknown IDs all return the same `404`. |

Upload is multipart, not JSON. Representative request shape (the browser supplies the boundary; filename is ignored):

```http
POST /api/v1/auth/me/stickers HTTP/1.1
Origin: https://app.example.test
Cookie: session=<session-cookie>
Content-Type: multipart/form-data; boundary=upload-boundary

--upload-boundary
Content-Disposition: form-data; name="file"; filename="sticker.png"
Content-Type: image/png

<PNG bytes>
--upload-boundary--
```

Example upload response (UUIDs are synthetic):

```json
{
  "id": "b7ef6178-b40d-40a4-a8e3-d346c780a3fa",
  "preview_url": "/api/v1/auth/me/stickers/b7ef6178-b40d-40a4-a8e3-d346c780a3fa/image",
  "width": 256,
  "height": 256,
  "media_type": "image/webp",
  "byte_size": 3218,
  "created_at": "2026-10-13T12:40:00Z"
}
```

Example list response:

```json
{
  "items": [
    {
      "id": "b7ef6178-b40d-40a4-a8e3-d346c780a3fa",
      "preview_url": "/api/v1/auth/me/stickers/b7ef6178-b40d-40a4-a8e3-d346c780a3fa/image",
      "width": 256,
      "height": 256,
      "media_type": "image/webp",
      "byte_size": 3218,
      "created_at": "2026-10-13T12:40:00Z"
    }
  ],
  "next_cursor": null
}
```

Example quota response is exactly:

```json
{"detail":{"code":"sticker_quota_exceeded"}}
```

Other sanitized responses use a short generic `detail`: `400` malformed multipart/invalid body length; `401` invalid/revoked session; `403` missing, duplicate or untrusted Origin; `404` unavailable/foreign/removed target; `413` total/file byte limit; `415` unsupported request or input media type; `422` invalid parts, image or cursor; `500` generic sticker operation/processing failure. Invalid or foreign cursor returns `{"detail":{"code":"invalid_sticker_cursor"}}`. No response/log includes the upload filename, bytes, decoder/SQL exception, storage key or disk path.

Image success responses set `Content-Type: image/webp`, `Content-Disposition: inline`, `Cache-Control: private, no-store`, `Vary: Cookie`, and `X-Content-Type-Options: nosniff`. Image error responses retain private/no-store plus `Vary: Cookie` and `nosniff`; they return a generic JSON 404 for missing/corrupt/unavailable objects.

## Request bounds, quotas and pagination

The mutation wrapper requires valid `multipart/form-data` with a syntactically valid boundary; exactly one Origin; and declared and streamed request body no larger than 2,228,224 bytes. Multipart parsing allows only enough files/fields to identify and reject duplicates/extras, then requires exactly one `UploadFile` named `file`. The file is read up to 2,097,153 bytes to detect overflow. Unsupported declared media type is 415; actual Pillow format must match. Parser form/upload resources close in `finally`, and Starlette's parser closes partial files on parse exceptions.

Pillow CS2 processing runs via `run_in_threadpool`; it accepts only static JPEG/PNG, preserves alpha, applies orientation, contain-fits to a transparent 256×256 canvas, strips source metadata and losslessly encodes WebP capped at 262,144 bytes. Only this output goes through `save_sticker_immutable`.

Active quota is 100 rows and 26,214,400 canonical bytes per account. Count and sum filter `owner_id == caller` and `removed_at IS NULL`; removed retained assets do not consume quota. After conversion, the mutation service locks/refetches User, locks/revalidates Session in User→Session order, recomputes the active quota under that lock, rejects a 409 before file publication if either bound would be exceeded, then publishes the immutable object and commits metadata. Thus concurrent upload requests for one account serialize. This active-library quota does not bound retained assets still referenced by sent messages or total orphan/backlog storage; CS6 and deployment operations must separately limit/monitor those bytes.

Cursor representation is unpadded base64url of the 16-byte asset UUID followed by a 32-byte HMAC-SHA256, yielding 64 URL-safe characters. The signature uses the high-entropy authenticated session cookie and a versioned domain separator. The decoder requires canonical round-trip encoding and constant-time signature comparison; malformed, tampered and cross-session cursors return `invalid_sticker_cursor`. A cursor is valid for the session that created it. The API resolves the signed UUID using `id` plus the caller's `owner_id`, including removed rows, then uses the DB row's `(created_at,id)` as the anchor. The listing query itself applies owner/availability filters before ordering and `limit + 1`; newest first is `created_at DESC, id DESC`. `next_cursor` points to the last returned row only when an extra row exists. A removed cursor remains a valid anchor while its retained row belongs to the caller, so removing an item during paging does not block later pages or expose it in results. No timestamp/username/client-provided path is trusted.

## File/database behavior

- Image-processing failure occurs before a transaction or object write.
- Quota rejection occurs under the locked user before immutable publication.
- On a typed storage failure with a generated possible-publication key, cleanup attempts only that exact key through the owner-validating delete method. Cleanup/logging failure is best effort and does not reveal paths.
- After successful publication, a known pre-commit/rollback failure deletes only the newly generated key. It cannot delete another asset.
- If `commit()` raises, the service rolls back/closes the original session and opens a fresh transaction. It first locks the User row, which waits for an in-flight operation holding the original User lock to resolve, then checks the asset UUID/key. A matching persisted row is returned as success; a confirmed absent row permits narrow cleanup. If the fresh state cannot be established, it retains the blob and returns generic 500. It does not blindly delete after a commit exception.
- Removal is a User→Session→StickerAsset locked mutation, sets `removed_at` once, and never deletes metadata or file. Existing references remain valid. Repeated removal of the retained owner row is 204; foreign/missing IDs are concealed as 404.
- Preview checks the owner and availability in SQL before storage access, uses the bounded read, then validates/decompresses canonical WebP in a worker thread (the synchronous endpoint runs off-loop). Missing, too-large, corrupt, non-WebP or wrong-size content becomes a concealed 404.

There is no sweeper, scheduler, directory scan or physical deletion path in CS3. Immutable objects whose DB state is uncertain remain for CS6's bounded reconciliation. Library removal is availability only; it cannot break sent references.

## Verification

- `acceptance.profile --suite sticker-api --heartbeat` — **33 passed**, including the new API tests plus CS2 sticker processor/storage and generic storage regressions. This used the existing test-process-only event-loop heartbeat accommodation. Coverage includes upload without send and exact response shape; alpha-preserving preview; no-membership and BANNED-membership access; foreign/ownerless/removed concealment; retained custom-message reference and blob after removal; repeated removal; malformed/foreign cursors and removed-page anchor; upload Origin/session/revocation; multipart extras/duplicate/file/declared-body/streamed-body limits; count and canonical-byte quota boundaries; and resolved rollback, committed-but-raised, and unresolved-commit file behavior.
- `acceptance.profile --suite avatar-api --heartbeat` — **129 passed** for existing avatar, profile, auth, generic storage and SQLite avatar migration paths. This is isolated API/core acceptance, not PostgreSQL.
- `acceptance.profile --suite password-api --heartbeat` — **116 passed** for password, profile, auth, session and security regressions. This is isolated API/core acceptance, not PostgreSQL.
- Accommodated focused pytest for `test_discussion.py`, `tests/acceptance/test_isolation.py` and `test_stickers.py` — **98 passed**, 1 warning. Discussion behavior and guards remained passing.
- `tests/services/test_sticker_library_pg.py --collect-only -q` — **3 collected**. Collection is not database execution.
- One guarded PostgreSQL attempt: `timeout -k 5s 180s .venv/bin/python -m acceptance.profile --suite sticker-library-postgresql --heartbeat` — blocked with `OperationalError` during setup, before target identity verification. Evidence `/tmp/irm-profile-evidence-02cdt84l/profile-result.json` reports null pytest status, no owned schema outstanding, and temporary storage removed. **Zero PostgreSQL assertions executed.** Count/byte concurrency, upload/removal ordering, session revalidation under PostgreSQL and final file/row state remain unverified. No alternate database was tried.
- `cd backend && .venv/bin/alembic heads` — passed; head remains `d1e2f3a4b5c6`; no migration was authored.
- `python -m py_compile` on new endpoint/service/route/acceptance/test modules — passed. Scoped `git diff --check` and trailing-whitespace scan on newly added files — no errors.

## CS4 sending integration

For first send, require `StickerAsset.owner_id == authenticated_user.id` and `removed_at IS NULL` in the same transaction that creates the custom message reference. Preserve existing retry ordering: look up the caller's idempotency key first and return the matching original visible message even if library removal happened after the first send; only a new send requires current library availability. Include the immutable `custom_sticker_id` in stored message/history/POST/event contracts without exposing storage keys or preview URLs. Keep asset metadata/blob while any retained visible or moderation-removed message references it. Add the community-scoped image route that authorizes active membership and a visible message before resolving the asset; never authorize sent-image reads by asset UUID alone. Keep `message_removed` metadata-only and return concealed 404 for its image route. CS3's owner preview URL is not a message-media URL.

## Carried-forward gates

- **S1:** no S1 report or artifact was found in CS3 inspection; status remains unknown, not accepted.
- **PostgreSQL:** CS2 migration acceptance and this CS3 concurrency suite both remain blocked before identity verification; neither collection nor SQLite acceptance closes them. Existing P1.3 profile and P3.3 password/login/profile PostgreSQL race acceptance, and avatar PostgreSQL migration/concurrency acceptance, remain unverified as recorded in prior reports.
- **Security/WebSocket:** earlier reports still list live password-revocation socket closure and the revalidation-exception path as unresolved.
- **Avatar deployment:** durable storage mount, coordinated backup/restore and restore verification remain open.
- **D1.3 frontend:** rendered two-account/mobile/desktop, navigation/reload and live account-transition acceptance remain unverified; this task changed no frontend files.

Fish-compatible focused PostgreSQL command, using only the existing approved disposable target and fresh run metadata:

```fish
cd /home/yasso/irm-platform/backend
function run_sticker_library_pg
    read -s -P 'Password for irm_test: ' db_password
    echo
    set -l run_id (python -c 'import uuid; print(uuid.uuid4().hex)')
    set -l journal "/tmp/irm-sticker-library-$run_id.jsonl"
    set -lx IRM_ACCEPTANCE_DB_PASSWORD $db_password
    set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
    set -lx IRM_ACCEPTANCE_DB_PORT 5432
    set -lx IRM_ACCEPTANCE_RUN_ID $run_id
    set -lx IRM_ACCEPTANCE_JOURNAL $journal
    ./.venv/bin/python -m acceptance.profile --suite sticker-library-postgresql --heartbeat
    set -l sticker_pg_status $status
    set -e IRM_ACCEPTANCE_DB_PASSWORD
    set -e db_password
    printf 'sticker library PostgreSQL status: %s; journal: %s\n' $sticker_pg_status $journal
    return $sticker_pg_status
end
run_sticker_library_pg
```

The runner verifies the database/role, schema search path and ownership marker, and removes only its lease-owned schema. Do not substitute a development, owner or production database.

Nothing was staged, committed, pushed, deployed or restarted.
