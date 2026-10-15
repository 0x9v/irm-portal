# EtudSup B1 — Multi-community backend audit and implementation plan

**Scope:** read-only backend and documentation audit. No schema/API implementation is included here.

**Repository authority:** inspected on 2026-10-11. The worktree was already extensively modified and contained untracked files before this audit. Those files were preserved; this report is the only file added by this task.

## Executive findings

- Authentication identifies a `User` through a database-backed HTTP-only session. The session has no community context. Membership is a separate row, but the database partial unique index and three service paths currently enforce a single PENDING or ACTIVE membership globally.
- The existing `(user_id, community_id)` unique constraint already provides the desired one-row-per-user/community rule. The global partial index can be retired without changing membership IDs or rows. Approval, applications, and delegate appointment must be changed in the same release as the index retirement.
- Most authorization is already evaluated against the requested community. Module/document routes, pending membership review, voting, membership management, posts, announcements, discussion history, and WebSocket auth use community ownership. Preserve those predicates and test records deliberately placed in a second community.
- Modules and documents currently inherit their scope through `Module.community_id`. A programme-level module would make its documents reusable across annual communities, but existing membership voting and the single document status are not annualized. The cleanest later design keeps stable academic resources at Programme scope and makes upload/review decisions explicitly community-scoped; it must not silently reuse one cohort's pending state or votes as another cohort's review.
- Keep the existing IRM `Community.id`, membership IDs, module IDs, document IDs, stored paths, content IDs, and personal saved/reading rows. Link the existing IRM row to a Programme by an additive FK backfill. Do not guess its academic year or infer applicant types.
- Community creation is not exposed as an API. Delegate powers are scoped to one community and must stay that way. A public directory needs a new minimal public response; current module and application-options routes do not provide one.

## A. Current schema and relationships

### Relationship map

| Table/model | Existing relationships and relevant constraints |
|---|---|
| `users` / `User` | UUID PK; unique username and email. Owns sessions, memberships, uploaded documents, votes, saved documents, reading records, and authorship/reaction records. Account identity is independent of community membership. |
| `sessions` / `Session` | UUID PK; `user_id → users.id ON DELETE CASCADE`; unique token hash and expiry/revocation state. Authentication yields a User only. |
| `communities` / `Community` | UUID PK; globally unique `slug`; name; `document_vote_threshold >= 1` check. Has memberships, modules, announcements, posts, and discussion messages. There is no programme, institution, academic-year, archive, or public-directory field. |
| `memberships` / `Membership` | UUID PK; `user_id → users.id CASCADE`, `community_id → communities.id CASCADE`; unique `(user_id, community_id)`; partial unique index `uq_memberships_global_active_pending` on `user_id` where status is PENDING or ACTIVE; partial unique index `uq_memberships_community_active_delegate` on `community_id` where ACTIVE/DELEGATE. Stores status, role, CNE, nullable application fields (`applicant_type`, names, identifier type, promotion). |
| `membership_permissions` | FK `membership_id → memberships.id CASCADE`; unique `(membership_id, permission)`. Grants are attached to a community membership, not a User. |
| `modules` / `Module` | UUID PK; `community_id → communities.id CASCADE`; unique `(community_id, slug)`. This is the parent scope for every document today. |
| `documents` / `Document` | UUID PK; `module_id → modules.id CASCADE`, `uploader_id → users.id CASCADE`; indexes on module and uploader. Checks: threshold snapshot >= 1; pending student documents must have a threshold snapshot. Stores status, source/type, storage and preview paths, snapshot, timestamps. |
| `document_votes` | `document_id → documents.id CASCADE`, `voter_id → users.id CASCADE`; unique `(document_id, voter_id)`, indexes on each FK. Vote eligibility is based on ACTIVE membership in the document module's community. |
| `saved_documents` | `user_id → users.id CASCADE`, `document_id → documents.id CASCADE`; unique `(user_id, document_id)`; indexes `(user_id, created_at DESC, id DESC)` and `document_id`. Community is derived through document → module → community. |
| `document_reading_records` | `user_id → users.id CASCADE`, `document_id → documents.id CASCADE`; unique `(user_id, document_id)`; positive-page check; indexes `(user_id, last_opened_at DESC, id DESC)` and `document_id`. Community is derived through document → module → community. |
| `announcements` | `community_id → communities.id CASCADE`, `author_id → users.id CASCADE`, community/author indexes. Soft-removal actor FK is `SET NULL`. |
| `announcement_replies` | `announcement_id → announcements.id CASCADE`, `author_id → users.id CASCADE`; parent/order and author indexes. Soft-removal actor FK is `SET NULL`. |
| `community_posts` | `community_id → communities.id CASCADE`, `author_id → users.id CASCADE`; community/order and author indexes. Optional module tags use `post_modules`. Soft-removal actor FK is `SET NULL`. |
| `post_modules` | Composite PK `(post_id, module_id)` with cascading FKs to posts and modules; index on `module_id`. The DB does not constrain tagged module and post to the same community; `create_community_post` validates it in service code. |
| `community_post_replies` | `post_id → community_posts.id CASCADE`, `author_id → users.id CASCADE`; parent/order and author indexes. Soft-removal actor FK is `SET NULL`. |
| `discussion_messages` | `community_id → communities.id CASCADE`, `author_id → users.id CASCADE`; unique `(community_id, author_id, client_message_id)` for retries; community/order index. Soft-removal actor FK is `SET NULL`. |
| `discussion_reactions` | `message_id → discussion_messages.id CASCADE`, `user_id → users.id CASCADE`; unique `(message_id, user_id)` and message/emoji index. Community is derived through the message. |
| `management_events` | `community_id → communities.id RESTRICT`, `actor_id → users.id SET NULL`; metadata-only polymorphic target `(target_type, target_id)`. Partial unique index `(community_id, action, target_type, target_id)` where `target_type != 'membership'`; repeated membership actions are allowed. |

