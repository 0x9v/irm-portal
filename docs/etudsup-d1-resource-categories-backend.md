# ETUDSUP D1 — resource categories backend

## Contract and data decision

`Document.type` remains the sole stored academic category. Its persisted values are `COURSE`, `TD`, `TP`, `EXAM`, `SOLUTION`, and `OTHER`. The column was already nullable. Historical null values remain null, and existing non-null values remain unchanged. `resource_kind` (`PDF`, `IMAGE`, `YOUTUBE`, `LINK`), `source`, and approval `status` remain independent. No document row, ID, file, owner, vote, saved relationship, or reading record is rewritten by D1.

The existing `ck_document_resource_payload` constraint prohibited a non-null `type` for canonical images and URL resources. Revision `c8e4f1a2b603` follows the verified sole head `b7c3e9a4d182` and changes only that constraint. PDF still requires a category. The downgrade refuses categorized canonical images or URL resources before restoring the old constraint. The model and new constraint retain the same YouTube ID length predicate as the prior migration.

Typed creation accepts the existing wire field `type` for every kind. PDF multipart still requires it. IMAGE multipart and YOUTUBE/LINK JSON may omit it or use JSON `null`, which stores null. An empty string, unknown value, duplicate multipart field, or multipart text `null` is invalid (422). URL JSON remains strict about extra fields; upload ownership, status, and storage fields are not accepted. Existing source permission and review rules are unchanged.

Typed create, approved browse, and pending review responses now include `category` with the persisted value or `null`. PDF also retains its existing `document_type` response field, equal to `category`. The legacy file-only document routes retain `type` and their existing visibility boundaries; they do not gain canonical images or URLs.

The mixed-resource browse endpoint accepts `category=TD` independently of `kind=PDF`. Database filters for category, kind, literal title search `q`, and source run before keyset pagination. With no category filter, unclassified resources are included; an explicit category excludes them. A cursor must belong to the current module and match every active filter or the API returns 404. Ordering remains `created_at DESC, id DESC`; `limit` remains 1–50.

## D2 handoff

| Persisted value | Existing document label | Existing upload label | Intended short label |
| --- | --- | --- | --- |
| `COURSE` | Course | Course | Cours |
| `TD` | Tutorial | TD (Tutorial) | TD |
| `TP` | Practical work | TP (Practical) | TP |
| `EXAM` | Exam | Exam | Examen |
| `SOLUTION` | Solution | Solution | Solution |
| `OTHER` | Other | Other | Autre |

Use these same six values in browsing and submission. D2 should place academic category controls prominently before format controls and keep both independent. Change display labels without changing persisted values.

- Multipart PDF or IMAGE: fields `kind`, `title`, `type=TD`, optional `description` and `source`, and exactly one `file`. PDF requires `type`; IMAGE can omit it for old clients.
- JSON YOUTUBE or LINK: `{"kind":"LINK","title":"TD notes","url":"https://example.com/td","type":"TD"}`. `type` is optional for old clients; `null` is accepted. Empty strings are rejected in both encodings.
- Browse: `GET /api/v1/communities/irm/modules/algebra/resources?category=TD`; combine with `kind=IMAGE`, `q=waves`, `source=STUDENT`, `limit=20`, and `after=<UUID>` as needed. Reset `after` and the accumulated list whenever any filter changes. A stale or mismatched cursor yields 404; reload the first page.
- Categorized typed response: `{"id":"<UUID>","kind":"IMAGE","category":"TD",...}`. Unclassified response: `{"id":"<UUID>","kind":"LINK","category":null,...}`. PDFs also carry `"document_type":"TD"`.
- Existing clients that omit category for IMAGE/YOUTUBE/LINK continue to create unclassified resources. Existing legacy document endpoints remain file-only and use their old `type` response/query field. The earlier MR1/MR2 rule prohibiting URL/image `type` input is superseded here.

## Verification and acceptance

Authored: `backend/alembic/versions/c8e4f1a2b603_allow_categories_on_all_resource_kinds.py`, this report. Modified: `backend/acceptance/isolation.py`, `backend/app/models/document.py`, `backend/app/schemas/module_resource.py`, `backend/app/api/v1/endpoints/module_resources.py`, `backend/app/services/module_resource.py`, `backend/tests/api/v1/test_module_resources.py`, `backend/tests/services/test_module_resource_migration_pg.py`.

- `acceptance.profile --suite module-resource-api --heartbeat`: 89 passed, 0 failed; evidence `/tmp/irm-profile-evidence-dcnkivh9/profile-result.json`.
- Focused legacy document API suites (documents, browsing, pending discovery, saved documents, reading): 53 passed, 0 failed.
- Final typed-resource API and document-model rerun after constraint alignment: 22 passed, 0 failed.
- Python syntax checks, `alembic heads` and acceptance `check_head()`: passed; one head, `c8e4f1a2b603`.
- `acceptance.profile --suite module-resource-postgresql --heartbeat`: blocked during setup by `OperationalError`, before identity verification, schema creation, migration, or any PostgreSQL assertion. Evidence `/tmp/irm-profile-evidence-hxjrolbi/profile-result.json` records no outstanding owned schema and removed temporary storage. The remaining acceptance gate is to run this guarded disposable-schema suite when the approved `irm_integration_test` / `irm_test` service is available, then inspect its cleanup evidence.

No owner or production database was altered. No frontend D2 work, deployment, staging, commit, push, or service restart was performed.
