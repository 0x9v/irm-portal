# EtudSup P4.3 — Account frontend acceptance

## Implementation status and acceptance status

The existing `/account` implementation contains the P2.1 identity page, P2.2 profile editor, P3.2 password form, P4.2 photo controls and P4.2B header avatar. Current frontend source matches the inspected backend contracts: own-account profile `PATCH /api/v1/auth/me`, password `POST /api/v1/auth/me/password` with confirmed empty 204, and avatar `PUT`/`DELETE /api/v1/auth/me/avatar` with confirmed 200 responses. The page uses the shared authenticated User and requires no ACTIVE membership. Email is read-only.

**Account browser and visual acceptance remains open.** The production build and browser runner could not start in this environment. Passing source checks and browser test discovery do not establish that the combined flows, responsive layout or screenshots work in an actual browser.

I inspected Git status before work and preserved the extensive existing modified/untracked frontend, backend, sticker and other concurrent files, including CS6A work. I read the P2.1, P2.2, P3.2, P4.2 and P4.2B handoffs and the profile, password and avatar backend contract reports, then checked the current route, schema, auth context, page, form, image, navigation and API source. The old Discussion lint/TypeScript errors did not recur and were not reopened.

## Exact P4.3 changed files

| File | Change |
| --- | --- |
| `docs/etudsup-p4-3-account-acceptance.md` | Records current acceptance evidence, limits and the owner closure checklist. |

No Account implementation file was changed. No frontend defect was reproduced by the checks that could execute, so there was no compatible correction or new regression test to add. This is not a claim that browser-only defects are absent.

## Combined journey review

| Journey | Current implementation and available coverage | P4.3 result |
| --- | --- | --- |
| Entry and identity | Account gate distinguishes checking, auth error, guest and owner; UUID-keyed content hides old account data. No-membership and banned access, real fields, read-only email, dropdown and avatar fallback have existing Node/browser cases. | Source and focused Node checks pass; browser cases unexecuted. |
| Profile | Partial, normalized PATCH; Unicode and field errors; Cancel; pending guard; confirmed save with separate refresh warning; read-only reconciliation after an uncertain response. | Source and focused Node checks pass; browser cases unexecuted. |
| Photo | Local unsaved preview; picker limits; credentialed multipart upload, empty DELETE, confirmation, header refresh and initials fallback. The shared profile baseline has an avatar generation guard, and an existing browser case keeps a dirty profile draft through photo refresh. | Source and focused Node checks pass; browser cases unexecuted. |
| Password | Exact two-field JSON POST; local confirmation; pending guard; 204-only success; local auth clearing before login navigation; one-time notice; uncertain outcome offers Sign in without retry. | Source and focused Node checks pass; browser cases unexecuted. |
| Account ownership | UUID-keyed form content, request scopes, aborts and shared auth request generation protect logout/account switches. Existing browser cases cover late profile, photo and password completions separately. | Source reviewed; browser race assertions unexecuted. |

The current source keeps the Security form under the same UUID-keyed `ProfileContent` during a same-account auth refresh, so a profile refresh does not remount it. The profile draft is retained while dirty; a changed saved baseline is surfaced. The avatar generation/override path prevents a late profile response from restoring an older saved avatar. Confirmed profile/photo mutations are reported separately from a later refresh failure. Password success clears User, membership and capabilities before routing to `/login`, with no redundant logout request. These are source-level findings; the combined timing paths still need browser execution.

Error handling keeps field errors attached through `aria-invalid`/`aria-describedby`, does not render raw backend details, and treats missing mutation responses as uncertain. Profile and photo reconciliation use read-only account checks; password uncertainty points to sign-in and never automatically repeats POST. A scoped source scan found no `localStorage`, `sessionStorage` or URL query storage for account passwords/files. Backend authorization, session revocation and image processing remain authoritative. No account version or cross-tab guarantee exists.

## Verification actually performed

