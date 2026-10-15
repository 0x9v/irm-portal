# EtudSup B4.1 — PostgreSQL acceptance and historical fixtures

## Status

The historical-fixture defect reported by the owner is corrected in the B2 PostgreSQL tests. PostgreSQL acceptance remains pending: this agent cannot connect to the approved integration endpoint. The fresh B2 attempt failed while opening the guarded admin connection, before server identity verification, journal append, or schema creation. B3 and B4 were not run after that connection failure.

No application defect was demonstrated. No assertions, identity checks, cleanup guards, or migration transitions were weakened. No frontend or application files were edited.

## Worktree and migration chain

The worktree already contained extensive modified and untracked work, including frontend changes; it was preserved. The only task edits are `backend/tests/services/test_programme_foundation_pg.py` and this report.

`cd backend && .venv/bin/alembic heads` reports the sole code head as `f4b8c1d2e390`. The focused chain is:

```text
c7e4a9d213f6 (pre-B2)
  → d9a1f3c7b205 (B2: Programme foundation)
  → e4b6c8d0f219 (B3: community-scoped membership lifecycle)
  → f4b8c1d2e390 (B4: Module–Programme linkage; sole head)
```

## Owner-reproduced fixture defect and correction

The owner reported B2 failures at `test_programme_foundation_pg.py:61` and `:249`: after migrating only to `c7e4a9d213f6`, the tests constructed current `Community` ORM objects. The current ORM includes `communities.programme_id`, which does not exist at that predecessor. The B2 preservation fixture also constructed a current `Module`; current `Module` includes the B4-only `modules.programme_id` column, so correcting Community alone would uncover another historical-schema failure.

The B2 fixture now reflects fresh Core `communities` and `modules` tables after reaching the exact predecessor and inserts only columns present there, with explicit fixture IDs and timestamps. B2 migration assertions continue to check the same preservation data. After migration, the test closes its predecessor Session, obtains a fresh `modules` reflection (B2 does not yet add `modules.programme_id`), and uses a new Session for ORM reads only on models compatible with B2. Fresh inspectors are created after migration and downgrade.

The B2 fixture's other ORM inserts (User, Membership, permission, Document, vote, save, reading record, announcement, post, discussion, and dependent rows) use fields already present at `c7e4a9d213f6`; none maps a column introduced by B2, B3, or B4.

Audit of the remaining pre-migration fixtures:

- B3 starts from `d9a1f3c7b205`, after B2 has added `Community.programme_id`; its current Community, User, and Membership ORM inserts use columns available at that revision. It inserts no Modules.
- B4 starts from `e4b6c8d0f219`, after `Community.programme_id` exists. Its historical Module rows already use parameterized SQL containing only predecessor columns; current Module ORM queries occur only after upgrading to B4. Its downgrade fixture likewise inserts pre-B4 Modules through legacy-column SQL.

These tests preserve the original predecessor-to-revision transitions; none upgrades early, stamps, or adds columns by hand.

## Guarded PostgreSQL results

The approved target is `127.0.0.1:5432`, database `irm_integration_test`, role `irm_test`. The agent environment has no `IRM_ACCEPTANCE_DB_PASSWORD` set. One fresh guarded B2 run was attempted with run ID `7308bbc69451469390b77a1ebed0c487` and journal path `/tmp/etudsup-fixture-fix-7308bbc69451469390b77a1ebed0c487.jsonl`:

| Suite | Result | Evidence |
|---|---|---|
| B2 `test_programme_foundation_pg.py` | 2 failures before fixture execution | Guarded admin connection raised `psycopg.OperationalError: connection is bad: no error details available`; no database identity was returned. The helper appends to the journal only after identity succeeds, so this run did not create a schema. |
| B3 `test_multi_community_memberships_pg.py` | Not run | Stopped after B2 confirmed endpoint access is blocked. |
| B4 `test_programme_module_linkage_pg.py` | Not run | Stopped after B2 confirmed endpoint access is blocked. |

The owner-supplied failed run journal `/tmp/etudsup-pg-204b5782e1bd45d2ba57320ec1810fbd.jsonl` exists and contains two lease records for `irm_acceptance_4c38b6a05c254379805884eb8142cba3` and `irm_acceptance_dc11cb499adf434b9132f44ae94fe97f`. The journal records intended ownership but does not prove either schema was removed. This environment cannot connect to the integration database to verify those schemas or markers. Neither schema was manually dropped or otherwise touched.

## Local verification

Commands run from `backend`:

```text
.venv/bin/python -m pytest tests/acceptance/test_isolation.py -q --tb=short
53 passed in 1.19s

.venv/bin/python -m py_compile tests/services/test_programme_foundation_pg.py tests/services/test_multi_community_memberships_pg.py tests/services/test_programme_module_linkage_pg.py
passed

.venv/bin/python -m pytest --collect-only -q tests/services/test_programme_foundation_pg.py tests/services/test_multi_community_memberships_pg.py tests/services/test_programme_module_linkage_pg.py
8 tests collected

.venv/bin/alembic heads
f4b8c1d2e390 (head)
```

The 53 isolation tests are guard tests using fakes; they are not PostgreSQL acceptance evidence. No test was switched to SQLite as a substitute.

## Owner-run PostgreSQL command

After making the approved integration endpoint reachable on the owner machine, run this fish command. It prompts without echoing the password, uses the exact approved loopback/database/role target through the guarded helper, creates a fresh run ID and private journal, and runs B2, B3, then B4 in order. It stops after the first failure. Each suite's fixture owns and cleans only its verified disposable schemas.

```fish
cd /home/yasso/irm-platform/backend
set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
set -lx IRM_ACCEPTANCE_DB_PORT 5432
set -lx IRM_ACCEPTANCE_RUN_ID (.venv/bin/python -c 'import uuid; print(uuid.uuid4().hex)')
set -lx IRM_ACCEPTANCE_JOURNAL "/tmp/etudsup-b4-1-$IRM_ACCEPTANCE_RUN_ID.jsonl"
read --silent --prompt-str 'Approved irm_test password: ' IRM_ACCEPTANCE_DB_PASSWORD
echo
set -lx IRM_ACCEPTANCE_DB_PASSWORD "$IRM_ACCEPTANCE_DB_PASSWORD"
set suite_status 0
for suite in tests/services/test_programme_foundation_pg.py tests/services/test_multi_community_memberships_pg.py tests/services/test_programme_module_linkage_pg.py
    .venv/bin/python -m pytest "$suite" -q --tb=short
    set result $status
    if test $result -ne 0
        set suite_status $result
        break
    end
end
set -e IRM_ACCEPTANCE_DB_PASSWORD
test $suite_status -eq 0
```

If any suite fails after creating a lease, preserve its journal. Check the reported lease/schema against the live approved database identity and ownership marker with the acceptance recovery helper; do not manually drop an unverified schema. Report the three suite results separately and include cleanup evidence from the journals.

## Remaining gate

The code fixture correction is locally verified, but all three migration suites still require a successful owner-side PostgreSQL run. Real migration parity, row preservation, concurrency behavior, downgrade preflights, and cleanup for the supplied two-schema journal remain unverified here.
