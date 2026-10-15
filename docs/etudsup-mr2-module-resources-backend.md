# ETUDSUP MR2 — Typed module-resource backend foundation

## Implementation

MR2 is implemented on the existing `Document` row. It adds resource kinds
`PDF`, `IMAGE`, `YOUTUBE`, and `LINK` with kind-specific payload constraints;
it does not add a resource table, approval action, or voting implementation.
Student submissions retain the existing pending state and vote-threshold
snapshot. Delegate/Moderator source rules remain intact, including the
separate `UPLOAD_OFFICIAL_DOCUMENTS` requirement for Moderator OFFICIAL
uploads.

The additive API is:

- `POST /api/v1/communities/{community_slug}/modules/{module_slug}/resources`
  creates URL resources from JSON and PDF/image resources from multipart.
- `GET /api/v1/communities/{community_slug}/modules/{module_slug}/resources`
  lists approved resources with `kind`, `q`, and `source` filters and bounded
  keyset pagination (`limit` 1–50, no total count).
- `GET /api/v1/communities/{community_slug}/resources/{resource_id}/preview`
  returns PDF first-page preview bytes, canonical image bytes, or a small URL
  descriptor. Pending access requires ACTIVE membership in the owning
  community; approved reads retain the authenticated audience.

Response items share the `Document` ID and common status/source/module/timing
fields. PDF exposes `document_type`; IMAGE exposes a same-origin `preview_url`;
YouTube exposes canonical `video_id` and URL; LINK exposes its validated URL.
Responses contain no storage key, local path, voter identity, or threshold.
New URL resources and canonical images do not enter file-only legacy routes or
lists. Existing PDF reader/download and document IDs remain compatible; legacy
JPEG/PNG rows preserve their existing file-backed behavior and taxonomy.

Legacy kind backfill uses the persisted, server-generated storage-key suffix:
`.pdf` → PDF and `.jpg`, `.jpeg`, `.png` → IMAGE. Unknown suffixes abort before
DDL with bounded row IDs. The migration does not inspect or reprocess files.
New static JPEG/PNG uploads are decoded off-loop and stored as metadata-free,
lossless WebP with alpha preserved: 10 MiB input, 4,096 pixels per side, 16M
pixels total, and 8 MiB output maximum. YouTube accepts exact supported HTTPS
hosts and canonical 11-character IDs. External links require validated HTTPS;
no URL is fetched, resolved, proxied, scraped, or embedded.

## Migration

MR2 revision **`b7c3e9a4d182`** follows PR2 revision **`e8a4f6b1c932`**.
`alembic heads` reports exactly one head, `b7c3e9a4d182`. The downgrade
refuses URL resources, canonical images, or non-null descriptions before DDL;
legacy IDs and relationships remain intact. The migration makes
`Document.type` nullable so URL resources and canonical images do not receive
invented PDF taxonomy. PDFs still require `type` at the request/schema
boundary; historical file-backed images keep their persisted taxonomy and the
legacy upload path continues to populate it.

MR3 handoff: add typed-resource voting and immediate approval against this same
locked `Document` row. Immediate approval is for pending student resources by
ACTIVE Delegates or Moderators in the owning community, with no new Moderator
grant. Keep OFFICIAL-upload permission separate, preserve vote history, and
serialize vote/approval state transitions on the same row. Confirm the
management-event vocabulary decision from the MR1 contract before adding
approval audit behavior.

## MR2 source and test files

- `backend/alembic/env.py`
- `backend/alembic/versions/b7c3e9a4d182_add_typed_module_resources.py`
- `backend/app/api/v1/api.py`
- `backend/app/api/module_resource_routes.py`
- `backend/app/api/v1/endpoints/module_resources.py`
- `backend/app/core/module_resources.py`
- `backend/app/core/storage/exceptions.py`
- `backend/app/core/storage/local.py`
- `backend/app/models/__init__.py`
- `backend/app/models/document.py`
- `backend/app/schemas/module_resource.py`
- `backend/app/services/document.py`
- `backend/app/services/document_vote.py`
- `backend/app/services/document_reading.py`
- `backend/app/services/module_resource.py`
- `backend/app/services/saved_document.py`
- `backend/acceptance/isolation.py`
- `backend/acceptance/profile.py`
- `backend/acceptance/run.py`
- `backend/tests/api/v1/test_module_resources.py`
- `backend/tests/core/test_module_resource_processing.py`
- `backend/tests/services/test_module_resource_migration_pg.py`
- `docs/etudsup-mr1-module-resources-contract.md` (approval clarification and finalized image/backfill contracts)