The models are registered in `backend/app/models/__init__.py`; Alembic imports them through `backend/alembic/env.py`. `Community.document_vote_threshold` is annual/community-level today. `Document.vote_threshold_snapshot` freezes the threshold used when a student upload enters voting. `Membership.promotion` is currently a per-membership application value, not a normalized programme relation.

### Current Alembic chain

Static `alembic heads` and `alembic history --verbose` report exactly one head, `c7e4a9d213f6`, with this single chain:

```text
dd021d7df98f users
→ 9b0eb59782b9 communities
→ 6466b3659e3b sessions
→ e51d75b18287 memberships
→ 95af7394f5be membership role
→ a2f015c95d8d modules
→ 89d2d5cb2fe2 documents
→ 87dc5e99ac98 moderator role
→ 75c1a93cb232 announcements
→ 3eeecb92fbc2 document votes
→ 92bb2697b74d preview path
→ 2b032f8c674b global PENDING/ACTIVE membership index
→ 589ce55cec37 document voting thresholds
→ 35fb40df73f5 membership permissions
→ b0d0b009b5e7 active Delegate partial index
→ 86fd7c69425d announcement replies
→ e7b1a2c3d4e5 community posts/replies/post_modules
→ f8c2b3d4e5f6 discussion messages/reactions
→ a916c0e16b01 content removal and management events
→ c4d8e9f1a2b3 delegate member management
→ d7a9b6c4e213 application fields
→ 98b4d2a6f731 membership identifier type
→ b21d7a4c9e60 saved documents
→ c7e4a9d213f6 reading records (current head)
```

The global index was introduced at `2b032f8c674b_add_global_active_pending_membership_.py`. The database guard pins `HEAD = "c7e4a9d213f6"` in `backend/acceptance/isolation.py`, which matches Alembic. Its static `TABLES` list currently omits `saved_documents` and `document_reading_records` despite those being part of the current chain; add them when the guard is next updated for implementation acceptance. The guard also needs assertions for new programme/community columns and tables as those land.

## B. Route and authorization matrix

“Member of another community” means ACTIVE in community A but no qualifying membership in requested community B. For the existing route families below, that person receives the same result as a non-member in B unless explicitly stated.

