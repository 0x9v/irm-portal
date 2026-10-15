# ETUDSUP CS4 — Custom stickers in Discussion and protected media

## Result and boundaries

Custom sticker sends now use the CS2 `StickerAsset` row and the existing immutable WebP object. First sends require the caller's active community membership and an available library asset owned by the authenticated account. The message stores only the asset UUID. History, POST/retry responses and `message_created` events include that UUID; a separate community-scoped route serves the image after checking the visible message.

No migration was needed. The inspected current head is `d1e2f3a4b5c6`; the existing `DiscussionMessage` model has `kind` length 20, a nullable `custom_sticker_id` FK with `ON DELETE RESTRICT`, and the three-shape check for TEXT, built-in STICKER and CUSTOM_STICKER. No frontend, dependency, environment or deployment files were changed. The worktree was already broadly dirty; concurrent U6, avatar, profile, document and other work was preserved.

## Changed files

- `backend/app/schemas/discussion.py` — accepts CUSTOM_STICKER requests and adds nullable `custom_sticker_id` to every Discussion response.
- `backend/app/services/discussion.py` — includes the stored asset UUID in history, compares it during idempotent replay, and validates/locks owned available assets for first sends.
- `backend/app/api/v1/endpoints/discussion.py` — passes the authenticated session credential to the creation service, includes the UUID in POST/event JSON, and adds the protected message-image route.
- `backend/app/core/stickers.py` — adds parsing of the owner UUID from a canonical generated storage key for authorized message reads, including retained ownerless assets.
- `backend/app/api/content_route.py` — adds private image headers and sanitized private errors for the message-scoped media route.
- `backend/tests/api/v1/test_discussion.py` — actual API/event tests for custom send, retry, history, ownership, media, removal and request validation; existing TEXT/STICKER checks now assert the additive null field.
- `backend/tests/services/test_discussion_custom_stickers_pg.py` — guarded PostgreSQL send/removal ordering, concurrent retry, rollback and moderation/retry tests.
- `backend/acceptance/profile.py` — adds `discussion-sticker-api` and `discussion-sticker-postgresql` focused selectors.
- `docs/etudsup-cs4-custom-sticker-discussion.md` — this report.

No model or Alembic file changed.

## Request, response and event contract

The only new request shape is:

```json
{
  "client_message_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "kind": "CUSTOM_STICKER",
  "custom_sticker_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
}
```

`custom_sticker_id` is parsed as a UUID. CUSTOM_STICKER requires that field and rejects text and built-in `sticker_id`. TEXT and built-in STICKER reject custom IDs; their existing normalization, limits and built-in catalog validation remain in force. Omitted and explicit-null optional fields follow the existing Pydantic convention. Extra JSON keys are forbidden, including `author_id`, `image_url` and `storage_key`. New-message authors always come from the authenticated membership.

The REST response and history item retain all existing fields and add `custom_sticker_id`, encoded as a canonical UUID string or `null` for TEXT/built-in STICKER. The event serializer is manually built and now sets the same field explicitly; it does not include an owner preview URL or storage information. Synthetic example:

```json
{
  "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "kind": "CUSTOM_STICKER",
  "content": null,
  "sticker_id": null,
  "custom_sticker_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "author_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "author_username": "samira",
  "created_at": "2026-10-13T10:20:30Z",
  "reactions": [],
  "caller_reaction": null
}
```

`message_created` carries the same message fields and UUID meanings:

```json
{
  "type": "message_created",
  "community_slug": "irm",
  "message": {
    "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "kind": "CUSTOM_STICKER",
    "content": null,
    "sticker_id": null,
    "custom_sticker_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "author_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    "author_username": "samira",
    "created_at": "2026-10-13T10:20:30Z",
    "reactions": []
  }
}
```

Existing eager author loading, history order/cursors and batched reaction queries are unchanged. A custom asset UUID comes from the stored FK; no per-message asset lookup is added. Reaction request/response contracts remain unchanged.

## First send, retry and removal

