# EtudSup P3.3 — password and session concurrency acceptance

**Acceptance: PARTIAL.** Focused API/security regressions pass, including actual ASGI route execution under the established test-process heartbeat. The single guarded PostgreSQL attempt failed before server identity verification and before any disposable schema or database assertion. Password/login/profile races and the live 30-second WebSocket closure therefore remain **unaccepted**.

## Scope and changed files

I read the [P1.3 profile acceptance](etudsup-p1-3-profile-backend-acceptance.md) and [P3.1 password handoff](etudsup-p3-1-password-change-backend.md), inspected `git status --short --untracked-files=all`, and preserved the concurrent backend/frontend work. I rechecked the current endpoint, password/auth/profile services, session helpers, route wrapper, DB lifecycle, discussion authorization/revalidation, guarded runner and tests. P3.3 changed only:

| File | Change |
| --- | --- |
| `backend/tests/api/v1/test_password_change.py` | Actual WebSocket authorization-boundary check before and after a password change. |
| `backend/tests/services/test_password_change_pg.py` | Controlled profile/password races in both lock orders, revoked initiating-session check, fresh new-password login, other-account session assertion, and guarded owned-server socket test at the real 30-second interval. The `test_server` helper import was aliased after collection showed pytest treating its name as an unintended test. |
| `backend/acceptance/profile.py` | The existing `password-postgresql` / `password-all` selectors now include the focused PostgreSQL profile-row-lock regression module alongside password concurrency. |
| `docs/etudsup-p3-3-password-security-acceptance.md` | This evidence and owner handoff. |

No application implementation defect was reproduced, so no production handler/service/model was changed. No migration, dependency, frontend, environment or deployment file was edited for P3.3.

## Transaction and lock-order findings

| Path | Transaction, lock and release |
| --- | --- |
| Login | The sole production caller of `authenticate_user` is `POST /api/v1/auth/login`. It queries the email-matched User with `populate_existing().with_for_update()`, verifies the current Argon2 hash while holding that User lock, then calls `create_session` in the **same SQLAlchemy Session**. `create_session` inserts the token-hash row and commits, releasing the User lock. It refreshes the created Session afterward; response serialization may start a read transaction, which the request-scoped `get_db` finalizer closes. Unknown email/wrong password raises 401 without a commit; `get_db` closes and rolls back the open transaction/lock. An issuance exception likewise leaves no cookie (cookie setting follows issuance) and closure rolls back uncommitted work. No extra login commit was introduced. |
| Password change | `AccountMutationRoute` uses a separate short-lived preflight DB Session and always closes it. The normal `get_current_user` dependency reads the session and User, then `change_password` reselects the session-derived User with a fresh `FOR UPDATE`, followed by fresh `FOR UPDATE` of the initiating Session. This **User → Session** order precedes current-hash verification, hash replacement, bulk revocation of that User's sessions and one commit. Every service exception rolls back. Cookie expiry occurs only after confirmed service success. |
| Profile edit | The same dependency resolves the User. `update_user_profile` locks/refetches that User with `FOR UPDATE`, assigns only supplied changed profile fields, then commits; omitted fields and password hash are not assigned. A no-op returns without commit and the request finalizer closes/rolls back the read transaction and releases any lock. Exceptions roll back. |
| Logout | `validate_session` reads the presented Session; `revoke_session` marks only that row revoked and commits. Logout does not acquire a User lock. It has no reverse Session → User lock dependency, so the inspected paths do not form a User/Session lock cycle. A password change's locked fresh initiating-session check rejects a prior logout; a later logout is idempotent on the already-revoked row. Request closure releases transactions on failure. |
| WebSocket | `check_ws_auth` opens/closes a fresh DB Session on each check and calls the same `validate_session`. The periodic loop waits 30 seconds between checks. It is not a per-message session check. |

`create_session` has one production caller, the login endpoint. Its many other references are test setup helpers. `authenticate_user` has one production caller and is used directly by the guarded race tests. The row-lock argument depends on PostgreSQL's real `SELECT ... FOR UPDATE` and fresh statement visibility; SQLite does not accept that concurrency claim. Existing profile and login external JSON/cookie contracts are unchanged.

## Required scenarios and current evidence

