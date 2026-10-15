# ETUDSUP CS2 — Custom sticker foundation

## Result and scope

The model, additive migration, static sticker image processor and sticker-specific immutable local-storage operations are implemented. No library routes, custom sticker request validation/response serializers, send/read services, frontend, quota logic, cleanup scheduler, dependency or deployment configuration were added. Existing avatar JPEG and document storage operations were left intact; sticker operations are separate methods and key grammar.

The worktree was already broadly dirty before CS2. Its S1 search found no S1 report or sticker implementation artifact; no S1 acceptance is claimed. Existing avatar/D1/U6 and other concurrent work was preserved. Only the paths listed below were changed for CS2.

## Changed files

- `backend/app/models/sticker_asset.py` — one `StickerAsset` table/model for immutable metadata and library availability.
- `backend/app/models/discussion_message.py` — nullable custom asset FK and three-way DB kind/field check; kind storage widened to 20 characters.
- `backend/app/models/__init__.py` — imports/exports the new model for metadata registration.
- `backend/alembic/versions/d1e2f3a4b5c6_add_custom_sticker_foundation.py` — additive schema revision, guarded downgrade.
- `backend/app/core/stickers.py` — image conversion limits and helpers for generated/validated keys.
- `backend/app/core/storage/exceptions.py` — sanitized typed `StickerStorageError` with an internal generated-key cleanup handle.
- `backend/app/core/storage/local.py` — sticker-only immutable publication, bounded read and exact deletion.
- `backend/acceptance/isolation.py` — new head/table/columns in the existing strict owned-schema guard.
- `backend/acceptance/profile.py` — `sticker-postgresql` guarded suite selector.
- `backend/tests/core/test_stickers.py` — synthetic-image and temporary-storage processor/helper coverage.
- `backend/tests/services/test_sticker_foundation_pg.py` — guarded migration/data/FK/check/downgrade test.
- `docs/etudsup-cs2-sticker-foundation.md` — this report.

`backend/app/core/storage/local.py` and `backend/app/core/storage/exceptions.py` were already modified by concurrent avatar work. CS2 added sticker-specific members to those files while preserving existing avatar implementations.

## Schema and migration

Immediately before revision authoring, `cd backend && .venv/bin/alembic heads` reported the sole head `c96b4731ea20`. Revision `d1e2f3a4b5c6` uses that as its predecessor; current `alembic heads` reports only `d1e2f3a4b5c6`.

`sticker_assets` is the single asset/library table: UUID primary key; nullable `owner_id` with `users.id ON DELETE SET NULL`; unique non-null storage key; `image/webp`; exactly 256×256 dimensions; byte size constrained to 1–262,144; created timestamp; nullable `removed_at`. Owner and `(owner_id, created_at, id)` listing indexes are present. There is no second library table or quota counter. Removal is represented only by `removed_at`; immutable key/media/dimensions/size/creation metadata have no mutation API. Ownerless assets are excluded by contract from future owner listing, preview and new send authorization.

`discussion_messages.custom_sticker_id` is nullable, indexed and references `sticker_assets.id ON DELETE RESTRICT`. `kind` is widened to 20 characters. The DB check allows exactly TEXT with nonblank content and neither sticker ID; built-in STICKER with `sticker_id`, no content and no custom UUID; or CUSTOM_STICKER with custom UUID, no content and no built-in ID. Existing author/idempotency/removal/reaction/history columns and indexes are unchanged. No rows are backfilled, no asset is fabricated, and migration code performs no filesystem operations. Public Pydantic request validation still accepts only TEXT and built-in STICKER.

The downgrade counts assets and custom message references before any schema DDL and raises if either exists. With empty sticker data it restores the old two-kind check and `kind` width, removes the FK/column/table/indexes, and retains legacy rows. A user can delete an asset only after message references are gone because of RESTRICT. The migration test verifies this lifecycle, but its PostgreSQL execution is blocked in this environment; see verification below.

## Processor and storage contract

`process_sticker_image(data, declared_media_type)` is CPU-bound and returns canonical WebP bytes or a `StickerImageError` with stable outcome. Its later API caller must invoke it in a worker thread. It accepts only declared/detected-matching JPEG and PNG, files up to 2 MiB, dimensions 32–4096 and at most 16 MP, and exactly one frame. Pillow probes dimensions/format before full decode, turns decompression-bomb warnings into failures, verifies then reopens and loads, and applies EXIF orientation. It contains the full image in a centered 256×256 RGBA canvas, preserves PNG alpha and transparent padding, strips source metadata by copying only pixels into a fresh canvas, and losslessly encodes WebP with an output cap of 256 KiB. It does not crop to a square, composite on white, accept WebP input, or remove photographic backgrounds. No per-request global Pillow policy is mutated. If the WebP feature or a real encoder probe is unavailable, it fails with `webp_encoder_unavailable`.

Sticker object keys are generated as `stickers/<owner_uuid>/<asset_uuid>/<version_uuid>.webp`. Helpers enforce lowercase canonical UUID key grammar and owner match before reads/deletes. The storage provider generates keys internally for publication, writes to a same-directory temporary file, fsyncs it, uses no-overwrite hard-link publication, removes the temporary file narrowly and fsyncs the directory. Read is capped at `max_bytes + 1`; read/delete reject symlinks and non-regular targets; delete is exact and returns false for an absent object. No broad scan/sweep exists. These markers/path checks do not prove that bytes form a valid image; callers must store only processor output.

