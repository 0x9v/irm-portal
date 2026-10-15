# ETUDSUP D1.2 — Discussion author UUID contract

## Result

Discussion message representations now expose `author_id` as the UUID already stored in `DiscussionMessage.author_id`. The field is present in history items, POST creation responses (including idempotent retries), and `message_created` WebSocket payloads. REST uses normal Pydantic UUID JSON encoding; the manually serialized event uses `str(msg.author_id)`, producing the same canonical UUID string.

The model and its existing migration declare `author_id` non-nullable with a foreign key to `users.id` and `ON DELETE CASCADE`. There is no supported null-author/legacy row representation in this schema: removing a user cascades to their messages. The response field is therefore required. If an invalid row with a missing author were ever introduced outside the schema, this change does not invent an identifier or infer one from `author_username`.

## Changed files and serialization paths

- `backend/app/schemas/discussion.py` — added required UUID `author_id` to `DiscussionMessageResponse`.
- `backend/app/services/discussion.py` — history item construction sets `author_id=m.author_id`. The existing author eager-load and query count are unchanged.
- `backend/app/api/v1/endpoints/discussion.py` — successful POST responses set `author_id=msg.author_id`; the manually assembled `message_created.message` event sets `author_id=str(msg.author_id)`. The service's existing retry lookup returns the same stored message, so the shared POST response construction serializes the same ID on replay.
- `backend/tests/api/v1/test_discussion.py` — exercises creation, history from two authors, UUID stability after username change, spoofing rejection, retries, built-in stickers, and a live TestClient WebSocket event compared with both REST and history.
- `backend/tests/api/v1/test_content_removal.py` — asserts that `message_removed` remains exactly the minimal metadata object.
- `docs/etudsup-d1-2-discussion-author-id.md` — this implementation and frontend handoff report.

The response continues to expose `author_username` and existing message fields. No user profile, email, first/family names, membership application, password/session data, complete user response, or avatar storage key is serialized. `author_id` is taken from the stored foreign key, never from a username or request field. `DiscussionMessageCreate` still forbids extra fields, and the authenticated membership user remains the author on creation.

Community membership authorization and removed-message filtering are unchanged. Removed-message retries continue to return the existing concealed 409 behavior without message content; removed rows remain absent from history. `message_removed` contains only `type`, `community_slug`, and `message_id`, with no author UUID or original content. Existing post-commit broadcast, queued visibility check, stale-payload suppression, and removal race guard remain unchanged. No migration was needed.

## Representative payloads

Synthetic UUIDs shown below:

History item:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "kind": "TEXT",
  "content": "Bonjour",
  "sticker_id": null,
  "author_id": "22222222-2222-4222-8222-222222222222",
  "author_username": "samira",
  "created_at": "2026-10-13T10:20:30Z",
  "reactions": [],
  "caller_reaction": null
}
```

Creation response (same message fields, with an empty reaction list and no caller reaction):

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "kind": "TEXT",
  "content": "Bonjour",
  "sticker_id": null,
  "author_id": "22222222-2222-4222-8222-222222222222",
  "author_username": "samira",
  "created_at": "2026-10-13T10:20:30Z",
  "reactions": [],
  "caller_reaction": null
}
```

`message_created` event:

```json
{
  "type": "message_created",
  "community_slug": "irm",
  "message": {
    "id": "11111111-1111-4111-8111-111111111111",
    "kind": "TEXT",
    "content": "Bonjour",
    "sticker_id": null,
    "author_id": "22222222-2222-4222-8222-222222222222",
    "author_username": "samira",
    "created_at": "2026-10-13T10:20:30Z",
    "reactions": []
  }
}
```

## Frontend handoff

The prepared ownership comparison can now use `message.author_id === user.id`. A message has an authoritative author UUID in the current schema; if a future compatible representation allows `author_id` to be null, the frontend should leave that message unclassified and must not guess ownership from `author_username`.

No frontend files were changed. Remaining acceptance gaps are live/browser verification of alignment after history reload/navigation and runtime verification against the deployed backend. No live PostgreSQL migration test is required for this additive response field; no owner or production database was used.

## Verification

- Initial `../.venv/bin/python -m pytest ...` from `backend/` — **not executed**: the root environment does not contain pytest (`No module named pytest`); it also reported a `sys.prefix` mismatch.
- Initial `backend/.venv/bin/python -m pytest tests/api/v1/test_discussion.py tests/api/v1/test_content_removal.py -q --tb=short` — **interrupted** after producing no output. This Python 3.14/AnyIO environment needs the documented test-process heartbeat accommodation.
- `timeout -k 5s 180s .venv/bin/python -c 'import pytest; from acceptance.profile import loop_heartbeat; exec("with loop_heartbeat(True):\\n raise SystemExit(pytest.main([\\"tests/api/v1/test_discussion.py\\", \\"tests/api/v1/test_content_removal.py\\", \\"-q\\", \\"--tb=short\\", \\"-o\\", \\"faulthandler_timeout=15\\"]))")'` from `backend/` — **94 passed**, 0 failed, 1 Starlette/httpx deprecation warning in 35.49s. This used `acceptance.profile.loop_heartbeat(True)` only inside the test process; tests used their existing isolated SQLite fixtures.
- The same accommodated runner on `tests/api/v1/test_discussion.py::test_websocket_connect_and_broadcast_message` after adding the history/event equality assertion — **1 passed**, 0 failed, 1 deprecation warning in 1.70s.
- `python -m py_compile` on the three changed backend modules and two test modules — passed.
- Direct trailing-whitespace scan over the five backend files and this report — **0 issues**. The five backend paths were already untracked in the initial worktree; the concurrent work was preserved. No staging, commit, push, deployment, service restart, or migration was performed.

## Remaining live/browser acceptance

Actual TestClient HTTP and WebSocket serialization passed. Browser-based frontend ownership alignment and a live backend session were not exercised in this task. They remain acceptance checks for the frontend/browser handoff; this change did not alter frontend code or connection lifecycle.
