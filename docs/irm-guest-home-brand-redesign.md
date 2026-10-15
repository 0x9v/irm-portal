# IRM Hub guest Home — brand redesign

## Status

Implemented in the actual Next.js application. **Visual acceptance is pending:** no browser assertions or screenshots executed successfully in this sandbox. This is not a visual approval claim. Signed-in Home was not redesigned.

## Exact files changed for this task

- `frontend/src/components/home/GuestBrandMark.tsx` — new original inline SVG mark.
- `frontend/src/components/home/GuestHome.tsx` — new guest content.
- `frontend/src/components/home/GuestHome.module.css` — new scoped guest styles.
- `frontend/src/components/home/GuestHomeShell.tsx` — new Home-only guest navigation and theme controls.
- `frontend/src/app/page.tsx` — mount guest component; keep neutral checking state during unauthenticated retry.
- `frontend/src/components/layout/ApplicationShell.tsx` — minimal dispatch to the Home-only guest shell when Home has no authenticated user; existing shell remains for authenticated users and other routes.
- `frontend/e2e/guest-home.spec.ts` — focused mocked coverage, responsive checks, and screenshot cases.
- `docs/irm-guest-home-brand-redesign.md` — this report.

Git status was inspected before edits. The worktree already contained extensive modified and untracked files, including Saved Documents, Recently Opened, Home work, and backend changes. Those were preserved. No other active agent appeared in the available agent inventory; no overlapping frontend editor was evident in the process inspection.

## Before and after

Previously, confirmed guests saw the existing light card welcome and generic shared navigation, including links into authenticated areas. The new guest Home has a fixed ink hero and sidebar, a public-route mobile menu, prominent Sign in and Create an account actions, three brief explanations of study resources, updates, and participation, and a visible Support action.

The hero explains the product without fake modules, announcements, activity, counts, or progress. FST Mohammedia / IRM is context; the page describes an independent student initiative and makes no official institutional endorsement claim.

### Authentication and data behavior

- Initial `/auth/me` remains owned by AuthContext. Only a confirmed unauthenticated result renders the guest welcome.
- Initial checking and authentication errors retain the existing neutral/error Home treatments. Authentication errors retain Try again.
- A small Home guard also covers `!user && isRefreshing`: AuthContext clears its error when retry starts, so the previous guard could briefly show guest content during a retry. AuthContext itself is unchanged.
- The guest shell suppresses Sign in/Create an account navigation until the unauthenticated result is confirmed.
- Guests cause no module, announcement, document, membership, or discussion fetch from Home. Modules require an authenticated account; community participation/announcements require appropriate membership. Guest content explains these requirements instead of linking into protected pages.
- Guest routes are `/`, `/login`, `/register`, and `/support`. Support is usable without a membership request. No protected navigation prefetch is introduced.
- Existing authenticated Home JSX, requests, request identifiers, abort cleanup, retries, membership error handling, and access-loss behavior are unchanged. The signed-in Home suffix and request-effect blocks were compared against the pre-edit snapshot and were identical.
- Login, logout, membership semantics, redirects, and persistent theme logic remain owned by existing components/context.

### Navigation scope

The shared shell has only a Home dispatch change. Guest sidebar/mobile navigation is implemented in the new guest-specific component, without changing SidebarNav, the signed-in drawer, bottom navigation, or other pages. The Home guest menu is a labelled disclosure with Escape-to-close/focus return; it presents public routes only. The existing ThemeSelector is reused. There is one main landmark and one Home H1; the skip link targets the focusable H1 after guest confirmation.

## Visual decisions

Ink `#19171e` anchors sidebar and hero in both themes. The original mark depicts two connected open learning spaces; exactly the same vector appears beside IRM Hub and as large desktop hero artwork. It is decorative for accessibility and is not an FST logo. Mobile removes the large artwork to prioritize the brand, headline and both authentication actions.

The reference dashboard informs the left-navigation/application structure. The EtudSup reference informs the confident heading scale, ink surface, and generous spacing; no EtudSup code, font files, or assets were accessed for this task.

