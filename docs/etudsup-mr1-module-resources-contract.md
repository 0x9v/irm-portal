# EtudSup MR1 — Module learning resources and staff approval contract

## Scope and inspection basis

This is an inspection and contract proposal only. No application source, tests,
models, or migrations were changed. The worktree already contains broad dirty
backend/frontend work, including the concurrent PR2 post-reply-image work; it
was preserved.

Inspected the live document/module/voting endpoints and services, `Document`,
`DocumentVote`, `Module`, membership and permission models, the module upload,
browse and reader pages, pending queue, auth/capability projection, removal
service, and the related document, U5 browsing, saved/submission, moderation,
and member-management reports. Current source is treated as authoritative;
reports are used as supporting context. Relevant paths are listed below.

## Current behavior

### Upload, browsing, and file access

The upload route requires a signed-in user and ACTIVE membership in the route's
community. It resolves the module by both community and module slug. The
multipart contract requires `title`, `type` (`COURSE`, `TD`, `TP`, `EXAM`,
`SOLUTION`, `OTHER`), and a file; `source` is optional only for MEMBER uploads.
The current file service accepts PDF, JPEG, and PNG MIME declarations, reads
at most `document_upload_max_bytes + 1` (default 50 MiB), stores a private
generated key, and creates a preview. Image upload therefore exists today, but
it is represented as a `Document` and sent through its preview/reader/file
routes. The declared content type is checked; the inspected service does not
decode/re-encode the original upload as the Sticker image processor does.

| Caller | Current upload rule | Result |
| --- | --- | --- |
| ACTIVE MEMBER | Source omitted or STUDENT; OFFICIAL is forbidden | STUDENT + PENDING |
| ACTIVE DELEGATE | Must explicitly select STUDENT or OFFICIAL | STUDENT + PENDING; OFFICIAL + APPROVED |
| ACTIVE MODERATOR | Must explicitly select source; STUDENT needs no extra grant; OFFICIAL requires `UPLOAD_OFFICIAL_DOCUMENTS` | STUDENT + PENDING; authorized OFFICIAL + APPROVED |

The ordinary module document list and detail return only APPROVED documents.
They require authentication, but not ACTIVE membership. The module file
download likewise requires authentication and APPROVED status. The global
inline view is approved-only, authenticated, and emits `nosniff` and
`private, no-store`; global full download is approved-only except that a
pending student document can be downloaded by an ACTIVE member of its owning
community who has cast their own YES vote. A submitter cannot cast that vote.

The preview endpoint accepts any authenticated user and returns the first-page
preview for PENDING or APPROVED documents; it conceals REJECTED documents. It
does not check ACTIVE membership or a vote. The pending list itself is limited
to ACTIVE community members and exposes only pending student submissions.
Thus a direct preview URL currently has a broader access rule than the pending
list and full-file download. This is an existing behavior to account for when
designing the new typed resource-preview route; it should not be accidentally
copied to newly introduced resource types.

PDF-specific behaviors include the PDF.js reader, page position and recent
reading records, bounded range probe, page navigation/zoom, browser inline
view, attachment download, and generated first-page preview. The reader also
renders current JPEG/PNG document uploads as images, but reading-position and
recent-page features are PDF-oriented. Saved documents and recent documents
are keyed to `Document`. YouTube and arbitrary external links have no current
model, endpoint, reader, preview, or module-list support.

### Voting, decisions, and removal

On each STUDENT + PENDING upload, the current community threshold is copied to
`Document.vote_threshold_snapshot`. Later changes to the community setting
affect future uploads only. The vote service locks the document row, then
checks ACTIVE membership in the document's owning community, pending/student
eligibility, uploader exclusion, and whether the voter already has a vote.
`DocumentVote` also has a unique `(document_id, voter_id)` constraint. A
duplicate vote returns 409; votes cannot be changed or deleted through the
current API.

Once total votes reach the saved threshold, more YES than NO approves and more
NO than YES rejects. **A tie at or above the threshold remains PENDING**; a
later eligible member may cast another vote and break it. A missing snapshot
fails closed with a 500 rather than reading the current community setting.
The document row lock serializes concurrent voting on PostgreSQL. The first
transaction that reaches a decisive state commits it; later transactions see
the terminal status and receive 409. Vote records are committed with the
resulting status. Automated voting has no `ManagementEvent` or other explicit
audit event in the inspected service.

No existing staff endpoint immediately approves a pending document. No
document-specific removal endpoint exists either. The generic Delegate content
removal contract covers announcements, replies, posts, post replies, and
discussion messages, not documents. Its `ManagementEvent` records removals;
document rows are preserved when a member is removed. Do not infer document
removal or staff approval from those unrelated routes.