| Route/service family | Guest | Authenticated non-member | PENDING in target | ACTIVE MEMBER | ACTIVE MODERATOR | ACTIVE DELEGATE | Member of another community |
|---|---|---|---|---|---|---|---|
| `/auth/register`, `/auth/login`, `/auth/logout`; `/auth/me` | Register/login/logout public; `/me` 401 | Account/session works | Same | Same | Same | Same | User/session remains account-wide; no community context |
| `POST /communities/{slug}/membership` | 401 | May apply | Existing same-community pending request conflicts; new request not duplicated | Existing same-community active conflicts | Same | Same | Currently blocked if they have PENDING or ACTIVE membership anywhere, including ACTIVE in A |
| `/membership/me`, `/membership/application-options` | 401 | Own state/options available | Own PENDING details/options | Own ACTIVE details/options | Same | Same | Correctly reads only the requested community row; options require an existing community |
| `/membership/pending` | 401 | 403 | 403 | 403 | 403 | Exact ACTIVE Delegate can list | A's role does not authorize B. The list is target-community scoped. |
| Approve/reject membership | 401 | 403 | 403 | 403 | Moderator with `MANAGE_DOCUMENT_VOTING` grant passes the current dependency | Delegate passes (Delegate permissions are implicit) | A's role/grants do not authorize B; target membership is resolved by `(id, community_id)` |
| `/membership/{id}` withdraw | 401 | 404 unless own target row in target community | Own PENDING can withdraw; other states conflict | Cannot withdraw ACTIVE | Same | Same | A membership ID does not authorize or select B's row |
| Member directory, active/banned list, role, permissions, remove/ban/unban | 401 | 403 | 403 | 403 | 403 for delegate-only management | Delegate can manage members in B; Moderator cannot | Delegate in A has no powers in B; cross-community target IDs are masked/not found |
| Module list/detail | 401 | 200 for existing community | 200 | 200 | 200 | 200 | Authenticated A member may read B's module metadata; this route is not private content |
| Approved module document list/detail/global inline and download | 401 | 200 for APPROVED docs; pending/rejected concealed | Same | Same | Same | Same | Approved document access is not membership-gated; the owning community matters for pending student voting access |
| Upload and My Submissions; pending student-document list | 401 | 403 | 403 | Allowed under current source/role rules | Allowed subject to official-upload grant | Allowed | ACTIVE in A does not satisfy B's upload/review gate |
| Document vote and pending-student full download | 401 | 403/404 | 403 | ACTIVE membership in document's owning community required; own uploader cannot vote; own YES vote permits pending full download | Same | Same | Membership in A cannot vote/access pending full document owned by B |
| Saved-document state/list/mutations and Recent Documents | 401 | Authenticated access to approved documents; no ACTIVE membership needed | Same | Same | Same | Same | Personal record is filtered by requested community and current document scope; only caller's rows are returned |
| Announcements, replies, community posts/replies, discussion REST | 401 | 403 | 403 | Read/write ordinary member operations | Same ordinary content permission; grants do not expand to delegate removals | Ordinary read/write plus soft-removal authority | A membership alone gives no B access |
| Announcement creation | 401 | 403 | 403 | 403 unless delegated permission model permits; ordinary MEMBER denied | Requires `CREATE_ANNOUNCEMENTS` grant | Allowed (Delegate has all community permissions) | A grant does not authorize B |
| Discussion WebSocket `/discussion/ws` | Rejected/closed | Rejected/closed | Rejected/closed | Accepted for the target community, then periodically revalidated | Same | Same | A socket is authorized against requested slug and B's ACTIVE membership; broadcaster rooms keyed by community slug |
| Public community directory / community creation | No current directory route | No current directory route | No current route | No current route | No current route | No current route | No current platform-wide authority exists |

Authorization evidence is implemented primarily in `backend/app/api/deps.py` (`get_current_user`, `get_current_active_membership`, `require_community_delegate`, `has_community_permission`) and endpoint dependencies. The route-level review anomaly should be explicitly retained or corrected as a separately reviewed product/security decision: `api_approve_membership` and `api_reject_membership` currently use `require_community_permission(MANAGE_DOCUMENT_VOTING)`, not an explicitly named membership-review permission. Do not grant platform-wide powers through this dependency.

## C. Exact assumptions, scopes, and cross-community review

### Global membership assumptions that must change

1. `backend/app/models/membership.py::Membership.__table_args__` defines `uq_memberships_global_active_pending` on `user_id`, partial on PENDING/ACTIVE. This blocks multiple current memberships even if services allow them.
2. `backend/app/services/membership.py::create_membership_request` searches by `user_id` plus PENDING/ACTIVE with no community predicate, then refuses another community. It already looks up the target community's prior membership separately and reuses a REJECTED/REMOVED row; BANNED is denied.
3. `backend/app/services/membership.py::_review_membership` rejects approval if another PENDING/ACTIVE row exists for the user, regardless of community. It locks the User before membership, then resolves the requested membership by `(id, community_id)`.
4. `backend/app/services/provisioning.py::appoint_delegate` rejects any PENDING/ACTIVE row in any other community, in addition to enforcing one ACTIVE Delegate per target community. This utility is not a platform permission model; its caller must remain a controlled operator path.
5. `backend/alembic/versions/2b032f8c674b_add_global_active_pending_membership_.py` creates the global partial index. The earlier `uq_memberships_user_community` from `e51d75b18287` already guarantees one row per pair and is the constraint to retain.
6. `backend/app/api/v1/endpoints/communities.py::get_self_membership` correctly scopes by user and community; it returns one community's membership/capabilities. There is no account-wide membership-context resolver in backend auth. `get_current_active_membership` is also correctly scoped by target slug and user. Future API surfaces should keep this per-community shape and must not reintroduce “the user's current membership” as a singleton.
7. `backend/app/services/membership.py::_handle_integrity_error` maps the global index name to a generic existing-membership conflict. Remove that special mapping when the index is retired; retain handling for `(user_id, community_id)` and the per-community Delegate index.

