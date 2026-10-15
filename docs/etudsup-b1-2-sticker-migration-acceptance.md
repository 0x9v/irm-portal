# ETUDSUP B1.2 — Correct sticker PostgreSQL migration acceptance

## Finding

The failure is a **legacy fixture defect**, not a defect in migration `d1e2f3a4b5c6`.

The test first downgrades its fresh disposable schema to predecessor `c96b4731ea20`, then intentionally inserts legacy TEXT and built-in STICKER Discussion rows before upgrading to the sticker revision. At that revision, the historical `discussion_messages` table has `kind VARCHAR(10)`, `content`, and `sticker_id`, but no `custom_sticker_id`. The current `DiscussionMessage` mapping already includes nullable `custom_sticker_id`; SQLAlchemy emits that column on ORM INSERT even when its value is `None`. PostgreSQL therefore correctly rejects the fixture INSERT at `session.commit()` because it references a column not yet present.

The same current ORM mapping was used for two legacy-row reads after downgrade, which would also select the removed `custom_sticker_id` column. User and Community ORM fixture inserts are compatible with `c96b4731ea20`; the mismatch is specific to DiscussionMessage's field added in `d1e2f3a4b5c6`. The migration add/drop order and the `c96b4731ea20` predecessor relationship are consistent with the intended additive migration. No migration graph or production migration change was needed.

## Owner evidence

I inspected the supplied files `/tmp/irm-profile-evidence-ot5ofivl/profile-result.json` and `/tmp/etudsup-b1-797794e787d1405192122b89411f6cb8.jsonl`. The profile result records:

- Target identity: database `irm_integration_test`, role `irm_test`, loopback PostgreSQL at port 5432.
- `sticker-postgresql`: one test failed in `test_sticker_migration_preserves_legacy_and_guards_data_downgrade`; no test passed.
- Cleanup: `verified owned schema dropped` and `temporary_storage: removed`.
- Two lease entries are present in the journal: the runner's owned schema and the test's separate `disposable_database` schema. The test's context manager closes its schema in `finally`; the pytest result recorded a call failure but no teardown error. No other sticker PostgreSQL suites were included in that run.

These are inspected owner-run artifacts. They are distinct from the local checks listed below.

## Correction

`backend/tests/services/test_sticker_foundation_pg.py` now reflects `discussion_messages` at `c96b4731ea20` and inserts legacy rows through SQLAlchemy Core using only historical columns. It keeps the real TEXT content, built-in STICKER kind and identifier, and generated row IDs. The seed still occurs before the upgrade; the test explicitly confirms `custom_sticker_id` is absent at the predecessor revision and present only after upgrade.

After an empty downgrade, the test reflects the historical table to check TEXT and built-in STICKER data without querying through the current ORM. It asserts the custom column and `sticker_assets` table are absent, then re-upgrades, asserts they return, and verifies legacy values through the current ORM. After a guarded downgrade refusal with live asset/reference data, it asserts the new column/table remain present and checks the legacy data while still on the new schema. Existing PostgreSQL assertions for custom-message creation, the TEXT/custom-reference check constraint, RESTRICT on referenced asset deletion, owner `SET NULL`, downgrade refusal, empty downgrade, legacy preservation and re-upgrade remain in place.

Only the acceptance test and this report changed for B1.2. No frontend, migration, application contract, dependency or feature change was made.

## Local verification

| Check | Result |
| --- | --- |
| `pytest tests/core/test_stickers.py tests/core/test_storage.py tests/acceptance/test_isolation.py -q --tb=short` | **76 passed.** |
| `acceptance.profile --suite sticker-api --heartbeat` | **33 passed, 0 failed**: sticker library API 10, sticker core 10, storage core 13. Evidence: `/tmp/irm-profile-evidence-z6ud9i1g/profile-result.json`; temporary storage removed. |
| `python -m py_compile tests/services/test_sticker_foundation_pg.py` | Passed. |
| PostgreSQL availability preflight | `127.0.0.1:5432` returned **no response**; no acceptance password is configured in this environment. No guarded PostgreSQL rerun was attempted. |

These local core/API/isolation tests do not establish PostgreSQL migration acceptance. The corrected `sticker-postgresql` test and its FK/check/downgrade behavior remain owner-side verification gates.

## B1.2 follow-up — Detached fixture identifiers

