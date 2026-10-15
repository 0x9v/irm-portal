# EtudSup P1.3 — profile backend acceptance

**Acceptance: PARTIAL.** The actual profile ASGI API and existing auth regressions pass with a test-process event-loop accommodation: **77 passed, 0 failed**. PostgreSQL acceptance is blocked before connecting/creating an owned schema, so PostgreSQL uniqueness races, row locks, and same-field ordering are not yet runtime-verified. SQLite service results and collection are not counted as API or PostgreSQL acceptance. This report does not establish production readiness.

## Scope and current-source review

Read P1.1/P1.2 and checked the current `AccountMutationRoute`, `UserProfileUpdate`, `update_user_profile`, auth route/dependency, session helpers, User/session/membership/permission/content models, content response routes/schemas, profile/auth tests, and guarded PostgreSQL resource/fixture implementation. Initial git status contained extensive modified/untracked work; that work and concurrent frontend files were preserved.

P1.3 changes are limited to:

| File | Change |
| --- | --- |
| `backend/app/api/account_mutation_route.py` | Strict raw Origin syntax and duplicate-header rejection; catch Starlette HTTP exceptions; reject negative declared body lengths |
| `backend/tests/api/v1/test_profile_editing.py` | Correct JSON-null and commit-failure tests; add Origin, session cleanup/revalidation, legacy/case/Unicode, body-boundary/encoding, ownership, actual author-response, and unrelated-integrity coverage |
| `backend/tests/services/test_user_profile_pg.py` | Assert loser retains all fields; bound PostgreSQL waits; add controlled row-lock/stale-state/same-field test |
| `backend/acceptance/profile.py` | New focused process-isolated runner, opt-in loop heartbeat, guarded disposable PostgreSQL setup/cleanup, exact per-suite counts and pytest status |
| `docs/etudsup-p1-3-profile-backend-acceptance.md` | This report |

No auth handler was changed to async. User schema/service, registration/email-login behavior, frontend, dependencies, environment files, deployment, and migrations were not changed in P1.3. Only the approved integration connection was attempted; no development database on port 5433 or owner/production database was used.

## Runtime execution and runner accommodation

Installed runtime: Python 3.14.7, FastAPI 0.141.1, Starlette 1.7.0, AnyIO 4.15.1, HTTPX 0.28.1, pytest 9.1.1, SQLAlchemy 2.1.1, psycopg 3.3.6. The project itself requires Python >=3.14; the observations do not justify calling Python 3.14 unsupported or claiming a proven dependency defect.

Bounded normal execution of `tests/api/v1/test_profile_editing.py` timed out after 12 seconds, exit 124, with no completed test result. A minimal synchronous FastAPI handler through `TestClient` also timed out after 10 seconds. Faulthandler showed the main thread waiting in AnyIO's portal while the portal loop slept in `selectors.select`. A separate minimal `anyio.to_thread.run_sync(lambda: 42)` timed out while its worker waited for more work and the event loop slept; ordinary `ThreadPoolExecutor` returned 42 successfully. These reproduce an environment-specific cross-thread loop-wakeup problem, not an application route failure; the underlying cause remains unproven.

The accommodation schedules a repeating 10 ms `call_later` heartbeat while an asyncio loop runs. The minimal synchronous FastAPI handler then returned successfully. `acceptance.profile --heartbeat` installs this only inside the test process and restores the original loop method afterward. It does **not** replace ASGI routing, `TestClient`, AnyIO's workers, synchronous endpoints/dependencies, session validation, SQLAlchemy, or assertions. The actual application middleware and route execute; synchronous database work continues through the real thread pool.

The runner sets application configuration in its own process before importing tests: explicit integration target settings, `ENVIRONMENT=test`, a known frontend Origin, and temporary storage. The API fixtures still use their isolated in-memory SQLite sessions and override both the dependency database factory and the profile preflight factory. No environment file is written. `--heartbeat` is opt-in; an unaccommodated normal test run has not passed in this agent environment.

Final API command, from `backend`:

```bash
timeout -k 3s 120s .venv/bin/python -m acceptance.profile --suite api --heartbeat
```

| Executed suite | Passed | Failed/errors |
| --- | ---: | ---: |
| `tests/api/v1/test_profile_editing.py` | 62 | 0 |
| `tests/api/v1/test_auth.py` | 13 | 0 |
| `tests/api/v1/test_auth_me.py` | 2 | 0 |
| **Actual API total** | **77** | **0** |

