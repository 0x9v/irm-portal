# ETUDSUP MR3 — Resource review backend and R2 C1/C4/C5

## Status and ownership

MR3 backend source is implemented on `/home/yasso/irm-platform` `main` at HEAD `e2e6ec8eb4081ae2f8883bd93a297e73098325e0` plus the existing dirty tree. Before editing, the router still had only MR2 create/approved-list/preview operations; no MR3 implementation or report was present. The live agent roster showed only this agent, and no build/test process owned the shared files. The separate reference worktree was not read or merged. The resource backend, its focused tests, the existing focused acceptance selector and this report were the only intended MR3 scope. No frontend, dependency, owner DB, service, staging, commit or deployment action occurred.

**C1 is implemented in source and passed API tests; PostgreSQL race/migration acceptance is blocked by an unreachable approved disposable endpoint.** C4 and metadata-created C5 behavior passed focused tests. Migrated PostgreSQL C5 parity remains pending for the same connection blocker. This is not a claim of full release acceptance.

## Exact additive wire contract

All paths below have `/api/v1` in front. The existing MR2 `POST /communities/{community_slug}/modules/{module_slug}/resources`, approved `GET` feed, and `GET /communities/{community_slug}/resources/{resource_id}/preview` remain. Legacy document endpoints and their response fields are unchanged.

| Endpoint | Request | Response and access |
| --- | --- | --- |
| `GET /communities/{community_slug}/resources/pending` | ACTIVE community session; `limit=20` by default, 1–50; optional scoped UUID `after`. | `200 {"items":[…],"next_cursor":null|"<uuid>"}` ordered newest `(created_at,id)` first. Every item has the MR2 kind-specific base fields plus `module_slug`, `module_name`, `is_uploader`, `my_vote` (`YES`/`NO`/null), `can_vote`, `can_approve`, `full_resource_access`, and `preview`. PENDING STUDENT rows only. No voter identity, storage key, path or threshold leaks. Invalid/foreign cursor 404. Private, no-store; cookie-varying response. |
| `POST /communities/{community_slug}/resources/{resource_id}/vote` | Trusted `Origin`, bounded JSON `{"vote":"YES"|"NO"}`, current ACTIVE membership in owning community. | `200 {"vote":"YES"|"NO","full_resource_access":true|false}`. One immutable `DocumentVote` on the canonical `Document` row; uploader 403, duplicate/terminal/ineligible 409, foreign ID 404. PDF `full_resource_access` follows legacy YES-voter/approved semantics; pending IMAGE/YOUTUBE/LINK payloads are visible to active members. |
| `POST /communities/{community_slug}/resources/{resource_id}/approve` | Trusted `Origin`, bounded JSON `{}`, current ACTIVE MODERATOR or DELEGATE in owning community; no Moderator grant. | First PENDING STUDENT transition: `200 {"id":"<uuid>","status":"APPROVED"}`. Repeat, terminal or ineligible: 409 with no new event or vote change. MEMBER 403; foreign ID 404. |

File preview descriptors are `{"url":"/api/v1/communities/{community_slug}/resources/{id}/preview","media_type":"image/png"|"image/webp"}`. PDF and legacy IMAGE use PNG; canonical IMAGE uses WebP. YOUTUBE/LINK descriptors are `{"url":"<validated HTTPS URL>"}` and carry no fetched thumbnail or file URL. `full_resource_access` is false for a pending PDF without the caller's YES vote; it is true for pending non-PDF resources because the protected preview or validated outbound URL supplies the usable content. `can_vote` is false for the uploader or a caller who already voted. `can_approve` is true only for ACTIVE staff. Approved/REJECTED resources leave the pending feed.