### Role versus capability checks

ACTIVE membership is enforced at the route/service boundary for upload, pending
queue, and voting. Delegate status is treated as implicit possession of every
`PermissionType` by `has_community_permission`; an ACTIVE Moderator must have
the named grant; a MEMBER never passes that helper. Existing grants are:

- `UPLOAD_OFFICIAL_DOCUMENTS` — official-source moderator upload.
- `CREATE_ANNOUNCEMENTS`.
- `MANAGE_DOCUMENT_VOTING` — voting-threshold settings and current related
  management routes.

`MANAGE_DOCUMENT_VOTING` is not an existing document approval capability.
The generic content-removal endpoint is separately role-based: only an ACTIVE
DELEGATE is allowed; Moderator grants do not authorize it. Do not silently
reuse that endpoint's Delegate-only role check or assign unrelated permission
grants to make the new approval action work.

## Architecture comparison and recommendation

### 1. Extend `Document`

This is the smaller transition in database and service count. The current
document row already owns the module association, uploader, source, review
status, vote-threshold snapshot, and lock used by voting. Keeping that row as
the one review aggregate preserves `DocumentVote` uniqueness, the voting lock,
and current API identifiers. It avoids duplicating authorization and
threshold/finalization logic.

However, the present shape is file-specific: `storage_path` is non-null,
`type` is a document taxonomy, and preview/download/reader routes assume a
stored file. Adding URL resources directly would require nullable and
kind-conditional payload fields plus careful route branching. A careless
extension would push URLs through file paths or make existing document APIs
return incompatible payloads.

### 2. Add a module-resource abstraction; keep `Document` as a backing record

This separates resource identity and listing from file-specific PDF behavior,
and can model image, YouTube, and external-link payloads cleanly. But if both
`ModuleResource` and `Document` own review status, threshold snapshots, or
votes, there would be two approval systems. Making the abstraction canonical
requires a planned migration/backfill of existing document identity and review
state, plus a migration of `DocumentVote`'s target while preserving every vote
and existing saved/reading relationships. Keeping documents as backing assets
is clean only if exactly one canonical resource row owns review and voting.

### Recommendation

For this first release, extend the existing `Document` row as the canonical
reviewable module-resource identity, expose it through a new typed resource
API, and keep its existing PDF endpoints as compatibility adapters. Add an
explicit resource kind and mutually exclusive kind-specific payload; do not
use PDF preview/download code for links or YouTube. Keep PDF file paths and
reader behavior intact, route static image bytes through an image-specific
validated storage/serve path, and render validated URL kinds as safe external
links. This is the smallest approach that preserves the current vote target,
threshold snapshot, row lock, and document endpoint identifiers without a
second vote/authorization implementation.

The tradeoff is the legacy `Document` name. If a later migration needs a
first-class `ModuleResource` table, that table should become the **sole** owner
of source/status/snapshot and votes, with existing documents represented by
document-backed resources. That larger transition must backfill one resource
per existing document and preserve its ID mapping and vote history; it should
not be introduced partially with split review state. No such migration is
proposed or implemented here.

## Proposed resource contract

### Common fields and kind-specific payload

Resource kinds are `PDF`, `IMAGE`, `YOUTUBE`, and `LINK`. Every resource has a
UUID `id`, scoped `module_id`, `kind`, trimmed non-empty `title` (1–255
characters), optional trimmed `description` (maximum 2,000 characters),
`uploader_id`, `source`, `status`, `created_at`, and `updated_at`. `module_id`
must resolve under the community in the route. The client cannot set uploader,
status, or threshold snapshot. Empty descriptions normalize to null.

| Kind | Required payload | Forbidden payload |
| --- | --- | --- |
| `PDF` | One PDF upload; existing document taxonomy `type` remains required | Image key, YouTube ID, external URL |
| `IMAGE` | One validated static JPEG/PNG upload | PDF `type`, YouTube ID, external URL |
| `YOUTUBE` | One validated HTTPS YouTube URL, stored canonical video ID | File, PDF `type`, external-link URL |
| `LINK` | One validated HTTPS external URL | File, PDF `type`, YouTube ID |

The persisted representation must enforce one kind's payload only (validation
plus database constraints where practical). API fields for another kind are
rejected rather than ignored. Existing PDFs retain their row IDs, document
type, source, status, storage path, preview path, threshold snapshot, votes,
and current file behavior.