Final run: 13.30 seconds, pytest exit 0. Evidence: `/tmp/irm-profile-evidence-ipk8c6l2/profile-result.json`; run ID `752734a670f349e6b248c5b05732e06e`. The runner captures pytest's return immediately before cleanup and records per-file call results, setup/teardown errors, and cleanup. Temporary storage was removed.

Additional normal execution:

```bash
PYTHONPATH=. .venv/bin/python -m pytest -q tests/services/test_user_profile_sqlite.py tests/core/test_sessions.py tests/core/test_security.py tests/services/test_multi_community_memberships_sqlite.py
```

Result: **18 passed, 0 failed**, 1.59 seconds. These are separate service/core regressions, not API acceptance. Changed Python files compiled successfully. The three guarded PostgreSQL tests collected successfully; **collection is not execution**.

Scoped whitespace checks passed. Repository-wide `git diff --check` still reports pre-existing blank-at-EOF warnings in unrelated API/model/schema files; those files were preserved.

Intermediate executed failures and reruns:

| Actual API execution | Result |
| --- | --- |
| Initial heartbeat execution of original profile suite | 41 passed, 1 failed (JSON-null transport defect) |
| Corrected null/commit-injection tests plus auth suites | 57 passed |
| Added raw/duplicate Origin regressions, before route correction | 58 passed, 5 failed |
| Expanded cleanup/body tests, before Starlette exception correction | 72 passed, 1 failed (invalid encoding returned 500) |
| After encoding correction and expanded identity/error checks | 76 passed |
| Focused negative Content-Length reproduction | 1 failed, 61 deselected (401 instead of 400) |
| Final corrected API/auth suites | 77 passed |

## Defects reproduced and corrected

1. **JSON-null test sent no JSON.** HTTPX `json=None` generated no JSON body or Content-Type; the route correctly returned 415. The test now sends serialized `null` with `application/json`, retaining the expected 422 assertion for a non-object JSON value.
2. **Commit-failure test never reached commit.** The helper accepted `db_session`, while the endpoint called it with keyword `db`; its TypeError yielded a misleading passing 500 test. The helper now matches the real signature and records the `before_commit` callback. Runtime execution confirms the injected commit callback fires, the response is private/generic 500, and stored profile values remain unchanged.
3. **Raw malformed Origins were normalized into trusted ones.** Leading space, an embedded tab, and empty `?`/`#` delimiters passed `urlsplit`; duplicate Origin headers also allowed the first trusted value. Five actual API cases returned 401 instead of required 403. The wrapper now rejects raw whitespace/control/query/fragment syntax before URL parsing and requires exactly one Origin header. Corrected tests all pass; production mode also denies development origins while accepting the configured frontend.
4. **Invalid body encoding lost the intended client-error status.** FastAPI raised Starlette's base `HTTPException` for body parsing, while the wrapper caught only FastAPI's subclass, turning the request error into generic 500. Catching the Starlette base preserves 400 and private/no-store handling. The executed test confirms the raw body is absent from the response. FastAPI-derived authentication and route errors remain covered by the same base catch.
5. **Negative Content-Length bypassed the invalid-length check.** `int('-1')` reached authentication instead of returning 400 at the body-header check. Negative declared lengths now produce stable private 400 `Invalid Content-Length`. Streamed byte counting still independently enforces the size cap.

No ownership, Origin, strict-value, cache, error-sanitization, atomicity, or rollback assertion was weakened. An unrelated injected integrity failure is exercised separately and returns generic private 500, never username-conflict 409 or SQL/parameter details.

## Session, privacy, and identity results

The preflight checks the cookie's session validity and User existence, closes its short-lived database session in `finally`, then the normal authentication dependency revalidates the same cookie using the request database session. Only the dependency's User UUID reaches `update_user_profile`; request JSON cannot select an account. The service locks/refetches that UUID and assigns only supplied changed fields. Source inspection confirms no membership dependency or username-based target lookup.

Executed cases verify valid self-editing without memberships and with a banned membership; expired/revoked/missing-user sessions are denied. A session deliberately revoked between preflight and dependency is rejected with private 401 before any profile edit. Tracking tests confirm both database sessions close exactly once on success, and the preflight session closes on an injected validation/query failure before the dependency runs. No-op transactions finish when the request dependency closes; timestamps do not move.

