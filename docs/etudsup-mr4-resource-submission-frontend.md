# ETUDSUP MR4 — Module resource submission frontend

## Implementation

The selected module's existing upload route now offers Document, Image, YouTube, and Useful link. It uses MR2's implemented `POST /api/v1/communities/irm/modules/{module_slug}/resources` endpoint. MR1 and the live MR2 endpoint/schema/service were inspected; no backend, migration, module browsing, review, or post-reply files were edited.

Common inputs are a trimmed title (1–255 characters), optional description (up to 2,000 characters), and source. Members submit as STUDENT. Delegates explicitly choose STUDENT or OFFICIAL; Moderators see OFFICIAL only when `upload_official_documents` is granted. Student submissions are described as pending review and voting. An approved resource is described as published only after a validated 201 response.

Request shapes:

| Kind | Body | Exact submitted fields |
| --- | --- | --- |
| PDF | multipart `FormData` | `kind=PDF`, `title`, optional `description`, `source`, `type`, `file` |
| IMAGE | multipart `FormData` | `kind=IMAGE`, `title`, optional `description`, `source`, `file` |
| YOUTUBE | JSON | `kind`, `title`, `description` (string or null), `source`, `url` |
| LINK | JSON | `kind`, `title`, `description` (string or null), `source`, `url` |

The browser sets multipart boundaries and Origin. The existing API helper includes credentials. Local guidance rejects empty/wrong MIME files, images over 10 MiB, PDFs over the configured default 50 MiB, non-HTTPS links, and unsupported YouTube URL shapes; backend decoding and validation remain authoritative. Image previews are local, visibly unsaved, uncropped, and revoked on replacement, removal, kind change, success, or unmount. Hidden kind-specific fields are omitted from requests.

A synchronous ref lock prevents duplicate submissions while a request is pending. A 201 response must identify the selected kind, module, source, expected status, title, and kind payload before success is shown. After a network error, 5xx, or invalid success response, the draft and selected File remain. The page says creation is unconfirmed, disables resubmission, and requires an explicit new-attempt action; there is no invented idempotency key or automatic retry. The form is keyed by account, membership, community, and module; outstanding requests are aborted and previews revoked on unmount. Module loading is also abortable. Return navigation stays within the selected module.

## Exact authored files

- `frontend/src/app/communities/irm/modules/[moduleSlug]/upload/page.tsx`
- `frontend/src/lib/moduleResourceSubmission.ts`
- `frontend/tests/module-resource-submission.test.mjs`
- `frontend/e2e/module-resource-submission.spec.ts`
- `frontend/playwright.module-resource-submission.config.ts`
- `docs/etudsup-mr4-resource-submission-frontend.md`

The normal build's prebuild step copied `frontend/public/pdf.worker.min.mjs`; this path is untracked in the current worktree. Its state before MR4 was not established, so it was left intact. Concurrent MR3 and PR4.1 changes were preserved.

## Verification

- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `node tests/module-resource-submission.test.mjs`: 4 focused helper tests passed.
- `npm run build`: passed once; no other build process was running when it started.
- `ETUDSUP_MR4_FRONTEND_URL=http://127.0.0.1:3170 npx playwright test --config=playwright.module-resource-submission.config.ts --list`: discovered 10 cases. Discovery is not browser execution.
- Focused browser execution: pending. The previous 3170 listener was unreachable from this environment. A single isolated production-listener attempt on port 3184 failed with `listen EPERM`; it was not repeated. No owner service was stopped or restarted.

When an owner production frontend serves this build, run from `frontend/`:

```sh
ETUDSUP_MR4_FRONTEND_URL=http://127.0.0.1:3170 npx playwright test --config=playwright.module-resource-submission.config.ts
```

The browser suite has fail-closed API mocks and covers all four request shapes, image replace/remove/kind cancel, validation, a held request and uncertainty, source permissions, response identity, account reload, and 320/390/1440 widths in light/dark. Browser visual and keyboard acceptance remains pending: inspect the composer, image containment and aspect ratio, labels/focus, 44px controls, and feedback placement at those widths in both themes. Announcement replies remain outside MR4 and were not modified.

## MR5 handoff

Run the focused browser suite against a production frontend serving this build, then verify the module's mixed-resource browse/review journeys when MR3's backend voting/approval is ready. Keep resource browsing and pending-review UI changes in MR5; the MR4 submission response does not imply that a student resource is already approved.