Both review mutations re-read the actor through the existing **User → Membership** lock order, then lock the same `Document` row used by voting. Authority, source, status and duplicate state are checked after locks. Voting calls the existing `_evaluate_document_votes` routine, preserving the submission threshold snapshot, total-vote majority, pending ties, terminal decisions and legacy YES-voter file access. Staff approval adds one metadata-only `ManagementEvent(action="approve", target_type="module_resource")` in the same transaction as the status transition; it preserves existing vote rows and snapshot. The existing management-event uniqueness constraint already covers this action and target, so **no new migration is needed**. OFFICIAL-upload permission remains a separate upload rule; no staff rejection, reopening, removal or vote rewriting was added.

The resource route guard now checks the exact trusted browser Origin before bounded POST intake, caps JSON at 16 KiB and multipart at the existing document limit plus overhead, and applies private no-store / `Vary: Cookie` to successful and error responses. A malformed approval body fails 422. This also hardens the existing MR2 creation POST without changing its successful wire shape; the focused MR2 tests now supply a trusted Origin.

## C4 and C5 corrections

- `app/core/module_resources.py::process_module_resource_image`: known malformed/unsupported images remain input errors. An unexpected decoder exception or failure during output encoding produces the operational `image_processing_failed` outcome; the route maps it to sanitized **500** `Image processing unavailable` without exception text. A failed WebP availability probe produces `webp_encoder_unavailable`, also mapped to 500. Injected decoder/encoder failures and the HTTP response passed focused tests.
- `app/models/document.py::ck_document_description_length` now matches MR2 migration `b7c3e9a4d182`: at most 2,000 characters, nonblank after `trim`, and stored text equal to its trimmed form. Metadata-created schema tests reject empty, whitespace, leading/trailing whitespace and overlength text. The new migrated-schema test checks the same values in disposable PostgreSQL; it collected but could not execute because the approved target was unreachable. No historical migration was edited.

## Changed files and migration graph

- `backend/app/api/module_resource_routes.py` — Origin, body, private response handling.
- `backend/app/api/v1/endpoints/module_resources.py` — pending feed, vote/approve endpoints and response projection; C4 route mapping.
- `backend/app/core/module_resources.py` — operational encoder classification.
- `backend/app/models/document.py` — C5 metadata constraint parity.
- `backend/app/schemas/module_resource.py` — pending discriminated response, vote and approval schemas.
- `backend/app/services/module_resource.py` — bounded pending query, locked typed voting, atomic staff approval.
- `backend/tests/api/v1/test_module_resources.py` — MR3 API, legacy boundary, C4/C5 and mutation guard assertions.
- `backend/tests/core/test_module_resource_processing.py` — injected decoder/encoder failure assertions.
- `backend/tests/services/test_module_resource_review_pg.py` — guarded races, authority loss, audit rollback, migrated C5 cases.
- `backend/acceptance/profile.py` — focused MR2/MR3 API and PostgreSQL selectors with relevant legacy vote/permission regressions.
- `docs/etudsup-mr3-resource-review-backend.md` — this evidence and MR5 handoff.

Static inspection found **31 revisions, exactly one head**: `d1e2f3a4b5c6 → e8a4f6b1c932 → b7c3e9a4d182`. `backend/acceptance/isolation.py::HEAD` remains `b7c3e9a4d182` and its layout pin still matches; MR3 adds no column, index or constraint. The existing CS2 migration already defines `StickerAsset.removed_at`; no redundant revision was introduced. Existing MR2 migration tests cover legacy PDF/JPEG/PNG backfill and ID/vote preservation. Legacy list/vote/save/recent/mine queries still exclude storage-less canonical image/URL rows, so their non-null `DocumentType` schemas remain compatible.

## Executed evidence and exact blocker