Muted violet is limited to the mark, selected-navigation indicator, Sign in, and focus/theme accents. Create an account is a clearly bordered neutral action. Value explanations share one calm divided surface, not a fictitious dashboard. Guest action/navigation underlines are removed through scoped component styling; there are no unstyled inline prose links.

Font: unchanged `var(--font-body)` = `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. No font dependency/download was added. Display headings use weight 750, tight tracking and responsive sizing; the actual rendered fallback could not be inspected because Chromium could not launch.

### Palette

| Use | Light | Dark |
| --- | --- | --- |
| Workspace | `#f4f2ee` | `#17161b` |
| Value surface | `#ffffff` | `#211f25` |
| Body text | `#211f24` | `#f1eef3` |
| Secondary text | `#625d65` | `#c7c1ca` |
| Decorative separator | `#d8d4ce` | `#48444d` |
| Primary action | `#65558f` | `#b6a8d1` |
| Primary text | `#ffffff` | `#211c29` |
| Primary hover | `#57477c` | `#c9bde0` |
| Workspace focus | `#65558f` | `#d0c3e5` |

Both themes: hero/sidebar `#19171e`, hero heading `#f8f6f8`, hero body `#cec9d2`, hero note `#b6afbf`; secondary button `#24212a` with `#9c95a4` border; ink focus `#e2d9f0`. Ink theme controls explicitly use `color-scheme: dark`. Controls have comfortable 44–52px minimum heights, 12px radii, visible focus, and 170ms color/border transitions disabled under reduced motion. Mobile styles use natural DOM order and wrapping, not CSS reordering.

## Contrast calculations

Calculated using Python and WCAG sRGB relative luminance: linearize each channel at 0.04045, weight by 0.2126/0.7152/0.0722, then `(Llighter + .05)/(Ldarker + .05)`. These are calculations from specified solid CSS surfaces, **not browser accessibility results**.

| Combination | Foreground / adjacent background | Ratio |
| --- | --- | --- |
| Light body | `#211f24` / `#f4f2ee` | 14.60:1 |
| Light muted | `#625d65` / `#f4f2ee` | 5.74:1 |
| Light muted card | `#625d65` / `#ffffff` | 6.42:1 |
| Light action | `#ffffff` / `#65558f` | 6.46:1 |
| Light action hover | `#ffffff` / `#57477c` | 8.08:1 |
| Dark action | `#211c29` / `#b6a8d1` | 7.53:1 |
| Dark action hover | `#211c29` / `#c9bde0` | 9.38:1 |
| Hero heading | `#f8f6f8` / `#19171e` | 16.51:1 |
| Hero body | `#cec9d2` / `#19171e` | 10.92:1 |
| Hero note | `#b6afbf` / `#19171e` | 8.35:1 |
| Secondary action text | `#f8f6f8` / `#24212a` | 14.73:1 |
| Secondary/control border, inside | `#9c95a4` / `#24212a` | 5.47:1 |
| Secondary/control border, outside | `#9c95a4` / `#19171e` | 6.13:1 |
| Primary boundary against hero | `#b6a8d1` / `#19171e` | 8.04:1 |
| Ink focus | `#e2d9f0` / `#19171e` | 13.04:1 |
| Ink focus on selected navigation | `#e2d9f0` / `#3a3443` | 8.80:1 |
| Light focus on canvas / white | `#65558f` / `#f4f2ee`, `#ffffff` | 5.78:1 / 6.46:1 |
| Dark focus | `#d0c3e5` / `#17161b` | 10.81:1 |
| Dark body | `#f1eef3` / `#17161b` | 15.65:1 |
| Dark muted card text | `#c7c1ca` / `#211f25` | 9.25:1 |
| Selected theme control | `#d0c3e5` / `#3a3443` | 7.20:1 |
| Support boundary, light / dark | muted text against respective canvas | 5.74:1 / 10.20:1 |

