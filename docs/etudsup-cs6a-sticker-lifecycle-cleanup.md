# ETUDSUP CS6A — custom sticker retention and bounded maintenance

## Release audit status — 2026-10-13

CS5 frontend integration is complete at source level. Its final reported full lint and TypeScript checks passed; the current repository recheck also passed TypeScript and lint with 0 errors and 2 unused-variable warnings in `frontend/scripts/release-acceptance.mjs`. The old P4.2 Discussion lint/type failures are stale. CS5 browser assertions did not execute, the normal production build remains environment-blocked, and live two-account sticker acceptance remains unexecuted. The P4.2 initials-only trigger report is superseded by P4.2B: current `AccountControls` renders the shared saved avatar.

Frontend source uses the owner-only image route for private library previews and the community/message-scoped route for conversation media; backend source checks active membership, message community/visibility and rechecks visibility after reading. Account-keyed composer remount and Discussion transition cleanup reset the cursor and clear account state. Upload, remove and ordinary send controls have pending guards. Retry retains the asset UUID and idempotency UUID, so replay works after library removal if the initial request committed; pre-commit failure followed by removal leaves no available asset to send. The Retry control does not currently set the composer's busy state, so concurrent clicks can make duplicate requests with the same idempotency key. Credentialed image fetch, cancellation and object-URL cleanup are present. Message removal unmounts its media and backend rechecks visibility, subject to bytes already delivered. The picker closes/restores focus on Escape and closes on outside mouse click, but focus entry/trapping and tab arrow-key behavior are absent; mobile behavior has not been browser-verified.

**Sticker release recommendation:** defer custom stickers from this release (option 2), as detailed in [`AUDIT.md`](../AUDIT.md). Keep current assets/files and historical message references. A later bounded release change should gate new uploads and new custom-message creation on the server and hide/disable upload/remove/send controls, while preserving text/built-in stickers and read access to existing private items and visible historical message media. No gate or other product code is changed by this audit.

The one finite, prioritized release closure queue is in [`AUDIT.md`](../AUDIT.md). CS6A's orphan/temp inventory remains dry-run only: no coordinated safe orphan/temp deletion path exists yet. S1 fail-closed WebSocket status is still unconfirmed. No cleanup apply, new feature, staging, commit, push or deployment was performed for this audit.

## Scope and inspected state

The inspected sole Alembic head is `d1e2f3a4b5c6`. No migration was needed. `sticker_assets` already has `created_at`, nullable `removed_at`, nullable `owner_id`, immutable `storage_key`, and the Discussion FK `custom_sticker_id` has `ON DELETE RESTRICT` and an index. Moderation removal retains its message row and reference. CS3 upload locks User then Session and publishes an immutable file before committing its row; an uncertain commit deliberately retains that file. CS4 new custom sends lock User then Session then an available, owner-matching asset. An idempotent replay after library removal returns only an already retained message. These existing APIs and the frontend were not changed.

The worktree was already broadly dirty, including U6 and CS2–CS5 files. Concurrent changes were preserved. There was no schema, migration, dependency, deployment, database, frontend, scheduler, avatar cleanup, or owner-service change.

## Exact files changed for CS6A

- `backend/app/services/sticker_cleanup.py` — new bounded database cleanup and dry-run filesystem inventory.
- `backend/scripts/sticker_maintenance.py` — new explicit command, target identity checks, dry-run default and structured aggregate output.
- `backend/app/core/storage/local.py` — narrow sticker-only idempotent missing-parent deletion and validated regular-file size inspection; avatar and document operations retain their behavior.
- `backend/tests/services/test_sticker_cleanup.py` — isolated SQLite, temporary-storage retention, failure, bound, target and inventory checks.
- `backend/tests/services/test_sticker_cleanup_pg.py` — guarded disposable-schema reference/cleanup race and committed deletion checks.
- `backend/acceptance/profile.py` — `sticker-cleanup-api` and `sticker-cleanup-postgresql` selectors.
- `docs/etudsup-cs6a-sticker-lifecycle-cleanup.md` — this report.

## Retention and transaction rule

An asset is eligible only if it has **no Discussion message reference of any visibility state** and either:

1. its owner library row was removed at least 30 days ago (`removed_at`), or
2. it is ownerless and its `created_at` is at least 30 days old.

Available owner assets, recently removed assets, visible-message references, and moderation-removed-message references are retained. Account deletion policy and Discussion row retention are unchanged. The schema has no owner-loss timestamp, so the ownerless rule measures age from creation, not the date ownership was lost. If policy later requires 30 days specifically *after account deletion*, that will need an explicit timestamp/migration and is outside CS6A.

