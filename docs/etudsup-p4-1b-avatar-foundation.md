# EtudSup P4.1B — avatar model, migration and storage foundation

**Status: foundation implemented; PostgreSQL migration acceptance is blocked.** No avatar upload, removal or image-read endpoint was added. No frontend, author response, deployment, dependency or owner database/storage change was made.

## Changed files

- `backend/app/models/user.py` — nullable account-level `avatar_storage_key` and safe derived `avatar_url` property.
- `backend/app/schemas/user.py` — nullable `avatar_url` on `UserResponse` only. `UserProfileUpdate` remains limited to `username`, `first_name` and `family_name`.
- `backend/app/core/avatars.py` — generated key, strict parser, URL projection and avatar storage wrappers.
- `backend/app/core/storage/local.py`, `backend/app/core/storage/exceptions.py` — local avatar-only durable save, bounded read and exact idempotent delete operations plus sanitized typed errors. Existing generic document methods are unchanged.
- `backend/alembic/versions/c96b4731ea20_add_user_avatar_storage_key.py` — additive nullable-column migration with guarded downgrade.
- `backend/acceptance/isolation.py`, `backend/acceptance/profile.py` — current acceptance head/layout pin and focused avatar API/PostgreSQL suites.
- `backend/tests/core/test_avatars.py` — key, projection and local storage coverage.
- `backend/tests/services/test_user_avatar_migration_sqlite.py`, `backend/tests/services/test_user_avatar_migration_pg.py` — isolated migration coverage.
- `backend/tests/api/v1/test_profile_editing.py`, `backend/tests/api/v1/test_auth.py` — owner response compatibility and profile-field rejection assertions.

All other modified or untracked work present before this task was preserved.

## Schema and account response

The migration graph was inspected before editing. Its sole prior head was `f4b8c1d2e390`; the new revision `c96b4731ea20` directly follows it. `alembic heads` now reports exactly one head: `c96b4731ea20`.

Upgrade adds `users.avatar_storage_key VARCHAR(255) NULL`, with no server default, backfill, timestamp update, file operation, or relationship change. Existing users project as no-avatar (`NULL`). Downgrade counts non-null references before changing the schema and raises a clear `RuntimeError` if any remain; it never clears references or deletes files. When all values are NULL, downgrade drops only the column and re-upgrade is safe.

`UserResponse` is used by account/auth routes (registration, login, `/auth/me`, and profile save); it is not reused by announcement, post, reply or discussion author schemas. Those account responses retain their existing fields and add `avatar_url: null` for legacy users. The internal key is not serialized. `UserProfileUpdate` remains strict: `avatar`, `avatar_url` and `avatar_storage_key` remain forbidden inputs.

For a well-formed key belonging to the User, the model property derives `/api/v1/users/{user_uuid}/avatar/{version_uuid}`. A NULL or malformed, noncanonical or wrong-owner stored key projects to `avatar_url: null`. That projection is deliberately fail-closed: it does not disclose the stored value and performs no filesystem operation. No endpoint exists to set an avatar, so the application has no production path that creates a non-NULL reference in this task.

## Key and storage helper contract

The canonical internal format is `avatars/<lowercase-canonical-user-uuid>/<lowercase-canonical-version-uuid>.jpg`. `generate_avatar_storage_key(user_id)` creates a fresh random version UUID. `parse_avatar_storage_key(key, owner_id)` accepts only the exact grammar and matching owner, returning the version UUID or raising `InvalidAvatarStorageKey`. The HTTP/API layer must call the generated-key wrapper and must never accept a key or version from a request.

`store_avatar_jpeg(storage, owner_id, jpeg_bytes)` accepts only bounded bytes with a JPEG start/end marker and delegates to the local adapter. The adapter takes the owner UUID (never a caller-selected key), generates and returns a fresh version key, and retries the extremely unlikely immutable-key collision. It assumes a future image-processing step already decoded and safely re-encoded the image; these byte markers are not image validation. The stored-output bound is 256 KiB. `read_avatar` validates owner/key before I/O and reads at most the configured bound plus one byte. `delete_avatar` validates owner/key before I/O and is idempotent when the file is absent.