The next owner run reached the same guarded target but failed in the corrected Core seed with `DetachedInstanceError` at `community.id`. The fixture had committed and exited the ORM session before using `owner.id`, `author.id`, and `community.id`; with SQLAlchemy's default `expire_on_commit=True`, commit expires their attributes and session exit detaches them. Access then attempts a refresh without a bound Session.

The fixture now flushes its initial User and Community objects and captures their UUIDs as plain scalar values while the session is active, before commit and close. It likewise captures `asset_id` and `custom_message_id` after their respective flushes, while those objects are attached. The reflected historical Core insert and subsequent bound SQL use only scalar UUIDs. No global expiration setting was changed.

The rest of the test was audited across session close, rollback and migration boundaries. After the initial session closes, no User/Community ORM attributes are read. After the failed referenced-asset delete and the failed invalid-message insert roll back, later operations use captured UUIDs; the `StickerAsset` and `DiscussionMessage` queries that remain occur in the still-open Session while the new schema is present. After the empty downgrade, legacy rows are read with reflected Core columns, and after re-upgrade the ORM reads occur in a new live Session. No ORM access requires a column removed by downgrade.

The supplied follow-up result `/tmp/irm-profile-evidence-3fe43x3_/profile-result.json` records the approved database/role identity, one failed test, verified owned-schema drop, and removed temporary storage. Its journal `/tmp/etudsup-b1-2-6a41bde8055246438076e625f4728a9a.jsonl` contains both the runner lease and nested `disposable_database` lease. The current local preflight again reports no response from `127.0.0.1:5432`, and no acceptance password is configured, so the full PostgreSQL migration path remains owner-side pending. The exact guarded rerun command below remains applicable.

Follow-up changed files:

- `backend/tests/services/test_sticker_foundation_pg.py` — capture fixture IDs while attached and use scalar IDs across Core/SQL operations.
- `docs/etudsup-b1-2-sticker-migration-acceptance.md` — this session-lifecycle audit, owner evidence, verification status, and changed-file record.

Follow-up local checks: the focused sticker/isolation run passed **76 tests**; the combined collect-only command collected **77 tests**, including the guarded sticker migration case (collection only); and `py_compile` passed. None executes PostgreSQL migration assertions.

## Owner rerun

Use an interactive fish shell when the approved integration service is available. This creates a fresh run ID and journal and runs only the existing guarded `sticker-postgresql` suite. The harness verifies the `irm_integration_test` / `irm_test` target, leases a unique schema, and removes temporary storage and the owned schema during cleanup.

```fish
cd /home/yasso/irm-platform/backend; or return 2
set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
set -lx IRM_ACCEPTANCE_DB_PORT 5432
read -s -P 'Approved irm_test integration password: ' db_password; or return 2
set -lx IRM_ACCEPTANCE_DB_PASSWORD $db_password
set -e db_password
set -lx IRM_ACCEPTANCE_RUN_ID (./.venv/bin/python -c 'from uuid import uuid4; print(uuid4().hex)')
test -n "$IRM_ACCEPTANCE_RUN_ID"; or return 2
set -lx IRM_ACCEPTANCE_JOURNAL "/tmp/etudsup-b1-2-$IRM_ACCEPTANCE_RUN_ID.jsonl"
./.venv/bin/python -m acceptance.profile --suite sticker-postgresql --heartbeat
set -l sticker_pg_status $status
printf 'sticker PostgreSQL status: %s; run ID: %s; journal: %s\n' $sticker_pg_status $IRM_ACCEPTANCE_RUN_ID $IRM_ACCEPTANCE_JOURNAL
set -e IRM_ACCEPTANCE_DB_PASSWORD
test $sticker_pg_status -eq 0
```

Inspect the emitted `profile-result.json` and journal. Require successful pytest status, the expected server identity, verified owned-schema cleanup, and removed temporary storage. If the guarded service is unavailable, retain this as pending rather than switching database targets or treating local/collection results as PostgreSQL acceptance.

## Cleanup status

The supplied failed owner run records verified owned-schema drop and removed temporary storage. Its journal records both the runner lease and nested disposable-test lease; the test context's `finally` cleanup completed without a pytest teardown error. Local API acceptance also records temporary storage removed and created no database schema. This B1.2 environment has no reachable PostgreSQL service, so the new guarded owner run and its cleanup evidence remain pending.