Tests confirm omission preserves even invalid legacy values byte-for-byte, normalized identical values are no-ops, exact duplicate usernames roll back all supplied changes, and case/Unicode normalization forms stay distinct under SQLite. User UUID, email, password hash, creation time, every stored session field and count, both communities' submitted applications/status/role/timestamps, and permission values are unchanged. The same session can immediately GET the updated account identity.

Author/uploader UUIDs and literal content remain unchanged. Fresh **actual HTTP responses** for announcement detail/replies, post detail/replies, and discussion history expose the new current username. Existing serialized events or other clients' cached labels are not broadcast/replaced.

Success and exercised 400/401/403/409/413/415/422/500 errors carry `Cache-Control: private, no-store`. Validation errors contain only `loc`, `type`, `msg`; forbidden secret fields, malformed JSON, invalid encoding, and unusual unknown-field keys do not echo input/context/raw body. Exact 16 KiB JSON is accepted; a 16 KiB + 1 streamed body without Content-Length is rejected. Authentication, Origin, type, and body-validation precedence is exercised, not inferred from collection.

## Guarded PostgreSQL result and cleanup

Focused attempt, from `backend`:

```bash
timeout -k 3s 20s .venv/bin/python -m acceptance.profile --suite postgresql
```

Runner exit **2**; PostgreSQL setup blocked with `OperationalError`. Evidence: `/tmp/irm-profile-evidence-3ah3ql43/profile-result.json`, run ID `927faf735e254081853fc6b0ea4a5192`. `pytest_exit_status` is null and the test result map is empty: **zero PostgreSQL tests executed**, not three skipped/passed. The attempted target is exclusively `127.0.0.1:5432`, `irm_integration_test`, role `irm_test`; this environment did not establish the connection. The owner's reachable integration service may be outside the agent's network context; a service outage is not established.

No schema/lease was created: `OwnedDatabase.create()` failed before live identity verification, journaling, or CREATE SCHEMA. Resource cleanup reports no outstanding owned schema and temporary storage removed. No live row-lock, collation, race, or successful schema-drop evidence is claimed.

The focused PostgreSQL module now contains:

- Two independent users and sessions racing to one exact username: one success/one exact sanitized 409; winner names updated; loser username, names, email, password hash, creation/update times retained.
- Concurrent different-field partial patches: final first and family names both survive.
- A held User lock with a stale User loaded in a second session: instrumentation observes the service's `SELECT FOR UPDATE` dispatch and its blocked return until release. The first transaction commits its names; the contender changes the same first-name field afterward. Final first name is the later commit, and the omitted family name reflects the refreshed row. This verifies the intended last-committed-writer policy without adding an ETag/version contract.

Tests use the existing `isolated_pg` attached-schema fixture, guarded factories, independent connections, and PostgreSQL lock/statement timeouts. The focused runner creates a random marked schema through `OwnedDatabase`, journals ownership, and drops only that verified owned schema in `finally`. SIGTERM is handled so bounded runs can enter cleanup; cleanup failures return nonzero and retain evidence/journal. No legacy fixed-database truncation fixture is used. These assertions await execution on the approved integration service.

## Complete focused owner command (fish)

Run this single block in an interactive fish shell. Password entry is silent; variables are scoped to the function. A fresh run ID and protected journal directory are created for every invocation. The four exact suites are listed below; there is no broad regression stage.

```fish
function etudsup_profile_acceptance
    cd /home/yasso/irm-platform/backend; or return 2
    set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
    set -lx IRM_ACCEPTANCE_DB_PORT 5432
    set -lx IRM_ACCEPTANCE_RUN_ID (.venv/bin/python -c 'from uuid import uuid4; print(uuid4().hex)')
    test -n "$IRM_ACCEPTANCE_RUN_ID"; or return 2
    set -l profile_metadata (mktemp -d /tmp/etudsup-profile-owner-XXXXXXXX)
    test -d "$profile_metadata"; or return 2
    set -lx IRM_ACCEPTANCE_JOURNAL "$profile_metadata/leases.jsonl"
    read -s -P 'Approved irm_test integration password: ' profile_password; or return 2
    set -lx IRM_ACCEPTANCE_DB_PASSWORD "$profile_password"
    set -e profile_password
    # Exact suites: tests/api/v1/test_profile_editing.py
    # tests/api/v1/test_auth.py; tests/api/v1/test_auth_me.py
    # tests/services/test_user_profile_pg.py
    timeout -k 5s 180s .venv/bin/python -m acceptance.profile --suite all --heartbeat
    set -l profile_pytest_status $status
    set -e IRM_ACCEPTANCE_DB_PASSWORD
    printf 'Profile pytest/runner exit status: %s\nRun ID: %s\nJournal: %s\n' $profile_pytest_status $IRM_ACCEPTANCE_RUN_ID $IRM_ACCEPTANCE_JOURNAL
    return $profile_pytest_status
end
etudsup_profile_acceptance
```

