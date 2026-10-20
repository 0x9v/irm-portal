# ETUDSUP D3 — controlled resource deletion

## Contract and implementation

`DELETE /api/v1/communities/{community_slug}/resources/{resource_id}` takes an empty body and returns 204 only after the removal and audit commit. It requires a trusted Origin, authenticated live session, and ACTIVE membership in the resource's owning community. A PENDING or REJECTED PDF, IMAGE, YOUTUBE, or LINK may be removed by its uploader or that community's current Delegate. A Moderator has no special deletion authority; a Moderator uploader uses the uploader rule. APPROVED resources always remain: an otherwise authorized attempt returns 409. Other ineligible active members receive 403; absent, already removed, wrong-community, or no-membership resources return concealed 404. Invalid bodies return 422; absent/invalid sessions return 401. Repeated DELETE returns 404 and creates no second event. The saved-reference DELETE route removes only a saved relationship, never the resource, and cannot delete that relationship after resource removal.

Revision `e3a91c6d2f40` follows D1's `c8e4f1a2b603` and adds nullable `documents.removed_at` and `removed_by_id`, matching the existing content-removal model. It does not rewrite rows or files. A downgrade refuses when removed resources or D3 removal events exist. The Document row, ID, category, uploader, source, status, votes, threshold snapshot, saved/reading references, storage key, and stored bytes remain. The request commits the removal marker and one metadata-only `ManagementEvent(action="remove", target_type="module_resource")` together. No physical file or external website is deleted.

Removal, typed approval, typed votes, and legacy file votes use User → Session (for removal) → Membership → Document locks, followed by a fresh removed/status check on the Document row. Approval first leaves an approved, undeleted resource and removal returns 409. Removal first leaves its original PENDING/REJECTED status and later approval/voting returns 404. Session and membership state are rechecked under mutation locks. The frontend capability is advisory: `can_delete` appears on pending review and the new typed own-submissions feed and is computed from the same server policy; DELETE enforces the policy again.

Removed resources are omitted from mixed browse, legacy file lists, typed pending/own feeds, legacy own submissions, saved/recent feeds, and cursor lookups. Protected preview, detail, original file, vote, approval, reading, and saved-state paths reject them. Image/PDF preview reads recheck removal after disk I/O. Bytes already delivered to a browser cannot be recalled. Existing read policy for other documents is unchanged.

The existing My Submissions page now reads `GET /api/v1/communities/{community_slug}/resources/mine?status=<optional>&limit=20&after=<UUID>`, which covers all four kinds and returns typed resource fields plus module slug/name and `can_delete`. The legacy `/documents/mine` API stays file-only. Own PENDING/REJECTED cards and eligible pending-review cards show a separate Delete control. The shared dialog names the resource, starts on Cancel, and explains community-access removal. The UI waits for exact 204, keeps single-flight protection, refreshes scoped lists, reconciles a 409 approval conflict, clears stale authority on 401/403, and treats network/5xx/unexpected success as uncertain without automatic resend. D2 category/format controls, labels, pagination, and submission behavior are preserved.

## Files

Authored: `backend/alembic/versions/e3a91c6d2f40_add_resource_soft_removal.py`, `backend/tests/services/test_resource_removal_migration_pg.py`, `frontend/playwright.d3.config.ts`, this report.

Modified for D3: `backend/acceptance/isolation.py`, `backend/acceptance/profile.py`, `backend/app/api/module_resource_routes.py`, `backend/app/api/v1/endpoints/documents_global.py`, `backend/app/api/v1/endpoints/module_resources.py`, `backend/app/models/content_removal.py`, `backend/app/models/document.py`, `backend/app/models/user.py`, `backend/app/schemas/module_resource.py`, `backend/app/services/document.py`, `backend/app/services/document_reading.py`, `backend/app/services/document_vote.py`, `backend/app/services/module_resource.py`, `backend/app/services/saved_document.py`, `backend/tests/api/v1/test_module_resources.py`, `backend/tests/services/test_module_resource_review_pg.py`, `frontend/src/lib/moduleResources.ts`, `frontend/src/app/communities/irm/documents/mine/page.tsx`, `frontend/src/app/communities/irm/documents/pending/page.tsx`, `frontend/tests/module-resources.test.mjs`, `frontend/e2e/module-resource-review.spec.ts`, `frontend/e2e/my-document-submissions.spec.ts`, `frontend/e2e/document-metadata-navigation.spec.ts`, `frontend/e2e/u5-document-rows.spec.ts`, `frontend/e2e/feature-page-identity.spec.ts`. Several of these already carried uncommitted D1/D2 edits; those edits were preserved.

## Verification and open gates

- Guarded test-process heartbeat `module-resource-api`: 109 passed, 0 failed. Evidence: `/tmp/irm-profile-evidence-29o1upl_/profile-result.json`. One later added Moderator-owner APPROVED assertion passed in a focused single-test rerun.
- Nine focused legacy document API files: 89 passed, 0 failed, with the same test-only heartbeat accommodation. After a narrow pending-download post-read check, its 9-test global-download file passed again.
- `npm run lint`, `npx tsc --noEmit`, two focused Node helper test files, Python syntax checks, `alembic heads`, acceptance `check_head()`, and `git diff --check`: passed. Sole source head: `e3a91c6d2f40`.
- Guarded `module-resource-postgresql` setup stopped with `OperationalError` before integration identity verification, schema creation, migration, pytest, or any PostgreSQL assertion. `/tmp/irm-profile-evidence-fbmay0hr/profile-result.json` records zero executed tests, no outstanding owned schema, and removed temporary storage. Concurrent approval/removal, session/member revocation, and migration preservation assertions remain **unexecuted**.
- Playwright `--list` discovered 17 focused cases in two files, but no existing frontend URL was configured. **Zero browser cases executed**; responsive, focus, touch, and dialog behavior await browser acceptance. The earlier task-owned listener is known to fail with `listen EPERM`; it was not retried.
- One normal `npm run build` stopped in Turbopack CSS processing because a child process could not bind a port (`Operation not permitted`, `os error 1`). This is not a passing build result. No diagnostic webpack build was substituted.

Run the outstanding guarded PostgreSQL suite when the approved `irm_integration_test` / `irm_test` service is available, then inspect its cleanup evidence:

```fish
cd /home/yasso/irm-platform/backend
./.venv/bin/python -m acceptance.profile --suite module-resource-postgresql --heartbeat
```

Run the fail-closed browser cases against an **already running** frontend URL, then the normal build in an environment that permits Turbopack worker binding:

```fish
cd /home/yasso/irm-platform/frontend
set -lx ETUDSUP_D3_FRONTEND_URL 'https://your-already-running-frontend.example' # replace with the actual existing frontend URL
npx playwright test --config=playwright.d3.config.ts
npm run build
```

Manual acceptance: verify own PENDING and REJECTED delete for all four kinds; Delegate deletion in the pending queue; another member and Moderator without ownership see no Delete; APPROVED has no Delete and its API returns 409 for owner/Delegate; Cancel restores focus; 204 removes only after confirmation; 409 reconciles; uncertain responses never auto-resend; verify 320/390/1440 light/dark layouts, keyboard focus, and no overflow. D1/D3 migrations must precede this frontend in any later rollout; no owner or production database was migrated here.

## D4 handoff

Future new Delegate uploads will be immediately APPROVED while retaining their STUDENT/OFFICIAL source as separately specified for D4. Under D3, they will therefore be non-deletable immediately. D3 did not change creation or approval rules.

No staging, commit, push, deployment, owner-service restart, physical cleanup, or D4 work was done.