## Import and PR2 verification follow-up

The installed FastAPI version is 0.141.1. The current module-resource router
uses the supported router-level registration
`APIRouter(route_class=ModuleResourceMutationRoute)`, the same pattern used by
the repository's private-content routers. It contains no `route_class_override`
decorator argument. Per-route overrides used elsewhere are passed to
`APIRouter.add_api_route`, whose installed signature supports that parameter.
Normal, unshimmed `import app.main` succeeded; therefore no import-source
change was necessary for this report pass.

After aligning the PR2 test fixtures with their explicit trusted-Origin and
session-validation guards (using the fixture's isolated SQLite sessionmaker),
the following suite passed under the test-only
`acceptance.profile.loop_heartbeat(True)` accommodation:

```text
tests/api/v1/test_post_reply_images.py
tests/api/v1/test_post_reply_route_guards.py
tests/api/v1/test_community_posts.py
tests/api/v1/test_content_removal.py
tests/api/v1/test_announcement_replies.py
117 passed
```

The fixture corrections were test-only: they validate sessions against the
isolated test database, send the trusted Origin required by PR2, account for
the browser's `Vary: Origin` plus private-media `Vary: Cookie`, and convert a
response UUID to `UUID` before querying a SQLAlchemy UUID column. No route
security guard was removed. The successful rerun pinned application
configuration to a dummy PostgreSQL port and used only in-memory SQLite test
databases; it did not migrate or write an owner database. The earlier
diagnostic run without the dummy database settings is not counted as
acceptance.

The changed PR2 verification files in this follow-up are:

- `backend/acceptance/profile.py` (adds the focused
  `post-reply-images-postgresql` selector)
- `backend/tests/api/v1/test_post_reply_images.py`
- `backend/tests/api/v1/test_community_posts.py`
- `backend/tests/api/v1/test_content_removal.py`

## PostgreSQL acceptance and autogenerate classification

PostgreSQL migration/race acceptance remains owner-side pending because the
guarded loopback service is unavailable in this environment. The focused
selector is `post-reply-images-postgresql`; it runs only
`tests/services/test_post_reply_images_pg.py` through the lease-guarded
`acceptance.profile` runner. No owner database was migrated.

The prior PR2 report described five unrelated expression-index differences.
That original PostgreSQL diff artifact is not present in the worktree. A local
reproduction of the available SQLite parity assertion showed the two declared
descending indexes (reading and saved-document feeds) as remove/add pairs:
the SQLite inspector reflects the columns without their DESC expressions,
while model metadata uses SQLAlchemy `desc()` expressions. Their models and
migrations agree on the named index and ordered descending columns, so these
are reflection limitations, not a reason to rewrite indexes. The same local
diff also surfaced a separate real schema mismatch: `StickerAsset.removed_at`
exists in model metadata but is not added by the content-removal migration's
`CONTENT_TABLES`. This unrelated drift was not suppressed or changed. Because
the original five PostgreSQL diff entries were unavailable, their exact
identity remains unverified; no differences were filtered to claim parity.

Fish-compatible focused owner run (prompts silently for the approved
`irm_test` password; press Enter if the approved role uses trust auth):

```fish
function irm_pr2_post_reply_pg
    cd /home/yasso/irm-platform/backend; or return
    set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
    set -lx IRM_ACCEPTANCE_DB_PORT 5432
    set -lx IRM_ACCEPTANCE_RUN_ID (.venv/bin/python -c 'import uuid; print(uuid.uuid4().hex)')
    set -lx IRM_ACCEPTANCE_JOURNAL "/tmp/irm-pr2-post-reply-$IRM_ACCEPTANCE_RUN_ID.jsonl"
    read --silent --prompt-str='Approved irm_test password: ' IRM_ACCEPTANCE_DB_PASSWORD
    or return
    echo
    set -lx IRM_ACCEPTANCE_DB_PASSWORD "$IRM_ACCEPTANCE_DB_PASSWORD"
    .venv/bin/python -m acceptance.profile --suite post-reply-images-postgresql --heartbeat
end
```

The profile is pinned by its guard to loopback `irm_integration_test` / `irm_test`,
creates fresh leased schemas, journals leases, and verifies cleanup. Do not
substitute the broad `acceptance.run` PostgreSQL regression stage for this
focused run.