### State outcomes today and recommended outcomes

| User state | Current possibility/result | Recommended multi-community behavior |
|---|---|---|
| ACTIVE in A + PENDING in B | Cannot be created through current API; global service check and index prevent it. | Allow. B application and A membership are independent. B review only changes B. |
| ACTIVE in A + ACTIVE in B | Cannot be created through current service/index. | Allow. Authorization is resolved per requested community. |
| ACTIVE in A + REMOVED in B | Allowed because REMOVED is outside the global partial index. B reapplication reuses the B row; A remains active. | Preserve. Reapplication may turn B to PENDING only in B, without changing A. |
| ACTIVE in A + BANNED in B | Allowed because BANNED is outside the global partial index. B cannot reapply; A remains active. | Preserve. A ban is local to B and cannot revoke A. |
| PENDING in A + PENDING in B | Not allowed by global check/index. | Allow one row per community. Cancellation/rejection/approval in one community does not transition the other row. |
| BANNED in B, no current B membership | API returns community-specific ban error. | Preserve; only an explicit B unban returns B to an eligible state. Never infer transfer/unban from A membership. |

Recommended rule: no cross-community exclusivity. Keep one row per `(user_id, community_id)`, one current lifecycle state on that row, and the existing one-active-Delegate-per-community constraint. The rule fits the stated goal of one account joining multiple communities, avoids serializing unrelated applications, and makes removal/ban authority local. Keep current same-community state transitions; do not create a new row during reapplication and do not reset BANNED implicitly.

### Hardcoded IRM assumptions and other IRM-specific references

- `backend/scripts/seed.py::seed_db` creates/looks up literal slug `irm`, display name `FST Mohammedia — IRM`, and initial modules by `(community_id, slug)`. It is an owner-run seed utility, not a community-creation API. It will need a Programme-aware implementation before it is used after hierarchy migration; do not use it to backfill production implicitly.
- `backend/tests/acceptance/seed.py::seed` and `backend/tests/acceptance/test_live_network.py` use `irm` as the primary synthetic/live acceptance community. These are fixtures and route probes, but their current identity assumptions need to remain stable for legacy-path coverage while adding second-community same-user cases.
- `backend/app/services/document.py::upload_document` builds new storage keys from `module.community_id/module.id/filename`. `backend/app/services/preview.py::create_and_store_preview` similarly accepts a community ID and includes it in the preview key. Existing stored paths must be preserved verbatim; future Programme ownership needs a deliberately stable new key convention without rewriting old files.
- Core route/service code does not hardcode `irm`: routes take `{community_slug}` and resolve a Community row. The frontend uses `/communities/irm/...`, but is outside this task and those URLs remain compatibility requirements.
- Global-membership assumptions are the seven items in this section's list above: model index; request service; approval service; delegate provisioning; migration; generic conflict mapping; and avoiding a future singleton membership in auth context.

### Community scoping already present and gaps to keep visible