`Document.type` remains required for PDFs and is retained on historical
file-backed image rows for document-endpoint compatibility. New canonical
image, YouTube, and link rows have no document taxonomy value; their response
schemas expose only fields relevant to their resource kind.

### Image processing and storage

Accept only static JPEG and PNG, never SVG, GIF, animation, video, or audio.
Treat MIME as a hint and verify the decoded format against it. Final canonical
format and limits: lossless WebP, maximum 10 MiB input, 4,096 pixels per side,
16,000,000 pixels total, one frame, and 8 MiB encoded output. Probe and verify,
reopen and fully decode, apply EXIF orientation, preserve aspect ratio without
upscaling, then encode a fresh metadata-free WebP while preserving alpha. Do
not copy untrusted bytes directly into storage. Require WebP encoder
availability; failures return sanitized errors. Run decoding in a worker
thread. The existing document upload default is 50 MiB and is not used for
decoded image processing.

Use an immutable server-generated key scoped by community, module, and
resource ID/version; never accept a storage key from the client. Store images
privately and serve only through an authorization-checking route with fixed
media type, `nosniff`, and `private, no-store`. Do not run images through the
PDF first-page previewer. The image itself is the preview. Failed DB writes
must remove just-created storage objects; resource removal must not permit a
stale object to be served.

### URL validation and navigation

For YouTube input, accept only HTTPS URLs on exact `youtube.com`,
`www.youtube.com`, `m.youtube.com`, or `youtu.be` hosts. Accept `/watch?v=ID`,
`/shorts/ID`, and the single-segment `youtu.be/ID` form. Require the video ID
to match `[A-Za-z0-9_-]{11}`; reject playlists, embed URLs, extra path segments,
credentials, non-default ports, non-HTTPS schemes, and ambiguous duplicate
`v` values. Persist the video ID as canonical identity and return canonical
`https://www.youtube.com/watch?v={id}`. Do not scrape, fetch, unfurl, generate
thumbnails, or emit an iframe. A plain outbound link may be rendered with
`target="_blank"` only alongside `rel="noopener noreferrer"`; a normal same-tab
link is also safe.

For `LINK`, require a syntactically valid absolute HTTPS URL, at most 2,048
characters; reject credentials, control characters, malformed hosts, and
non-default ports. Do not fetch the URL server-side, resolve it for metadata,
or proxy it. Return the validated URL as an ordinary anchor and apply
`noopener noreferrer` for a new tab. The link response grants no download,
inline view, or storage access.

### Listing, filters, pagination, and response shapes

Keep existing document endpoints and their response schemas/behavior intact:

```text
GET  /communities/{community}/modules/{module}/documents[?q=&type=&source=]
GET  /communities/{community}/modules/{module}/documents/{document_id}
GET  /communities/{community}/modules/{module}/documents/{document_id}/download
GET  /documents/{document_id}/view
GET  /documents/{document_id}/download
GET  /documents/{document_id}/preview
POST /communities/{community}/modules/{module}/documents
POST /documents/{document_id}/vote
```

Add a resource endpoint rather than changing the shape of those responses:

```text
GET  /communities/{community}/modules/{module}/resources
POST /communities/{community}/modules/{module}/resources
GET  /communities/{community}/resources/pending
POST /communities/{community}/resources/{resource_id}/vote
POST /communities/{community}/resources/{resource_id}/approve
GET  /communities/{community}/resources/{resource_id}/preview
```

The ordinary resource list is APPROVED-only and authenticated, matching the
existing ordinary document-list audience. It accepts `kind`, `q` (trimmed,
literal title search, max 100 characters), and `source`; kind/source filters
are validated enums. Use a bounded keyset feed: `limit` defaults to 20 and is
1–50; `after` is an opaque/validated UUID cursor scoped to that module,
community, approval state, and filters. Sort by `(created_at DESC, id DESC)`;
fetch `limit + 1`; return no total count. Pending and removed rows do not
appear. Pending remains a separate active-member queue; it can be keyset
paginated using the same feed shape if volume requires it, without changing
the current legacy pending-document array response.

Resource output is a discriminated union with common fields above and only its
kind's payload: PDF returns `document_type` and a PDF document identifier;
IMAGE returns a same-origin `preview_url`; YOUTUBE returns `video_id` and
canonical URL; LINK returns its validated URL. Never return storage keys,
local paths, voter identities, or internal threshold values. Pending queue
items additionally return `is_uploader`, `my_vote`, `can_vote`, and the
documented preview descriptor, but no unrelated member data. All personal and
pending feeds use `private, no-store`.

Use these exact response envelopes (timestamps are ISO-8601 UTC strings;
UUIDs are strings). Kind-specific keys not shown for an item are omitted:

