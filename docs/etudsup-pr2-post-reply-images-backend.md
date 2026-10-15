# ETUDSUP PR2 — Post-reply image backend

## F14 recovery

`MemberDirectory` and its accompanying presentation/tests are present in the shared worktree. The inspected component includes active Delegate gating, filtering/pagination, and request-scope cancellation. I found no saved F14 completion report or test result, so the source is evidence of implementation only; F14 checks and completion remain unverified.

## Contract implemented

`POST /api/v1/communities/{community_slug}/posts/{post_id}/replies` keeps legacy JSON `{ "content": "…" }` and adds atomic multipart creation. Multipart accepts exactly one canonical lowercase UUIDv4 `client_request_id`, optional UTF-8 `content`, and at most one `image`. It supports text-only, text plus image, and image-only replies. Unknown/duplicate fields, caller identity/storage/URL fields, duplicate content-type/origin headers, and extra files are rejected. Filenames are ignored.

The request body is capped at 5,308,416 streamed and declared bytes. Image input is nonempty and at most 5,242,880 bytes; text is at most 8 KiB raw and 2,000 code points after trimming. The route checks one trusted Origin and authenticates the session before body intake/parsing. Active membership is checked again under user→membership→parent locks before creation. The existing visible-parent check and parent-removal serialization remain in place. Multipart files/forms are closed in a `finally` block.

First creation returns **201**; a visible matching replay returns **200** with the original reply. Reusing an ID with another fingerprint, or replaying a removed reply/post, returns a concealed **409** (`reply_request_conflict`). If commit outcome cannot be resolved, the API returns sanitized **503** (`reply_outcome_unknown`) and retains the generated image object. Legacy JSON remains non-idempotent and content-only. Reply responses now add nullable `image_url`; no storage key, filename, path, or full account object is returned.

The fingerprint hashes normalized text, normalized declared image MIME, and raw image SHA-256 using tagged, length-prefixed components. The existing non-null text column is retained; image-only replies store `content: ""`, with a database check requiring nonempty trimmed text or an image key. Request ID and fingerprint must be both null or both populated; uniqueness is scoped to `(post_id, author_id, client_request_id)`.

## Image and storage policy

The existing Pillow installation is reused. JPEG/PNG declared MIME must match the decoded format. Processing rejects corrupt/truncated, animated, or over-limit images; dimensions must be 32–4096 per side and at most 12 million pixels. It verifies and reopens/loads the image, applies EXIF orientation, rechecks dimensions, preserves aspect ratio without upscaling, limits the longest output side to 1,600 pixels, flattens transparency on white, and emits a fresh metadata-free RGB JPEG at quality 88, capped at 2,097,152 bytes. CPU processing runs in a worker thread.

Reply images use separate immutable LocalFS save/read/delete methods and generated keys shaped as `post-reply-images/{reply_uuid}/{version_uuid}.jpg`. Operations validate reply ownership, reject traversal/symlinks/non-regular files, publish durably without overwrite, and perform bounded reads. On a confirmed rollback, only this attempt’s generated key is removed. A raised commit is resolved in a fresh transaction while taking the same locks; an unresolved outcome never deletes potentially committed media. Soft removal retains files; no cleanup sweep was added.

`GET /api/v1/communities/{community_slug}/posts/{post_id}/replies/{reply_id}/image` requires current ACTIVE membership and a visible reply below the visible parent in the requested community. It rechecks visibility after reading and serves only bounded, decoded canonical JPEG bytes. Cross-parent/community, removed, absent, invalid-key, and unavailable-media cases are concealed as **404**. Existing authentication/membership 401/403 behavior is retained. Success and errors carry `Cache-Control: private, no-store`, `Vary: Cookie`, and `X-Content-Type-Options: nosniff`; success is `image/jpeg` with inline disposition.

Announcement reply code and routes were not changed.

## Migration coordination

PR2 authored migration **`e8a4f6b1c932`**, directly after the prior sole head `d1e2f3a4b5c6`. The concurrent MR2 migration now correctly declares `down_revision = "e8a4f6b1c932"`. The integrated tree has one Alembic head: **`b7c3e9a4d182`**. The acceptance head/layout guard includes the reply fields and current integrated head. MR2 should keep its parent at `e8a4f6b1c932`; do not branch from the older `d1e2f3a4b5c6` revision.

