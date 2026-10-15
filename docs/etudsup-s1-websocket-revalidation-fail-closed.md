# ETUDSUP S1 — Discussion WebSocket revalidation fail-closed

## Finding and correction

No standalone S1 correction/report existed in the current tree. The security issue was present in `discussion_websocket`: its 30-second loop awaited `check_ws_auth` in a worker, but only handled `CancelledError`. A database/authorization exception ended that task while its accepted socket remained registered and continued accepting broadcaster enqueues. No later authorization check was scheduled.

Periodic revalidation now closes on either result:

- **Confirmed expired/revoked session or inactive/missing membership:** existing policy close `1008`, with the generic reason `Session expired or membership revoked`.
- **Authorization check exception or 10-second wait deadline:** fail closed with `1011` and the generic reason `Authorization check unavailable`. The connection is marked closed before awaits, so later enqueues are refused; queued payloads are drained and the connection is unregistered.

The configured revalidation interval remains `WS_REVALIDATION_INTERVAL_SECONDS` (30 seconds in the current source). There is no raw exception detail, SQL text, credential, cookie, token, or message text in the new authorization-failure log or close reason. The receiver/sender error logs were also changed to generic messages.

## Cleanup and timing limits

The `Connection.close_and_cleanup` path is shared and idempotent. It marks the connection closed before awaiting, drains the queue with matching `task_done` accounting, and rejects later enqueues. Cleanup runs in its own task, so cancelling a caller propagates to that caller while the one close/unregister operation continues. It cancels and awaits the sender and non-initiating revalidation task, then sends the selected close frame. After a successful ASGI close send, it lets the route-owned receiver finish from the resulting disconnect; it cancels the receiver only when no close frame was sent. The route's final disconnect does not cancel the active cleanup task. Queue cleanup and unregister are still attempted in `finally`, transport close failures are logged without exception detail, and shutdown uses the same path.

### B1.1 live close lifecycle correction

Owner-side live acceptance later reproduced a password-revocation failure: the client received no close frame, `CancelledError` escaped the route while it awaited `receive_text()`, and cleanup logged a transport close failure. The route task is the ASGI receiver. The previous cleanup path cancelled that task immediately after its close call, making server-side teardown race the transport's graceful close completion. The route's `finally` then raced cleanup through `disconnect`. B1.1 gives close/unregister a separate shared owner and allows the receiver to end from the close-induced disconnect before cleanup finishes unregistering. This does not change the 30-second authorization interval, the 1008 confirmed-revocation policy, or the 1011 authorization-error policy.

The local lifecycle regression models an ASGI receiver that stays alive through the close send and returns only after observing the resulting disconnect. It also checks that cancelling a cleanup caller preserves caller cancellation while the shared cleanup completes. The guarded live PostgreSQL rerun remains an owner-side requirement when the integration service is reachable.

Authorization checks open a dedicated `SessionLocal` inside the synchronous worker and close it in `finally`. Revalidation waits at most 10 seconds for the check. On timeout/cancellation, AnyIO abandons the wait; **it does not stop the synchronous worker thread**. That worker retains ownership of its database session and closes it only if/when the driver call returns. A stuck DB driver can therefore occupy a worker beyond the WebSocket close deadline. No database/network driver timeout was added. When the check returns normally, revocation is detected no later than the next 30-second interval plus check duration; a check taking longer than 10 seconds closes with 1011 at that deadline.

Queued events are discarded after close begins. An outbound event whose sender already passed its last closed/visibility check, or bytes already accepted by the transport, cannot be recalled. Discussion message mutations remain REST requests; this correction does not alter text, built-in/custom sticker payloads, reactions, history, author UUID, or removal contracts. Trusted-origin checks and session/membership policy are unchanged.

## Exact files changed