The service checks the community/author/client-message key first. A matching visible stored message returns as a replay, including its original author and `custom_sticker_id`, even after library removal; replay sends no second creation event. A conflicting payload, including a different custom asset UUID, returns 409. A removed original retains the concealed 409 path and returns no message body or asset UUID.

For a new custom message, after the authenticated membership dependency, the service locks/refetches User, locks and revalidates the initiating Session, rechecks ACTIVE membership, resolves the idempotency key again after any User-lock wait, and locks the owner-matching, available StickerAsset before inserting the message. This shares CS3's `User → Session → StickerAsset` serialization order. If removal commits first, a subsequent first send sees no available asset and returns concealed 404. If send commits first, the message FK remains and library removal only sets `removed_at`; it does not delete or mutate the immutable object. Simultaneous identical sends serialize on User and resolve to one stored message and one newly broadcast creation.

An existing removed-message retry is concealed before asset access. A new-send failure never deletes or changes the library asset. The FK remains `ON DELETE RESTRICT`, and soft moderation removal keeps the message/asset reference. Existing post-commit broadcasting, fresh visibility checks, queued-event suppression and removal ledgers remain in effect. `message_removed` is unchanged and contains exactly `type`, `community_slug`, and `message_id`.

## Protected image access

The message image URL is:

```text
GET /api/v1/communities/{community_slug}/discussion/messages/{message_id}/sticker
```

The route relies on the existing authenticated-session and ACTIVE target-community membership policy. It then requires a message in that community that is visible, not removed and `CUSTOM_STICKER`, joins its referenced asset, reads at most the canonical 256 KiB through CS2's key-validated storage helper, and validates canonical WebP bytes. The owner UUID used to validate the generated storage key is parsed only from the DB-stored canonical key; it is not an authorization input. This permits a retained ownerless asset to serve an otherwise authorized message without making it listable, previewable or newly sendable by an owner.

Unknown, wrong-kind, cross-community, removed, missing, malformed-key and corrupt-media targets return a sanitized 404. A nonmember follows the established 403 policy; an invalid session is 401. Responses and errors are `private, no-store`, vary on Cookie (the global CORS middleware may also append Origin), and set `X-Content-Type-Options: nosniff`. Successful images use `Content-Type: image/webp` and `Content-Disposition: inline`. No public mount, arbitrary path, asset-UUID-only authorization or owner preview route is used for delivery.

The route checks visibility again after reading disk bytes. A moderation removal that commits during the read is therefore concealed by the second check. As with the existing WebSocket removal contract, there is an unavoidable interval after the final visibility check and before response delivery; bytes already sent or downloaded cannot be recalled.

Privacy remains limited to message representations already authorized for the caller. No email, account names, membership application data, session/password details, complete User response, avatar storage key, sticker storage key/path, asset owner data or preview URL is serialized.

## Verification

- `cd backend && .venv/bin/alembic heads` — sole current head `d1e2f3a4b5c6`; inspected model/migration supports CUSTOM_STICKER, so no migration was required.
- `py_compile` on the changed schema, service, endpoint, image helper, private route, acceptance runner, and both changed/new test modules — passed.
- Accommodated focused API run via `acceptance.profile --suite discussion-sticker-api --heartbeat` — **107 passed, 0 failed** in 44.43s, 54 existing deprecation warnings. Evidence: `/tmp/irm-profile-evidence-npjaius7/profile-result.json`. It exercised `test_discussion.py`, `test_content_removal.py` and `test_sticker_library.py` using isolated SQLite fixtures and the existing test-process-only event-loop heartbeat. This covers Discussion creation/history/reactions, removal privacy, custom POST/history/event serialization including an actual WebSocket delivery, retry and conflict behavior, foreign/removed/ownerless asset denial, active-member image access, owner-preview denial, cross-community/nonmember concealment, retained media after library removal, missing/corrupt media, and the unchanged minimal removal event. Counts are reported for this one suite and are not added to overlapping runs.
- `acceptance.profile --suite sticker-api --heartbeat` — **33 passed** in 6.11s for sticker library, image processor and storage tests. This overlaps the API suite above; counts are not added.
- `PYTHONPATH=. .venv/bin/pytest tests/services/test_discussion_custom_stickers_pg.py --collect-only -q` — **5 collected**. Collection confirms the guarded test module imports; it is not PostgreSQL execution or assertion evidence.
- Focused custom API subset run through the same heartbeat accommodation — **3 passed**, 35 deselected; this is a subset of the 107 above and is not a separate regression count.
- One guarded `discussion-sticker-postgresql` attempt — blocked during connection/setup with `OperationalError`, before database identity verification. Evidence: `/tmp/irm-profile-evidence-jpgmtpby/profile-result.json`; it records `pytest_exit_status: null`, empty test results, no outstanding owned schema and temporary storage removed. **Zero PostgreSQL assertions executed.** The new race tests were not run against PostgreSQL. No alternate, development, owner or production database was used.