For each UUID-keyset candidate, the service opens a fresh transaction, locks the asset row, rechecks age/availability and *all* message references, validates the immutable key's owner and asset UUID, and inspects only that sticker object. Apply mode issues the database DELETE and flushes it first, so the immediate FK `RESTRICT` check runs before any unlink. It then deletes the exact file and commits the row. The service never takes a User lock after an asset lock. A CS4 first send cannot gain a reference once the asset is removed or ownerless; a matching retry already has a message reference. A competing direct FK writer must coordinate with the locked row, and the FK remains the final constraint.

The database and filesystem are not atomic. On file deletion failure, the transaction rolls back and the asset row remains; the command reports failure, not deletion. If the file was deleted and commit fails or its outcome is unknown, the row may remain with a missing file. A later bounded pass rechecks the row and references, treats the exact missing object as an idempotent recovery, and deletes only the eligible row. If commit succeeded, the row is absent and no second file deletion occurs. A failed candidate is counted but a checkpoint may pass it; restart from the beginning after investigating failures. No broad sweep or repeated automatic deletion is launched.

## Explicit command and limits

Run from `backend` with `./.venv/bin/python -m scripts.sticker_maintenance`. It requires `IRM_STICKER_MAINTENANCE_DATABASE_URL` plus an existing absolute storage root and independently supplied expected database, role, schema and storage root. PostgreSQL requires an exclusive schema search path, TCP identity and migration head `d1e2f3a4b5c6`. An `irm_acceptance_*` apply target additionally requires the approved loopback integration identity and exact schema lease marker. A separate owner PostgreSQL apply requires `--owner-apply` and the reviewed `--expected-server-address`/`--expected-server-port` from its dry run; a supplied schema marker is verified if that owner schema has one. SQLite apply is restricted to an isolated `/tmp/irm-sticker-maintenance-test-*` database and storage tree. The command never falls back to the application database or default storage settings. It prints the verified target identity and aggregate counts, not the URL, password, storage keys, filenames or raw exceptions.

Default mode is **dry run**. `--apply` is accepted only with `--mode assets`. Database identity is also rechecked on each pooled connection after preflight. Defaults are at most 100 rows, 50 files, 25 MiB of inspected eligible file sizes and 30 seconds. The configurable ceilings are 500 rows, 500 files, 64 MiB and 120 seconds. The UUID `next_cursor` continues the database primary-key walk with `--after-id`; after `complete: true`, begin a new pass without a cursor to include records whose UUID falls before an earlier checkpoint. An entry too large for the configured byte ceiling is skipped and counted; increase the bound only after inspecting the target. Time is checked between records and PostgreSQL statements/row locks have capped timeouts. A single stalled filesystem syscall cannot be forcibly interrupted safely; the elapsed bound is therefore cooperative for filesystem operations.

Example isolated **dry run** (replace the test paths with a freshly created temporary test fixture and use its explicit SQLite file):

```fish
cd /home/yasso/irm-platform/backend
set -l test_root /tmp/irm-sticker-maintenance-test-EXAMPLE
set -lx IRM_STICKER_MAINTENANCE_DATABASE_URL "sqlite:///$test_root/isolated.sqlite"
./.venv/bin/python -m scripts.sticker_maintenance \
    --storage-root "$test_root/storage" --expected-storage-root "$test_root/storage" \
    --expected-database "$test_root/isolated.sqlite" \
    --expected-role sqlite --expected-schema main
set -l maintenance_status $status
set -e IRM_STICKER_MAINTENANCE_DATABASE_URL
echo "dry-run status: $maintenance_status"
```

For a reviewed eligible test fixture, the matching **apply** invocation is:

```fish
set -l test_root /tmp/irm-sticker-maintenance-test-EXAMPLE
set -lx IRM_STICKER_MAINTENANCE_DATABASE_URL "sqlite:///$test_root/isolated.sqlite"
./.venv/bin/python -m scripts.sticker_maintenance \
    --storage-root "$test_root/storage" --expected-storage-root "$test_root/storage" \
    --expected-database "$test_root/isolated.sqlite" \
    --expected-role sqlite --expected-schema main --apply
set -l maintenance_status $status
set -e IRM_STICKER_MAINTENANCE_DATABASE_URL
echo "apply status: $maintenance_status"
```

Inspect `deleted`, `failed` and `next_cursor` before another bounded pass. For read-only diagnostics, add `--mode orphans` or `--mode temporaries`, and resume those inventories with `--after-ordinal <next_cursor>`. An `--apply` request in either inventory mode is refused.

For an owner PostgreSQL target, an operator must separately obtain the exact database URL, database name, role, exclusive application schema and durable storage root. Run the command in default dry-run mode with those explicit `--expected-*` values, record the printed server address/port and review the candidate counts. Only after that review, a separate invocation may add `--apply --owner-apply --expected-server-address <observed address> --expected-server-port <observed port>`. Supply `--expected-schema-marker` when the schema has an ownership marker. The owner procedure is documented but **was not executed**; no owner/development/production target was used here. Store the database URL in a function-scoped environment variable, never as a command argument or report field. Keep each report's cursor and failure count in the operations record.

## Filesystem orphan and temporary inventory