Failure outcomes are sanitized. A write/publication/durability error includes an internal storage key only when it was generated by this operation and may need restricted cleanup. Pre-publication temporary files are removed. If publication may have occurred and cleanup cannot be confirmed, the caller receives that generated key for a later owner/key-validated delete attempt. Missing, oversized, unsafe, read and delete failures have stable typed outcomes without exposing paths. Database and filesystem are not atomic: a later API service may delete a newly published object only after known rollback; if commit outcome is unknown it must preserve the object and resolve/reconcile the DB reference before cleanup. Never use a general “delete after every commit exception” handler. Library removal changes `removed_at`; physical asset deletion remains separate and must not occur while a retained message references the asset.

## Verification

- `cd backend && .venv/bin/alembic heads` — passed; sole head `d1e2f3a4b5c6`.
- Pillow 12.3.0 capability probe — WebP encoder available; lossless RGBA WebP round-trip completed. Output alpha was retained.
- Accommodated focused run using `acceptance.profile.loop_heartbeat(True)` inside this test process over `test_stickers.py`, `test_storage.py`, `test_avatar_processing.py`, `test_avatars.py`, `test_discussion.py` and `tests/acceptance/test_isolation.py` — **134 passed**, 0 failed, 10 existing deprecation warnings. This covers alpha/padding, contain-fit, EXIF orientation, metadata stripping, input/output/dimension/frame/corrupt/MIME limits, immutable keys, owner checks, bounded reads, traversal/symlink protections, exact deletion and narrow failure cleanup, plus Discussion/avatar/storage/isolation regressions. The heartbeat accommodation changes no app code and only wakes the test event loop.
- `tests/services/test_sticker_foundation_pg.py --collect-only -q` — **1 collected**; collection is not migration/FK acceptance.
- One guarded PostgreSQL attempt: `timeout -k 5s 180s .venv/bin/python -m acceptance.profile --suite sticker-postgresql --heartbeat` — blocked with `OperationalError` during setup before DB identity verification. Runner evidence `/tmp/irm-profile-evidence-id3uzr21/profile-result.json` records null pytest status, no test assertions, no outstanding owned schema, and removed temporary storage. No alternate DB was attempted. Therefore upgrade preservation, PostgreSQL RESTRICT/SET NULL/check behavior, downgrade refusal, empty downgrade/re-upgrade and owned-schema cleanup are **not accepted yet**.
- **B1.2 follow-up:** a later owner-side `sticker-postgresql` attempt reached the approved `irm_integration_test` / `irm_test` target and executed the migration test, which failed because legacy rows were inserted through the current ORM while running at predecessor revision `c96b4731ea20`. The cause was corrected in the test fixture with a reflected historical table; see [ETUDSUP B1.2](etudsup-b1-2-sticker-migration-acceptance.md). PostgreSQL acceptance remains pending until the corrected guarded suite passes.
- `git diff --check` on the CS2 code paths — passed; no whitespace errors.

No owner or production database was used. No live image storage/deployment, browser or frontend behavior was exercised.

## CS3 library API integration instructions

Build the API on these foundations without adding a duplicate library table or quota counter. Upload must bound declared and streamed multipart intake and exact parts before parsing; run the processor off-loop; create the `StickerAsset` with a newly generated UUID and the exact generated key; use `save_sticker_immutable(owner_id, asset_id, canonical_bytes)`; persist output metadata and commit. On known DB rollback, use only the generated operation key with validated narrow deletion. If DB commit outcome is unknown, preserve the object and resolve state before cleanup. Check that `owner_id` is non-null and `removed_at IS NULL` for listing, preview and first send. Removal sets only `removed_at`; it must not delete a message-referenced object. Custom message validation, retry semantics, serializers, community-scoped media reads, post-commit events and retention belong to CS4/CS6 and are not implemented here.

## Remaining gates carried forward

- **S1:** no S1 report/work was found in this inspection; its status and acceptance remain unknown, not passed.
- **PostgreSQL:** CS2 guarded migration acceptance is blocked as above. Existing P1.3 profile and P3.3 password/login/profile PostgreSQL concurrency acceptance, plus avatar PostgreSQL migration/concurrency coverage, remain unverified from the cited avatar reports; their previous attempts also stopped before identity/schema verification.
- **WebSocket/security:** prior reports still list live password-revocation socket closure and the revalidation-exception path as unresolved.
- **Avatar deployment:** durable storage mount, coordinated backup/restore and restore verification remain release gates. CS2 did not change avatar behavior or resolve these.
- **D1.3 frontend:** browser ownership/navigation/reload alignment and live two-account acceptance remain unverified; Chromium could not launch in the recorded run. CS2 did not touch frontend code.

Fish-compatible owner command for the isolated sticker PostgreSQL suite (use only the approved `irm_integration_test`/`irm_test` loopback service; the runner checks target identity, owns a marked schema and drops only that schema):

```fish
cd /home/yasso/irm-platform/backend
read -s -P 'Password for irm_test: ' IRM_ACCEPTANCE_DB_PASSWORD
echo
set -lx IRM_ACCEPTANCE_DB_PASSWORD $IRM_ACCEPTANCE_DB_PASSWORD
set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
set -lx IRM_ACCEPTANCE_DB_PORT 5432
set -lx IRM_ACCEPTANCE_RUN_ID (python -c 'import uuid; print(uuid.uuid4().hex)')
set -lx IRM_ACCEPTANCE_JOURNAL "/tmp/irm-sticker-$IRM_ACCEPTANCE_RUN_ID.jsonl"
./.venv/bin/python -m acceptance.profile --suite sticker-postgresql --heartbeat
set -l sticker_pg_status $status
printf 'sticker PostgreSQL status: %s; journal: %s\n' $sticker_pg_status $IRM_ACCEPTANCE_JOURNAL
test $sticker_pg_status -eq 0
```

The command intentionally does not fall back to development, owner or production databases. The avatar/profile/password acceptance reruns should use their existing documented guarded commands and retain separate result evidence.

Nothing was staged, committed, pushed, deployed or restarted.