Commands below ran in `frontend/` unless otherwise stated. The four Playwright configurations select four distinct spec files, so the discovery total is **8 + 13 + 14 + 15 = 50 unique scenarios**, not four executions of the same tests.

| Check | Result |
| --- | --- |
| `npm run lint` | Passed repository-wide, no warnings/errors. |
| `npx tsc --noEmit` | Passed repository-wide. |
| `node --test tests/account-controls.test.mjs tests/profile-editing.test.mjs tests/password-change.test.mjs tests/avatar-management.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/actions.test.mjs` | Passed: 7 distinct test-file runner entries, 0 failures. No browser assertions are counted here. |
| P2.1/P2.2/P3.2/P4.2 `npx playwright test --config=... --list` | Discovery passed: 8, 13, 14 and 15 scenarios respectively; 50 unique scenarios, **0 executed browser assertions**. |
| `npm run build` | Failed before a production build completed: Next 16.3.6 Turbopack processing `src/components/layout/SiteFooter.module.css` attempted to create a process and bind a port; `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-e7d256ad8ff837b1d3072b06d48d3a84.log`. The normal prebuild hook copied the already existing PDF worker; no source/dependency setting was changed. |
| Representative `npx playwright test --config=playwright.p4-2.config.ts` | Stopped before test code: `Process from config.webServer was not able to start. Exit code: 1`. The other three identical production-server suites were not repeatedly launched against the same boundary. |
| Computer browser inventory | No available browser surface; opening the in-app browser returned `Browser is not available: iab`. |
| Scoped whitespace | `git diff --check` and a trailing-whitespace scan of this report passed. |

No P4.3 screenshot was produced or inspected. Actual 320px, 390px, 768px and 1440px layout, light/dark contrast, long-text wrapping, 44px targets, focus and field associations, password visibility, photo preview/confirmation, top-bar avatar/dropdown and mobile bottom-navigation/safe-area clearance remain browser acceptance items. Existing suites prepare 320px checks and 390px/1440px captures; 768px requires an explicit owner viewport inspection. Earlier U1–U6 visual/build gaps are not closed here.

## Finite closure checklist for the owner

1. On a machine where Next can build/listen and Chromium can launch, run the commands below and retain the four suite results. Inspect their 390px/1440px light/dark captures and check the Account page at 320px and 768px in both themes for overflow, focus, 44px targets and safe-area clearance.
2. With one **isolated test account**, visit `/account` as guest, during account checking, after a simulated/temporary request failure and while signed in without ACTIVE membership. Confirm real details, read-only email and guest/Retry behavior.
3. Edit and cancel a profile draft; save one changed field; verify the header name, field/conflict feedback, uncertain-result Check saved profile, and a dirty draft while a photo or profile refresh occurs.
4. Upload, replace and remove a disposable JPEG/PNG photo. Confirm the unsaved preview, removal dialog, saved account image and header image/initials after each confirmed action; inspect a failed-image fallback and a new-version recovery.
5. Change this test account's password last. Confirm the account/header clears before sign-in, the old session is denied on a fresh request, the old password no longer signs in, and the new password does. Do not perform this step on an owner or production account.
6. Record browser screenshots/results and separately close the backend PostgreSQL concurrency and avatar storage/durability gates using their backend acceptance procedures. These were not run by P4.3.

Fish-compatible frontend commands:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/account-controls.test.mjs tests/profile-editing.test.mjs tests/password-change.test.mjs tests/avatar-management.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/actions.test.mjs
npm run build
npx playwright test --config=playwright.p2-1.config.ts
npx playwright test --config=playwright.p2-2.config.ts
npx playwright test --config=playwright.p3-2.config.ts
npx playwright test --config=playwright.p4-2.config.ts
```

No backend, migration, database, dependency, environment, deployment or reference-worktree file was changed. No owner server or lock was stopped or removed. Nothing was staged, committed, pushed or deployed.