`--mode orphans` and `--mode temporaries` are separate, **dry-run-only** inventories. They walk only canonical `stickers/<owner UUID>/<asset UUID>/<version UUID>.webp` paths or task-owned `.sticker-tmp-*` leaves under that namespace. Symlinks, non-regular files and malformed directories/keys are rejected. Both modes require file modification age of at least 30 days. Orphans are checked for absence by asset UUID or storage key against the specified database; temporary files are reported separately. Neither mode touches avatar/document directories. `--after-ordinal` resumes a bounded inventory over the current directory enumeration; because filesystem order can shift during concurrent writes, this is an advisory dry-run checkpoint only and must never authorize deletion.

No safe orphan or temporary-file **apply** exists yet. CS3 can publish a file before its row commit and retain it after an uncertain commit. There is no shared writer/reconciler lease, publication ledger or definitive end-of-write marker; even a 30-day mtime cannot prove an object is abandoned. The bounded plan is to inspect inventory reports now, then add explicit writer/reconciler coordination and reverify database absence immediately before any future deletion. CS6A does not turn age into unsafe deletion authority. Operational orphan/backlog storage remains a deployment capacity gate.

## Verification and outstanding gates

| Command | Actual result |
| --- | --- |
| `./.venv/bin/python -m pytest tests/services/test_sticker_cleanup.py -q` | 8 passed, isolated SQLite and temporary storage. |
| `./.venv/bin/python -m acceptance.profile --suite sticker-cleanup-api --heartbeat` | 21 passed (cleanup plus generic storage); test-process heartbeat accommodation. |
| `./.venv/bin/python -m acceptance.profile --suite discussion-sticker-api --heartbeat` | 107 passed, 54 deprecation warnings; test-process heartbeat accommodation; Discussion/custom sticker, removal and library API overlap other suites. |
| `./.venv/bin/python -m acceptance.profile --suite sticker-api --heartbeat` | 33 passed, 54 deprecation warnings; overlaps the preceding library/storage coverage. |
| `./.venv/bin/python -m pytest tests/acceptance/test_isolation.py -q` | 53 passed, pure guard tests. |
| `./.venv/bin/python -m pytest tests/services/test_sticker_cleanup_pg.py --collect-only -q` | 2 collected; no database assertions. |
| `./.venv/bin/python -m acceptance.profile --suite sticker-cleanup-postgresql` | **Blocked** with `OperationalError` during setup, before identity verification. Evidence `/tmp/irm-profile-evidence-z0yygyxh/profile-result.json`: null pytest status, empty test results, no outstanding owned schema, temporary storage removed. **Zero PostgreSQL assertions executed.** |
| `compileall`, scoped `git diff --check`, trailing-whitespace scan | Passed. |

The focused tests cover active/recent retention; old removed and ownerless eligibility; visible and moderation-removed references; missing-file idempotence; malformed key, owner mismatch and file/parent symlink refusal; storage deletion and commit failures; repeated passes, row/file/byte/time bounds and cursor progress; dry-run orphan/temp inventory; target refusal; and no avatar/document deletion. The guarded PostgreSQL module has a controlled independent-connection reference/cleanup race, but it remains **unexecuted**. Do not add overlapping suite totals as unique test counts.

Fish-compatible owner retry for **only** the approved disposable PostgreSQL race suite:

```fish
cd /home/yasso/irm-platform/backend
function run_cs6a_sticker_cleanup_pg
    read -s -P 'Password for irm_test: ' db_password
    echo
    set -l run_id (./.venv/bin/python -c 'import uuid; print(uuid.uuid4().hex)')
    set -l journal "/tmp/irm-cs6a-$run_id.jsonl"
    set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
    set -lx IRM_ACCEPTANCE_DB_PORT 5432
    set -lx IRM_ACCEPTANCE_DB_PASSWORD $db_password
    set -lx IRM_ACCEPTANCE_RUN_ID $run_id
    set -lx IRM_ACCEPTANCE_JOURNAL $journal
    ./.venv/bin/python -m acceptance.profile --suite sticker-cleanup-postgresql
    set -l pg_status $status
    set -e IRM_ACCEPTANCE_DB_PASSWORD
    set -e db_password
    printf 'CS6A PostgreSQL status: %s; journal: %s\n' $pg_status $journal
    return $pg_status
end
run_cs6a_sticker_cleanup_pg
```

CS2 migration, CS3 quota/removal and CS4 send/removal guarded PostgreSQL gates remain open; this blocked attempt closes none of them. Prior profile/password/avatar PostgreSQL and rendered D1.3/CS5 browser/live two-account/mobile acceptance remain open. The S1 report still was not located and its acceptance status is unknown. Durable sticker/avatar storage mounts, backup/restore, production capacity and deployment behavior were not verified. CS6B owns final sticker end-to-end acceptance. No files were staged, committed, pushed or deployed and no owner service was restarted.