| Case | Focused coverage | Result |
| --- | --- | --- |
| A. Old-password login commits before change | PG test holds login after verification, issues its session, then waits for password change; final token must be revoked. | **Pending PG execution.** Static lock order supports it, but no database assertion ran. |
| B. Password change commits before waiting old-password login | PG test pauses hashing while the User lock is held, observes login's `FOR UPDATE` dispatch, releases change, then requires login 401 and no issued token. | **Pending PG execution.** |
| C. Two simultaneous changes | Independent PG sessions start through a barrier with different valid tokens, require exactly one success and one 401, final new hash, both tokens revoked, unrelated account token still valid. | **Pending PG execution.** |
| D. Fresh login with new password | Actual API test succeeds with the new password, rejects the old, and checks all prior tokens invalid. PG test also requires a fresh usable token after change. | **Passed in accommodated SQLite ASGI; pending PG execution.** |
| E. Profile/password race | Two PG tests hold the User lock in opposite orders, observe the contender's `FOR UPDATE`, enforce bounded waits, then require both edits/new hash, unchanged omitted fields, UUID/email and two application snapshots. | **Pending PG execution.** No deadlock-free runtime conclusion yet. |
| F. Initiating token revoked after dependency resolution | Actual API test revokes between dependency and service and gets private 401 with old hash retained. PG test caches the dependency-observed Session, revokes from another connection, then calls the service and requires 401. | **Passed in accommodated SQLite ASGI; pending PG execution.** |

The guarded tests use `isolated_pg.factory` (independent NullPool connections), `SET LOCAL lock_timeout = '5s'`, `statement_timeout = '12s'`, `Event`/barrier ordering and bounded future joins. They do not use sleeps as the proof of row-lock order. A separate actual socket test uses the runner-owned server and an ACTIVE membership; it opens a WebSocket before password change, posts the real endpoint, checks immediate authorization-boundary denial, then waits up to 50 seconds for policy close code 1008 with the configured 30-second interval unchanged. **It has not executed.**

## Atomicity and security regression results

The existing actual-route tests verify 204 with an empty body; matching expired cookie attributes; no replacement token; all existing account sessions revoked; another User's session left active; wrong-current/identical/invalid input changing neither hash nor sessions; an injected `before_commit` failure rolling back both; and no cookie expiry on failure. They also cover exact whitespace/Unicode passwords, strict field allowlist, sanitized secret-free 400/422/500 responses, private/no-store on success/errors, Origin/media/declared-and-streamed body limits, and unchanged profile plus submitted applications in two communities. The P1.3 profile suite still verifies its own membership/application preservation and mutation protections. These are SQLite/ASGI observations, not PostgreSQL atomicity evidence.

The password service neither trims nor normalizes submitted secrets. Registration's established minimum is eight Unicode code points, and this mutation retains it; the entire JSON body is bounded at 16 KiB without truncation. Login remains email/password in and `UserResponse` plus database-backed HttpOnly cookie out. The scoped `AccountMutationRoute` remains unchanged. No raw password, hash, token, SQL or submitted validation input is returned by the new route or logged by this task.

## Executed commands and runtime separation

| Command / scope | Actual result |
| --- | --- |
| `timeout -k 5s 180s .venv/bin/python -m acceptance.profile --suite password-api --heartbeat` | **114 passed, 0 failed**, actual ASGI/synchronous DB work under P1.3's test-process-only Python 3.14/AnyIO heartbeat: 25 password API, 62 profile API, 13 auth API, 2 auth/me API, 7 session core, 5 security core. Evidence: `/tmp/irm-profile-evidence-dr4pd87l/profile-result.json` (`pytest_exit_status: 0`, temporary storage removed). |
| `timeout 60s .venv/bin/python -m pytest tests/core/test_sessions.py tests/core/test_security.py -q --tb=short` | **12 passed** under normal execution, without heartbeat. These overlap the 114; do not add them to a unique-test total. |
| `timeout -k 2s 15s .venv/bin/python -m pytest tests/api/v1/test_password_change.py::test_success_revokes_only_own_sessions_clears_cookie_and_requires_new_login -q --tb=short -o faulthandler_timeout=5` | **Exit 124, 0 API assertions executed.** The normal TestClient stalled during its AnyIO/Starlette portal setup; faulthandler showed the asyncio portal in `selectors.select` and the main thread awaiting `TestClient.__enter__`. This reproduces P1.3's runner problem, not an endpoint failure. No production loop/handler change was made. |
| `timeout -k 5s 240s .venv/bin/python -m acceptance.profile --suite password-postgresql --heartbeat` | **Exit 2, `OperationalError` during guarded setup; 0 tests/DB assertions.** `/tmp/irm-profile-evidence-dcvp4i5j/profile-result.json` has no pytest status, no server identity or schema; cleanup records “no outstanding owned schema” and temporary storage removed. One attempt only; no target change or retry. |
| `.venv/bin/python -m pytest tests/services/test_password_change_pg.py tests/services/test_user_profile_pg.py --collect-only -q` | **12 collected, 0 executed** (9 password PG including live socket, 3 profile PG). Collection verified importability after aliasing the owned-server helper, but is not acceptance. |