The downgrade refuses to drop any populated reply image/request-identity fields. Existing reply identifiers/text remain untouched by upgrade.

## Changed files

- `backend/alembic/versions/e8a4f6b1c932_add_post_reply_images_and_idempotency.py`
- `backend/acceptance/isolation.py` and `backend/acceptance/run.py` (head/layout and focused suites; `isolation.py` also contains concurrent MR2 guard work)
- `backend/app/api/post_reply_routes.py`
- `backend/app/api/v1/endpoints/community_posts.py`
- `backend/app/core/post_reply_images.py`
- `backend/app/core/storage/exceptions.py`
- `backend/app/core/storage/local.py` (narrow reply-image methods appended to a file with existing concurrent changes)
- `backend/app/models/community_post_reply.py`
- `backend/app/schemas/community_post.py`
- `backend/app/services/post_reply_images.py`
- `backend/tests/api/v1/test_community_posts.py` (trusted Origin on existing reply-create test client)
- `backend/tests/api/v1/test_post_reply_images.py`
- `backend/tests/api/v1/test_post_reply_route_guards.py`
- `backend/tests/core/test_post_reply_images.py`
- `backend/tests/services/test_post_reply_image_service.py`
- `backend/tests/services/test_post_reply_images_pg.py`
- `docs/etudsup-pr2-post-reply-images-backend.md`

No dependencies, frontend, module-resource implementation, Announcement behavior, deployment, or owner database were changed.

## Verification and pending checks

- Passed: 67 focused tests across acceptance-isolation guards, multipart route size/content-type helpers, image conversion/storage, and service replay/read/rollback lifecycle.
- Passed: Python compile check for the changed backend/migration/test modules.
- Passed: `alembic heads` reports the single integrated head `b7c3e9a4d182`.
- Existing regression run: 35 tests passed across content-removal transactions, sticker storage, and avatar storage. One migration autogenerate assertion failed because it found five unrelated expression indexes for document-reading/saved-document/sticker tables; the expected empty diff was not met. I did not change those indexes.
- PostgreSQL migration/concurrency and existing post-removal regressions are pending. The approved disposable acceptance harness was run once; `postgresql_setup` was blocked by `OperationalError` connecting to the configured integration endpoint. Its evidence summary records `verified_owned_leases: 0`, schema cleanup complete, and the owned workspace removed. No schema was created and no other database was used.
- API TestClient cases are added but remain unverified locally. The shared tree's concurrent module-resource router uses a `route_class_override` argument unsupported by the installed FastAPI decorator, preventing app import. A temporary test-only compatibility shim allowed import, but Starlette `TestClient` still hung on `/health` for a minimal FastAPI app in this Python 3.14 environment. Existing post API and Announcement reply endpoint regressions are also pending for this reason; neither limitation was changed as part of PR2, and no API result is claimed as passed.
- `ruff` is not installed in the backend virtualenv; the changed Python modules compile successfully.

Fish-compatible owner rerun once the approved disposable PostgreSQL endpoint is available:

```fish
cd /home/yasso/irm-platform/backend
set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
set -lx IRM_ACCEPTANCE_DB_PORT 5432
# Use the approved integration-role password via IRM_ACCEPTANCE_DB_PASSWORD or an authorized .pgpass entry.
.venv/bin/python -m acceptance.run --non-interactive --stages postgresql_setup postgresql_regressions
```

## PR3 frontend handoff

Add one optional JPEG/PNG picker to the **community post** reply composer only. Support text, text plus image, or image-only; show an unsaved preview with replace/cancel/clear actions and the 5 MiB limit. Submit multipart with a persistent UUIDv4 per logical attempt; keep the draft and request ID after an uncertain response so retry is idempotent, and clear both only after a confirmed create/replay. Render `image_url` through credentialed authenticated loading, revoke object URLs, and clear account-scoped image state on account changes. Use responsive aspect-ratio-preserving geometry with accessible labels. Do not add image controls to Announcement replies. Focus browser acceptance on retry, privacy/account switching, removal, narrow/mobile sizing, and the 201/200/409/503 states.

## PR1 deviations

The strict Origin requirement is enforced for both multipart and legacy JSON on this single POST route; legacy callers that do not send a trusted Origin must add it. The JSON payload/response text behavior otherwise remains the same. Image-only storage uses an empty string in the legacy non-null `content` column, with `image_url` carrying the visible media reference.