```json
{
  "items": [
    {
      "id": "<uuid>",
      "module_id": "<uuid>",
      "kind": "PDF",
      "title": "Algebra notes",
      "description": null,
      "source": "STUDENT",
      "status": "APPROVED",
      "created_at": "<timestamp>",
      "updated_at": "<timestamp>",
      "document_type": "COURSE"
    },
    {
      "id": "<uuid>",
      "module_id": "<uuid>",
      "kind": "YOUTUBE",
      "title": "Linear equations",
      "description": "A worked introduction",
      "source": "OFFICIAL",
      "status": "APPROVED",
      "created_at": "<timestamp>",
      "updated_at": "<timestamp>",
      "video_id": "dQw4w9WgXcQ",
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    }
  ],
  "next_cursor": null
}
```

`IMAGE` substitutes `preview_url` for URL payload fields; `LINK` uses `url`.
Pending entries add `is_uploader`, `my_vote` (`YES`, `NO`, or null),
`can_vote`, and `preview` (a kind-specific descriptor, with no file path).
`POST .../resources` takes common `kind`, `title`, optional `description`,
and the single matching payload: multipart `file` plus `type` for
PDF, multipart `file` for IMAGE, JSON `url` for YOUTUBE or LINK. The PDF
response names that taxonomy value `document_type`. `source` is
optional only for MEMBER, as on the existing PDF upload; delegates and
moderators explicitly select it. A successful creation returns the same
resource item shape and 201 status. `POST .../{id}/vote` retains the current
vote response shape `{ "vote": "YES", "full_document_access": true }` for
PDF compatibility; the resource vote response uses `{ "vote": "YES",
"full_resource_access": true }`. `POST .../{id}/approve` returns
`{ "id": "<uuid>", "status": "APPROVED" }` on the first transition; an
already terminal resource returns 409.

### Backward compatibility

Existing PDF upload, list, detail, preview, inline view, download, pending
queue, voting, saved-document, recent-reading, and My Submissions contracts
remain available with their current response fields and identifiers. Existing
clients continue to call the document routes. The new resource API is additive;
new UI may use it to list mixed resource kinds. PDF resources appear once in
ordinary module results, not as duplicate document and resource cards. Existing
document preview/download authorization remains as-is for compatibility until
an explicit access-contract change is approved. New IMAGE/YOUTUBE/LINK preview
routes must apply an explicit resource-kind policy and must not accidentally
inherit global document file privileges. Do not migrate Posts into Modules.

## Approval, vote, and access rules for new resources

Student-source submissions of every kind start `PENDING` and stay out of
ordinary approved module results. They snapshot the community's current
required total-vote threshold at submission. Approval/rejection follows the
current total, majority, and tie rules exactly. A snapshot is never recomputed
from current settings. A moderator's direct approval does not insert, edit, or
delete votes.

Preserve uploader exclusion and current vote eligibility: voter must have an
ACTIVE membership in the resource's owning community, resource must still be
pending and STUDENT source, uploader cannot vote, and each voter gets one
immutable vote. New resource votes use the shared decision routine and one
canonical resource row lock; they must not implement a second policy.

Pending preview usefulness:

- PDF: existing first-page preview and the existing full-download-after-YES
  rule.
- IMAGE: display the sanitized static image at bounded dimensions.
- YOUTUBE: display title, description, and canonical outbound video link only;
  no thumbnail, embedded player, or external fetch.
- LINK: display title, description, and validated outbound HTTPS link only;
  never proxy or download the target.

The current PDF preview endpoint is authentication-only even for pending data.
For new resource preview/list paths, require an ACTIVE membership in the
owning community while PENDING; approved resources keep the current ordinary
authenticated read audience. This closes the new path to users outside the
community without changing the legacy preview endpoint. Every lookup must be
scoped through resource → module → community; removed or foreign resources
return the same concealed 404 as unavailable resources.

## Staff immediate approval and concurrency contract

MR3 will add one explicit owner-community action on a pending resource. The
actor must have an ACTIVE membership in the resource's owning community and
role DELEGATE or MODERATOR. No new Moderator permission grant is required.
Members and staff from another community are denied. This action approves an
existing pending student resource only; it does not grant official upload,
voting-settings, content-removal, membership, or any other capability.
Existing staff upload source behavior remains: Delegate OFFICIAL uploads are
immediately approved; Moderator OFFICIAL uploads still require
`UPLOAD_OFFICIAL_DOCUMENTS`; staff STUDENT uploads remain pending and use the
community vote snapshot.