- `announcements.py` routes depend on target ACTIVE membership; `services/announcement.py` resolves announcement by `(announcement_id, community_id)`, replies through the parent announcement, and uses community-filtered list/latest/detail queries. Reply cursors are scoped to parent; some invalid cursor responses are 400 by established contract.
- `community_posts.py` similarly scopes post and replies by requested community. `services/community_post.py::create_community_post` validates every tagged module belongs to that community. The `post_modules` FK pair itself does not enforce this relationship, so future Programme-shared modules need a deliberate tag policy and service validation.
- Discussion REST in `services/discussion.py` scopes messages and reaction targets by community. `discussion.py::check_ws_auth` checks session user membership in the requested community; `broadcaster.py` separates rooms by slug, periodically revalidates, and checks removed message visibility before sends. Removal events contain community slug and message UUID. Keep room names canonical and stable when URL aliases are designed.
- Content removal in `services/content_removal.py` resolves target and parent within the requested community before mutation and inserts a community-scoped `management_events` row atomically. No event-list route currently exposes audit history.
- Module routes in `services/module.py` resolve `(community_id, slug)`. Document list/detail routes resolve module within community. `documents_global.py` routes use a document UUID and derive owning community through its module; they are safe only because access checks use the actual owning community. Global preview currently permits any authenticated caller to fetch a PENDING or APPROVED preview; that is existing policy and deserves an explicit product choice before pending uploads are shared across cohorts.
- `document_vote.py::cast_document_vote` resolves document then module, requires ACTIVE membership in the owning community, and makes vote uniqueness per document/user. `check_full_document_access` applies the same owning-community check for pending student files. A Programme-level document cannot continue to use an unqualified global vote pool if each annual community has its own review.
- Saved and reading services (`saved_document.py`, `document_reading.py`) join `document → module → community`, filter the current user's row and requested community, and filter APPROVED status before cursor pagination. Their table uniqueness is per user/document, not per community. If one stable Programme document becomes visible from multiple annual communities, current uniqueness naturally yields one personal save/reading position and separate community feeds can show that same record. Decide whether this is desired; otherwise add an explicit community association before enabling that behavior. Existing rows must remain addressable.
- `get_active_memberships` and `list_community_memberships` in `services/membership.py` filter by community. Their explicit response projections avoid CNE/application private data in the directory. `membership_permissions` are membership keyed, so Moderator grants remain local after the global index change.

No current service has a cross-community aggregate cursor or account-wide membership selector. IDs for membership, announcement, post, replies, modules, voting, and management actions are resolved with their path community or parent scope before mutation. Global document-by-ID routes intentionally derive the actual owner. Cursor scopes are generally community/user/parent constrained; preserve existing cursor status conventions where clients depend on them.

## D. Recommended target model and additive migration sequence

### Design recommendation

Represent the identity tree as:

```text
EtudSup (platform identity/configuration; one deployment root)
└── Programme (stable academic catalogue; e.g. IRM at FST Mohammedia)
    ├── Programme modules and approved long-lived academic resources
    └── Community (one annual/cohort operating space)
        ├── memberships and their application/role/permission state
        ├── announcements and replies
        ├── posts/replies and discussion/messages/reactions
        ├── annual moderation history
        └── document upload/review/voting activity for that cohort
```

Keep one institution context as deployment configuration or a `Programme.institution_code/name` value for FST Mohammedia; do not add a University entity or multiple-university behavior in this release. EtudSup is the single product/platform root, not a delegate-managed tenant. A Programme has stable identity/slug and reusable modules. A Community has `programme_id`, immutable route slug, academic-year/cohort label when explicitly known, and lifecycle/archive metadata. A community remains the authorization and annual social/management boundary.

Recommended ownership: modules and the canonical approved academic document library belong to Programme; membership, applications, announcements, posts, discussion, moderation and annual voting belong to Community. New document uploads should retain an explicit submitting/reviewing community association so a pending item and its votes are cohort-scoped, while an approved resource can be attached/promoted to the Programme catalogue without changing its document UUID or file. The existing `Document` has one mutable status and one vote set; do not expose programme-sharing until implementation chooses whether to add a `CommunityDocument` review/link table or an equivalent review record. For a minimal first implementation, keep current Document/module/community behavior for existing IRM data and migrate/reconcile document review ownership only with a separately specified content-preserving migration.

Archive a Community instead of deleting it. Keep the Programme module/resource records and original Document IDs/storage paths available after an annual community is archived. Existing approved documents remain readable to authenticated users under current rules; saved/recent rows remain attached by their stable document IDs. Archive must not delete memberships, content, management events, votes, saved rows, reading rows, or files. Whether former cohort members keep read access to private/pending material is a policy choice; default to current approved-document read policy and no pending access after membership is inactive.

### Small additive migration sequence (implementation prompts; not performed here)

