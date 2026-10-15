# EtudSup P4.1C — Account Avatar API

## Result

The authenticated avatar API and image-processing path are implemented. Isolated API, image, storage, profile, auth, password and session checks passed. Acceptance is **PARTIAL** because the guarded PostgreSQL attempt failed before target identity verification; no PostgreSQL test assertion ran. Persistent storage and backup behavior also remain a deployment gate.

## Changed files

- `backend/app/api/avatar_routes.py` — route-scoped Origin, request-size, authentication preflight and private-response protections.
- `backend/app/api/v1/endpoints/avatars.py` — upload, removal and authenticated image-read routes.
- `backend/app/api/v1/api.py` — registers the avatar router. The file also contains concurrent community-post and discussion router registrations; those are outside this task and were preserved.
- `backend/app/services/avatar.py` — image processing, locked pointer mutation, rollback cleanup and current-version reads.
- `backend/tests/api/v1/test_avatar_api.py` — isolated API and lifecycle coverage.
- `backend/tests/core/test_avatar_processing.py` — decoder, metadata, orientation, transparency and limits coverage.
- `backend/tests/services/test_avatar_concurrency_pg.py` — guarded concurrent replacement, replace/remove and avatar/profile/password race coverage; PostgreSQL execution is pending.
- `backend/acceptance/profile.py` — adds focused avatar API and PostgreSQL suite selections to the existing guarded acceptance runner.
- `docs/etudsup-p4-1c-avatar-api.md` — this implementation handoff.

The implementation reuses P4.1B's `User.avatar_storage_key`, derived `avatar_url`, generated immutable key helpers and bounded durable local-storage operations. It adds no migration, dependency, public storage mount, author-schema field or frontend code.

## API contract

All mutation successes and errors use `Cache-Control: private, no-store`. Mutation requests require exactly one trusted raw `Origin`, validated by the existing account-origin checker. The check retains the configured frontend origin and existing development/test origins; the allowlist was not broadened.

| Method and path | Authentication and request | Success | Main errors |
|---|---|---|---|
| `PUT /api/v1/auth/me/avatar` | Valid session; one `multipart/form-data` body with a valid boundary and exactly one file part named `file`; no fields or duplicate parts. Full body ≤2,162,688 bytes and file ≤2,097,152 bytes. | `200 {"avatar_url":"/api/v1/users/<user-uuid>/avatar/<version-uuid>"}` | 400 malformed multipart; 401 invalid session; 403 missing/duplicate/untrusted Origin; 413 request/file/canonical output limit; 415 unsupported request or declared input media; 422 wrong/extra/missing parts or invalid image/MIME mismatch; generic private 500 for unexpected operation failure. |
| `DELETE /api/v1/auth/me/avatar` | Valid session; empty body; trusted Origin. | `200 {"avatar_url":null}`. Repeated removal is idempotent. | 400 nonempty body; 401 invalid session; 403 Origin; generic private 500. |
| `GET /api/v1/users/{user_id}/avatar/{version}` | Any valid authenticated account session; no membership requirement. | `200 image/jpeg`, inline, with no account metadata. | 401 guest/expired/revoked session; the same generic 404 for malformed, unknown, stale, missing or malformed stored targets; private generic 500 for unexpected failures. |

Example upload response:

```json
{"avatar_url":"/api/v1/users/58eaa39e-e211-4e6c-a61f-4e7a2ae365b0/avatar/94f8f84d-9771-4c8d-a18b-8c41d0280f27"}
```

Example removal response:

```json
{"avatar_url":null}
```

The target user for mutations comes from the normally authenticated user, and the service independently re-locks and revalidates that session. The upload route performs the existing route preflight before FastAPI parses multipart data, then the ordinary dependency validates the session again. Image reads also preflight authentication before target-specific lookup. Profile `PATCH /api/v1/auth/me` remains strict and continues to reject avatar fields.

Request error precedence is: trusted Origin first; request media type and declared/streamed body checks next; session preflight after bounded body intake; then normal dependency validation and multipart parsing. Thus a request with a trusted Origin but oversized body is rejected as 413 before the session check. The whole body is bounded before parser work. `max_files=2` and `max_fields=1` permit identifying duplicate/extra parts and rejecting them; parser failures are sanitized. The `FormData` resource and its upload files are closed in a `finally` block. DELETE checks both declared and streamed body content.

