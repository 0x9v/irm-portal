# EtudSup F8 — top account bar and sidebar footer cleanup

## Scope and ownership

Work was limited to the frontend shell, its focused verification, and this report. Initial modified/untracked work was inspected and preserved. The session's agent inventory contained only the F8 agent; no concurrent frontend shell editor was visible. The user identified P1.1 as a separate read-only profile/backend audit. No agent was spawned. A shell snapshot and initial frontend/document hashes were saved under `/tmp/irm-f8-before/` before edits and compared afterward.

Inspected ApplicationShell, ContextBar, SidebarNav, MobileHeader, MobileBottomNav, NavigationLinks, useNavigationDisclosure, ThemeSelector/provider/store/bootstrap, AuthContext/logout, global/scoped styles, route files, and the F5–F7 reports. Read the installed Next.js pathname and CSS guides required by `frontend/AGENTS.md`.

The approved Home columns, source/content order and ink hero are preserved. Feature-page content, public landing/login/register layouts, permissions, Delegate workflows, authentication/session requests, refresh behavior, WebSockets, bottom navigation, safe-area reservation and input/composer handling were not authored changes. No backend, profile API, database, migration, dependency, environment, deployment or `/home/yasso/etudsup` edits. Nothing staged, committed, pushed or deployed.

## Exact changed files

| File | Change |
| --- | --- |
| `frontend/src/components/navigation/AccountControls.tsx` | Shared header theme/account disclosure, associated panel, dismissal and focus return. New. |
| `frontend/src/components/navigation/AccountControls.module.css` | Bounded anchored panel, initials, truncation, focus, 44px targets, neutral themed surfaces. New. |
| `frontend/src/components/navigation/AccountPanel.tsx` | Moves existing Support/logout into dropdown content; full username and concise identity; retains pending/error/retry and adds immediate duplicate-submit guard. |
| `frontend/src/components/navigation/ContextBar.tsx` | Existing sidebar toggle/context on left, shared account/theme controls on right. |
| `frontend/src/components/navigation/MobileHeader.tsx` | Same controls in mobile header; one mutually exclusive drawer/account disclosure state; removes drawer account footer. |
| `frontend/src/components/navigation/SidebarNav.tsx` | Removes account/Appearance/Support/logout footer; branding/community/navigation retained. |
| `frontend/src/components/navigation/NavigationShell.module.css` | Approximately 64px desktop bar, flexible context, compact narrow header, bar above drawer backdrop; removes obsolete footer CSS and scopes undecorated navigation controls. |
| `frontend/src/components/navigation/ThemeSelector.tsx` | Existing F7 control gains compact presentation and callback; retains provider actions, adds outside/focus dismissal to its native preference disclosure. |
| `frontend/src/components/navigation/ThemeSelector.module.css` | Compact 44px preference target and anchored System action; public control retains its text presentation. |
| `frontend/e2e/navigation-shell.spec.ts` | Reconciles placement assertions; adds account keyboard/dismissal, long-identity/short-height, logout retry, breadcrumbs and drawer/account/theme/bottom interaction checks. Uses existing deny-by-default fixture. |
| `frontend/e2e/theme-preference.spec.ts` | Uses header control/account panel selectors; retains persistence/store/public checks and existing deny-by-default fixture. |
| `frontend/e2e/theme-account-surfaces.spec.ts` | Checks dropdown identity, focus/contrast and pending/error actions in both themes; ordinary disclosure Tab order replaces old footer expectations. Uses existing deny-by-default fixture. |
| `frontend/e2e/signed-in-home.spec.ts` | Logout opens account disclosure; existing dashboard checks retained and isolated with the existing deny-by-default fixture. |
| `frontend/playwright.f8.config.ts` | Frontend-only mocked shell/theme/dashboard runner; no server/backend/database hooks. New. |
| `frontend/tests/account-controls.test.mjs` | Actual component SSR shell/privacy checks and actual logout caller pending/duplicate/failure/timeout/retry checks. New. |
| `docs/etudsup-f8-top-account-bar.md` | This report. New. |

The normal package prebuild recopies the installed PDF worker; this is not an authored reader change. ApplicationShell, AuthContext, ThemeContext, theme storage/bootstrap, NavigationLinks, MobileBottomNav/MobileShell, NavIcons, globals.css and all dashboard/feature/public page source files remain unchanged relative to the F8 starting snapshot.

## Before and after placement

| Item | Before | After |
| --- | --- | --- |
| Account identity | Sidebar footer / mobile drawer footer | Header initials/username trigger; full username plus “EtudSup account” in the panel |
| Theme | Sidebar / mobile drawer footer | Header sun/moon action plus compact native Appearance options disclosure |
| Support | Beside Sign out in footer | Account dropdown link to existing `/support`; existing dashboard guidance retained |
| Sign out | Sidebar / mobile drawer footer | Account dropdown action calling the established logout handler |
| Sidebar context | EtudSup, current IRM/FST, grouped links | Retained; navigation gets the footer's former scrolling space |