Text combinations exceed 4.5:1; focus/control boundaries listed exceed 3:1. The subtle value separators are decorative, not interactive-control boundaries. The light primary has a contrasting lavender boundary because the violet fill alone is not a strong enough boundary against the ink hero.

## Verification

Commands run from `/home/yasso/irm-platform/frontend` unless stated otherwise.

| Command/check | Actual result |
| --- | --- |
| `npm run lint` | Passed, exit 0. |
| `npx tsc --noEmit` | Passed, exit 0. |
| `npm run build` | Blocked, exit 1. Normal Turbopack build failed writing `/page`: CSS processing attempted process creation/port binding; `Operation not permitted (os error 1)`. |
| `npx next build --webpack` | Failed, exit 1. Additional diagnostic fallback: `Could not parse output from TypeScript's --showConfig.` This does not validate the production build. |
| `npx playwright test --config=playwright.guest-home.config.ts` | Blocked before test execution: configured frontend webServer exited 1. Zero browser assertions executed. |
| `DEBUG=pw:webserver npx playwright test --config=playwright.guest-home.config.ts --grep 'confirmed guest gets'` | Same startup block; zero assertions executed. |
| `npx playwright test --config=playwright.guest-home.config.ts --list` | Discovered 25 tests; discovery is not a pass. |
| `npm run dev -- --hostname 127.0.0.1 --port 3108` | Direct attempt printed Ready; separate curl could not connect. The task's server was stopped. This did not establish a usable browser server. |
| Direct Playwright Chromium launch using `/usr/sbin/chromium`, headless, `--no-sandbox` | Failed before page creation: crashpad `setsockopt: Operation not permitted (1)`, browser terminated with SIGTRAP. |
| SHA-256 snapshot comparisons | Preexisting source changes confined to Home and ApplicationShell; new source files confined to the four guest files. Dependency manifests/lockfile, tsconfig, next-env, PDF worker and Git index unchanged from task baseline. |

The 25 mocked tests cover pending auth, confirmed guest and Support navigation, authentication errors/retry, delayed signed-in transition and membership error, public guest navigation/Escape, keyboard activation/focus, theme persistence/reduced motion, six widths in both themes, and four screenshots. All API calls are intercepted in these tests; no backend/database is started. **Every browser assertion remains unexecuted**, including first-screen CTA position, overflow, actual computed focus, rendered themes, navigation activation, and screenshots. Static source review and contrast arithmetic do not replace these checks.

### Owner-side screenshot and acceptance steps

On a machine able to launch Chromium and bind localhost, with the existing frontend dependencies and Playwright browser installed:

```sh
cd /home/yasso/irm-platform/frontend
npx playwright test --config=playwright.guest-home.config.ts
```

For just the four required screenshots:

```sh
npx playwright test --config=playwright.guest-home.config.ts --grep 'captures'
```

The existing isolated config starts only the frontend on `127.0.0.1:3108`; the tests mock API responses. Do not start an owner backend. PNGs are written beneath `frontend/test-results/guest-home/` in test-specific directories, named `guest-light-390.png`, `guest-dark-390.png`, `guest-light-1440.png`, and `guest-dark-1440.png`. Screenshots use 390×844 and 1440×1000 viewports, full page.

Inspect both themes side by side: ensure brand/headline/both auth actions fit the first 844px at 390px; inspect ink mark and typography at 1440px; confirm value text remains subordinate and no protected destinations appear in guest navigation. The full suite also checks 320, 390, 768, 1024, 1280 and 1440px for horizontal overflow. Review 320 and 768 manually for wrapping, keyboard tab order, menu Escape behavior, and readable focus against the adjacent surface. No real screenshots are included because rendering was blocked.

## Preservation and stopping point

No signed-in dashboard content or requests, AuthContext, shared global styles, backend files, APIs, authorization, databases, EtudSup files, Saved Documents/Recently Opened implementation, reader/PDF behavior, dependencies, deployment or environment files were changed by this task. The tiny shared shell dispatch is explicitly listed above. No staging, commit, push or deployment occurred. Existing unrelated work remains in place. Work stops at the guest page, with browser/visual acceptance pending.
