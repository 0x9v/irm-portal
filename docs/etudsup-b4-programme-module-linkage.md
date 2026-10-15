# EtudSup B4 — Programme linkage for Modules

**Status:** additive ORM and storage foundation. Existing Community-owned Module and Document behavior remains in place. No route cutover, shared listing, cross-community document access, or annual review state is included.

## Changed files

| File | B4 change |
|---|---|
| `backend/app/models/module.py` | Added nullable `programme_id`, indexed Programme FK (`ON DELETE RESTRICT`), and `Module.programme` relationship. Kept `community_id`, `uq_modules_community_slug`, document relationships, and post tags. |
| `backend/app/models/programme.py` | Added the reverse `Programme.modules` relationship. |
| `backend/scripts/seed.py` | New IRM communities use an existing IRM Programme when available; newly created Modules copy the Community's `programme_id`. Existing unlinked Communities remain unlinked. No seed ran as part of this task. |
| `backend/alembic/versions/f4b8c1d2e390_link_modules_to_programmes.py` | Added the single additive revision after B3. It backfills only through each Module's current Community link and refuses a downgrade that would discard any non-NULL Module Programme link. |
| `backend/acceptance/isolation.py` | Pinned the acceptance head and verifies the new Module column, FK, index, and retained community/slug uniqueness. Database identity, schema ownership, table allowlist, cleanup lease, and external-dependency checks remain guarded. |
| `backend/tests/services/test_programme_module_linkage_pg.py` | Added guarded disposable PostgreSQL coverage for backfill, preservation, duplicate slugs across Communities, FK/index/model parity, and downgrade behavior. |
| `backend/tests/services/test_programme_module_linkage_sqlite.py` | Added a local SQLite migration smoke test. SQLite is not PostgreSQL acceptance evidence. |
| `backend/tests/services/test_programme_foundation_sqlite.py` | Adjusted its pre-B4 metadata fixture to omit the new Module column when constructing the historical B2 schema. |
| `backend/tests/core/test_seed.py` | Added seed coverage for a new linked IRM Community and for preserving an existing unlinked Community. |
| `backend/tests/api/v1/test_programme_api_compatibility.py` | Added linked-Programme API coverage proving existing module responses omit Programme metadata and a requested Community/module slug resolves to that Community's Module when another linked Community has the same slug. |
| `docs/etudsup-b4-programme-module-linkage.md` | This implementation and verification record. |

The checkout contained extensive pre-existing modified and untracked work. Those files were preserved. No frontend files were edited.

## Migration and backfill

The actual sole Alembic head before B4 was verified as `e4b6c8d0f219`, following B2's `d9a1f3c7b205`. The new revision `f4b8c1d2e390` has predecessor `e4b6c8d0f219`; `alembic heads` reports `f4b8c1d2e390` as the sole head.

`modules.programme_id` is nullable UUID, references `programmes.id` with `ON DELETE RESTRICT`, and has index `ix_modules_programme_id`. The existing unique constraint remains `UNIQUE (community_id, slug)` named `uq_modules_community_slug`. No `UNIQUE (programme_id, slug)` was added. The migration does not alter Module IDs, `community_id`, or timestamps, and does not update Documents, votes, saves, reading rows, posts, or tags.

The backfill rule is exactly:

```sql
UPDATE modules
SET programme_id = communities.programme_id
FROM communities
WHERE modules.community_id = communities.id
  AND communities.programme_id IS NOT NULL
  AND modules.programme_id IS NULL;
```

Thus, existing IRM Modules follow the already explicit IRM Community → IRM Programme relationship. Any Module owned by a Community with `programme_id IS NULL` stays NULL. The migration does not infer a Programme from a Community name or slug and does not assume all Communities belong to IRM.

### Duplicate slugs and later reconciliation

Different Communities under one Programme can legitimately use the same slug: current route identity is `(community_slug, module_slug)`, and `uq_modules_community_slug` permits the same slug in different Communities. The guarded migration fixture includes two linked Communities with `slug = 'signals'` and verifies both rows link to the same Programme without merging or renaming either.

