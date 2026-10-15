# ETUDSUP B1.1 — Live WebSocket close after password revocation

## Result

The owner-side password PostgreSQL run exposed a live lifecycle failure: 11 passed and 1 failed in `test_live_socket_closes_on_password_revocation_at_policy_interval`. The WebSocket client received no close frame after the password change revoked its session. The supplied server evidence reported `CancelledError` escaping the Discussion route while it awaited `receive_text()` and a broadcaster warning that socket close failed during cleanup.

The two supplied owner evidence files (`/tmp/irm-profile-evidence-em2w749h/profile-result.json` and `/tmp/etudsup-b1-9e2c2aac80844f129056c2ec86147fd9.jsonl`) were not present in this environment, so their detailed cleanup fields could not be independently inspected. This report treats the 11/1 outcome and server messages above as owner-provided evidence. The current environment's PostgreSQL preflight at `127.0.0.1:5432` returned `no response`, and neither `IRM_ACCEPTANCE_DB_PASSWORD` nor `PGPASSWORD` is configured.

## Root cause and correction

`discussion_websocket` owns the ASGI receiver task because it is blocked in `websocket.receive_text()`. Before B1.1, `close_and_cleanup` stored its initiating caller as `_cleanup_task`, cancelled sender/revalidation tasks, sent a close frame, and then cancelled and awaited the receiver immediately. The receiver's `finally` concurrently called `broadcaster.disconnect`. Thus cleanup explicitly terminated the route task that owns the ASGI receive lifecycle at the point the transport was closing; the route propagated `CancelledError`, and teardown could race the close send. The existing behavior was not a password revocation or policy-code defect.

B1.1 creates one shared cleanup task independent of the initiating caller. The initiating task is excluded from cancellation, other background tasks are stopped and awaited, and the queue is drained after marking the connection closed. After a successful close send, cleanup waits for the ASGI receiver to finish from the close-induced disconnect; it cancels the receiver only if there was no successful close send. Concurrent callers await the same cleanup operation through `asyncio.shield`, so genuine cancellation still propagates to a caller while cleanup and unregister continue. The route's `finally` can unregister without cancelling or awaiting the cleanup task, avoiding a cancellation cycle. Repeated calls still issue only one close, late enqueues are refused, and unregister is attempted from cleanup's `finally` path.

Confirmed session revocation still selects close code 1008. Revalidation exceptions/deadlines still select 1011 with a sanitized reason. The production revalidation interval remains 30 seconds. No password, membership, sticker or message contract changed.

## Exact B1.1 changes

- `backend/app/core/broadcaster.py` — independent shared cleanup task, caller cancellation shielding, and graceful receiver completion after a successful close send.
- `backend/tests/core/test_broadcaster_revocation_cleanup.py` — regression proving the ASGI receiver remains alive until the close-induced disconnect, plus caller-cancellation coverage.
- `docs/etudsup-s1-websocket-revalidation-fail-closed.md` — update to lifecycle behavior and B1.1 follow-up.
- `docs/etudsup-p3-3-password-security-acceptance.md` — record the owner-side failure and B1.1 acceptance status.
- `docs/etudsup-b1-1-live-websocket-close.md` — this report and guarded owner rerun.

No frontend, migration, dependency, password, membership, sticker or message implementation files changed. No staging, commit, push, deployment or service restart occurred.

## Executed verification

| Check | Result |
| --- | --- |
| `pytest tests/api/v1/test_discussion_ws_revalidation.py tests/core/test_broadcaster_revocation_cleanup.py -q --tb=short` | **12 passed.** Covers 1008/1011 fail-closed selection, operational errors/timeouts, external cancellation propagation, cleanup idempotence, queue accounting, close failure, unregister, receiver graceful completion and shared cleanup after caller cancellation. |
| `acceptance.profile --suite discussion-sticker-api --heartbeat` | **107 passed, 0 failed** (Discussion 38, content removal 59, sticker library 10); temporary storage removed. Evidence: `/tmp/irm-profile-evidence-16qq1deb/profile-result.json`. |
| PostgreSQL reachability preflight | `127.0.0.1:5432` returned **no response**. No guarded schema was created and no PostgreSQL suite was attempted from this environment. |

## Owner-side guarded rerun still required

Run from an interactive fish shell when the approved `irm_integration_test` database, `irm_test` role and loopback service are available. Each profile invocation creates its own fresh run ID and lease journal and uses the existing guard and temporary storage. The live test keeps the production 30-second interval and still requires a received 1008 frame.

```fish
cd /home/yasso/irm-platform/backend; or return 2
set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
set -lx IRM_ACCEPTANCE_DB_PORT 5432
read -s -P 'Approved irm_test integration password: ' db_password; or return 2
set -lx IRM_ACCEPTANCE_DB_PASSWORD $db_password
set -e db_password

function run_b1_guarded_suite --argument-names suite
    set -l run_id (./.venv/bin/python -c 'from uuid import uuid4; print(uuid4().hex)')
    test -n "$run_id"; or return 2
    set -lx IRM_ACCEPTANCE_RUN_ID $run_id
    set -lx IRM_ACCEPTANCE_JOURNAL "/tmp/etudsup-b1-1-$suite-$run_id.jsonl"
    ./.venv/bin/python -m acceptance.profile --suite $suite --heartbeat
    set -l result $status
    printf 'Suite %s exit status: %s; run ID: %s; journal: %s\n' $suite $result $run_id $IRM_ACCEPTANCE_JOURNAL
    return $result
end

run_b1_guarded_suite password-live-socket-postgresql
set -l live_status $status
run_b1_guarded_suite password-postgresql
set -l password_status $status
run_b1_guarded_suite discussion-websocket-postgresql
set -l discussion_status $status

set -e IRM_ACCEPTANCE_DB_PASSWORD
printf 'Live socket: %s; password PostgreSQL: %s; Discussion WebSocket PostgreSQL: %s\n' $live_status $password_status $discussion_status
```

Inspect each emitted `profile-result.json` and journal. Require `pytest_exit_status: 0`, the expected server identity, and cleanup reporting no outstanding owned schema / verified schema cleanup. If any stage fails before identity verification, report it as blocked with zero assertions; do not substitute another database or retry against a different target.

## Cleanup status

The local Discussion/sticker acceptance profile reports temporary storage removed. It did not create a database schema. The guarded PostgreSQL owner runs remain pending, so this environment has no owner schema or database lease to clean up. The supplied owner evidence paths were absent locally; no claim about their recorded schema cleanup is made here.
