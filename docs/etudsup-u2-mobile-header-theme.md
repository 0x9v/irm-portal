# EtudSup U2 — mobile header and theme controls

## Scope and ownership

Inspected Git status before editing; the checkout already contains extensive modified and untracked frontend/backend work. The live agent inventory showed only this agent, and no shell-file edits were overwritten. Pre-edit copies of touched shell/theme/public files are in `/tmp/irm-u2-before/`. Read the F8, F9 and U1 reports, the local Next.js CSS and client-component guides, the shell, drawer, bottom navigation, account, theme store/bootstrap, route layout and existing tests. `/account` still has no implemented route in this checkout, so the account panel does not link to it. No backend, profile, authentication, membership, environment, dependency, PDF/discussion, dashboard or bottom-navigation source was changed.

## Exact changed files

| File | U2 change |
| --- | --- |
| `frontend/src/components/navigation/MobileHeader.tsx` | Places Menu first in the DOM, then EtudSup identity, with shared account/theme controls on the right; removes obsolete theme-disclosure cleanup. |
| `frontend/src/components/navigation/NavigationShell.module.css` | Flexible left header group and truncating identity; retains 44px controls and existing breakpoint/drawer. |
| `frontend/src/components/navigation/ThemeSelector.tsx` | Single accessible sun/moon button selecting the explicit opposite of the resolved theme; exports the shared System action. |
| `frontend/src/components/navigation/ThemeSelector.module.css` | Removes chevron/disclosure styling; adds selected System action styling and reduced-motion icon treatment. |
| `frontend/src/components/navigation/AccountControls.tsx` | Uses the single theme button beside the existing account trigger; removes native `<details>` coordination. |
| `frontend/src/components/navigation/AccountControls.module.css` | Divides appearance from account utilities and fixes the narrow-screen chevron selector. |
| `frontend/src/components/navigation/AccountPanel.tsx` | Offers “Use system appearance” in the existing disclosure, preserving Support and logout behavior. |
| `frontend/src/components/home/GuestHomeShell.tsx` | Keeps System reachable in public desktop navigation and the mobile guest drawer. |
| `frontend/src/components/home/GuestHome.module.css` | Fits the public appearance controls in the narrow guest sidebar/drawer. |
| `frontend/src/components/auth/AccountPage.tsx` | Keeps System reachable on login/register without adding the application header. |
| `frontend/src/components/auth/AccountPage.module.css` | Compact theme/System row within the existing account composition. |
| `frontend/tests/theme.test.mjs` | Verifies the actual selector renders one icon button and a separately selected System action; existing store/bootstrap tests remain. |
| `frontend/tests/account-controls.test.mjs` | Verifies Menu-first DOM order, one header theme control, System placement and guest access. |
| `frontend/e2e/navigation-shell.spec.ts` | Updates drawer/tab-order and account/System expectations for the new control arrangement. |
| `frontend/e2e/theme-preference.spec.ts` | Uses the single theme button and appropriate System action while retaining preference/reload/OS tests. |
| `frontend/e2e/theme-account-surfaces.spec.ts` | Checks icon-button contrast and account System selected state. |
| `frontend/e2e/u2-mobile-header-theme.spec.ts` | Adds mocked 390/1440 light/dark screenshots, 320px overflow/disclosure/theme, and guest System checks. |
| `frontend/playwright.u2.config.ts` | Lists focused browser suites using local mocked fixtures. |
| `docs/etudsup-u2-mobile-header-theme.md` | This report. |

## Behavior and layout

Before, the application mobile header placed the EtudSup brand first and Menu on the right beside an icon, an Appearance chevron and the account trigger. Now Menu is the first DOM and visual control on the left, followed by the compact brand. The right side holds one theme icon and authenticated initials/account trigger. At narrow widths Menu keeps its accessible label but shows its icon, the community subtitle is hidden, and the identity and username truncate before controls shrink. Desktop still uses ContextBar's sidebar toggle/breadcrumb on the left and the same account/theme controls on the right. Its structure and the sidebar breakpoint are unchanged.

The moon means “Switch to dark mode” when effective appearance is light; the sun means “Switch to light mode” when effective appearance is dark. Clicking while System is selected creates an explicit opposite preference. The separate Appearance chevron and `<details>` are gone. “Use system appearance” is a visibly selected `aria-pressed` button in the authenticated account panel, separated from Support/Sign out by a fine border. The public guest navigation shell has the same action in its sidebar and mobile drawer; login/register keep it in their own frame. The unauthenticated landing composition remains its own frame. No guest account trigger or profile link was added.

`ThemeContext`, `lib/theme.ts`, the `irm-theme` key/accepted values, prepaint script, native `color-scheme`, OS change subscription and cross-tab handling remain unchanged. The action is shared through ThemeSelector, and icon buttons use U1's `iconButtonStyles`. Reduced-motion styling remains. The account disclosure retains its `aria-expanded`/`aria-controls` relationship, ordinary Tab navigation, Escape/outside/route dismissal and trigger focus return; logout pending/error/retry stays in the existing panel. Mobile drawer and account continue to share exclusive disclosure state. Menu retains modal drawer focus containment, Escape/backdrop return, scroll lock and route dismissal. No permission gates or bottom-nav destinations changed.

The mobile/desktop dashboard order, F9 footer placement and PDF/discussion footer exceptions remain unchanged. No U3–U6 structural changes or profile frontend work were started.

## Verification and remaining acceptance

Commands run from `frontend/`:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed. |
| `node --test tests/theme.test.mjs tests/account-controls.test.mjs tests/navigation-model.test.mjs` | Passed: 3 test files. Theme store/bootstrap and navigation/permissions suites executed, including new U2 SSR assertions. |
| `npx playwright test --config=playwright.u2.config.ts --list` | Discovery only: 69 tests across four files, including new U2 browser checks. No browser test executed. |
| `npm run build` | Failed during normal Next/Turbopack production build: CSS processing for `SiteFooter.module.css` attempted to create a process and bind a port; sandbox returned `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-2d13997dd574dbfb1a3aba6e026b411.log`. This does not establish a source/CSS error and is **not** a completed build. |
| Scoped trailing-whitespace search and `git diff --check` | No issues in authored files. |

Browser-surface inventory returned no apps or browsers. The earlier U1 Chromium launch already failed with the same sandbox permission class, so it was not repeatedly launched. No U2 browser tests ran and **no screenshots or rendered visual acceptance were obtained**. The 390px/1440px light/dark captures and 320px/768px/1024px responsive, computed-style and focus checks remain owner-side acceptance. U2's failed normal build and absent browser provide no new evidence resolving U1's incomplete build/visual acceptance.

On a machine that permits the build and browser, run:

```bash
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/theme.test.mjs tests/account-controls.test.mjs tests/navigation-model.test.mjs
npm run build
npm run start -- -p 3152
```

Then in a second terminal:

```bash
cd /home/yasso/irm-platform/frontend
IRM_U2_TEST_URL=http://127.0.0.1:3152 npx playwright test --config=playwright.u2.config.ts
```

Inspect `test-results/u2/captures/` and the browser rendering before accepting mobile/desktop visuals. The normal build, browser interactions and actual screenshot inspection remain unverified here.