`/account` is absent: source-route inspection and the completed production build route list contain no account/profile route. “My account” is omitted. `AccountPanel.tsx` marks the action-list insertion point for the future usable account route. No placeholder, disabled item, editing claims, fake portrait, remote avatar service or upload flow was added.

## Accessibility, responsive and privacy decisions

- Desktop bar uses current semantic tokens, a fine bottom border, existing typography, and a 64px minimum. The context side can shrink; long username text ellipsizes inside a bounded trigger. Full username wraps within the panel.
- Mobile uses EtudSup identity, Menu, the same theme component and account trigger. Below 600px the trigger hides username/chevron and the brand hides its long community subtitle. Below 480px Menu shows its icon with its existing accessible name. The drawer retains full IRM/FST community context. At tablet widths usernames are bounded.
- Account trigger has an accessible name, `aria-expanded`, and a unique `aria-controls` associated with a labeled region. This is a non-modal disclosure with ordinary Tab/Shift+Tab order, rather than an incomplete ARIA menu. Escape restores trigger focus; outside pointer dismissal returns focus if it was inside the disappearing panel before allowing the pointer's normal focus action. Focus leaving closes the panel. Support/success navigation closes it; pathname changes and switching to the other header breakpoint dismiss it.
- The panel is mounted while hidden so explicit dismissal/reopening retains local logout failure feedback. Header/panel controls have visible focus. Panel width and scrollable maximum height are bounded using viewport dimensions; identity text wraps. Buttons and the compact Appearance summary have 44px targets. Reduced-motion rules and F7 icon behavior remain.
- Mobile drawer and account use one mutually exclusive disclosure state. Opening account releases drawer inert/scroll-lock state; opening Menu closes account and the preference disclosure. Opening Appearance options closes the account/drawer. Header controls sit above the backdrop. Existing drawer focus containment, Escape/backdrop return and route dismissal hook are retained. The account panel has no backdrop or body lock.
- Top bar/panel identity is derived only from username and initials. Email, first/family/applicant names, CNE, promotion, membership application fields and management details are not displayed there. The existing dashboard remains the source of membership guidance.
- Logout calls the unchanged `useAuth().logout()` implementation. Its API, timeout, session invalidation, failure semantics and already-signed-out handling remain. Local pending plus context pending and an immediate ref guard prevent duplicate submission. Sign out remains visibly present but disabled while pending; a live status announces progress. Failure does not invoke dismissal/navigation, shows plain-language feedback and enables Retry logout. Only confirmed success dismisses and pushes the existing `/login` experience.
- Light/Dark/System continue to use the unchanged `irm-theme` store/provider/head bootstrap. Sun/moon selects the opposite resolved appearance. System remains available in the same native preference disclosure and follows the OS. Compact presentation is enabled only for signed-in header controls; public controls retain their existing text presentation. CSS hides the inactive desktop/mobile header, so only one signed-in theme control is visible.

### Scoped underline investigation

The source scan found intentional `.ui-link` and inline prose underlines, plus the old footer Retry logout underline. Existing sidebar/mobile resets targeted anchors only; ContextBar buttons had no explicit scoped decoration reset. F8 removes the old underlined retry presentation, gives its retry a button treatment, and explicitly resets decoration only within sidebar/header/account navigation controls. Inline text-link rules and global styles are preserved.

Computed styles could not be inspected because both browser execution paths are unavailable. The historical screenshot underline discrepancy cannot be conclusively attributed to a runtime/browser stylesheet from source inspection. The mocked browser checks include computed `text-decoration-line` assertions; owner-side inspection is still required. No user stylesheet or browser setting was modified to force screenshots.

## Executed verification

Commands are run from `/home/yasso/irm-platform/frontend` unless stated otherwise.