The final focused command `.venv/bin/python -m acceptance.profile --suite module-resource-api --heartbeat` passed **87 tests** in seven files: module-resource API 17; image processing 35; storage 13; legacy document voting 10; voting flows 3; threshold rules 3; Moderator permissions 6. Its locally inspected result is `/tmp/irm-profile-evidence-os8nzfm0/profile-result.json`: `pytest_exit_status=0`, zero failures/errors/skips, temporary storage removed. Earlier exploratory runs were 56 passed and then 63 passed/1 failed (the injected encoder test accidentally intercepted the WebP availability probe); that test fixture was corrected and the final 87-pass result supersedes them. `py_compile` and `git diff --check` for the changed backend scope passed.

The guarded PostgreSQL selector `.venv/bin/python -m acceptance.profile --suite module-resource-postgresql --heartbeat` was attempted **once** and stopped in setup with `OperationalError`. Locally inspected `/tmp/irm-profile-evidence-arolef2y/profile-result.json` records no pytest result, no tests, `cleanup.database="no outstanding owned schema"` and temporary storage removed. Its journal was absent because no lease was created. The harness was configured for loopback `irm_integration_test` / `irm_test`, but **server identity was not reached or verified**; no nested lease, migration or PostgreSQL assertion ran. It was not retried. Focused collection under explicit disposable test settings found **7 PostgreSQL cases** (2 existing MR2 migration, 5 new MR3 review); collection is not execution. No owner application database was contacted or migrated.

Owner-only fish functions for the approved disposable target (the API function needs no PostgreSQL service; the PG function requires the approved role and endpoint):

```fish
function irm_mr3_api
    cd /home/yasso/irm-platform/backend; or return
    .venv/bin/python -m acceptance.profile --suite module-resource-api --heartbeat
end

function irm_mr3_postgresql
    cd /home/yasso/irm-platform/backend; or return
    set -lx IRM_ACCEPTANCE_DB_HOST 127.0.0.1
    set -lx IRM_ACCEPTANCE_DB_PORT 5432
    set -lx IRM_ACCEPTANCE_RUN_ID (.venv/bin/python -c 'import uuid; print(uuid.uuid4().hex)')
    set -lx IRM_ACCEPTANCE_JOURNAL "/tmp/etudsup-mr3-$IRM_ACCEPTANCE_RUN_ID.jsonl"
    if not set -q IRM_ACCEPTANCE_DB_PASSWORD
        read --silent --prompt-str='Approved irm_test password: ' IRM_ACCEPTANCE_DB_PASSWORD; or return
        echo
        set -lx IRM_ACCEPTANCE_DB_PASSWORD "$IRM_ACCEPTANCE_DB_PASSWORD"
    end
    .venv/bin/python -m acceptance.profile --suite module-resource-postgresql --heartbeat
end
```

After the PG run, inspect the printed `profile-result.json` for `server_identity` (`irm_integration_test` / `irm_test`), seven executed results, `pytest_exit_status=0`, owned schema drop and temporary storage removal. Check every nested lease in the journal is closed; do not infer this from a 0 exit alone. The suite selectors are exactly `tests/services/test_module_resource_migration_pg.py` and `tests/services/test_module_resource_review_pg.py`. Do not replace this with a generic backend suite against application settings or repeat earlier B1 suites.

## Exact MR5 frontend handoff

Use the three new paths and response fields above. The pending feed includes **all four kinds** and the owning `module_slug`/`module_name`; paginate with `next_cursor`, treat a 404 cursor as stale and reload, and use `can_vote`/`can_approve` from the current feed rather than inferring role from the browser. Fetch file `preview.url` with credentials and no-store; PDF gets a first-page PNG, legacy IMAGE a PNG and canonical IMAGE a WebP. YOUTUBE/LINK `preview.url` is an HTTPS outbound destination, not a backend image request. A vote or approval 409 means the queue is stale: refresh without automatically repeating the mutation. A network/5xx uncertainty must be reconciled by reloading before a new action. PDF `full_resource_access` retains the YES-voter file rule; the legacy pending-document page and its response shape remain intact. The upload/source rules remain unchanged. Frontend implementation and browser acceptance belong to MR5/MR6, not this backend task.
