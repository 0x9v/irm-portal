# EtudSup P4.2 — account avatar management frontend

## Scope and source

I inspected Git status before editing and preserved the extensive existing modified and untracked backend, Discussion, account, navigation and theme work. I read P4.1C, P2.1, P2.2, P3.2 and U1/U2/U6 handoffs, inspected the live avatar display, account/profile/security components, authentication refresh, API base, shared controls and confirmation dialog, and followed the installed Next.js client/CSS guides. No backend or Discussion file was edited.

## Exact P4.2 changed-file inventory

| File | P4.2 change |
| --- | --- |
| `frontend/src/app/account/AvatarManager.tsx` | Account photo actions, local preview, upload/removal, confirmation, safe feedback, read-only uncertainty check and account-scope cleanup. |
| `frontend/src/app/account/ProfileContent.tsx` | Places controls beside the saved avatar and protects the profile baseline/draft from avatar and profile response races. |
| `frontend/src/app/account/AccountPage.module.css` | Compact wrapped controls and bordered local preview in the existing account card. |
| `frontend/src/lib/avatarManagement.ts` | Pure picker limits and owner-scoped versioned response URL checks. |
| `frontend/src/lib/api.ts` | Adds a narrow Content-Type opt-out for the empty avatar DELETE; existing callers retain their prior header behavior. |
| `frontend/tests/avatar-management.test.mjs` | Executed file-limit, URL, credentialed multipart and empty-DELETE tests. |
| `frontend/e2e/avatar-management.spec.ts` | Fourteen mocked browser scenarios, including light/dark 390px/1440px capture cases. |
| `frontend/playwright.p4-2.config.ts` | Focused production-server browser suite. |
| `docs/etudsup-p4-2-avatar-management-frontend.md` | This report. |

`AccountAvatar` and `accountInitials` were inspected and left intact. The saved avatar still loads from the versioned API URL using credentials, an abortable fetch and a revoked blob URL, with initials on NULL/load/decode failure. No second account cache or image proxy was added. The account dropdown continues its established initials treatment.

## Interaction and API contract

The identity card shows Add photo when the account has no saved avatar, or Change photo and a quiet Remove photo when it does. File selection keeps the saved avatar visible and opens a separately bordered “Local preview — not uploaded” area with Upload photo and Cancel. Cancel revokes the local blob URL, clears the input, and permits selection of the same file again. Choosing another valid file replaces and revokes the earlier preview. Removal uses the existing compact confirmation dialog. Upload and removal share a synchronous operation lock and pending controls, so they cannot overlap or duplicate.

The picker accepts JPEG/PNG and locally rejects empty files, declared other MIME types and files over **2,097,152 bytes**. Guidance says the backend creates a square picture and that signed-in users who receive the URL can view it. The frontend does not rely on extensions, decode safety, resize, crop or re-encode; the backend remains authoritative for content, dimensions and processing.

Upload sends `PUT /api/v1/auth/me/avatar` through the existing credentialed API helper with `FormData` containing only `file`. The browser supplies the multipart boundary and Origin. Removal sends `DELETE` to the same path with an empty body and no JSON Content-Type. Only a **200** with a correctly shaped `avatar_url` confirms a mutation: upload requires the current owner's versioned relative API URL, removal requires `null`. Neither User UUID, storage key nor avatar data enters the profile PATCH payload.

After a confirmed mutation, the returned avatar URL updates the account card, local selection is cleared, a restrained success message appears, and shared `AuthContext.refresh()` runs. A failed refresh is reported separately as “Photo uploaded/removed, but your account could not be refreshed”; it does not retract success or repeat PUT/DELETE. The existing profile draft remains typed through the same-account refresh. A confirmed avatar version is protected from older profile PATCH/check responses by an avatar generation check and a short-lived override until shared identity reconciliation.

400/415/422 give safe request or image guidance, 413 gives size guidance, 403 gives safe authorization guidance, and 401 invokes the existing session refresh path. Network/5xx/malformed-success outcomes are neutral: the controls offer **Check saved photo**, a read-only `/api/v1/auth/me` request before another mutation. That check describes only the currently saved state; it does not claim the earlier request succeeded or failed. No mutation is retried automatically. Logout or account change aborts requests, revokes any local preview, and ignores stale completions through the existing UUID-keyed account component and async scope.

The Security section, password auth clearing, read-only email, profile editor, avatar display, account navigation and EtudSup theme remain in place. No upload is offered to a guest, and no membership status is required for an authenticated account owner.

## Verification and remaining acceptance

Commands ran from `frontend/` unless stated otherwise.

| Check | Actual result |
| --- | --- |
| `npx eslint src/app/account src/lib/avatarManagement.ts src/lib/api.ts tests/avatar-management.test.mjs e2e/avatar-management.spec.ts playwright.p4-2.config.ts` | Passed after the final source changes. |
| `npm run lint` | Failed in concurrent Discussion code: `AuthenticatedStickerImage.tsx:29` triggers `react-hooks/set-state-in-effect` (plus an image warning). The initial account warning was corrected; P4.2 did not edit Discussion. |
| Scoped TypeScript program using the repository `tsconfig.json` and account/avatar roots | Passed: 9 root files, 0 diagnostics. |
| `npx tsc --noEmit` | Failed in concurrent `DiscussionComposer.tsx` at line 201–205 (`Cannot find name 'error'`). An earlier run instead saw its concurrent custom-sticker prop mismatch. P4.2 did not edit those files. |
| `node --test tests/avatar-management.test.mjs tests/password-change.test.mjs tests/profile-editing.test.mjs tests/account-controls.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/actions.test.mjs` | Passed: 7 executed files. The new avatar file contains 3 executed tests. |
| `npx playwright test --config=playwright.p4-2.config.ts --list` | Passed discovery after the final scenario additions: 14 mocked tests. **No browser assertion executed.** |
| `npm run build` | Failed before completion in Turbopack: `SiteFooter.module.css` → creating a new process → binding to a port → `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-6a5cab3e2407c4f5a04477ece0194ce7.log`. This is the established sandbox boundary, not a completed production build. The later narrow DELETE header opt-out passed scoped lint, scoped TypeScript and the seven-file unit suite; build was not retried against the same blocker. |
| `npx playwright test --config=playwright.p4-2.config.ts` | Failed before tests: `Process from config.webServer was not able to start. Exit code: 1`. This attempt preceded the last two browser scenarios; discovery after their addition passed. |
| Scoped whitespace | `git diff --check` passed for touched tracked files; trailing-whitespace scan of new source/spec/config files found no matches. |

No screenshots were produced. Actual upload/removal interaction, confirmation focus, 320px overflow and 44px controls, light/dark contrast, avatar image loading and the 390px/1440px captures remain browser acceptance gates. P2.1/P2.2/P3.2 and U1–U6 visual/build gaps remain open; test discovery does not close them. Backend P4.1C PostgreSQL/storage acceptance also remains outside this frontend task.

Owner-side fish-compatible commands on a machine where Next can build/listen and Chromium can launch, after concurrent Discussion checks are repaired by their owner:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/avatar-management.test.mjs tests/password-change.test.mjs tests/profile-editing.test.mjs tests/account-controls.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/actions.test.mjs
npm run build
npx playwright test --config=playwright.p4-2.config.ts
```

Inspect `frontend/test-results/p4-2/` for the interaction results and `avatar-preview-<theme>-<width>.png` captures in the Playwright test directories. No backend, migration, database, dependency, environment, deployment or reference-worktree change was made. Nothing was staged, committed, pushed, deployed or restarted.
