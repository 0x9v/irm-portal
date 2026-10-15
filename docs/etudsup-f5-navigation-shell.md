# EtudSup F5 — signed-in navigation shell

## Scope and exact changed files

The existing modified and untracked work, including concurrent backend work, was preserved. F5 changed only these current-frontend navigation files, tests, and this report:

| File | Change |
| --- | --- |
| `frontend/src/components/layout/ApplicationShell.tsx` | Defers the signed-in shell until initial auth completes; retains public frames and desktop collapse state. |
| `frontend/src/components/navigation/SidebarNav.tsx` | New platform mark, current IRM identity, scrollable links, and account region. |
| `frontend/src/components/navigation/MobileHeader.tsx` | Compact EtudSup/IRM header and separate drawer; retains Escape, outside dismissal, focus return, and navigation dismissal. Measures actual header height for drawer sizing. |
| `frontend/src/components/navigation/ContextBar.tsx` | Quieter route context and accessible desktop sidebar toggle. |
| `frontend/src/components/navigation/NavigationLinks.tsx` | Shared desktop/mobile destinations, permission gates, and nested active-route logic. |
| `frontend/src/components/navigation/AccountPanel.tsx` | Username/status, existing Appearance selector, Support, and logout with pending/error/retry handling. |
| `frontend/src/components/navigation/NavigationShell.module.css` | Responsive light/dark navigation presentation using semantic tokens. |
| `frontend/e2e/navigation-shell.spec.ts` | Mocked account, route, drawer, collapse, logout, theme, responsive, and screenshot checks. |
| `frontend/playwright.navigation-shell.config.ts` | Isolated production-server browser config. |
| `frontend/tests/navigation-model.test.mjs` | Executable role/capability and nested-route model checks. |
| `docs/etudsup-f5-navigation-shell.md` | This report. |

Guest landing, account and feature pages, dashboard data logic, authentication requests, WebSocket lifecycle, backend, dependencies, environment, deployment, and `/home/yasso/etudsup` were not edited. No work was staged, committed, pushed, or deployed. `MobileBottomNav.tsx` exists but is not mounted by `ApplicationShell`; F5 leaves it unmounted, avoiding a second always-visible mobile navigation strip.

## Before and after information architecture

Before: solid ink sidebar, combined brand/community wordmark, a long nearly uniform list with personal routes mixed into Study, Support mixed into Community, and separately maintained desktop/mobile gates. The account block was visually heavy.

After: EtudSup Home brand link; a small noninteractive IRM current-community card with FST Mohammedia context; distinct Home row; Study, IRM community, Your library, and conditional Management groups; then username/status, Appearance, Support, and Sign out. The desktop links scroll independently of the account region. The mobile header stays compact and opens a viewport-limited drawer with the same shared links. There is no working community switcher.

| Group | Label → real route | Gate |
| --- | --- | --- |
| Platform | Home → `/` | Signed-in |
| Study | Modules → `/communities/irm/modules` | Signed-in |
| Study | Pending documents → `/communities/irm/documents/pending` | ACTIVE |
| IRM community | Announcements → `/communities/irm/announcements` | ACTIVE |
| IRM community | Posts → `/communities/irm/posts` | ACTIVE |
| IRM community | Discussion → `/communities/irm/discussion` | ACTIVE |
| IRM community | Membership → `/communities/irm/membership` | Signed-in |
| Your library | Saved documents → `/communities/irm/documents/saved` | Signed-in |
| Your library | Recently opened → `/communities/irm/documents/recent` | Signed-in |
| Your library | My submissions → `/communities/irm/documents/mine` | ACTIVE |
| Management | Review applications → `/communities/irm/membership/review`; Manage staff → `/staff`; Members → `/members` | ACTIVE DELEGATE |
| Management | Voting settings → `/communities/irm/document-voting/settings` | ACTIVE and `manage_document_voting` |
| Account | Support → `/support`; Sign out → existing logout action | Signed-in |

All listed routes exist. Backend authorization remains authoritative. The shared model reads `AuthContext` membership status, role, capability, errors, and refresh state. Routine refresh keeps basic ACTIVE destinations discoverable from the last verified membership, while management links hide until refresh resolves. Auth or membership verification errors hide protected destinations.

## Permission matrix and active states

| State | Visible destinations |
| --- | --- |
| Guest or initial unresolved auth | Public frame only; signed navigation absent. |
| No membership, PENDING, REJECTED, REMOVED, BANNED | Home, Modules, Membership, Saved, Recently opened, Support; truthful account status. |
| ACTIVE MEMBER | Above plus Pending documents, Announcements, Posts, Discussion, My submissions. |
| ACTIVE MODERATOR without voting capability | ACTIVE member routes; no Management group. |
| ACTIVE MODERATOR with voting capability | ACTIVE member routes plus Voting settings. |
| ACTIVE DELEGATE | ACTIVE routes plus review/staff/members; Voting settings only if capable. |
| Verification error | Basic authenticated routes and Support; protected links hidden. |

`navigationIsActive` matches exact paths and descendants. Module detail, upload, and document reader select Modules; announcement detail selects Announcements; post detail/new selects Posts; saved/recent/submissions/pending select their own links. Review, staff, and members descendants select their specific management link, excluding general Membership. Desktop and mobile use the same route, gate, label, icon, and active rule.

## Visual review and remaining gap

The new light shell uses a warm white surface and fine borders against the canvas; dark mode uses the existing charcoal semantic surface. The IRM identity uses a small ink mark; lavender is reserved for hover and the single active link. Icons remain distinct, and links have no incidental underlines. Controls have 44px minimum targets and visible focus. The account area remains scrollable at short heights. The mobile drawer sizes itself from the measured header and `dvh`, with safe-area padding and reduced-motion styling.

**No screenshots were captured or inspected.** Chromium still exits at launch with `sandbox_host_linux.cc:41 ... Operation not permitted`, and the UI browser inventory reported no available browser or app. Rendered alignment, 200% text enlargement, overflow, and mobile-keyboard occlusion therefore remain visual acceptance gaps.

Owner-side checklist: run the browser suite below and compare its light/dark 390px mobile closed-header and open-drawer screenshots and 1440px desktop screenshots under `frontend/test-results/navigation-shell/` with the guest landing and F4 dashboard. Check 320px text wrapping and horizontal overflow; 768/1024px header spacing; 1440px short-height scrolling and Appearance/Sign out reachability; 200% text enlargement; and a mobile form or Discussion composer with the keyboard open. Revise visible defects before visual acceptance.

## Commands and results

- `cd frontend && npm run lint` — passed.
- `cd frontend && npx tsc --noEmit` — passed.
- `cd frontend && npm run build` — **passed**, fresh normal Next.js 16.3.6/Turbopack production build; 21 static routes generated.
- `cd frontend && node tests/navigation-model.test.mjs` — 7 model checks passed.
- `cd frontend && node --test tests/theme.test.mjs` — passed; Light/Dark/System persistence and pre-paint logic remain covered.
- `cd frontend && npx playwright test --config playwright.navigation-shell.config.ts --list` — 26 mocked checks discovered; **not executed**.
- Focused Playwright attempt with `--grep 'desktop collapse'` — configured local server could not start; no browser test body ran.
- Direct `chromium.launch()` — failed before a page opened with sandbox `Operation not permitted`.
- Scoped `git diff --check` on tracked F5 paths — passed.

Owner-side browser command after the completed build:

```bash
cd /home/yasso/irm-platform/frontend
npx playwright test --config playwright.navigation-shell.config.ts
```

Browser execution and screenshot inspection remain unresolved; they are not reported as passing tests.