1. **Hierarchy foundation.** Add a `programmes` table with UUID PK, stable unique slug, display name, and single-institution context fields. Add nullable `communities.programme_id` FK plus nullable explicit academic-year/archive fields. Seed one IRM Programme through a controlled migration/config value and update the existing `communities` row whose slug is `irm` by setting only its new FK. Preserve every existing community ID and all child rows. Do not invent a year; keep it NULL until supplied. Add programme FK/index and `uq_programmes_slug`. Update ORM/Alembic model registration and the acceptance allowlist/required-column checks. Do not expose community creation to Delegates.
2. **Programme module expansion.** Add nullable `modules.programme_id → programmes.id`, populate it by joining each existing module's existing community to its newly linked Programme, then make it non-null after explicit orphan/duplicate preflight. Add unique `(programme_id, slug)` and index `programme_id`. Keep module IDs and `documents.module_id` unchanged. Keep or stage the old `community_id` column during a compatibility window; do not drop it until all routes, post tagging, and consumers are switched and data parity is proven. Existing `(community_id, slug)` uniqueness can remain while only one legacy community per programme exists; retire it only when the final ownership model no longer needs it. For posts, retain annual `community_id`; validate Programme module tags against that post's community's Programme.
3. **Membership rule change and global-index retirement.** In one coordinated release, update `create_membership_request`, `_review_membership`, `appoint_delegate`, integrity-error mapping, membership API response semantics, and tests to scope lifecycle conflict checks to the target community; preserve User→Membership lock order and BANNED behavior. Add an additive Alembic revision that drops `uq_memberships_global_active_pending`; retain `uq_memberships_user_community` and `uq_memberships_community_active_delegate`. Deploy compatible service code and migration as one maintenance/release step so old code cannot race new multi-membership writes. Update `backend/acceptance/isolation.py::HEAD` to that exact new revision and include all current/new tables and required columns. Before downgrade/recreating the global index, run a guarded preflight that counts users with >1 PENDING/ACTIVE row; fail without deleting/merging/transitioning any rows if any are found. Never auto-pick a surviving membership.
4. **Community-scoped document review and cross-community authorization.** Add only the schema needed to distinguish Programme resource identity from annual upload/review state (recommended `CommunityDocument`/review record or an equivalent explicit association). Preserve current document IDs, vote IDs, threshold snapshots, saved/reading rows, and storage paths. Backfill existing records to the original IRM community from their existing module path; no file copy or document duplication. Add unique/index/FK constraints for the chosen association and enforce that each vote is unique within its review/document and voter. Update upload, moderation, search, submissions, saved/recent listing, preview, PDF access, and vote predicates together. Keep approved programme-resource links stable and preserve `/api/v1/documents/{document_id}/view|download` behavior.
5. **Public discovery and controlled provisioning.** Add a minimal guest-readable `GET /api/v1/communities` or `/directory` projection with only community ID/slug/name, programme display identity, institution context, explicit year when set, and active/archive visibility. Do not return membership counts, applicant data, private settings, or moderation internals by default. Keep member-only membership options and operational settings private. Community/Programme creation remains a platform operator action with explicit authorization outside ordinary Delegate permissions; do not overload `appoint_delegate` as community provisioning.

### Preservation and URL compatibility requirements

- Existing IRM row and all dependent records stay on the same `communities.id`; populate only the new programme FK. Existing memberships and permission rows are not rewritten, retyped, transferred, or duplicated. Application fields remain nullable; no Student/Laureate type inference.
- Module IDs, document IDs, vote IDs, post/content IDs, SavedDocument IDs, DocumentReading IDs, and filesystem object paths remain stable. No reupload, copy, or blob-key rewrite.
- Preserve `/communities/irm/...` as a permanent compatibility path to the existing IRM community row. Do not silently repoint it to a newer cohort. New cohort communities receive distinct canonical slugs, for example `irm-2026-2027`, only after an explicit year decision. If product wants `/irm` to mean “current cohort,” that requires an explicit stable-alias/redirect contract and old route references must continue to resolve their original records.
- Preserve existing document links: community module URLs continue to resolve old module/document IDs; global `/api/v1/documents/{document_id}/view`, `/download`, and `/preview` retain their current access semantics. Programme-wide links should be additive and use stable programme/module/document identity. Existing read/saved cursors must either remain valid or fail with the established masked/not-found behavior, never disclose another user's records.

## E. Two-community test matrix

Use two communities under one Programme, users with independent membership states, and intentionally overlapping module slugs / document fixtures. Assert HTTP status and body shape, not only successful cases.