Every route uses only the session owner UUID; caller-supplied IDs are accepted solely as read targets and never grant access by themselves. Knowing an exact current image URL is sufficient for any authenticated account to view it. No anonymous/public image access is introduced. Image responses include `Content-Type: image/jpeg`, `Content-Disposition: inline`, `Cache-Control: private, no-store`, `Vary: Cookie`, and `X-Content-Type-Options: nosniff`. The CORS middleware may append `Origin` to `Vary` as well.

## Image validation and canonicalization

The endpoint accepts only declared `image/jpeg` and `image/png`. Pillow's detected decoder format must match that declared type; filenames and extensions are ignored. Unsupported GIF, WebP, AVIF, SVG and other formats are rejected. The implementation uses the Pillow installation already in the project and adds no dependency.

Before full decode it enforces each dimension from 32 through 4096, at most 16,000,000 pixels, a single frame, and decompression-bomb warnings as errors. It verifies the input, reopens it and fully decodes it. EXIF orientation is applied, then the image is center-cropped square, resized to 256×256 using Lanczos, composited onto white, copied into fresh RGB pixels and encoded as JPEG quality 85. The output is bounded to 262,144 bytes. Re-encoding into a new image retains no source EXIF/GPS, ICC, XMP, comments or other source metadata. Original upload bytes are never stored. CPU-heavy decoding/resizing/encoding runs in Starlette's thread pool; request-level code does not change Pillow process-wide settings.

## Pointer, file and failure lifecycle

Upload processing completes before opening the pointer-mutation service transaction. The service opens its own DB session, locks and refreshes the session-derived User, then locks and refreshes the initiating session in User → Session order. It captures the old pointer, saves a newly generated immutable JPEG key, assigns only `avatar_storage_key`, and commits. Only after confirmed commit does it attempt deletion of the captured old key. Removal follows the same locking and session checks, commits NULL first, then deletes only the captured former key. Removing an already absent avatar does not commit and does not advance `updated_at`.

On known pre-commit or rolled-back failure, the service rolls back and removes only this operation's generated key. Storage failures that retain a potentially published generated key are also passed through the same owner-validated delete helper. Existing immutable versions are never overwritten. Cleanup helpers accept only a canonical avatar key owned by the target UUID; malformed legacy values fail closed before filesystem access. They do not invoke broad document deletion or directory cleanup.

If `commit()` raises, the service rolls back and queries the pointer to resolve whether the commit took effect. A confirmed new pointer is treated as success; a confirmed old/NULL pointer remains a failure and only the new file is removed. If the pointer state cannot be read, the service keeps both files and returns a generic operation failure, logging only an account UUID and a static outcome signal. This avoids deleting a possibly current avatar but can leave an orphan. No cleanup job or retry mechanism exists. A post-commit old-file cleanup failure is logged as a sanitized actionable signal (`avatar_cleanup_failed`, phase and outcome, with an explicit no-retry statement) and does not change the already-committed success response.

PostgreSQL and filesystem operations are not one atomic transaction. A process crash after file publication but before pointer commit can leave a new orphan; a crash after pointer commit but before old-file deletion can leave the old orphan. Recovery needs a later bounded, owner-verified cleanup design; this task adds no broad orphan sweep. Filesystem durability follows the existing local provider's file and directory fsync/immutable publication behavior, but actual deployment persistence, backup inclusion and restore behavior were not verified or changed.

## Verification

Executed in the isolated project test environment with the acceptance runner's **test-process-only heartbeat accommodation** for the Python 3.14/AnyIO TestClient behavior:

- `timeout 180 ./.venv/bin/python -m acceptance.profile --suite avatar-api --heartbeat` — **129 passed**, 0 failed. This included profile edit/auth APIs, avatar API, storage/avatar core helpers, image processing and SQLite avatar migration coverage. The final run included streamed-body overflow and EXIF-orientation checks.
- `timeout 180 ./.venv/bin/python -m acceptance.profile --suite password-api --heartbeat` — **116 passed**, 0 failed. This covered password/profile/auth/session/security regressions.
- `python -m py_compile ...` on the avatar route/service and new PostgreSQL test — passed.
- `python -m pytest tests/services/test_avatar_concurrency_pg.py --collect-only -q` — **3 collected**. This confirms test collection only; it is not execution or PostgreSQL acceptance.

The guarded PostgreSQL command was attempted once with fresh run ID `3672dacf6a0a414b85dc8aa8bbbc2340` and journal `/tmp/irm-p4-1c-3672dacf6a0a414b85dc8aa8bbbc2340.jsonl`, using the runner's approved `127.0.0.1:5432`, `irm_integration_test`, `irm_test` target. Setup failed with `OperationalError` before identity verification. The runner evidence recorded no pytest status/tests, `no outstanding owned schema`, and temporary-storage removal. Therefore **zero PostgreSQL assertions executed**, and the three new race cases remain unverified against PostgreSQL. No alternate database target was attempted.

