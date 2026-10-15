# EtudSup B2 — Programme and Community hierarchy foundation

**Status:** implemented as an additive schema foundation. No community creation API, programme modules, membership-index change, frontend work, or owner database migration was included.

## Schema and files changed

The current hierarchy is represented as EtudSup platform identity → Programme → Community. EtudSup remains the platform/deployment identity and is not a tenant table in this release. The one institution context is stored as Programme metadata; no University entity or catalogue was added.

| File | Change |
|---|---|
| `backend/app/models/programme.py` | New `Programme` ORM model and reverse community relationship. |
| `backend/app/models/community.py` | Nullable `programme_id` FK to Programme, indexed, plus optional ORM relationship. Existing slug, threshold, membership/content relationships and constraints remain. |
| `backend/app/models/__init__.py` | Registers/exports `Programme`. |
| `backend/alembic/env.py` | Imports `Programme` so it is present in Alembic metadata. |
| `backend/alembic/versions/d9a1f3c7b205_add_programmes_and_link_irm.py` | New additive revision and narrowly scoped IRM backfill. |
| `backend/acceptance/isolation.py` | Pins the new head; adds `programmes`, `saved_documents`, and `document_reading_records` to the guarded table allowlist; verifies new Programme columns, FK and Community index. Identity, schema ownership and cleanup protections are unchanged. |
| `backend/tests/services/test_programme_foundation_pg.py` | Guarded PostgreSQL migration tests for populated IRM, an unrelated Community, no-IRM installation, schema constraints, preservation and downgrade behavior. |
| `backend/tests/services/test_programme_foundation_sqlite.py` | SQLite migration/model checks for populated and no-IRM cases, preservation, linkage, FK schema and downgrade safety. |
| `backend/tests/api/v1/test_programme_api_compatibility.py` | API response-shape regression for existing module and self-membership responses. |
| `docs/etudsup-b2-programme-foundation.md` | This implementation report. |

The worktree had extensive pre-existing modified and untracked work, including several backend files touched here. That work was preserved. No frontend file was edited.

### Final schema

`programmes` has UUID primary key; globally unique `slug` (`VARCHAR(100)`); `name` (`VARCHAR(100)`); `institution_slug` (`VARCHAR(100)`); `institution_name` (`VARCHAR(150)`); and non-null timezone-aware `created_at`/`updated_at` timestamps. The first row is the IRM Programme in the FST Mohammedia context.

`communities.programme_id` is nullable UUID, references `programmes.id` with `ON DELETE RESTRICT`, and has index `ix_communities_programme_id`. `Community.slug` remains globally unique. No academic-year/cohort or archive fields were added: B1 established that the existing IRM year is unknown, and did not settle the lifecycle meaning or access policy for an archived Community. Leaving the existing year unset and deferring archive state avoids assigning semantics by inference.

No field or relationship was added to Module. Module ownership remains `community_id`; documents, memberships, and all routes continue using their existing relationships. Programme metadata is not included in any response schema.

## Migration and backfill

The head before editing was verified with `alembic heads`: `c7e4a9d213f6` (single head). The new revision is `d9a1f3c7b205`, with predecessor `c7e4a9d213f6`; final `alembic heads` reports `d9a1f3c7b205 (head)`.

Upgrade creates the Programme table and nullable Community FK/index. It resolves Programme slug `irm`; if absent, it inserts the fixed Programme UUID `9e85c0d8-08a8-4a25-8ca6-13fcaf412c20`, slug/name `irm`/`IRM`, and institution slug/name `fst-mohammedia`/`FST Mohammedia`. If that slug already exists, its ID and metadata are retained. It updates `programme_id` only where `communities.slug = 'irm'` and the new FK is NULL.

If no `irm` Community exists, the migration creates only the IRM Programme row. It does not fabricate a Community. Every other Community remains present and unlinked (`programme_id IS NULL`), regardless of name. Existing Community IDs and children are not updated. No application fields are read or rewritten, and no modules, documents, paths, votes, saves, reading records, posts, announcements, discussion rows, or management events are touched.

On SQLite, the nullable FK is added and dropped in place. This avoids Alembic batch mode rebuilding `communities`, which can trigger child cascades when SQLite foreign-key enforcement is enabled. PostgreSQL uses normal additive column DDL. The migration runs as one Alembic revision transaction. It uses no deletes or backfills outside the one Community link.

Downgrade first counts all Community Programme references. If any exist, it raises a clear error before DDL; it does not unlink or delete rows. With no references it drops the index, FK column and Programme table. The no-IRM SQLite test covers that safe downgrade. After any Programme links are used, downgrade requires an explicit operator reconciliation and is intentionally blocked.

## Compatibility and preservation evidence