State transition is atomic and monotonic:

| Current state | Vote request | Staff approve request |
| --- | --- | --- |
| PENDING + STUDENT | Record one eligible immutable vote; decide only under existing threshold/majority/tie rule | PENDING → APPROVED |
| APPROVED | 409, no vote mutation | 409 `already decided`; no state or event mutation |
| REJECTED | 409, no vote mutation | 409 `already decided`; no override |
| Removed/unavailable | Concealed 404 | Concealed 404 |
| OFFICIAL/non-pending | 409 | 409; action is only for pending student submissions |

Both vote and approval lock the same canonical resource row before checking
state. If the threshold vote wins first, it commits its existing decision and
approval then observes APPROVED/REJECTED and does not alter it. If approval
wins first, it commits APPROVED and the waiting voter observes a terminal state
and gets 409 without adding a vote. The row lock and status predicate produce
one final decision. Repeat approval never changes `updated_at` or vote history.
Do not add staff rejection, reopen, or vote-rewrite actions.

There is no existing document approval event to reuse. The current management
event table is documented for removal actions and has a uniqueness rule keyed
to action/target. Before implementation, define a metadata-only `approve`
event for the winning staff transition (community, actor, resource target,
timestamp) and insert it in the same transaction, or explicitly decide that
staff approval is not audited. Recommended contract: write one event on the
first PENDING → APPROVED staff action; repeats create none; voting decisions
remain represented by the existing immutable votes and final status; never
rewrite vote history. Confirm that adding `approve` fits the owner-visible
management-event vocabulary before schema work.

## Removal and concealment boundary

There is currently no document/resource removal action. Generic content
removal explicitly excludes documents. This contract does not add a staff
removal capability. If a resource later becomes removable, it must be hidden
from ordinary and pending results and all preview/read routes, including direct
IDs, and its image storage must not remain servable; define that lifecycle
separately before implementation. Existing PDFs retain existing behavior.

## Legacy kind backfill and compatibility

Existing document rows do not persist a MIME column. The current upload
service stores a server-generated UUID filename with an extension selected
from the accepted declared MIME (`.pdf`, `.jpg`, `.jpeg`, or `.png`); the existing
download service also uses that suffix to choose its response MIME. The
original user filename is not used to form the storage key. Backfill `kind`
from this exact persisted storage-key suffix, case-insensitively: `.pdf` →
PDF; `.jpg`, `.jpeg`, or `.png` → IMAGE. Do not inspect storage contents or infer from
user filenames. If a row has any other suffix, abort the migration with its
row ID and a sanitized message; never default it to PDF. This preserves
existing PDF and image behavior according to the format metadata the current
application already trusts. No owner storage scan or reprocessing is needed.

Keep legacy `documents` routes and response schemas. Their ordinary and
pending queries must exclude URL kinds. Legacy PDF and image rows remain
available by their original IDs. New PDF resources can use the legacy file
path and remain compatible; new IMAGE resources use the new private image
key and only the resource media route. Every file-only legacy endpoint checks
kind and required path before resolving storage, so YouTube/LINK rows are
concealed as 404. No resource response exposes internal keys.

## Inspection references

Primary source inspected:

- `backend/app/models/document.py`, `document_vote.py`, `module.py`,
  `membership.py`, `membership_permission.py`, `management_event.py`.
- `backend/app/services/document.py`, `document_vote.py`,
  `content_removal.py`.
- `backend/app/api/deps.py`, `backend/app/api/v1/endpoints/documents.py`,
  `documents_global.py`, `modules.py`, `communities.py`.
- `frontend/src/app/communities/irm/modules/[moduleSlug]/upload/page.tsx`,
  `[moduleSlug]/page.tsx`,
  `[moduleSlug]/documents/[documentId]/page.tsx`,
  `frontend/src/app/communities/irm/documents/pending/page.tsx`, and
  `frontend/src/components/DocumentReader.tsx`.
- `backend/tests/api/v1/test_documents.py`,
  `test_document_voting.py`, `test_document_voting_flows.py`,
  `test_document_voting_thresholds.py`, `test_document_preview.py`,
  `test_document_inline_view.py`, `test_content_removal.py`, and
  `test_moderator_permissions.py`.

Supporting reports inspected: `docs/etudsup-u5-module-document-browsing.md`,
`docs/v0.1-document-qol-backend-acceptance.md`,
`docs/v0.1.19-my-document-submissions.md`,
`docs/v0.1.21-saved-documents.md`,
`docs/v0.1-delegate-content-moderation-backend.md`, and
`docs/v0.1-delegate-member-management-backend.md`.
