# EtudSup P3.1 — own-account password change backend

**Acceptance: PARTIAL.** The actual ASGI route and focused SQLite API/auth/session regressions pass with the P1.3 test-process heartbeat accommodation. Guarded PostgreSQL setup was attempted once and could not connect from this agent environment, so the database race tests have not executed. No production-readiness claim follows from the SQLite results.

## Inspected behavior and changed files

Before editing, `git status --short --untracked-files=all` showed extensive existing backend, frontend, docs and test work. It was preserved. I read the P1.1 audit, P1.2 backend handoff and P1.3 acceptance report and checked current `backend/app/models/user.py`, `models/session.py`, `schemas/user.py`, `core/security.py`, `core/sessions.py`, `services/auth.py`, `services/user.py`, `api/deps.py`, `api/account_mutation_route.py`, `api/v1/endpoints/auth.py`, discussion WebSocket code, existing auth/profile/session tests and guarded acceptance fixtures/runner.

Existing registration accepts passwords of at least eight Unicode code points; login requires at least one. There is no complexity rule or password maximum. `hash_password` uses argon2-cffi's `PasswordHasher` (Argon2id) and `verify_password` treats malformed hashes as failures. Neither helper transforms input. User stores a hash in `users.password_hash`; `UserResponse` never returns it. The new mutation uses exactly those helpers and the existing eight-code-point minimum. The route-wide 16 KiB **encoded JSON body** limit bounds both submitted passwords, including legacy current passwords, without truncation. A separate 1024-byte maximum proposed in P1.1 was not adopted because it would diverge from registration in this task.

Sessions are database rows with a SHA-256 token hash, User UUID, expiration and revocation boolean. Login sets a host-only, HttpOnly, SameSite=Lax cookie at path `/`, with `Secure` controlled by settings. Default lifetime is seven days. Logout revokes only the presented valid session and expires that cookie. `validate_session` rejects missing, revoked and expired rows. Before this task, login hash verification and session issuance lacked a shared User lock, allowing an old-password login to issue a new session after a concurrent password change's revoke-all operation.

| File | P3.1 change |
| --- | --- |
| `backend/app/schemas/user.py` | Strict required `UserPasswordChange` with forbidden extras; no secret normalization. |
| `backend/app/api/v1/endpoints/auth.py` | `POST /me/password`, returning 204 and expiring the session cookie only after commit. |
| `backend/app/services/password.py` | Locked, fresh account/session verification; one transaction for hash replacement and all-account session revocation; rollback on every failure. |
| `backend/app/core/sessions.py` | Optional fresh/locked session lookup used by the password transaction; existing callers retain prior behavior. |
| `backend/app/services/auth.py` | Login locks and refreshes the User row through session issuance's commit. External login request/response remains the same. |
| `backend/tests/api/v1/test_password_change.py` | Isolated actual-route behavior, validation, protection, rollback and unchanged account/application tests. |
| `backend/tests/services/test_password_change_pg.py` | Guarded concurrency, login race and transaction rollback tests, pending PostgreSQL execution. |
| `backend/acceptance/profile.py` | Additional exact `password-api`, `password-postgresql`, `password-all` suite selectors; existing selectors unchanged. |
| `docs/etudsup-p3-1-password-change-backend.md` | This handoff. |

No migration, dependency, environment, frontend or global CORS change was made.

## API contract

`POST /api/v1/auth/me/password` requires the established session cookie and one exact trusted `Origin`. Send `Content-Type: application/json` and a JSON object containing only two required, non-null strict strings:

```json
{"current_password":"Example-old-pass!","new_password":"Example-new-pass!"}
```

`current_password` must contain at least one character; `new_password` at least eight. Spaces, case and Unicode code points are significant and never trimmed, folded or normalized. No maximum password field length was introduced; the entire encoded body must fit 16 KiB. The User UUID comes only from the authenticated session. Membership status is irrelevant. On confirmed success the response is **204 with no body**, `Cache-Control: private, no-store`, and a `Set-Cookie` that expires the existing cookie with matching path, HttpOnly, SameSite and configured Secure attributes. All old account sessions, including the caller's, become invalid. Sign in again using the new password; no replacement session is created.

| Status | Response / meaning |
| --- | --- |
| 400 | `{"detail":"Current password is incorrect."}` for failed current verification; malformed body parsing or Content-Length uses the established generic 400 response. |
| 401 | `{"detail":"Not authenticated"}` for missing, invalid, expired, revoked or no-longer-owned session. |
| 403 | `{"detail":"Untrusted request origin"}`. |
| 413 | `{"detail":"Request body too large"}` for declared or streamed body over 16 KiB. |
| 415 | `{"detail":"Content-Type must be application/json"}`. |
| 422 | Schema errors are a `detail` array with only `loc`, `type`, `msg`. Matching old/new secrets produce `[{"loc":["body","new_password"],"type":"password_unchanged","msg":"New password must differ from the current password"}]`. |
| 500 | `{"detail":"Account operation failed"}` for unexpected operation failure. |

The `AccountMutationRoute` applies `private, no-store` to success and every error, including validation and unexpected failures. It checks exactly one raw trusted Origin, then media type, declared/streamed body size, session preflight, FastAPI body validation and normal dependency revalidation in that order. A guest with malformed JSON receives 401 after the earlier Origin/media/size checks. It strips submitted `input` and validator context from 422 responses. It does not expose request bodies, passwords, hashes, tokens, SQL or driver errors; no password-bearing logging was added. CORS is not the server-side mutation guard.

## Atomicity, concurrency and access effects