| Scenario | Fixture/action | Required assertion |
|---|---|---|
| Membership application independence | Same user ACTIVE in A applies to B; then B is approved | Both rows coexist with original IDs; A role/status/permissions and B application data are independent. |
| Multiple pending applications | Same user PENDING in A and B | Both requests persist; withdraw/reject/approve B does not alter A; reapply reuses only B row. |
| Ban locality | User ACTIVE in A, BANNED in B; user removes/unbans/reapplies per B state | A remains ACTIVE and authorized; B remains forbidden until B unban; no cross-community unban or implicit transition. |
| Community content privacy | A-only member reads B announcement/post/discussion REST, replies, reactions | 403; target IDs from A passed under B path return masked 404; no author/private payload leak. |
| Management scoping | A Delegate attempts role, permission, remove, ban/unban, content removal on B records | 403 before mutation; B Delegate succeeds only on B targets; moderator grants do not become platform powers. |
| Cross-community IDs and cursors | B caller submits A membership/content/reply/cursor IDs under B routes | Existing route-specific 404/400/422 contract; no body, user detail, or existence signal beyond documented behavior. |
| WebSocket rooms and revocation | ACTIVE in A only connects to B; same user connects to both after B approval; remove/ban B while both sockets live | B socket denied before membership; B revocation closes/drains only B; A socket remains connected; no B event broadcast to A room. |
| Document list/detail | Approved document/module in A requested under B path; global UUID routes used | Community module routes hide foreign document; global approved route follows actual owning community's approved policy and never trusts caller-supplied community. |
| Upload and review | ACTIVE in A only uploads/votes against B; then gains B membership | Initially denied; later B threshold and review state independent; one user's B vote cannot satisfy/alter A resource review. |
| Pending/PDF access | Pending student upload owned by B; user has ACTIVE A and YES vote in A or no B vote | Full file denied; B ACTIVE + own YES vote permits existing pending download only; inline approved route stays approved-only. Test preview policy explicitly. |
| Saved documents | User saves same Programme resource via A and B if cross-community listing is enabled | One personal `(user, document)` row remains; each community feed is correctly scoped; remove/state operations cannot affect unrelated docs. If product selects community-specific saves, assert the new association uniqueness instead. |
| Recent documents | Open same stable Programme document from both communities | Personal position/last-opened semantics match chosen model; community list only shows resources associated with that community/programme; a cursor from another user's record is rejected. |
| Programme modules and post tags | A and B share programme module slug; create post in A tagged with B-programme module ID | Shared Programme tag policy is explicit; modules outside the post's Programme are rejected; no cross-programme association can be created. |
| Archive and preservation | Archive A after approved document has saves, readings, votes, posts, and moderation records | Archive does not cascade/delete any row or file; old IRM URL and document IDs still resolve under the selected archive read policy. |
| Public discovery | Guest lists directory; caller checks hidden membership/application endpoints | Public contract contains only approved metadata; no private setting, membership/application data, session state, or operator action is exposed. |

Current tests with multi-community fixtures exist for some isolation behavior (for example `test_member_directory.py`, document browsing tests, and discussion PG tests), but they do not prove the proposed same-user multi-active lifecycle because the global invariant currently forbids it. No tests were run for this audit.

## F. Production data and rollback risks

- Dropping the global index is behaviorally irreversible once one user has multiple PENDING/ACTIVE rows. Recreating it will fail. A downgrade must preflight and stop before DDL if any such user exists. It must never delete, merge, reject, or transfer records to force rollback.
- Application code retaining global checks after the index drops creates a misleading split invariant: DB accepts records while requests reject them. Conversely deploying new application code before the index is retired will surface uniqueness conflicts. Coordinate the service and DDL release and pin the exact deployment revision.
- Backfilling programme links is reversible only while no programme-owned rows are created or referenced. Once sibling communities or shared modules/resources exist, dropping `programme_id` or restoring the old one-community-per-module meaning is unsafe without a preservation migration and code compatibility window.
- Moving module ownership changes route resolution and access predicates. A bad join can expose another Programme's documents or hide saved/recent records. Keep IDs and add explicit constraints/indexes before removing legacy ownership fields.
- Document review is the highest data-model risk: current status, threshold snapshot and votes are attached to a single Document; votes are unique per document/user. Reusing the same row across annual cohorts would merge review outcomes and voter history. Preserve legacy vote history and introduce a separate review/community association before sharing pending resources.
- Community slug is globally unique and appears in API paths, WebSocket rooms, frontend URLs, tests, and events. Reusing `irm` for a later cohort or changing the old row's meaning can break saved links, cursors, room routing, and moderation references.
- Existing FK cascades mean deleting a Community or Programme-linked Module can delete membership/content/documents and cascade saved/reading/vote records. Archive with a state field; do not use deletion as cohort cleanup. `management_events.community_id` is RESTRICT, so community deletion can already fail when audit events exist.
- Saved and recent rows currently key on `(user, document)` with no community field. Programme reuse makes data naturally personal and shared across community views. If product expects per-community personal state, an explicit association migration is required; do not duplicate or silently discard existing rows.
- Public discovery can reveal community existence and metadata. Keep its response allowlisted and separate from member settings, membership directories, pending applications, and voting configuration.
- The current guarded PG runner uses exact DB/role/schema identity and a pinned head. Future migration acceptance must advance its head and allowlist/required layout together. Its present table allowlist omission for saved/reading records is a guard coverage gap, not evidence those tables are absent.
- No database was connected to. Production row counts, duplicate conditions, exact existing academic-year meaning, filesystem inventory/path layout, and live WebSocket/browser behavior remain unverified. Migration preflights must be performed only in an explicitly approved isolated/production change process; this audit did not query them.