- Existing `/communities/irm/...` routes still resolve the same Community slug. No router or service predicate changed.
- `Community.id` remains the same; Module still points to the original Community ID. Existing document IDs and storage/preview path strings are untouched.
- Existing membership decisions and the global PENDING/ACTIVE partial index are unchanged. The migration does not relax or replace that index.
- Existing schemas `ModuleResponse` and `SelfMembershipResponse` remain unchanged. A focused API test asserts their response keys do not include Programme metadata.
- SQLite migration fixtures assert the original IRM UUID, membership CNE, module/document references and storage path survive; an unrelated Community remains NULL-linked. The PostgreSQL test additionally constructs and asserts IDs/counts and representative fields for membership permissions, documents/votes/saves/reading records, announcements/replies, posts/replies, discussion/reactions and a management event. It also checks CNE/application values, preview/storage paths, FK/index/unique constraints, Programme FK restriction and downgrade refusal.
- These preservation assertions are test coverage, not a claim about production rows: no production or owner database was queried or migrated.

## Verification

Actual commands and results:

1. `cd backend && .venv/bin/alembic heads` — **passed**, one head: `d9a1f3c7b205`.
2. `cd backend && .venv/bin/alembic history --verbose` — **passed**, confirms `d9a1f3c7b205` follows `c7e4a9d213f6`.
3. Python `py_compile` on the model, migration, guard and new tests — **passed**.
4. Final focused SQLite/API/guard command:

   ```text
   POSTGRES_DB=irm_b2_unused POSTGRES_USER=unused POSTGRES_PASSWORD=unused DATABASE_PORT=1 ENVIRONMENT=test STORAGE_ROOT=/tmp/irm-b2-programme timeout 120s .venv/bin/python -c 'import selectors,sys; original=selectors.EpollSelector.select; selectors.EpollSelector.select=lambda self,timeout=None: original(self,0.01 if timeout is None else min(timeout,0.01)); import pytest; raise SystemExit(pytest.main(sys.argv[1:]))' tests/services/test_programme_foundation_sqlite.py tests/api/v1/test_programme_api_compatibility.py tests/api/v1/test_modules.py tests/api/v1/test_membership_me.py tests/acceptance/test_isolation.py -q --tb=short
   ```

   **65 passed.** The selector wrapper is process-local for TestClient. The migration fixture used a temporary SQLite file; the dummy PostgreSQL variables were not used to connect to a database.
5. Existing backend regressions:

   ```text
   POSTGRES_DB=irm_b2_unused POSTGRES_USER=unused POSTGRES_PASSWORD=unused DATABASE_PORT=1 ENVIRONMENT=test STORAGE_ROOT=/tmp/irm-b2-programme timeout 150s .venv/bin/python -c 'import selectors,sys; original=selectors.EpollSelector.select; selectors.EpollSelector.select=lambda self,timeout=None: original(self,0.01 if timeout is None else min(timeout,0.01)); import pytest; raise SystemExit(pytest.main(sys.argv[1:]))' tests/api/v1/test_memberships.py tests/api/v1/test_membership_applications.py tests/api/v1/test_membership_review.py tests/api/v1/test_membership_withdrawal.py tests/api/v1/test_delegate_member_management.py tests/api/v1/test_document_browsing.py tests/api/v1/test_saved_documents.py tests/api/v1/test_document_reading.py tests/api/v1/test_community_posts.py tests/api/v1/test_discussion.py tests/acceptance/test_isolation.py -q --tb=short
   ```

   **283 passed.** These regression suites exercise existing membership lifecycle, community authorization, documents, saved/recent records, posts, discussion and acceptance guard behavior.
6. Guarded PostgreSQL migration command:

   ```text
   IRM_ACCEPTANCE_RUN_ID=2a9cc67986e24c8e9fd822a3dfb23911 IRM_ACCEPTANCE_JOURNAL=/tmp/irm-b2-programme-2a9cc67986e24c8e9fd822a3dfb23911.jsonl .venv/bin/python -m pytest tests/services/test_programme_foundation_pg.py -q --tb=short
   ```

   **Blocked before schema creation:** the guard attempted only its approved `irm_integration_test` / `irm_test` loopback target and psycopg returned `OperationalError: connection is bad: no error details available`. No identity was returned and no schema was created. PostgreSQL migration behavior, FK enforcement, rollback atomicity and the full multi-table preservation fixture therefore remain unverified at runtime. No owner database was used as fallback.
7. `git diff --check` on changed tracked files reports the pre-existing blank line at EOF in `backend/app/models/community.py` (also noted by B1). New files passed trailing-whitespace scans. The existing whitespace was left untouched.

## Handoff for B3

The hierarchy now provides one stable IRM Programme and links the existing IRM Community without assigning a year. B3 can address the global membership uniqueness rule as a separate task. Programme ownership of modules/documents, annual document review, public discovery, community provisioning and archive semantics remain unimplemented and unchanged.

No dependency, deployment, environment, storage, or frontend files were changed. The separate `/home/yasso/etudsup` worktree was not entered. No migration was run outside temporary SQLite tests or the failed-before-schema guarded PostgreSQL attempt. Nothing was staged, committed, pushed, or deployed.
