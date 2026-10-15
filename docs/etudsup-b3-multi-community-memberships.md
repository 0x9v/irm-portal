# EtudSup B3 — Community-scoped membership lifecycle

**Scope:** membership lifecycle and the global PENDING/ACTIVE index only. No frontend, Programme module ownership, directory creation, or account-switching behavior is included.

## Files changed for B3

- `backend/app/models/membership.py` — removed the global partial unique index from ORM metadata. Kept `uq_memberships_user_community` and `uq_memberships_community_active_delegate` unchanged.
- `backend/app/services/membership.py` — application/reapplication and approval conflict checks now include the requested `community_id`; retired-index handling was removed while pair-conflict handling remains.
- `backend/app/services/provisioning.py` — Delegate provisioning checks the target membership only, so a controlled operator can provision an account already current in another community. Target PENDING still blocks appointment; the existing per-community Delegate check remains.
- `backend/alembic/versions/e4b6c8d0f219_scope_membership_lifecycle_to_community.py` — one additive index revision.
- `backend/acceptance/isolation.py` — pinned the new head and added required/retired membership-index assertions. The database identity, exact schema ownership, cleanup lease, external-dependency, and table allowlist checks remain intact.
- `backend/tests/api/v1/test_memberships.py` — updated global-exclusivity expectations and added two-community application, approval, reapplication, ban, privacy, directory, moderator-grant, and Delegate-index coverage.
- `backend/tests/api/v1/test_membership_review.py` — added the reverse cross-community Delegate management denial case.
- `backend/tests/api/v1/test_delegate_member_management.py` — changed the old global-exclusivity assertion to allow an IRM request while ACTIVE in another community.
- `backend/tests/services/test_membership_errors.py` — retired-index errors are no longer mapped; user/community conflicts still map to 409.
- `backend/tests/services/test_provisioning.py` — changed the cross-community appointment expectation to allow controlled provisioning in a second community.
- `backend/tests/test_pg_concurrency.py` — updated its old distinct-community expected row count. This legacy test directly truncates `irm_integration_test`; it was not run. Guarded B3 concurrency coverage is in the new test below.
- `backend/tests/services/test_multi_community_memberships_pg.py` — guarded PostgreSQL migration, index, downgrade-preflight, and concurrency cases.
- `backend/tests/services/test_multi_community_memberships_sqlite.py` — local SQLite migration/model smoke checks; not PostgreSQL migration acceptance.
- `docs/etudsup-b3-multi-community-memberships.md` — this implementation and verification record.

Several of these files already had unrelated or earlier-task modifications when B3 began. Those changes were preserved. No frontend file was edited.

## Current migration chain and schema rule

The repository had one Alembic head before B3: `d9a1f3c7b205`, the B2 Programme foundation revision. Rechecking with `backend/.venv/bin/alembic heads` after B3 shows one head: `e4b6c8d0f219`.

The complete chain observed in Alembic history is:

```text
dd021d7df98f → 9b0eb59782b9 → 6466b3659e3b → e51d75b18287
→ 95af7394f5be → a2f015c95d8d → 89d2d5cb2fe2 → 87dc5e99ac98
→ 75c1a93cb232 → 3eeecb92fbc2 → 92bb2697b74d → 2b032f8c674b
→ 589ce55cec37 → 35fb40df73f5 → b0d0b009b5e7 → 86fd7c69425d
→ e7b1a2c3d4e5 → f8c2b3d4e5f6 → a916c0e16b01 → c4d8e9f1a2b3
→ d7a9b6c4e213 → 98b4d2a6f731 → b21d7a4c9e60 → c7e4a9d213f6
→ d9a1f3c7b205 → e4b6c8d0f219 (B3)
```

`e4b6c8d0f219` follows `d9a1f3c7b205` and drops only `uq_memberships_global_active_pending`. It does not rewrite membership rows or timestamps. The schema after upgrade has:

| Rule | Result |
|---|---|
| One row per user/community | `UNIQUE (user_id, community_id)` named `uq_memberships_user_community` remains. |
| Current memberships across communities | Multiple PENDING and/or ACTIVE rows for one user are allowed if each row is for a different Community. |
| Community leadership | `uq_memberships_community_active_delegate` remains unique on `community_id` where status is ACTIVE and role is DELEGATE. |
| Removed global rule | No `uq_memberships_global_active_pending` declaration in PostgreSQL or SQLite ORM metadata; migration removes the deployed index. |

## Lifecycle behavior

Before B3, both the partial index and service checks made PENDING/ACTIVE exclusive across the whole account. The pair constraint already represented the separate rule of one row per user/community.

After B3, lifecycle state belongs to the membership row for the target Community:

