# ETUDSUP D4 — Delegate publication and D1–D4 focused acceptance

## Creation contract

The server now rechecks the live session and ACTIVE membership for the resource's owning community under User → Session → Membership row locks, held through creation commit. The source policy remains unchanged. A current community Delegate's new PDF, IMAGE, YOUTUBE, or LINK is created APPROVED whether its explicit source is STUDENT or OFFICIAL. No status, source, category, file reference, or vote of an existing resource is rewritten. The same document creation service gives legacy PDF/JPEG/PNG uploads this rule. Legacy multipart authority/status fields are rejected with 422; typed creation already rejects extras.

| Uploader | Selected source | New status | Source retained |
| --- | --- | --- | --- |
| ACTIVE community Delegate | STUDENT | APPROVED | STUDENT |
| ACTIVE community Delegate | OFFICIAL | APPROVED | OFFICIAL |
| Ordinary member | STUDENT or omitted | PENDING | STUDENT |
| Moderator | STUDENT | PENDING | STUDENT |
| Moderator with established upload grant | OFFICIAL | APPROVED | OFFICIAL |

An ordinary member cannot select OFFICIAL. A Moderator without the grant cannot select OFFICIAL. A Delegate of another community, demoted/inactive member, or revoked session cannot use the Delegate exception. The locked membership is refreshed from the database; request fields and the preflight membership object are never publication authority. The creation transaction does not fabricate YES votes or invoke staff approval. As with existing immediate OFFICIAL creation, it creates no `ManagementEvent(action="approve")`: there was no separate staff review. Pending STUDENT threshold snapshots remain required; typed STUDENT resources retain the existing snapshot behavior. D3 forbids deletion of these newly APPROVED resources immediately, including by uploader or Delegate.

The upload form keeps Catégorie before Format and the same six D1 values and labels. It tells a Delegate that a STUDENT resource publishes immediately **as a student resource**. It validates APPROVED for Delegate responses of either source, PENDING for ordinary member/Moderator STUDENT responses, and matching identity, source, category, kind, payload, and PDF `document_type` as before. A mismatched response remains uncertain with no automatic resend. Success shows the confirmed source and no Delete control.

## Files changed for D4

Authored: `backend/tests/services/test_delegate_publication_pg.py`, `frontend/playwright.d4.config.ts`, this report.

Modified: `backend/acceptance/isolation.py`, `backend/acceptance/profile.py`, `backend/app/api/v1/endpoints/documents.py`, `backend/app/api/v1/endpoints/module_resources.py`, `backend/app/services/document.py`, `backend/app/services/module_resource.py`, `backend/tests/api/v1/test_documents.py`, `backend/tests/api/v1/test_module_resources.py`, `frontend/src/lib/moduleResourceSubmission.ts`, `frontend/src/app/communities/irm/modules/[moduleSlug]/upload/page.tsx`, `frontend/tests/module-resource-submission.test.mjs`, `frontend/e2e/module-resource-submission.spec.ts`. These files already contained uncommitted D1–D3 work; it was preserved. D4 adds no migration.

## Executed verification and open gates

- Focused guarded API suite: **126 passed**, 0 failed; evidence `/tmp/irm-profile-evidence-wqxrnles/profile-result.json`. It covers typed category, creation, source/role, browse, D3 removal, voting, and media behavior, including D4 creation for both sources and all four kinds.
- Nine relevant legacy document API files: **89 passed**, 0 failed. After the final legacy authority-field check, `test_documents.py` alone passed **7/7**.
- Frontend: `npm run lint`, `npx tsc --noEmit`, three focused Node/helper test files, Python compile checks, `git diff --check`, `alembic heads`, and acceptance `check_head()` passed. Sole source head and acceptance pin: `e3a91c6d2f40`. The acceptance layout guard now requires D3 removal columns.
- Guarded PostgreSQL selector was inspected and now contains D1 migration, D3 migration and approval/removal races, plus the deterministic D4 demotion/creation race. Its run stopped at setup with `OperationalError` before database identity verification, schema creation, pytest, or any PostgreSQL assertion. Evidence `/tmp/irm-profile-evidence-cj8gptps/profile-result.json`: zero tests, no outstanding owned schema, temporary storage removed. **PostgreSQL acceptance remains open.**
- Playwright `--list` discovered **40 focused cases in four files**; **zero browser cases executed**, because no existing frontend URL was configured and the task-owned listener is known to fail with `EPERM`. Responsive/browser acceptance remains open.
- One normal `npm run build` was attempted after source stabilization. Turbopack failed while processing `globals.css`: its child process could not bind a port (`Operation not permitted`, os error 1). **Final production build acceptance remains open.** No alternate build was counted.

## Owner acceptance and deployment order

Run remaining focused checks in an environment with the approved disposable PostgreSQL service and an already-running frontend. These are fish-compatible commands; replace the URL with the actual existing frontend URL:

```fish
cd /home/yasso/irm-platform/backend
./.venv/bin/python -m acceptance.profile --suite module-resource-postgresql --heartbeat

cd /home/yasso/irm-platform/frontend
set -lx ETUDSUP_D4_FRONTEND_URL 'https://your-already-running-frontend.example'
npx playwright test --config=playwright.d4.config.ts
npm run build
```

Manually check Delegate STUDENT and OFFICIAL uploads in each format; verify STUDENT badges, approved browse visibility, no pending entry or Delete action; verify ordinary member and Moderator STUDENT remain pending; check TD/category-first filters and 320/390/1440px light/dark forms, keyboard focus, and uncertainty after a mismatched confirmation.

This release needs **backend and frontend** updates. The source migration chain is `b7c3e9a4d182 → c8e4f1a2b603 → e3a91c6d2f40`; verify the owner's actual deployed head before applying the pending revisions. Back up the production database and uploaded storage, build images on the owner's laptop because Oracle RAM is limited, and retain old images plus a reviewed recovery procedure. Apply migrations and a compatible backend before the new frontend. Preserve all production accounts, resources, relationships, IDs, and files; do not seed, reset, stamp, or manually add columns. No production migration, deployment, service restart, staging, commit, or push occurred in D4.