The runner records the exact pytest return immediately before cleanup; its exit propagates pytest's status on a completed run. Setup blockage returns 2, cleanup failure returns 3, and the outer timeout returns 124 if it expires. Fish captures the command status on the immediately following line. The runner prints a persistent `profile-result.json` path with per-suite counts and cleanup evidence. `--suite all` establishes the guarded resource before collecting/running tests and uses temporary storage; API fixtures remain SQLite-isolated, and the PostgreSQL module uses only the marked disposable schema. The integration database/role are fixed by the guard and port 5432 is enforced. The runner also overrides `PGOPTIONS` to an exclusive test schema (or `pg_catalog` in API-only mode), so accidental default-factory use has no public-schema fallback. Do not substitute owner/production or development targets. The exact block above passed `fish -n` syntax validation; it has not been run against the owner's integration service here.

## Final frontend contract

`PATCH /api/v1/auth/me`, credentials included, trusted browser Origin, `Content-Type: application/json`; total encoded body at most 16 KiB. Send a JSON object containing only changed `username`, `first_name`, `family_name` keys, each a non-null strict string. Omitted fields retain stored bytes; `{}` is a successful no-op. Email, password, avatar, IDs, role, permissions, admin/status and application/membership fields are forbidden.

Raw text rejects `Cc`, `Cs`, `Zl`, `Zp` and U+202A–U+202E/U+2066–U+2069 before Python `str.strip()` boundary trimming. Lengths after trimming: username 3–50, names 1–100 Unicode code points. Internal spaces, punctuation, Arabic, accented/combining characters, exact case, and normalization form are preserved. Registration remains on its existing rules; no accounts are backfilled.

200 returns the existing allowlist: `id`, `username`, `email`, `first_name`, `family_name`, `created_at`, `updated_at`. Use returned normalized values as the saved baseline, refresh shared account identity, and retain the successful save if the refresh separately fails. Do not copy account names into community application state. Fresh author responses use the current username; identity broadcasts were not added.

| Status | Response behavior |
| --- | --- |
| 400 | `Invalid Content-Length` or generic `There was an error parsing the body` |
| 401 | `{"detail":"Not authenticated"}` |
| 403 | `{"detail":"Untrusted request origin"}` |
| 409 | `{"detail":"Username is already taken."}` |
| 413 | `{"detail":"Request body too large"}` |
| 415 | `{"detail":"Content-Type must be application/json"}` |
| 422 | `detail` array containing only `loc`, `type`, `msg`; handle fields by `loc`, not submitted-input echoes |
| 500 | `{"detail":"Account operation failed"}` |

An actual short-username error uses type `value_error` and message `Value error, Username must contain 3 to 50 characters` from the existing custom Pydantic validator. P1.2's illustrative `string_too_short` example was not the runtime type. Invalid JSON uses `json_invalid`; extra keys use `extra_forbidden`; wrong scalar types use `string_type`. All mutation responses are private/no-store.

Precedence remains: exactly one valid trusted Origin → media type → declared/streamed byte bounds → session preflight → JSON/schema parsing and normal session dependency → locked mutation. Thus untrusted malformed guest requests receive 403, wrong media 415, oversized bodies 413, bounded malformed JSON from guests 401, and authenticated malformed JSON 422. An authenticated malformed byte encoding receives private 400. Origin matching is by scheme/host/effective port after strict raw syntax checks; only configured frontend and environment-gated development/test origins are trusted.

## Remaining limits

PostgreSQL execution/cleanup and unaccommodated normal TestClient execution remain unresolved. SQLite exact-case behavior is exercised; real PostgreSQL equality/collation and transaction concurrency remain pending. In-process ASGI acceptance does not certify a deployed reverse proxy, browser UI, or production configuration. Rollback evidence covers constraint and injected pre-commit failures; a connection failure after a database commit can leave the client uncertain whether a save completed, as with other transactional APIs. No claim is made that a later response/refresh failure can undo an already committed transaction.