Avatar-specific local methods are separate from `save`, `read`, `delete`, `exists` and `get_path`, preserving current document-storage behavior:

- Save creates only the avatar parent directories, rejects existing symlink components, writes a same-directory task-owned `.avatar-tmp-*` file, flushes and `fsync`s its contents, then atomically publishes with a same-filesystem hard link that cannot overwrite an existing immutable version. It removes the temporary name and `fsync`s affected directory entries, including newly created directories.
- Read validates the canonical namespace, rejects symlink/non-regular targets, uses `O_NOFOLLOW` where supported, and reads no more than `max_bytes + 1`.
- Delete unlinks only the exact validated avatar path, refuses symlink/non-regular targets, `fsync`s the parent, and treats absence as success. It never calls broad document deletion or directory cleanup.

`AvatarStorageError` has a safe fixed message and an internal `outcome` for write, publication, durability, oversize, missing, read, unsafe-path, immutable-collision and deletion failures. When publication may have happened, `storage_key` is retained internally for narrowly scoped cleanup; exception text contains no path or key. A later API/service transaction should capture the old key, save a new immutable file, set the new pointer and commit, then remove only the captured old key. On database failure it should roll back and delete only the newly generated key. PostgreSQL and the filesystem are not one transaction; interruption can leave an unreferenced file. A durability error may still require cleanup by its internally retained key.

The hard-link publication and directory `fsync` behavior target local POSIX filesystems. If hard-link or directory-sync behavior is unavailable, the operation fails closed rather than falling back to an overwrite or partially visible write. The configured storage root and its permissions remain an operational trust boundary; no concurrent hostile filesystem writer or power-loss simulation was performed. A process crash can leave a hidden task temporary file. No broad orphan sweep or scheduler was introduced.

## Verification results

Executed:

- `backend/.venv/bin/python -m pytest tests/core/test_storage.py tests/core/test_avatars.py tests/services/test_user_avatar_migration_sqlite.py -q --tb=short` — **30 passed**. Covers canonical/generated URL behavior, malformed and wrong-owner keys without I/O, owner response projection, bounded reads, write/read/delete lifecycle, immutable collision, injected write/publication/durability/delete failures, temporary cleanup, symlink-safe deletion, untouched document files, and actual migration upgrade/downgrade/re-upgrade on in-memory SQLite.
- `timeout 150 .venv/bin/python -m acceptance.profile --suite avatar-api --heartbeat` from `backend/` — **109 passed**. This was actual API and service test execution, not collection. The existing P1.3 heartbeat accommodation was enabled in the test process only. It included profile-editing, `/auth/me`, registration/login, avatar/storage helpers and SQLite migration coverage.
- `backend/.venv/bin/alembic heads` — exactly `c96b4731ea20 (head)`.
- `backend/.venv/bin/python -m pytest tests/acceptance/test_isolation.py -q --tb=short` — **53 passed**, including acceptance guard/head behavior.
- `compileall` over the changed Python modules/tests — passed.

Guarded PostgreSQL was attempted once with `--suite avatar-postgresql`, approved loopback target configuration, fresh run ID `4d8172baf0d44c1a98b275ec34b0106e`, and journal `/tmp/irm-avatar-4d8172baf0d44c1a98b275ec34b0106e.jsonl`. Setup stopped with `OperationalError` before database identity verification. **Zero PostgreSQL assertions executed, zero disposable schemas were created, and no database cleanup was needed.** The runner evidence reports no outstanding owned schema and removed temporary storage. The PostgreSQL migration test is present but unexecuted; SQLite migration execution does not replace PostgreSQL acceptance.

## Next avatar API implementation