The focused isolated tests exercise first upload, replacement, removal and repeated removal; authenticated cross-account image-only reads; guest/expired/revoked denial; concealed malformed/unknown/stale targets; extra/missing/duplicate parts; unsupported and spoofed MIME; declared, streamed and file byte limits; corrupt/truncated/animated/dimension-invalid images; metadata removal, orientation and transparency; commit rollback preserving the old pointer/file; post-commit cleanup failure preserving success; account/session/membership/content identity preservation; and continued profile avatar-field rejection. Existing storage/core tests cover bounded reads, durability/write/publication failures, immutable-key protection, symlink/path safety, idempotent deletion, and document-file isolation. PostgreSQL-only concurrency and live deployment storage behavior are not claimed as passed.

Owner-run output should be retained with the run journal as evidence. Fish-compatible focused rerun command (it runs only avatar API/storage/profile/auth and avatar PostgreSQL suites, creates fresh run metadata, reads the password silently, captures each exit immediately, and leaves the journal available for lease cleanup evidence):

```fish
cd /home/yasso/irm-platform/backend
set -l run_id (python -c 'import uuid; print(uuid.uuid4().hex)')
set -l journal "/tmp/irm-avatar-p4-1c-$run_id.jsonl"
read -s -P 'Password for irm_test: ' IRM_ACCEPTANCE_DB_PASSWORD
echo
set -lx IRM_ACCEPTANCE_DB_PASSWORD $IRM_ACCEPTANCE_DB_PASSWORD
set -lx IRM_ACCEPTANCE_RUN_ID $run_id
set -lx IRM_ACCEPTANCE_JOURNAL $journal
set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
set -lx IRM_ACCEPTANCE_DB_PORT 5432
./.venv/bin/python -m acceptance.profile --suite avatar-api --heartbeat
set -l avatar_api_status $status
./.venv/bin/python -m acceptance.profile --suite avatar-postgresql --heartbeat
set -l avatar_pg_status $status
printf 'run_id=%s journal=%s avatar_api=%s avatar_postgresql=%s\n' $run_id $journal $avatar_api_status $avatar_pg_status
test $avatar_api_status -eq 0 -a $avatar_pg_status -eq 0
```

The acceptance runner performs marked disposable-schema creation, identity/search-path/ownership checks and guarded schema cleanup; the command does not use fixed-database truncation fixtures or the development database.

## Frontend handoff

- Submit `PUT /api/v1/auth/me/avatar` as credentialed `fetch` with `FormData`: `formData.append("file", file)`. Let the browser set `multipart/form-data` and its boundary; do not set `Content-Type` manually. Send the expected Origin and credentials (`credentials: "include"`). Prevent duplicate submissions while pending.
- Use the returned relative `avatar_url` or refresh `/api/v1/auth/me` after success. Display it with an authenticated same-origin `<img>`/credentialed fetch; do not route it through an anonymous/public image proxy or Next image optimizer that drops the session cookie. The URL is visible to any authenticated user who knows it.
- When `avatar_url` is null, malformed legacy storage projects as null, or an image cannot be loaded, show the account initials fallback. On removal success, refresh shared account identity and immediately use initials.
- Treat 400/415/422 as request or image feedback, 413 as a size-limit message, 401 as expired authentication, 403 as a rejected Origin, and generic 500 as an operation failure without exposing storage details. A failed old-file cleanup can still accompany a successful response; do not surface internal cleanup logs.
- If the network outcome is uncertain, do not assert that the upload/removal definitely succeeded or failed. Refresh `/api/v1/auth/me` and use its current `avatar_url`; if that refresh also fails, show a neutral retry/check message and preserve the selected local preview only as temporary UI state.
- A future page should not mutate membership application snapshots or author text. This backend leaves sessions, profile values, memberships, permissions and content ownership unchanged.

## Remaining release gates

- Execute the new avatar PostgreSQL replacement/removal/profile/password concurrency tests and confirm lease-journal cleanup on the approved integration service.
- Carry forward the existing profile/password PostgreSQL concurrency acceptance gap.
- Carry forward live password-revocation WebSocket closure acceptance and the separately reported WebSocket revalidation-exception path that can stop checking without closing a connection.
- Verify durable avatar storage mounts, backups and restore behavior in the deployment environment before relying on images across restarts or recovery.
- No avatar author projection, public access, cropping UI, orphan sweeper, password/email/avatar account administration, or frontend integration was added here.