The PostgreSQL attempt was made before adding the final unrelated-account assertion and including `test_user_profile_pg.py` in the password runner selector. Since setup never reached identity verification, none of those assertions executed in either version. The final owner command below targets the current exact suites. There is no PostgreSQL server identity or owned-schema drop to report from this environment.

## WebSocket limits and uncertain client outcomes

The accommodated authorization-boundary test passed: `check_ws_auth` grants a live ACTIVE-member token before the password change and rejects the same token afterward with `Invalid or expired session`. The discussion loop uses a new short-lived DB Session every 30 seconds and then calls `close_and_cleanup`, which closes with policy code 1008. The owner-side B1.1 PostgreSQL run later executed the password suite and reported 11 passed, 1 failed: its live revocation case received no close frame. B1.1 corrected the shared cleanup/ASGI receiver lifecycle; its deterministic tests pass, while guarded owner reruns remain pending because the integration PostgreSQL endpoint is unreachable in the current environment. Even after live closure passes, the policy permits delivery between commit and the next check. S1 separately covers database/authorization exceptions by closing with 1011.

A client that loses the response after the commit cannot infer whether the password changed or remained old. A completed commit is not undone by a later network failure. The frontend should present an uncertain outcome, avoid automatic retry, and guide a fresh login attempt with the new password before considering the old one. A confirmed 204 means the server committed the change and expired the caller cookie.

## Focused owner command and remaining gates

Run this complete command in an interactive **fish** shell against only the approved `irm_integration_test` database, `irm_test` role and `127.0.0.1:5432` integration service:

```fish
function etudsup_password_concurrency_acceptance
    cd /home/yasso/irm-platform/backend; or return 2
    set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
    set -lx IRM_ACCEPTANCE_DB_PORT 5432
    set -lx IRM_ACCEPTANCE_RUN_ID (.venv/bin/python -c 'from uuid import uuid4; print(uuid4().hex)')
    test -n "$IRM_ACCEPTANCE_RUN_ID"; or return 2
    set -l password_metadata (mktemp -d /tmp/etudsup-password-concurrency-XXXXXXXX)
    test -d "$password_metadata"; or return 2
    set -lx IRM_ACCEPTANCE_JOURNAL "$password_metadata/leases.jsonl"
    read -s -P 'Approved irm_test integration password: ' password_secret; or return 2
    set -lx IRM_ACCEPTANCE_DB_PASSWORD "$password_secret"
    set -e password_secret
    # Exact SQLite ASGI/core suites: test_password_change.py, test_profile_editing.py,
    # test_auth.py, test_auth_me.py, test_sessions.py, test_security.py.
    # Exact guarded PostgreSQL suites: test_password_change_pg.py, test_user_profile_pg.py.
    timeout -k 5s 300s .venv/bin/python -m acceptance.profile --suite password-all --heartbeat
    set -l password_run_status $status
    set -e IRM_ACCEPTANCE_DB_PASSWORD
    printf 'Password runner exit status: %s\nRun ID: %s\nJournal: %s\n' $password_run_status $IRM_ACCEPTANCE_RUN_ID $IRM_ACCEPTANCE_JOURNAL
    return $password_run_status
end
etudsup_password_concurrency_acceptance
```

The runner enforces the fixed loopback integration target and port, creates a fresh marked disposable schema with lease journal, verifies database identity/search path/ownership, uses temporary storage, and drops only its verified owned schema in `finally` (including handled SIGTERM). It prints a `profile-result.json` path recording each suite's counts, the pytest exit captured immediately after execution, server identity if reached, and cleanup. Exit 2 means setup blocked; exit 3 means cleanup failed; outer timeout returns 124. Never use fixed-database truncation fixtures or the development database on port 5433.

Release gates: execute the 12 collected PostgreSQL tests successfully under the guard, inspect the runner's identity and verified-drop evidence, and resolve any **reproduced** race or socket failure without weakening the assertions. Only then can PostgreSQL concurrency and live-network revocation be marked accepted. The normal TestClient portal stall is separately documented; the 114 accommodated tests are real route executions, not mere collection.
