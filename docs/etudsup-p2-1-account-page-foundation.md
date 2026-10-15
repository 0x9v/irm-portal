# EtudSup P2.1 — account page foundation and navigation

## Scope and source

The working tree was already substantially modified and untracked before P2.1. I inspected Git status, the profile audit/backend handoffs, P4.1C avatar API, U1/U2/U6 reports, the current auth context, API base, shell/navigation, feedback controls, and the backend `UserResponse`. Concurrent backend, avatar API, Discussion, and other frontend work was preserved. This task adds read-only account display and navigation only.

## Exact changed-file inventory

| File | P2.1 change |
| --- | --- |
| `frontend/src/context/AuthContext.tsx` | Adds nullable `avatar_url` to the shared `User` response type. |
| `frontend/src/components/layout/ApplicationShell.tsx` | Uses the neutral shell on `/account` during refresh, logout or auth error, hiding any previous identity in the header. |
| `frontend/src/components/navigation/AccountPanel.tsx` | Adds authenticated “My account” link to the existing disclosure; keeps Support, Sign out and System appearance. Extracts the existing initials function without changing its behavior. |
| `frontend/src/components/account/accountInitials.ts` | Holds the existing username initials algorithm for navigation and avatar fallback. |
| `frontend/src/components/account/AccountAvatar.tsx` | Reads the authenticated avatar image through a credentialed fetch and uses a stable initials fallback. |
| `frontend/src/components/account/AccountAvatar.module.css` | Fixed avatar geometry using current tokens. |
| `frontend/src/app/account/page.tsx` | Actual read-only account route and checking/error/guest/owner states. |
| `frontend/src/app/account/AccountPage.module.css` | Bounded neutral cards, responsive details and safe text wrapping. |
| `frontend/tests/account-controls.test.mjs` | Updates disclosure expectations and checks page identity, legacy values, no-membership/banned access and neutral auth states. |
| `frontend/e2e/navigation-shell.spec.ts` | Updates the existing dropdown link and keyboard order assertions. |
| `frontend/e2e/account-foundation.spec.ts` | Prepares mocked browser scenarios for account, avatar, auth, navigation, responsive and theme behavior. |
| `frontend/playwright.p2-1.config.ts` | Focused production-server browser test config. |
| `docs/etudsup-p2-1-account-page-foundation.md` | This report. |

## Account and image behavior

`/account` reads `useAuth()` only. It shows username, first name, family name and email from the current `/api/v1/auth/me` response. Absent or blank legacy display values use “Not provided.” It does not infer names from usernames or membership applications. It displays no User UUID, membership/permission data, password data, storage keys, verification claims or invented account metadata. Profile fields are read-only; no edit, password or avatar mutation action is present.

Initial load, refresh and logout show a neutral checking state. The account route's shell also withholds an old account identity while checking or after an auth error. A confirmed guest sees a real `/login` link. Auth errors show sanitized inline feedback and Retry through the existing `refresh()` function. Any authenticated user can view their account, independent of IRM membership status, including no membership or a banned membership. The existing auth context remains the sole account source and retains its request-generation and logout behavior.

The backend exposes `avatar_url: string | null`, with a relative `/api/v1/users/{user_id}/avatar/{version}` URL. `AccountAvatar` resolves that URL against the same configured `API_URL` used by `fetchApi`, checks that it belongs to the current account on the configured API origin, and fetches with `credentials: "include"`. It uses a local blob URL for the native image rather than an anonymous Next image proxy. The component aborts requests and revokes blob URLs on identity/version change or unmount. State is keyed by account and version, so a prior image cannot render for another account; NULL, loading, request failure and image decode failure use the existing username initials. The 72px frame prevents size changes while loading. The image has one accessible avatar label and a decorative inner image.

The authenticated account disclosure now includes “My account.” Its existing appearance, Support, logout, focus/dismissal and pending/error logic remain. The mobile bottom navigation still points to Membership. No global theme or dashboard layout changes were made.

## Verification

| Check | Actual result |
| --- | --- |
| `npm run lint` | Passed, no warnings. |
| `npx tsc --noEmit` | Passed. |
| `node --test tests/account-controls.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs` | Passed: 3 files, including new account state assertions. |
| `npx playwright test --config=playwright.p2-1.config.ts --list` | Passed discovery: 8 mocked tests found. This is not execution. |
| `npm run build` | Failed before completion in Turbopack: `SiteFooter.module.css` → creating a new process → binding to a port → `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-acd0ac734b702e97ba1ca737fc601072.log`. The failure is at the sandbox process/port boundary, not a completed production build. |
| `npx playwright test --config=playwright.p2-1.config.ts` | Failed before any scenario: configured web server could not start, exit 1. |
| Direct Chromium launch | Failed at `sandbox_host_linux.cc:41`, `Operation not permitted (1)`, then SIGTRAP. |
| Scoped whitespace | `git diff --check` passed for touched tracked files; trailing-whitespace search of new source/config/spec files returned no matches. |

No P2.1 browser assertion executed and no 390px/1440px light/dark screenshots were produced. Consequently, actual 320px overflow, keyboard focus, image load/decode behavior, visual contrast and responsive composition still require owner-browser acceptance. Earlier U1–U6 visual/build gaps remain open.

On a machine where Next can build/listen and Chromium can launch, run these fish-compatible commands:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/account-controls.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs
npm run build
npx playwright test --config=playwright.p2-1.config.ts
```

Inspect the test output under `frontend/test-results/p2-1/`, including `account-light-390.png`, `account-dark-390.png`, `account-light-1440.png` and `account-dark-1440.png` in their Playwright test directories. Review the 320px wrapping/focus assertion and the avatar/auth scenarios in the same run. A successful owner build and browser run are required before claiming P2.1 visual acceptance.

## Next handoff boundaries

Profile editing can later call the existing owner-scoped `PATCH /api/v1/auth/me`, then refresh the shared auth context. Avatar management can later call the existing credentialed PUT/DELETE endpoints and refresh `avatar_url`; the display component already accepts a new version. Password security forms belong to their separate backend contract and must preserve session revalidation. None of these forms, uploads, removal controls or APIs was implemented in P2.1.
