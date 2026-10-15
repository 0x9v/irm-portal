# F9 — Support EtudSup and shared copyright footer

## Scope and ownership

Implemented in `/home/yasso/irm-platform/frontend`. Inspected git status before editing and preserved the existing modified/untracked F1–F8 work. Read the F5–F8 reports, navigation shell, account/guest layouts, dashboard, buttons, theme and mobile navigation. No other frontend agent was visible in the collaboration inventory; the concurrent backend profile work was left untouched. A pre-edit frontend content snapshot was retained in `/tmp/irm-f9-before` for checking the task's changes independently of the already dirty git tree.

No backend, profile API, authentication/session behavior, payment integration, dependency, environment or deployment changes. Nothing was staged, committed, pushed or deployed.

## Exact authored files

Paths below are relative to the repository root. Existing files were changed relative to the F9 starting snapshot, including files already untracked before this task.

| File | F9 change |
| --- | --- |
| `frontend/src/app/support/page.tsx` | Support identity, contribution/help content, safe existing contact links and shared navigation buttons |
| `frontend/src/app/support/Support.module.css` | New scoped Support layout using current EtudSup tokens |
| `frontend/src/components/layout/SiteFooter.tsx` | New shared copyright component |
| `frontend/src/components/layout/SiteFooter.module.css` | New restrained footer styling and safe-area padding |
| `frontend/src/app/layout.tsx` | Supplies one server-derived current year to the shell |
| `frontend/src/components/layout/ApplicationShell.tsx` | Owns footer placement across ordinary layouts and constrained-view exceptions |
| `frontend/src/app/page.tsx` | Removes the dashboard's hardcoded copyright copy |
| `frontend/src/components/home/HomeDashboard.module.css` | Removes obsolete footer declarations |
| `frontend/src/components/home/GuestHome.tsx` | Removes the landing's previous separate identity footer |
| `frontend/src/components/home/GuestLanding.module.css` | Removes the landing's obsolete footer declarations |
| `frontend/tests/support-footer.test.mjs` | New actual-component rendering checks for contact states, navigation, privacy and footer ownership |
| `frontend/tests/home-presentation.test.mjs` | Updates dashboard composition assertions for shell-owned copyright |
| `frontend/tests/account-controls.test.mjs` | Supplies the shell's year prop in existing rendering fixtures |
| `frontend/e2e/support.spec.ts` | Focused mocked Support, accessibility, responsive and footer checks |
| `frontend/e2e/signed-in-home.spec.ts` | Updates copyright selectors and dynamic-year expectations |
| `frontend/e2e/mobile-home.spec.ts` | Updates the two copyright selectors for shell ownership |
| `frontend/e2e/foundation-acceptance.spec.ts` | Updates the existing contact helper's expected EtudSup message |
| `frontend/playwright.f9.config.ts` | New frontend-only mocked acceptance runner without backend/startup hooks |
| `docs/etudsup-f9-support-footer.md` | This report |

`frontend/tsconfig.tsbuildinfo` was refreshed by TypeScript; build/test outputs are generated artifacts. Existing package/configuration, auth, theme, bottom navigation and profile work were preserved.

## Real contribution/contact mechanism

The only existing mechanism is optional `NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER`. The example environment setting is empty and the local environment does not configure it. No payment URL, checkout, bank details or other contribution mechanism was found. Environment files were not changed.

The current local page therefore displays **“Contribution details are not yet available.”** and renders no dead contribution button. Practical help retains community Delegate guidance when online contact details are unavailable.

If the existing setting contains a valid international digit string (7–15 digits, with surrounding whitespace trimmed), the page renders:

- **Contact us about supporting EtudSup**, opening the configured `https://wa.me/…` destination with a contribution-specific message.
- **Contact for help on WhatsApp**, opening the same actual contact with a separate account/community-help message.

Both anchors use `target="_blank"` and `rel="noopener noreferrer"`, and visible captions explain WhatsApp/new-tab behavior. Missing or malformed values produce no contact link. No synthetic fixture number is used by application code or placed in configuration. These conversations do not process payments.

Contributions are explicitly voluntary and do not affect approval, community roles, document access or restrictions. No fundraising statistics, financial allocations, charity/tax claims or donor incentives were added.

## Content and navigation

The final content order is:

1. Home / Support breadcrumb.
2. Ink introduction panel: “Student-built, community-supported,” “Support EtudSup,” and a short explanation identifying IRM at FST Mohammedia as the first community.
3. Contribution card with the available contact or honest unavailable state.
4. Quieter maintenance explanation and non-financial participation through existing permitted workflows.
5. Distinct “Need help with your account or community?” section.
6. Bottom navigation buttons.
7. Shared copyright, owned by the shell after the entire page.

The old platform wording and long feature catalogue were removed. Pending applicants receive manual-review/status guidance. Restricted accounts receive Delegate guidance without a suggestion that contributing changes access. No contact form or profile integration was added.

Bottom actions reuse `buttonStyles("secondary")` and native link semantics:

- **Back to Home** with a left-arrow icon → `/`.
- Signed-in accounts: **Browse IRM modules** → `/communities/irm/modules`, retaining that route's existing permission gates.
- Confirmed guests: **Sign in** → `/login`.
- Unresolved authentication: Home remains available; no speculative authenticated destination is rendered.

The shared button treatment supplies a neutral surface, fine border, visible focus, restrained hover and 44px minimum target. Support-specific styling prevents resting underlines without changing inline text-link affordances globally. Buttons wrap/stack at narrow widths. The page uses existing stroke icons and current warm canvas, ink/lavender and neutral-card tokens. The layout collapses to a single column below 768px; the decorative hero icon is omitted on narrow screens. Reduced-motion preferences disable Support button transitions.