Before Programme-level shared resources are exposed, reconcile identity explicitly. Keep current Module IDs and Community slugs stable, and introduce a curated Programme-level canonical mapping or alias table for Modules that are proven to represent the same academic resource. Preserve distinct rows where they are not the same resource. Do not resolve collisions by deleting or renaming existing rows. That future step must also define community-specific review and access rules for documents.

## Runtime and API compatibility

Module list/detail services continue filtering by the requested Community ID; detail lookup still uses `(community_id, slug)`. The compatibility test now exercises two linked Communities with an overlapping module slug and verifies each requested Community returns its own Module ID.

Document listing and detail remain rooted at `Document.module_id` and the selected Module. Voting and pending-document access continue requiring ACTIVE membership in `Module.community_id`. Upload and preview keys remain based on `module.community_id/module.id`; existing storage and preview paths are untouched. Saved and Recent records still reference the same Document rows. Post tags still reference the same Module IDs and remain subject to existing same-community service validation. The B4 migration and routes do not grant sibling-Community access through `programme_id`.

`ModuleResponse` remains unchanged and does not expose `programme_id` or Programme metadata. Upload, review, voting, inline, preview, download, Saved, Recent, My Submissions, and post-tag routes/services were not changed.

The seed path fills a newly created Module's `programme_id` from its Community. When the seed creates the IRM Community, it associates the existing `irm` Programme if present. If the Community already exists but is unlinked, the seed leaves it unlinked and its new Modules NULL-linked.

Downgrade first checks for any Module with non-NULL `programme_id`. If links exist, it raises before schema DDL; it never unlinks Modules and never deletes Modules or Documents. With no Module links, it drops only the new index and column. A guarded safe-downgrade case verifies Module and Document IDs and the storage path survive.

## Verification

Commands ran from `backend/` unless noted.

The Alembic checks were:

```bash
.venv/bin/alembic heads
.venv/bin/alembic history --verbose
.venv/bin/alembic upgrade e4b6c8d0f219:f4b8c1d2e390 --sql
```

The local focused checks used the process-local selector wrapper required by the current `TestClient` event-loop behavior:

```bash
POSTGRES_DB=irm_b4_unused POSTGRES_USER=unused POSTGRES_PASSWORD=unused DATABASE_PORT=1 ENVIRONMENT=test STORAGE_ROOT=/tmp/etudsup-b4-focused \
.venv/bin/python -c 'import selectors,sys; original=selectors.EpollSelector.select; selectors.EpollSelector.select=lambda self,timeout=None: original(self,0.01 if timeout is None else min(timeout,0.01)); import pytest; raise SystemExit(pytest.main(sys.argv[1:]))' \
tests/services/test_programme_module_linkage_sqlite.py tests/services/test_programme_foundation_sqlite.py \
tests/api/v1/test_programme_api_compatibility.py tests/api/v1/test_modules.py \
tests/api/v1/test_member_directory.py tests/acceptance/test_isolation.py -k 'not postgresql' -q --tb=short

POSTGRES_DB=irm_b4_unused POSTGRES_USER=unused POSTGRES_PASSWORD=unused DATABASE_PORT=1 ENVIRONMENT=test STORAGE_ROOT=/tmp/etudsup-b4-seed \
.venv/bin/python -c 'import selectors,sys; original=selectors.EpollSelector.select; selectors.EpollSelector.select=lambda self,timeout=None: original(self,0.01 if timeout is None else min(timeout,0.01)); import pytest; raise SystemExit(pytest.main(sys.argv[1:]))' \
tests/core/test_seed.py -q --tb=short
```

The regression command used the same wrapper and environment, with `STORAGE_ROOT=/tmp/etudsup-b4-regressions`, and these suites: `test_modules.py`, `test_documents.py`, `test_document_browsing.py`, `test_document_upload_limit.py`, `test_document_voting.py`, `test_document_voting_flows.py`, `test_document_voting_thresholds.py`, `test_document_preview.py`, `test_document_inline_view.py`, `test_document_download.py`, `test_document_global_download.py`, `test_saved_documents.py`, `test_document_reading.py`, `test_community_posts.py`, `test_memberships.py`, `test_membership_applications.py`, `test_membership_review.py`, `test_membership_withdrawal.py`, `test_membership_management.py`, `test_delegate_member_management.py`, `test_provisioning.py`, `test_membership_errors.py`, and `test_deps_authz.py`; it used `-k 'not postgresql' -q --tb=short`.