| Command | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed. |
| `npm run build` (initial execution) | Completed normal Next.js 16.3.6/Turbopack production build: compiled, TypeScript, 21 static pages generated, final optimization complete. Existing external `/home/yasso/package-lock.json` warning. This preceded the last disclosure cleanup and new test harness, so it is not final-tree build acceptance. |
| `npm run build` (final rerun and retries) | Blocked in Turbopack CSS processing: worker port binding failed with `Operation not permitted (os error 1)`. Final-tree default production build requires owner-side rerun. No build configuration, sandbox or environment files changed. |
| `npm run build -- --webpack` | Tried the installed Next CLI's documented production bundler option. Failed before compilation: `Could not parse output from TypeScript's --showConfig`. Direct Next configuration-CLI probe returned empty child stdout; standalone `npx tsc --noEmit` passed. No successful alternative final-tree build is claimed. |
| `node tests/account-controls.test.mjs` | 6 passed: actual shell selection, permission preservation/privacy, associated full identity, actual logout pending/duplicate guard/success, failure and timeout retries. |
| `node tests/theme.test.mjs` | 12 passed, including store/bootstrap, System/OS/cross-tab, storage failures and actual selector SSR. |
| `node tests/navigation-model.test.mjs` | 7 passed: existing permission and nested-active rules. |
| `node tests/mobile-presentation.test.mjs` | 19 passed: bottom-navigation states/destinations and mobile shortcuts. |
| `node tests/home-presentation.test.mjs` | 16 passed: approved dashboard composition, identity/privacy, guidance and permissions. |
| `npx playwright test --config playwright.f8.config.ts --list` | 101 discovered in 4 files. Discovery is not execution. |
| Focused browser command below | 23 attempted; all failed at Chromium startup, 0 page assertions ran. Same launch error in every result. |
| `npm run start -- --hostname 127.0.0.1 --port 3148` | Blocked before serving: `listen EPERM: operation not permitted 127.0.0.1:3148`. |
| Standard `chromium.launch()` probe | Blocked before page creation: `sandbox_host_linux.cc:41`, `shutdown: Operation not permitted (1)`. No custom sandbox flags/settings added. |
| UI automation inventory | No browser/app surfaces available. |
| `git diff --check -- frontend/src frontend/e2e frontend/tests` from repo root | Passed; new files additionally checked for whitespace/final newline. |

Focused attempted command:

```sh
npx playwright test --config playwright.f8.config.ts --grep 'account disclosure keyboard|logout error is retained|long identity|theme options, drawer|guest and unresolved|desktop permissions|nested routes'
```

Browser log: `/tmp/irm-f8-browser.log`. Machine-readable attempted result: `frontend/test-results/f8/results.json`. Final failed build/lint logs: `/tmp/irm-f8-build-final.log`, `/tmp/irm-f8-lint.log`; additional default retry and Webpack attempt: `/tmp/irm-f8-build-retry.log`, `/tmp/irm-f8-build-webpack.log`. Mocked suites use `e2e/moderation-fixtures.ts` to deny unmatched API calls and isolate WebSockets; they cannot reach a backend. No backend service is started.

## Screenshots and remaining acceptance gaps

**Visual acceptance is unverified. No actual application screenshots were captured or inspected.** Available historical clipboard references were inspected; the F6/F7 approved composition and the current source are preserved, but these are not new runtime screenshots or proof of an exact visual match.

Capture checks cover 320/390/768/1024/1440px in light/dark, closed shell/open account, desktop/mobile drawer, and long usernames at 420px height. Captures are written under `frontend/test-results/f8/captures/` when browser execution is available. F8's focused assertions also cover guest/loading/signed-in, ordinary member/pending/Delegate, permissions, nested context/active selection, focus/dismissal, System persistence, logout success/pending/error/retry and disclosure/bottom-navigation interaction.

Remaining gaps: a completed default production build of the final tree; actual pixel spacing/contrast and computed underline source; keyboard/focus behavior in a live DOM; real device safe areas/virtual keyboard/composer; text enlargement; short-height scrolling; all mocked browser interactions; screenshot comparison with the current approved landing/account/dashboard. SSR and caller tests are not counted as browser or visual acceptance.

## Exact owner-side commands

Terminal 1, with loopback listening and Chromium permitted:

```sh
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
npm run build
npm run start -- --hostname 127.0.0.1 --port 3148
```

Terminal 2:

```sh
cd /home/yasso/irm-platform/frontend
node tests/account-controls.test.mjs
node tests/theme.test.mjs
node tests/navigation-model.test.mjs
node tests/mobile-presentation.test.mjs
node tests/home-presentation.test.mjs
npx playwright test --config playwright.f8.config.ts
```

A different existing frontend test server can be selected without `.env` edits:

```sh
IRM_F8_TEST_URL=http://127.0.0.1:YOUR_PORT npx playwright test --config playwright.f8.config.ts
```

Inspect the generated desktop/mobile captures beside the approved dashboard, landing and public account pages. Verify panel/controls stay inside the viewport in both themes, long identity remains readable, breadcrumbs and top actions fit, and sidebar management links scroll at 420–510px heights. With keyboard only check Tab/Shift+Tab, Escape, outside/navigation dismissal and focus return; switch between drawer/account/System disclosure and bottom destinations. Exercise logout error/retry without losing visible feedback. On a device inspect safe-area clearance, enlarged text, and opening/closing a form/composer keyboard. Fix visible failures before accepting the visuals.