- ACTIVE in A may apply to B (201, B becomes PENDING) and a reviewer in B may approve it (200, B becomes ACTIVE). A remains unchanged.
- PENDING in A may apply to B independently. Rejecting or withdrawing B changes only B; A remains PENDING. Withdrawal keeps its established behavior of deleting only the target pending row.
- REJECTED or REMOVED in B reuses that B row and applies the existing reset behavior (PENDING, MEMBER, fresh application values, new `updated_at`; original ID and `created_at` retained). A's status, role, and grants are untouched.
- BANNED in B remains ineligible for application (403) until explicitly unbanned in B. A remains accessible if A is ACTIVE.
- Repeating a PENDING or ACTIVE application in the same Community remains 409. Approving/rejecting a non-PENDING target remains 409. The same-community `(user_id, community_id)` conflict remains the final database guard.
- Controlled Delegate provisioning follows the same target-community scope. An ACTIVE membership in A no longer blocks provisioning in B. A target PENDING row in B still blocks appointment, and the target community's existing Delegate still wins the one-Delegate rule.
- Removal, ban/unban, role transitions, moderator permissions, member directories, pending queues, and `membership/me` retain their requested-community predicates. No session is transferred or revoked by a membership change in another Community.

Applicant CNE and Student/Laureate fields remain fields on each separate Membership. They are returned only on the applicant's target-community `membership/me` response or in that community's authorized pending-review response. The public member directory remains a minimal directory response and does not include them.

## Locking and concurrency

The existing service lock order and commit boundaries were retained:

- Application/reapplication: lock User, resolve Community, inspect/update the target membership, then commit.
- Review: read the membership to identify its User; lock User; resolve Community; lock and revalidate the membership by `(id, community_id)`; validate PENDING; commit.
- Delegate provisioning: lock Community, then User, then target Membership. The community lock serializes appointments for that community; the partial unique index remains the database backstop.
- Member management: target User, then target Membership, as before.

Because application and review operations still take the same User row lock, two current-state operations for one account are serialized even when they target different communities. The target-scoped checks then allow both distinct-community operations to commit. Same-community duplicate application sees the existing row after the lock and returns 409; `(user_id, community_id)` remains a final constraint. Concurrent approval re-reads the locked target after the User lock: one request transitions PENDING to ACTIVE and the second observes a non-PENDING state and returns 409. PostgreSQL `SELECT FOR UPDATE` behavior and these interleavings remain unverified at runtime because the guarded target was unavailable.

## Two-community endpoint outcomes

| Scenario | Expected result |
|---|---|
| User ACTIVE in A applies in B | `POST /communities/B/membership` returns existing 201 response shape; A ACTIVE, B PENDING. |
| Reviewer in B approves B | Existing approval response shape and 200; both rows ACTIVE. |
| A Delegate attempts to approve/manage a B membership without B authority | 403; B's target row is unchanged. |
| B Delegate attempts to ban/manage an A membership without A authority | 403; A's target row is unchanged. |
| User reads `/communities/A/membership/me` and `/communities/B/membership/me` | Each response contains only that community's membership and capabilities. |
| Delegate reads B pending queue or directory | Only B records are listed; pending applicant details are limited to B's reviewer queue. |
| User PENDING in A and B, rejects B | Existing 200 rejection response; A remains PENDING. |
| User REMOVED in B reapplies while ACTIVE in A | Existing 201 shape; B row ID is reused and A remains ACTIVE. |
| User BANNED in B reapplies while ACTIVE in A | 403; A remains ACTIVE and can still use A's member-gated routes. |
| User repeats application in the same PENDING/ACTIVE community | Existing 409 response. |

## Downgrade and release risks

The downgrade first runs this read-only preflight before DDL:

```sql
SELECT user_id
FROM memberships
WHERE status IN ('PENDING', 'ACTIVE')
GROUP BY user_id
HAVING COUNT(*) > 1
LIMIT 1;
```

If any user has multiple current memberships, downgrade raises a clear `RuntimeError` before attempting to recreate the old index. It never chooses, deletes, rejects, or transfers a membership. With no conflicting rows, it recreates the exact old partial unique index. The Alembic revision uses transactional DDL on PostgreSQL, so failure leaves the B3 version and data in place.

Once multi-community PENDING/ACTIVE rows have been written, the previous exclusivity model cannot be restored automatically. Reverting then needs a product decision and a separate preservation migration that explicitly accounts for every row and its authority; this revision intentionally refuses to make that choice.

The old backend's global service checks and the old index must be replaced together. Safe deployment order:

1. Put membership writes into maintenance mode; stop and drain every old backend process and close its WebSockets. Verify no old process can still accept requests.
2. Run the B3 migration once against the intended database.
3. Start only the B3 backend build and verify its Alembic head before reopening membership traffic.
4. Do not roll back to old backend code after migration unless the guarded downgrade preflight succeeds and an approved rollback plan exists.

Do not leave an old process serving after index removal: its account-global checks produce stale conflicts, and its code was not designed to see multiple current rows.

## Verification performed

Commands ran from `backend/` unless noted.

Key invocations (the selector wrapper is process-local for TestClient and does not change DB configuration):