- `backend/app/api/v1/endpoints/discussion.py` — isolated bounded authorization wait; operational-error/timeout 1011 handling; confirmed-revocation 1008 handling; receiver task registration and sanitized termination logging.
- `backend/app/core/broadcaster.py` — shared idempotent cleanup ownership, task cancellation/awaiting, queue draining, close-code support, exception-safe unregister, cancellation propagation, and shutdown reuse.
- `backend/tests/api/v1/test_discussion_ws_revalidation.py` — deterministic invalid-session/membership, operational exception, timeout-with-worker-continuation, cancellation, queue, unregister, close-failure and concurrent cleanup tests.
- `backend/tests/api/v1/test_content_removal.py` — expects the sender task's `CancelledError` to propagate rather than be swallowed.
- `backend/tests/api/v1/test_delegate_member_websocket_revocation_pg.py` — guarded live session revocation and member removal/ban socket-close cases.
- `backend/acceptance/profile.py` — dedicated `discussion-websocket-postgresql` isolated-schema acceptance selector.
- `docs/etudsup-s1-websocket-revalidation-fail-closed.md` — this report and owner retry command.

No frontend, migration, dependency, environment, storage-cleanup, deployment, or reference-worktree file was changed. No owner service was restarted. No staging, commit, push, or deployment occurred.

## Verification

| Check | Result |
| --- | --- |
| `./.venv/bin/python -m pytest tests/api/v1/test_discussion_ws_revalidation.py tests/core/test_broadcaster_revocation_cleanup.py -q --tb=short` | **10 passed**. Exercises 1008 and 1011 policies, generic error handling, timeout while the worker is still running, task cancellation, close failure, unregister, enqueue refusal, repeated cleanup, simultaneous disconnect, and task termination. |
| `./.venv/bin/python -m acceptance.profile --suite discussion-sticker-api --heartbeat` | **107 passed**, 54 existing dependency/deprecation warnings. The profile's heartbeat is an opt-in test-process event-loop wakeup accommodation; it does not change the production revalidation interval. Covers existing Discussion, content-removal and sticker API regressions. |
| `./.venv/bin/python -m acceptance.profile --suite discussion-websocket-postgresql --heartbeat` | **Blocked during isolated PostgreSQL setup** with `OperationalError`, before schema creation or pytest. Evidence: `/tmp/irm-profile-evidence-wpngp19m/profile-result.json`; `pytest_exit_status` is null, `tests` is empty, no owned schema remained, and temporary storage was removed. **Zero live network assertions executed.** No owner/production data was used. |

The real-network suite is guarded by the acceptance harness: it validates the loopback integration database identity, creates a uniquely leased `irm_acceptance_<run UUID>` schema, and runs synthetic accounts there. Its fixture may clear tables only inside that verified, unique schema; it cannot target a shared owner schema.

## Remaining live gate and owner command

Run the isolated live session-revocation and membership removal/ban WebSocket cases when the approved `irm_integration_test`/`irm_test` PostgreSQL service is reachable. The password is read without echo and is not written to the command line, report, or evidence:

```fish
cd /home/yasso/irm-platform/backend
function run_s1_ws_revalidation
    read -s -P 'Password for irm_test: ' db_password
    echo
    set -l run_id (./.venv/bin/python -c 'import uuid; print(uuid.uuid4().hex)')
    set -l journal "/tmp/irm-s1-$run_id.jsonl"
    set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
    set -lx IRM_ACCEPTANCE_DB_PORT 5432
    set -lx IRM_ACCEPTANCE_DB_PASSWORD $db_password
    set -lx IRM_ACCEPTANCE_RUN_ID $run_id
    set -lx IRM_ACCEPTANCE_JOURNAL $journal
    ./.venv/bin/python -m acceptance.profile --suite discussion-websocket-postgresql --heartbeat
    set -l result $status
    set -e IRM_ACCEPTANCE_DB_PASSWORD
    set -e db_password
    printf 'S1 guarded WebSocket acceptance status: %s; lease journal: %s\n' $result $journal
    return $result
end
run_s1_ws_revalidation
```

No S1 implementation work remains; only this owner-side live acceptance is open.