## Product choices not inferable from this repository (recommended defaults)

1. **Annual cohort identity and year of existing IRM row:** current Community has no year field. Default: leave existing year NULL and keep slug `irm`; require an operator-provided year for new annual rows.
2. **Whether the IRM public URL means the original row or current cohort:** repository cannot decide. Default: `/communities/irm/...` permanently maps to the original IRM row; use distinct slugs for later cohorts.
3. **Programme document review semantics:** existing one-document status/vote pool has no annual dimension. Default: share only approved Programme resources; retain pending uploads and their votes in a community-scoped review record until explicitly approved for catalogue use.
4. **Saved/recent behavior for resources shared by sibling cohorts:** current keys are user/document. Default: keep personal save/page position shared for the stable document; community feeds filter visible Programme resources. Add community key only if product explicitly wants independent personal state per cohort.
5. **Archive read policy for former members and pending student files:** current approved files are readable by any authenticated account; pending full files require current ACTIVE membership plus own YES vote. Default: preserve approved-resource policy after archive and deny pending/review surfaces after archive; never auto-transition membership rows.
6. **Public discovery contents and inactive entries:** no current public API establishes this contract. Default: expose active/listable communities only and a minimal allowlisted projection; archive/history lookup stays authenticated/operator-only unless separately requested.
7. **Programme identity normalization and FST naming:** repository contains no governed catalogue. Default: create only one IRM Programme in the FST Mohammedia context, with operator-confirmed display values and no multi-university table/API.

## G. Prioritized next backend implementation subtasks

1. **Programme/community hierarchy foundation:** add Programme and nullable Community linkage/archive/year fields; link the existing IRM row without changing its ID; update guarded migration fixtures. No directory or shared-module cutover yet.
2. **Community-scoped membership lifecycle:** remove global checks from apply/approve/delegate appointment, add the drop-index revision and multi-membership tests, retain per-community uniqueness, and update the acceptance guard head/table coverage in the same task.
3. **Programme module ownership and backward-compatible resolution:** add/backfill Programme module linkage while retaining legacy route resolution and validating post-module tags. Do not change document IDs or file paths.
4. **Community-scoped document review design and migration:** implement an explicit annual review association for uploads/votes, preserve existing Document/vote history, and adapt file access plus saved/recent feeds to Programme resources.
5. **Minimal public directory and operator provisioning boundary:** add an allowlisted public contract and explicit platform-only creation path; verify Delegates cannot create programmes/communities or gain cross-community permissions.

## Inspection and verification limits

Inspected: initial `git status --short`; root task instructions; `backend/app/models/*` including user, session, community, membership, permissions, module, documents/votes, saved/reading, announcements/replies, posts/replies, discussion/reactions, and management events; relevant API dependencies and all v1 endpoint routers; membership, provisioning, module, document, vote, saved, reading, announcement, post, discussion and content-removal services; route/model authorization predicates; Alembic `env.py`, all revision IDs and the global membership-index migration; current acceptance `HEAD`, table allowlist, required layout checks; static searches for `irm`, membership status and community predicates; and current reports for membership applications, moderation/member management, saved documents, recent reading, document search/submissions, and moderation acceptance.

Ran only read-only commands: `git status --short`, `rg` searches, file reads, `alembic heads`, and `alembic history --verbose`. No tests, migrations, seed scripts, database commands/connections, production queries, or browser behavior were run. Runtime authorization, PostgreSQL constraint behavior, migration locking/duration, actual production data conditions, file paths, and end-to-end multi-community behavior remain unverified.

No frontend files, implementation files, migration files, environment/deployment files, separate `/home/yasso/etudsup` worktree, or database state were modified. No files were staged, committed, pushed, or deployed.