The service refreshes and locks the session-derived User row, then refreshes and locks the initiating Session row to reject a stale dependency result. It verifies the current password against the locked current hash and rejects an identical new string. It hashes the new password, bulk-revokes **only rows with that User UUID**, and commits both writes together. Every exception rolls back. Cookie expiry happens only after service success; a failed request does not clear it. Profile fields, email, membership/application rows, permissions and author/uploader UUIDs are never assigned by this service. User `updated_at` may advance because the password hash changes.

The login correction uses the same User-first lock ordering: `authenticate_user` refreshes and locks the User, verifies its current hash, and `create_session` commits issuance while that lock is still held. An old-password login committed first is included in password revocation; a login waiting behind password change reads the new hash and fails. Concurrent password changes serialize, and the second request must recheck its revoked initiating session. These claims follow from PostgreSQL row-lock semantics and code inspection; guarded runtime race acceptance remains outstanding below.

Discussion WebSockets use the same `validate_session` revocation flag. Their separate short-lived DB check runs every **30 seconds**, plus scheduling/database delay. Old sockets can still receive events until their next check; there is no instant server broadcast. Existing revalidation does not fail closed on a DB exception, so bounded closure during a DB failure is not established here. This task did not redesign sockets. The initiating frontend should close its socket on confirmed success. No account rate limiter exists in the inspected backend; the P1.1 recommended throttle remains a separate security decision, and this report does not claim a deployed aggregate attempt budget.

## Verification and PostgreSQL gap

Executed with `timeout 180s .venv/bin/python -m acceptance.profile --suite password-api --heartbeat` from `backend`: **113 passed, 0 failed** (24 password API, 62 profile API, 13 auth API, 2 auth/me API, 7 session core, 5 security core). The heartbeat is the P1.3 **test-process-only** Python 3.14/AnyIO accommodation; production handlers/event loops were unchanged. Tests exercised actual ASGI routing and synchronous DB work, including session preflight, strict fields, private errors, exact whitespace/Unicode passwords, no-membership and banned-community access, two unchanged applications, another account's session, all-own-session revocation, cookie attributes, old/new login, rollback, and a revoked session between dependency and service. Profile-route regressions also checked the shared Origin/media/body wrapper. Evidence: `/tmp/irm-profile-evidence-.../profile-result.json` printed by the runner for each run; the final successful run is recorded in the runner output.

Executed once with `timeout 45s .venv/bin/python -m acceptance.profile --suite password-postgresql --heartbeat`: setup returned **exit 2, `OperationalError` before test execution or schema creation**. Evidence: `/tmp/irm-profile-evidence-dugntqup/profile-result.json` records no pytest status, zero tests, no outstanding owned schema and removed temporary storage. `tests/services/test_password_change_pg.py` therefore has **0 executed tests** here. Its concurrent-change case, both login/password race orderings, row locking, atomicity and rollback assertions require owner execution. Collection is not counted as acceptance.

Run this complete focused command in an interactive **fish** shell with the approved `irm_integration_test` / `irm_test` service at `127.0.0.1:5432`:

```fish
function etudsup_password_acceptance
    cd /home/yasso/irm-platform/backend; or return 2
    set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
    set -lx IRM_ACCEPTANCE_DB_PORT 5432
    set -lx IRM_ACCEPTANCE_RUN_ID (.venv/bin/python -c 'from uuid import uuid4; print(uuid4().hex)')
    test -n "$IRM_ACCEPTANCE_RUN_ID"; or return 2
    set -l password_metadata (mktemp -d /tmp/etudsup-password-owner-XXXXXXXX)
    test -d "$password_metadata"; or return 2
    set -lx IRM_ACCEPTANCE_JOURNAL "$password_metadata/leases.jsonl"
    read -s -P 'Approved irm_test integration password: ' password_secret; or return 2
    set -lx IRM_ACCEPTANCE_DB_PASSWORD "$password_secret"
    set -e password_secret
    # Exact API/core suites: test_password_change.py, test_profile_editing.py,
    # test_auth.py, test_auth_me.py, test_sessions.py, test_security.py.
    # Exact PostgreSQL suite: tests/services/test_password_change_pg.py.
    timeout -k 5s 180s .venv/bin/python -m acceptance.profile --suite password-all --heartbeat
    set -l password_run_status $status
    set -e IRM_ACCEPTANCE_DB_PASSWORD
    printf 'Password runner exit status: %s\nRun ID: %s\nJournal: %s\n' $password_run_status $IRM_ACCEPTANCE_RUN_ID $IRM_ACCEPTANCE_JOURNAL
    return $password_run_status
end
etudsup_password_acceptance
```

The guarded runner fixes database/role/port, creates a marked disposable schema, verifies server identity and exclusive search path, and drops only its owned schema on normal/handled interrupted cleanup. It uses temporary storage. It records per-suite counts, the immediate pytest exit status and cleanup in a printed `profile-result.json`. Do not substitute the development database on port 5433 or any owner/production target.

## Frontend integration handoff

The future Security form sends only `current_password` and `new_password` as JSON with credentials. Keep both inputs in component memory, never URLs, persistent browser storage, analytics or logs. Show field errors by sanitized `loc`; show the generic current-password 400 at the current-password field and the `password_unchanged` 422 at the new-password field. Disable duplicate submit while pending. Tell the user beforehand that all devices will be signed out.

After a **confirmed 204**, clear both password inputs and shared authenticated profile/membership state, close local discussion sockets, and navigate to Sign in with a truthful non-secret success message. The server already revoked all sessions and expired the cookie, so do not call logout again. A definitive 401 should clear stale auth state. On a network timeout/unknown outcome, neither success nor failure is established: preserve a neutral message, avoid automatic resubmission with the old credential, and direct the user to try signing in with the new password first, then the old password if needed. Never claim the password definitely changed or definitely stayed unchanged from a missing response.