Keep avatar mutations separate from `PATCH /api/v1/auth/me`; use the session-derived User UUID and existing exact trusted-Origin protections, but add a multipart-specific bounded request wrapper rather than requiring JSON. Future processing should use the already installed Pillow decoder: accept JPEG/PNG only, enforce the P4.1A upload and decoded-dimension limits, reject animation and corrupt/truncated files, apply EXIF orientation, strip metadata, resize/crop, and encode one canonical JPEG before calling `store_avatar_jpeg`.

The next service should row-lock and refresh the User, retain the old pointer/file until the new pointer commits, clean only the newly generated key on rollback, and delete only the captured old key after confirmed replacement/removal. A future authenticated image-read route should return only JPEG bytes with private/no-store headers and should validate session, owner/key grammar and current version before storage access. Do not add avatar data to author schemas in that task. Account responses already provide the relative `avatar_url`; clients should use initials for NULL and switch to the new versioned URL after a confirmed response.

Before enabling uploads, deployment must establish a durable backend storage mount and coordinated backup/restore for image files and database references. Source inspection found no declared backend storage mount or verified backup/restore policy; none was changed here.

## Remaining release gaps and owner verification

Still unresolved from earlier acceptance work: profile and password/login PostgreSQL concurrency acceptance; live WebSocket closure after password revocation; and the separate WebSocket revalidation-exception path that can stop checking without closing a connection. This task did not modify those areas. PostgreSQL migration acceptance is also pending because the integration target was unreachable from this environment.

Run the following fish-compatible command on an owner environment that can reach only the approved integration target. It performs the focused API suite and then the guarded PostgreSQL migration suite with separate fresh run IDs, silently reads the `irm_test` password, captures each runner exit status immediately, and prints the PostgreSQL result JSON plus lease journal. The runner refuses other database/role/port targets and drops only its marked schema.

```fish
read --silent --prompt-str "irm_test password: " IRM_ACCEPTANCE_DB_PASSWORD
set -gx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
set -gx IRM_ACCEPTANCE_DB_PORT 5432
set -gx IRM_ACCEPTANCE_DB_PASSWORD $IRM_ACCEPTANCE_DB_PASSWORD
cd /home/yasso/irm-platform/backend

set -gx IRM_ACCEPTANCE_RUN_ID (./.venv/bin/python -c 'import uuid; print(uuid.uuid4().hex)')
set -gx IRM_ACCEPTANCE_JOURNAL "/tmp/irm-avatar-$IRM_ACCEPTANCE_RUN_ID.jsonl"
set avatar_api_log "/tmp/irm-avatar-$IRM_ACCEPTANCE_RUN_ID-api.log"
./.venv/bin/python -m acceptance.profile --suite avatar-api --heartbeat 2>&1 | tee $avatar_api_log
set avatar_api_status $pipestatus[1]

set -gx IRM_ACCEPTANCE_RUN_ID (./.venv/bin/python -c 'import uuid; print(uuid.uuid4().hex)')
set -gx IRM_ACCEPTANCE_JOURNAL "/tmp/irm-avatar-$IRM_ACCEPTANCE_RUN_ID.jsonl"
set avatar_pg_log "/tmp/irm-avatar-$IRM_ACCEPTANCE_RUN_ID-postgresql.log"
./.venv/bin/python -m acceptance.profile --suite avatar-postgresql --heartbeat 2>&1 | tee $avatar_pg_log
set avatar_pg_status $pipestatus[1]

set avatar_pg_evidence (string replace 'Focused profile evidence: ' '' (rg '^Focused profile evidence:' $avatar_pg_log | tail -n 1))
if test -n "$avatar_pg_evidence"
    cat $avatar_pg_evidence
end

if test -f $IRM_ACCEPTANCE_JOURNAL
    cat $IRM_ACCEPTANCE_JOURNAL
else
    echo "No schema lease was created for the final run."
end
set -e IRM_ACCEPTANCE_DB_PASSWORD
printf 'avatar API status: %s; avatar PostgreSQL status: %s\n' $avatar_api_status $avatar_pg_status
test $avatar_api_status -eq 0; and test $avatar_pg_status -eq 0
```