The previous CS2 migration, CS3 quota/concurrency, avatar/profile/password PostgreSQL and D1.3 browser/live acceptance gaps remain open as documented in their reports. The moderation report's older local database repair is not evidence for this new guarded CS4 suite. S1 still has no located report or confirmed acceptance status; it is not claimed complete. Durable production sticker storage, backups, bounded orphan cleanup, live deployment checks and browser rendering are also outstanding.

Fish-compatible focused owner command for a future retry against only the approved loopback integration target:

```fish
cd /home/yasso/irm-platform/backend
function run_cs4_discussion_sticker_pg
    read -s -P 'Password for irm_test: ' db_password
    echo
    set -l run_id (./.venv/bin/python -c 'import uuid; print(uuid.uuid4().hex)')
    set -l journal "/tmp/irm-cs4-$run_id.jsonl"
    set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
    set -lx IRM_ACCEPTANCE_DB_PORT 5432
    set -lx IRM_ACCEPTANCE_DB_PASSWORD $db_password
    set -lx IRM_ACCEPTANCE_RUN_ID $run_id
    set -lx IRM_ACCEPTANCE_JOURNAL $journal
    ./.venv/bin/python -m acceptance.profile --suite discussion-sticker-postgresql
    set -l pg_status $status
    set -e IRM_ACCEPTANCE_DB_PASSWORD
    set -e db_password
    printf 'CS4 PostgreSQL status: %s; journal: %s\n' $pg_status $journal
    return $pg_status
end
run_cs4_discussion_sticker_pg
```

## CS5 frontend handoff

The frontend can send `{client_message_id, kind: "CUSTOM_STICKER", custom_sticker_id}` and keep the UUID through history, POST/retry and live-event merging. Message images must use the community-scoped message URL above, never the private library `preview_url`. A removed library entry remains renderable in a still-visible sent message; a removed message's media URL returns concealed 404. Preserve UUID-based own-message comparison using `author_id`. The current REST/event output always includes nullable `custom_sticker_id`; TEXT and built-in STICKER contain `null`.

CS5 frontend integration, including private-library picker/upload, alpha-preserving rendering and removal/send behavior, is now present in [`docs/etudsup-cs5-custom-stickers-frontend.md`](etudsup-cs5-custom-stickers-frontend.md). Source review confirms owner-only library preview access and community/message-scoped media access. Current full lint and TypeScript checks pass; P4.2's earlier Discussion failures are stale. CS5 browser assertions did not execute, normal production build remains environment-blocked, live two-account acceptance is open, and lifecycle/orphan cleanup is unfinished. The picker still needs browser keyboard/mobile verification, and its retry control does not set the composer's submitting state.

For the frozen release, the current audit recommends deferring custom stickers. Keep existing assets/messages and text/built-in stickers intact; gate new custom uploads and new custom-message sends server-side and hide/disable the related picker controls. Preserve reads for existing private library items and visible historical message media. The release-wide finite closure queue and explicit recommendation live in [`AUDIT.md`](../AUDIT.md). No implementation or sticker-data cleanup is included in this handoff update.
