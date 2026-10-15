# EtudSup F4 — signed-in dashboard

## Scope and changed files

The pre-existing modified and untracked work, including concurrent backend work, was preserved. Only these frontend/dashboard files and this report changed:

- `frontend/src/app/page.tsx` — signed-in hierarchy, contextual actions, membership guidance; existing auth and API request logic retained.
- `frontend/src/components/home/HomeWelcomeHero.tsx` — compact ink hero with the actual username and one state-aware action.
- `frontend/src/components/home/HomeDashboard.module.css` — signed-in responsive styles using EtudSup semantic tokens.
- `frontend/e2e/signed-in-home.spec.ts` — adjusted mocked browser assertions and delayed announcement/touch-height checks.
- `frontend/e2e/guest-home.spec.ts` — adjusted authenticated-transition heading assertion; guest page implementation is untouched.
- `frontend/tests/home-presentation.test.mjs` — isolated render assertions for the new hierarchy.
- `docs/etudsup-f4-signed-in-dashboard.md` — this report.

No backend, migrations, database, deployment, environment, dependency, or `/home/yasso/etudsup` files were edited. Nothing was staged, committed, pushed, or deployed.

## Before and after hierarchy

Before: large illustrated hero, three tall feature cards, announcements, modules, a Quick access panel largely duplicating the sidebar, then membership/help. After: compact welcome/identity hero; contextual next-step links; latest announcements when authorized; modules; concise membership/help; footer. This is the **same DOM and reading order on desktop and mobile**. The desktop EtudSup sidebar and working mobile header/menu remain shell-owned. IRM is labeled as the community. Home has one main landmark and one h1. The mobile hero removes the illustration and fits its next action near the top; announcements and modules use scannable rows. Safe-area bottom padding, focus outlines, and reduced-motion styles are retained.

## Route and permission inventory

| Link | Real route | Home gate |
| --- | --- | --- |
| Modules / module detail | `/communities/irm/modules`, `/communities/irm/modules/[moduleSlug]` | Signed-in account |
| Membership/application | `/communities/irm/membership` | Signed-in; no reapply for BANNED |
| Support | `/support` | All signed-in states |
| Saved / recently opened documents | `/communities/irm/documents/saved`, `/communities/irm/documents/recent` | Saved: signed-in; Recent: ACTIVE on Home; both have real account feeds |
| My submissions | `/communities/irm/documents/mine` | ACTIVE; route checks membership |
| Announcements / detail | `/communities/irm/announcements`, `/communities/irm/announcements/[announcementId]` | Verified ACTIVE |
| Review / staff / members | `/communities/irm/membership/review`, `/staff`, `/members` | ACTIVE DELEGATE |
| Voting settings | `/communities/irm/document-voting/settings` | ACTIVE with `manage_document_voting` capability |

Posts, Discussion, and pending documents retain their existing shell navigation and routes; their duplicate Home tiles were removed. No sample content, progress, counts, or fabricated reading activity was added.

## Account-state matrix

| State | Hero action | Other Home actions | Announcements | Guidance |
| --- | --- | --- | --- | --- |
| None | Request membership | Modules, saved | Hidden | Delegate verification |
| PENDING | View application | Modules, saved | Hidden | Awaiting review |
| ACTIVE MEMBER | Browse modules | Saved, recent, submissions | Real API | Active access |
| ACTIVE MODERATOR | Browse modules | Active actions; voting if capable | Real API | Active role |
| ACTIVE DELEGATE | Browse modules | Active actions; review/staff/members; voting if capable | Real API | Active role |
| REJECTED / REMOVED | Reapply | Modules, saved | Hidden | Review/reapply |
| BANNED | Contact Support | Modules, saved | Hidden | Restriction; no reapply |
| Verification error | Retry verification | Modules, saved | Hidden | Unconfirmed access, distinct from ban |
| Checking / refreshing | Existing AuthContext gate | Protected actions withheld until verified | Withheld until verified | Checking status |

Home still calls `GET /api/v1/communities/irm/modules` and, only for verified ACTIVE accounts, `GET /api/v1/communities/irm/announcements?limit=3` through `fetchApi`. Existing loading, empty, error, retry, account-owner, abort, and late-response guards remain. The backend still enforces access.

## Visual comparison and screenshots

The short ink panel, lavender detail, warm canvas, white cards, fine borders, and quiet text colors follow the implemented guest landing and account pages without reproducing their large public hero. The 390px and 1440px light/dark dashboard screenshots **could not be captured or inspected**: Chromium exited before opening a page with `sandbox_host_linux.cc:41 ... Operation not permitted`. Source-level review shows no deliberate CSS reordering, but rendered overflow, contrast, and first-viewport acceptance remain open.

Owner-side command in an environment that permits Chromium:

```bash
cd /home/yasso/irm-platform/frontend
npx playwright test --config playwright.signed-in-home.config.ts
```

Inspect the signed-in light/dark 390px and 1440px images in `frontend/test-results/signed-home/` beside the guest captures and account pages. Review 320px/390px overflow, touch targets, focus, and first-screen composition. Revise visible defects before visual acceptance.

## Verification

- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `node --test tests/home-presentation.test.mjs` — passed.
- `npx playwright test --config playwright.signed-in-home.config.ts --list` — discovered 57 mocked guest/dashboard checks; **not execution**.
- Focused Playwright run — configured dev server could not start; a separate existing Next dev process owned `.next/dev` and its port was unreachable here. No test body ran.
- Direct `chromium.launch()` — failed with sandbox `Operation not permitted`. No screenshots were produced.
- `npm run build` — normal Next 16.3.6/Turbopack optimization did not finish within 120 seconds and was stopped. **Build unverified.**
- `npx next build --webpack` — secondary attempt failed before compilation: `Could not parse output from TypeScript's --showConfig`.
- Scoped `git diff --check` on tracked frontend changes — passed.

The remaining gates are a completed normal production build and browser/screenshot inspection in a permitted environment.