## Footer ownership and exceptions

`ApplicationShell` now renders exactly one `SiteFooter` after route content for ordinary landing, login/register, guest feature and signed-in pages. It does not add a `main` landmark. The footer displays:

> © [current year] EtudSup · v0.1 · All rights reserved.

`RootLayout` obtains the year once with `new Date().getFullYear()` and passes it through the shell, avoiding independent server/client date calculations and stale hardcoded copy. Existing Next rendering/build behavior still governs when a rendered page refreshes its year.

Removed the dashboard's old hardcoded `© 2026 …` and the landing's previous separate identity footer, along with their unused CSS. Account-page brand copy remains brand copy, not a second copyright footer. Account forms retain their approved layout; copyright follows their content outside the account `main`.

The dashboard's announcements/modules/remaining sections retain their original order and columns. Copyright follows the complete dashboard rather than appearing between sections. The signed-in footer lives inside the existing workspace, so F7's bottom-navigation clearance continues to reserve space beneath it. Its own padding also respects `env(safe-area-inset-bottom)`; it is never fixed or overlaid.

Deliberate omissions:

- `/communities/irm/discussion` and nested paths: no copyright, preserving conversation/composer space.
- `/communities/irm/modules/[moduleSlug]/documents/[documentId]` and nested paths: no copyright, preserving PDF reader controls and reading space.

Those omissions apply to both public and signed-in shell branches. Document lists, uploads, announcements, membership and other ordinary pages still receive the footer.

## Verification results

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, including the final code |
| `npx tsc --noEmit` | Passed, including the final code |
| Focused Node checks below | 76 passed: Support/footer 16, home 16, account controls 6, mobile presentation 19, theme 12, navigation model 7 |
| Scoped whitespace/diff checks | Passed |
| Normal `npm run build` | Failed due to sandbox restrictions; no completed production build |
| Mocked Playwright discovery | 56 tests discovered in the F9 runner; discovery is not a passing browser run |
| Focused Support/ownership browser execution | 18 attempted, all blocked at Chromium launch; zero page assertions executed |
| Screenshots/visual acceptance | Unverified; no application screenshots were captured |

Node rendering checks execute the actual Support, shell, landing, dashboard and account components with isolated mocked auth/configuration. They cover missing/malformed/configured contact values, distinct safe contact messages, guest/member/pending/restricted/loading/error navigation, no private identity fields, copyright once and after content, no second main landmark, and reader/discussion omissions. They do not establish browser layout, contrast or focus behavior.

The normal production build was allowed to terminate normally with exit 1 on both attempts, including the final code. Turbopack's CSS worker failed while creating a process/binding a port: `Operation not permitted (os error 1)`. Final log: `/tmp/irm-f9-build-final.log` (first attempt: `/tmp/irm-f9-build.log`). No bundler, dependency or environment workaround was introduced.

Chromium could not launch in this environment: `sandbox_host_linux.cc:41` / `Operation not permitted (1)`. A direct default launch probe confirmed the same restriction. The production server also failed to bind `127.0.0.1:3149` with `listen EPERM`; the computer-use inventory had no available browser. Browser log: `/tmp/irm-f9-browser.log`; direct probe: `/tmp/irm-f9-chromium.log`; structured result: `frontend/test-results/f9/results.json`.

The user-provided before screenshots were inspected. They are reference images, not after screenshots. No browser/user stylesheet or sandbox flags were modified to force captures.

## Owner-side completion commands

Run from an environment that permits local port binding and the installed Chromium browser. Terminal 1:

```bash
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
npm run build
npm run start -- --hostname 127.0.0.1 --port 3149
```

Proceed to the server only after the normal build succeeds. Terminal 2, while the server runs:

```bash
cd /home/yasso/irm-platform/frontend
node tests/support-footer.test.mjs
node tests/home-presentation.test.mjs
node tests/account-controls.test.mjs
node tests/mobile-presentation.test.mjs
node tests/theme.test.mjs
node tests/navigation-model.test.mjs
npx playwright test --config playwright.f9.config.ts
```

If an existing frontend is running on another local port, use `IRM_F9_TEST_URL=http://127.0.0.1:<port> npx playwright test --config playwright.f9.config.ts`. The runner uses existing deny-by-default mocked API/socket fixtures and requires no backend. It does not edit environment files.

The Support suite requests screenshots for guest/member at 320px, 390px and 1440px in light/dark modes, under `frontend/test-results/f9/captures`, with names `support-<persona>-<theme>-<width>.png`. Inspect those actual images after a successful run. The suite checks button destinations, keyboard focus, minimum targets, computed text contrast, underlines, horizontal overflow, footer order/count and clearance above the mobile bar. It also covers pending/restricted help and footer ownership on landing/account/modules/reader/discussion routes. The companion dashboard suite checks the approved composition and responsive layouts.

Contact branch checks follow the real frontend's build-time public configuration: the current local build should show the unavailable state. The Node fixtures exercise both configured and unavailable branches independently without changing application configuration. A real configured contact should additionally be inspected in an owner environment already supplied with its authorized setting; do not copy a fixture phone number into production.

Remaining acceptance gaps: completed normal production build; real light/dark/mobile/desktop screenshot inspection; actual keyboard, contrast, long-copy overflow and bottom-bar clearance; practical reader/composer interaction after footer omission. No browser acceptance claim is made until these checks execute successfully.