The guarded PostgreSQL attempts were:

```bash
IRM_ACCEPTANCE_RUN_ID=<fresh-32-hex-id> IRM_ACCEPTANCE_JOURNAL=/tmp/<unique-run>.jsonl .venv/bin/python -m pytest tests/services/test_programme_foundation_pg.py -q --tb=short
IRM_ACCEPTANCE_RUN_ID=<fresh-32-hex-id> IRM_ACCEPTANCE_JOURNAL=/tmp/<unique-run>.jsonl .venv/bin/python -m pytest tests/services/test_multi_community_memberships_pg.py -q --tb=short
IRM_ACCEPTANCE_RUN_ID=<fresh-32-hex-id> IRM_ACCEPTANCE_JOURNAL=/tmp/<unique-run>.jsonl .venv/bin/python -m pytest tests/services/test_programme_module_linkage_pg.py -q --tb=short
```

| Check | Result |
|---|---|
| `.venv/bin/alembic heads` and `.venv/bin/alembic history --verbose` | Passed. Sole head `f4b8c1d2e390`; predecessor is `e4b6c8d0f219`. |
| `.venv/bin/alembic upgrade e4b6c8d0f219:f4b8c1d2e390 --sql` | Passed. Generated transactional PostgreSQL SQL adds the nullable column/FK/index, updates Modules only through `communities.id`, and updates Alembic version. |
| `py_compile` on changed Python files | Passed. |
| Focused SQLite/API/guard command: `test_programme_module_linkage_sqlite.py`, `test_programme_foundation_sqlite.py`, API compatibility, modules, member directory, and acceptance isolation; `-k 'not postgresql'` | 102 passed, 41 PostgreSQL parameterizations deselected. Includes module response shape and same-slug Community route checks. |
| `tests/core/test_seed.py` | 3 passed. Covers linked Programme population and NULL retention for an existing unlinked Community. |
| Module/document/membership regression group: modules, upload, browsing, voting, previews, inline/download, Saved, Recent, Community Posts, membership lifecycle/provisioning, and dependency authorization; `-k 'not postgresql'` | 306 passed. The initial unfiltered run also passed 346 SQLite/API cases but tried 41 PostgreSQL member-directory cases without a lease; those cases errored at fixture setup. The focused rerun above covers the member-directory SQLite cases. |
| Guarded B2 PostgreSQL test, `tests/services/test_programme_foundation_pg.py` | Attempted before B4 tests as requested. 2 failures before schema creation: approved `irm_integration_test` / `irm_test` loopback connection returned `psycopg.OperationalError: connection is bad: no error details available`. No schema was created. |
| Guarded B3 PostgreSQL test, `tests/services/test_multi_community_memberships_pg.py` | Attempted after B2 and before B4 tests. 1 failure and 3 setup errors at the same guard connection step, before schema creation. No schema was created. |
| Guarded B4 PostgreSQL test, `tests/services/test_programme_module_linkage_pg.py` | Attempted. 2 failures before schema creation with the same guarded connection error. PostgreSQL migration, row preservation, and safe/blocked PostgreSQL downgrade remain unverified at runtime. |

SQLite tests validate local ORM/migration behavior only. They are not PostgreSQL acceptance evidence. No owner database was used as a fallback.

## Remaining before shared Programme resources

- Decide how canonical Programme Modules map to Community-specific Module rows when slugs overlap.
- Define whether stable learning resources and their documents are shared, copied, or versioned, while preserving legacy Module and Document IDs and paths.
- Model annual Community-specific document submission, review state, vote thresholds, and votes before any cross-community document visibility is enabled.
- Add explicit authorization and response contracts for any future Programme-level listing or reading route; Programme linkage alone grants no sibling access.
- Define and test new storage-key rules only if future shared resource ownership requires them. Existing keys must remain readable.

B4 stops at nullable Module–Programme linkage. It does not change resource ownership or expose shared resources.