```bash
.venv/bin/alembic heads
.venv/bin/alembic history --verbose
.venv/bin/alembic upgrade d9a1f3c7b205:e4b6c8d0f219 --sql

POSTGRES_DB=irm_b3_unused POSTGRES_USER=unused POSTGRES_PASSWORD=unused DATABASE_PORT=1 ENVIRONMENT=test STORAGE_ROOT=/tmp/etudsup-b3-tests timeout 180s .venv/bin/python -c 'import selectors,sys; original=selectors.EpollSelector.select; selectors.EpollSelector.select=lambda self,timeout=None: original(self,0.01 if timeout is None else min(timeout,0.01)); import pytest; raise SystemExit(pytest.main(sys.argv[1:]))' tests/services/test_multi_community_memberships_sqlite.py tests/api/v1/test_memberships.py tests/api/v1/test_membership_applications.py tests/api/v1/test_membership_review.py tests/api/v1/test_membership_withdrawal.py tests/api/v1/test_membership_management.py tests/api/v1/test_member_directory.py tests/api/v1/test_delegate_member_management.py tests/services/test_provisioning.py tests/services/test_membership_errors.py tests/acceptance/test_isolation.py -k 'not postgresql' -q --tb=short

POSTGRES_DB=irm_b3_unused POSTGRES_USER=unused POSTGRES_PASSWORD=unused DATABASE_PORT=1 ENVIRONMENT=test STORAGE_ROOT=/tmp/etudsup-b3-compat timeout 150s .venv/bin/python -c 'import selectors,sys; original=selectors.EpollSelector.select; selectors.EpollSelector.select=lambda self,timeout=None: original(self,0.01 if timeout is None else min(timeout,0.01)); import pytest; raise SystemExit(pytest.main(sys.argv[1:]))' tests/services/test_programme_foundation_sqlite.py tests/api/v1/test_programme_api_compatibility.py tests/api/v1/test_modules.py tests/api/v1/test_membership_me.py tests/acceptance/test_isolation.py tests/api/test_deps_authz.py -q --tb=short

IRM_ACCEPTANCE_RUN_ID=92b4492806a34cf0b89a5be6ce947d00 IRM_ACCEPTANCE_JOURNAL=/tmp/etudsup-b3-b2-pg-92b4492806a34cf0b89a5be6ce947d00.jsonl timeout 120s .venv/bin/python -m pytest tests/services/test_programme_foundation_pg.py -q --tb=short
IRM_ACCEPTANCE_RUN_ID=6c2a82bbb8ce4a2ea3f1b07e20d7958d IRM_ACCEPTANCE_JOURNAL=/tmp/etudsup-b3-pg-6c2a82bbb8ce4a2ea3f1b07e20d7958d.jsonl timeout 120s .venv/bin/python -m pytest tests/services/test_multi_community_memberships_pg.py -q --tb=short
```

| Check | Result |
|---|---|
| `.venv/bin/alembic heads` and `.venv/bin/alembic history --verbose` | One current head, `e4b6c8d0f219`; parent is actual B2 head `d9a1f3c7b205`. |
| `.venv/bin/alembic upgrade d9a1f3c7b205:e4b6c8d0f219 --sql` | Passed. Generated transactional SQL contains only `DROP INDEX uq_memberships_global_active_pending` plus the Alembic version update. No database connection was made. |
| SQLite/API membership regression group: `test_multi_community_memberships_sqlite.py`, memberships, applications, review, withdrawal, membership management, member directory, delegate member management, provisioning, membership error mapping, acceptance isolation; `-k 'not postgresql'` | 256 passed, 41 PostgreSQL-parametrized cases deselected. This includes two-community endpoint responses, target-scoped private details/directory, bans, reapplication, moderator grants, same-community conflicts, and retained per-community Delegate uniqueness. |
| Programme/API compatibility group: `test_programme_foundation_sqlite.py`, `test_programme_api_compatibility.py`, modules, membership/me, acceptance isolation, and dependency authorization | 74 passed. |
| Focused rerun: SQLite membership migration, membership lifecycle, review, provisioning, and error mapping | 53 passed. After the final two-community directory and member-gated A/B access assertions were added, each affected API test was rerun: 1 passed each. |
| B2 guarded PostgreSQL test, `tests/services/test_programme_foundation_pg.py` | Attempted first as requested; 2 failures before schema creation. The guard's approved `irm_integration_test` / `irm_test` loopback connection returned `psycopg.OperationalError: connection is bad: no error details available`. No identity was returned and no schema was created. |
| B3 guarded PostgreSQL test, `tests/services/test_multi_community_memberships_pg.py` | Attempted after B2; 1 migration test failed and 3 concurrency tests errored at the same guard connection step, before schema creation. No identity was returned and no schema was created. |

SQLite is only a model and service/API check; it does not validate PostgreSQL DDL, PostgreSQL partial-index enforcement, transaction rollback, or row-lock concurrency. Those B2 and B3 PostgreSQL checks remain release gates. The repository's legacy `tests/test_pg_concurrency.py` was not run because its fixture directly truncates a fixed database rather than using the guarded disposable-schema helper. No owner/production database was queried or modified, and no migration was run against a live database.

## Handoff

B3 completes the membership lifecycle and global index retirement. The next phase may build on per-community memberships, but must remain separate: Programme-level module/document ownership, annual review state, public community discovery, and frontend community switching have not started here.
