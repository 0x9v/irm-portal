# EtudSup P3.2 — account password security frontend

## Scope and source

I inspected Git status before editing and preserved the extensive existing modified and untracked backend, Discussion, account, navigation and theme work. I read the P2.1/P2.2 account handoffs, P3.1 password contract, P3.3 acceptance report and U1/U2/U6 reports. I inspected the current account page/profile editor, `AuthContext`, `fetchApi`, login feedback, shared controls, backend password schema and Discussion auth-loss cleanup. This task changes only the frontend and this report. The account page still requires authentication but no ACTIVE membership.

## Exact P3.2 changed-file inventory

| File | P3.2 change |
| --- | --- |
| `frontend/src/app/account/SecuritySection.tsx` | Inline Security section, password form, local feedback, request, account-scope and uncertainty handling. |
| `frontend/src/app/account/ProfileContent.tsx` | Mounts the separate Security section beneath the existing profile editor. |
| `frontend/src/app/account/AccountPage.module.css` | Neutral bordered section, responsive form spacing and wrapped actions. |
| `frontend/src/context/AuthContext.tsx` | Adds account-ID-checked local auth clearing, stale-refresh invalidation and a one-time, non-secret password-success notice. |
| `frontend/src/lib/api.ts` | Allows a caller to require an exact success status; the password call requires 204. Existing callers keep their behavior. |
| `frontend/src/lib/passwordChange.ts` | Pure code-point validation and safe field-location error mapping. |
| `frontend/src/app/login/page.tsx` | Displays and consumes the one-time success notice. |
| `frontend/tests/password-change.test.mjs` | Executed validation, sanitized errors, credentialed JSON and exact-204 tests. |
| `frontend/tests/account-controls.test.mjs` | Updates the read-only account assertion for the new Security action while retaining private-data checks. |
| `frontend/e2e/password-security.spec.ts` | Fourteen mocked browser scenarios, including four light/dark 390px/1440px captures. |
| `frontend/playwright.p3-2.config.ts` | Focused production-server browser suite. |
| `docs/etudsup-p3-2-password-security-frontend.md` | This handoff. |

## Form and request contract

The Security card uses the existing bordered account surface. “Change password” opens an inline form with visible Current, New and Confirm labels. The warning says that changing the password signs the user out on all devices. Autocomplete is `current-password` and `new-password`; the shared 44px icon button toggles password visibility without submitting. The shared primary pending label and neutral Cancel match U1/U6 controls. The identity card, read-only email, avatar and profile editor remain separate.

The form sends `POST /api/v1/auth/me/password` through credentialed `fetchApi` with JSON containing **only** `current_password` and `new_password`. Confirmation is local. The browser supplies Origin. Values are sent exactly as typed: no trim, Unicode normalization, case conversion or truncation. Local validation requires a nonempty current password, eight Unicode code points in the new password, a different new value and exact confirmation. A synchronous submission ref plus pending state block duplicate POSTs. The backend remains authoritative. Only a returned **204** confirms success; an unexpected 2xx is treated as unknown.

The backend's 400 appears beside Current password; sanitized 422 locations appear beside the appropriate field, including `password_unchanged` beside New password. Field errors use `aria-invalid`, `aria-describedby` and inline alert text. A 401 clears stale local authentication and goes to sign-in without a success claim. A 403 gives safe request-authorization guidance; a 413 gives bounded-request guidance. Other definitive client errors use safe prose. Network, 5xx and unexpected-success-status outcomes are neutral and never expose response details or passwords.

## Auth state, secrets and uncertain outcome

On confirmed 204 the form clears its draft, then `AuthContext.clearAuthenticatedState(expectedUserId, true)` invalidates older refreshes and removes user, membership and capabilities **before** replacing the route with `/login`. It does not call `/auth/logout`; the backend has already revoked all sessions and expired the cookie. Discussion already tears down its socket and protected state when the shared user ID changes or its route unmounts, so no Discussion code was changed. The login page consumes a one-time in-memory success flag and displays “Password changed. Sign in with your new password.” The flag contains no secret and is cleared when a new authenticated account is loaded.

On an unconfirmed response, the section erases password fields, closes the form, shows “We couldn’t confirm the result. Try signing in with your new password.” and offers a real Sign in action. That action clears only local auth state before navigation; it sends no logout or second password POST. The UI does not claim the operation failed or that the old password still works. Passwords live only in component memory; Cancel, unmount, logout and account change remove that state. Neither password is placed in a URL, browser storage, analytics or feedback.

The form is mounted under the existing User UUID key. Logout aborts and clears it immediately; an account switch unmounts it. `useAsyncScope` ignores stale completions, and the context clear checks the expected UUID before touching shared state or redirecting. Ordinary same-account account refresh still preserves the P2.2 profile-editor draft. The password section has its own errors and notice, so it does not overwrite profile-save feedback. No claim is made about preventing an unseen cross-tab cookie change before the backend receives a request; the server remains responsible for session authorization.

## Verification and remaining acceptance

Commands ran from `frontend/` unless stated otherwise.

| Check | Actual result |
| --- | --- |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed. |
| `node --test tests/password-change.test.mjs tests/profile-editing.test.mjs tests/account-controls.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/actions.test.mjs` | Passed: 6 files. The password unit file includes 3 executed tests. |
| `npx playwright test --config=playwright.p3-2.config.ts --list` | Passed discovery: 14 mocked tests. **No browser assertion executed.** |
| `npm run build` | Failed before completion in Turbopack: `SiteFooter.module.css` → creating a new process → binding to a port → `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-2baae1940a87ff9df809af721ba42d3f.log`. This is the same sandbox boundary as P2.1/P2.2, not a production-build pass. A later exact-status helper adjustment passed lint, TypeScript and unit tests; build was not repeatedly retried against the same blocker. |
| `npx playwright test --config=playwright.p3-2.config.ts` | Failed before tests: `Process from config.webServer was not able to start. Exit code: 1`. This attempt preceded the final fourteenth scenario; discovery after that addition passed. |
| Scoped whitespace | `git diff --check` passed for touched tracked files. Trailing-whitespace search of the new and modified account source/spec/config files found no matches. |

No screenshots were produced. The 320px overflow/focus assertions, light/dark contrast, 390px/1440px captures, live 204/login handoff, stale-account interaction and Discussion socket closure require actual browser execution. P2.1/P2.2 and U1–U6 build/visual gaps remain open; test discovery does not close them.

Owner-side fish-compatible commands on a machine where Next can build/listen and Chromium can launch:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/password-change.test.mjs tests/profile-editing.test.mjs tests/account-controls.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/actions.test.mjs
npm run build
npx playwright test --config=playwright.p3-2.config.ts
```

Inspect `frontend/test-results/p3-2/` for the browser results and `password-security-<theme>-<width>.png` captures in their Playwright test directories. Review the 320px 44px/overflow check and account-switch/uncertain cases before visual acceptance.

No backend, migration, database, dependency, environment, deployment, reference-worktree, Discussion, avatar-management or future-phase files were changed for P3.2. Nothing was staged, committed, pushed, deployed or restarted.
