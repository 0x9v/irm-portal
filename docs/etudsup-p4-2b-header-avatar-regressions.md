# EtudSup P4.2B — header avatar and frontend regressions

## Inspection and reproduced state

I inspected the dirty worktree before editing and preserved its concurrent backend, account, navigation and Discussion files. The CS5 report became available during this task and was read. The reported `AuthenticatedStickerImage.tsx` effect/image lint issue and `DiscussionComposer.tsx` undefined `error` were already corrected in the current source: initial and final full `npm run lint` and `npx tsc --noEmit` both passed without warnings or errors. I did not edit Discussion or claim its concurrent changes as P4.2B corrections.

The reproduced gap was in `AccountControls`: its authenticated trigger always rendered initials from the username, even when shared `AuthContext.user.avatar_url` contained a saved image. P4.2 already refreshed that shared user after confirmed upload/removal and kept truthful local feedback if refresh failed.

## Exact changed-file inventory

| File | P4.2B change |
| --- | --- |
| `frontend/src/components/account/AccountAvatar.tsx` | Adds compact/decorative rendering options to the existing credentialed image loader and checks the resolved path remains within the current user's avatar route. |
| `frontend/src/components/account/AccountAvatar.module.css` | Adds fixed 34px compact geometry matching the established account trigger. |
| `frontend/src/components/navigation/AccountControls.tsx` | Uses shared `user.id`, `username` and `avatar_url` in the trigger instead of an initials-only span. |
| `frontend/tests/account-controls.test.mjs` | Adds a rendered-source check for the compact decorative avatar and unchanged accessible trigger name. |
| `frontend/e2e/avatar-management.spec.ts` | Adds header assertions after upload/removal and account switch, a failed-image/new-version scenario, and visible header/dropdown checks in the four light/dark screenshot cases. |
| `docs/etudsup-p4-2b-header-avatar-regressions.md` | This report. |

The trigger remains a minimum 44px button named **Account options**, with the username where space allows. Its image is decorative because the button already has an accessible label. The existing initials, focus, Escape/outside dismissal, My account, System appearance, Support, Sign out, mobile Menu-left layout and single sun/moon control remain. The dropdown identity line retains its established initials treatment; the requested trigger displays the saved image.

`AccountAvatar` still resolves the relative backend URL against `API_URL`, requires the configured API origin and current user's avatar path, fetches with credentials, and renders a local blob URL. It aborts and revokes on account/version change or unmount. Image state is keyed by user ID and version, so an old account's image cannot render for the new account. NULL, loading, request and decode failures keep initials in the same fixed frame; a new version resets the fallback. No image proxy, persistent cache or second account identity store was added.

The top bar reads the single shared auth identity. A confirmed photo mutation updates it when P4.2's account refresh returns the new `avatar_url`. The account page's confirmed mutation feedback remains independent of a failed refresh, and the shell masks prior identity on an account refresh error. P4.2's profile draft/avatar generation guards, password auth clearing and logout/account-switch cleanup were left intact.

## Verification

Commands ran in `frontend/` unless indicated otherwise.

| Check | Actual result |
| --- | --- |
| Initial and final `npm run lint` | Passed repository-wide, no source failures or warnings. |
| Initial and final `npx tsc --noEmit` | Passed repository-wide. |
| `node --test tests/avatar-management.test.mjs tests/password-change.test.mjs tests/profile-editing.test.mjs tests/account-controls.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/actions.test.mjs` | Passed: 7 test files, 0 failures. Includes the new trigger rendering assertion. |
| `npx playwright test --config=playwright.p4-2.config.ts --list` | Discovery passed: 15 browser scenarios, including the new header scenario and four 390px/1440px light/dark captures. Discovery is not browser execution. |
| P2.1, P3.2 and D1 Playwright `--list` | Discovery passed: 8 account, 14 password and 90 Discussion/moderation/navigation scenarios respectively. None executed by listing. |
| `npm run build` | Failed in Turbopack before a production build completed: `SiteFooter.module.css` → creating a new process → binding to a port → `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-6dbad87768901b5058b9d8d501d4c6ca.log`. The prebuild hook copied the existing PDF worker; no worker source was edited. |
| `npx playwright test --config=playwright.p4-2.config.ts` | Failed before test code ran: `Process from config.webServer was not able to start. Exit code: 1`. No browser assertion or screenshot was produced. The CS5 report separately records a Chromium sandbox launch denial for its own run. |
| Scoped whitespace | `git diff --check` passed for the changed paths; a trailing-whitespace scan found no matches. |

The build and browser limits are separate from the earlier Discussion source failures, which no longer reproduce. The new avatar/header browser cases, 320px overflow and target measurements, keyboard interaction, both themes and 390px/1440px screenshot inspection remain acceptance gates. Prior U1–U6 visual/build gaps are not closed by these checks.

Owner-side fish-compatible commands where Next and Chromium can run:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/avatar-management.test.mjs tests/password-change.test.mjs tests/profile-editing.test.mjs tests/account-controls.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/actions.test.mjs
npm run build
npx playwright test --config=playwright.p4-2.config.ts
npx playwright test --config=playwright.p2-1.config.ts
npx playwright test --config=playwright.p3-2.config.ts
npx playwright test --config=playwright.d1.config.ts
```

Inspect the `avatar-header-<theme>-<width>.png` files under Playwright's `test-results/p4-2/` after browser execution. No backend, migration, database, dependency, environment, deployment or reference-worktree files were changed for P4.2B. Nothing was staged, committed, pushed, deployed or used to restart owner services.
