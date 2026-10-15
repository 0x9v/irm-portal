# EtudSup U3 — contextual Quick access and IRM guidance

## Scope and source of truth

Inspected Git status and preserved the already modified/untracked frontend and concurrent backend work. The live agent inventory showed only this agent. Pre-edit copies of the four touched frontend files are in `/tmp/irm-u3-before/`. Read the F4 and F6 dashboard reports, U1, U2 and F9 reports, the current Home source, route pages, backend route declarations read-only, navigation model, AuthContext and focused tests. The current Home source, rather than earlier dashboard descriptions, governed the changes.

No backend, profile, API, membership, authentication, route, dependency, environment, deployment, PDF/discussion, bottom-navigation, header or footer source was edited. No file was staged, committed, pushed or deployed. `/account` remains absent in the frontend; no profile link was added.

## Exact changed files

| File | U3 change |
| --- | --- |
| `frontend/src/app/page.tsx` | Limits Quick access to authorized document shortcuts; removes duplicate Posts/Membership/Support and management list; makes IRM access copy concise with one state-specific action and no prominent active-membership CTA. |
| `frontend/src/components/home/HomeDashboard.module.css` | Gives Quick access tiles neutral surfaces/hover while retaining fine borders, violet icons, whole-link semantics and visible focus; removes now-unused management/access-link rules. |
| `frontend/tests/home-presentation.test.mjs` | Renders the actual Home component through the account-state matrix, asserting exact Quick access routes, one guidance action, no active Membership tile, verification gating and reading order. |
| `frontend/e2e/signed-in-home.spec.ts` | Updates mocked assertions for exact Quick access links and sidebar management gates; extends light/dark responsive tile, focus and decoration checks. |
| `docs/etudsup-u3-contextual-quick-access.md` | This report. |

## Destination inventory and route decisions

Current pre-U3 Quick access had Saved, Recently opened, My submissions, Pending documents and Posts for ACTIVE accounts, plus Membership; non-ACTIVE accounts had Saved, Recently opened, Membership and Support. Delegate management and voting settings were also listed below those tiles. Modules, Announcements and Discussion were **already absent** from this panel despite older reports; they remain in the feature cards/navigation. Posts duplicated the sidebar and mobile navigation. Membership status/action and Support guidance fit the adjacent IRM access panel. Management already has capability/role-aware sidebar links.

| Destination | Before | After | Actual access contract |
| --- | --- | --- | --- |
| Saved documents | All signed-in | All signed-in | Real page and endpoint use authenticated user only. |
| Recently opened | All signed-in | All signed-in | Real page and endpoint use authenticated user only; no ACTIVE-only restriction was added. |
| My submissions | ACTIVE | Verified ACTIVE, withheld during refresh/error | Real page and endpoint require ACTIVE membership. |
| Pending documents | ACTIVE | Verified ACTIVE, withheld during refresh/error | Real endpoint requires ACTIVE membership. |
| Posts | ACTIVE | Removed from Quick access | Remains in main navigation and the existing Home feature/mobile shortcuts. |
| Membership | All signed-in | Removed from Quick access | Remains in sidebar/bottom navigation and the IRM access action where appropriate. |
| Support | Non-ACTIVE | Removed from Quick access | Remains in account dropdown, practical guidance and the IRM access action for restrictions/ACTIVE help. |
| Review/staff/members/voting | Delegate/capability block below tiles | Removed from Quick access | Existing sidebar management group retains its Delegate and `manage_document_voting` gates. |

The panel now has two personal tiles for a signed-in account and four for verified ACTIVE membership. They use real routes, distinct existing icons, one anchor per tile, neutral fill, subtle border/hover and U1's opt-in undecorated card-link boundary. There are no invented counts, unavailable tiles, nested controls or new routes.

## Account-state behavior

| State | Quick access | Your IRM access |
| --- | --- | --- |
| No membership | Saved, Recent | No request; Request membership. |
| PENDING | Saved, Recent | Application pending; Check application. |
| REJECTED or REMOVED | Saved, Recent | Accurate decision/end guidance; Review or reapply. |
| BANNED/other restricted | Saved, Recent | Restriction and no reapplication; Contact Support. |
| Membership check/error | Saved, Recent only | Checking status or verification unavailable; error keeps Retry verification. No false nonmember/ban status. |
| ACTIVE Member | Saved, Recent, My submissions, Pending documents | Accurate Active member status; quiet practical Support action, no membership CTA. |
| ACTIVE Moderator | Same four personal routes | Accurate Active moderator status; management/voting stays in existing capability-aware navigation. |
| ACTIVE Delegate | Same four personal routes | Accurate Active delegate status; Delegate management stays in existing sidebar navigation. |
| Confirmed guest | No signed-in panel | Approved guest landing remains. |

Protected Quick access links are withheld during an in-flight membership refresh even if the prior snapshot was ACTIVE. Saved/Recent remain available because their actual pages/endpoints require authentication, not membership. Backend authorization remains authoritative. Existing Home module/announcement request, cancellation, owner and stale-response guards were not touched.

## Dashboard composition and preserved behavior

The source order is still **hero → existing feature cards → announcements → modules → Quick access → Your IRM access**, followed by F9's shared footer. Desktop keeps the broad main column and right supporting column. At mobile widths the existing four-shortcut grid replaces feature cards, with the supporting panels after modules. No CSS order or route gate changed for those other sections. U2's left Menu, single theme button, System account action, bottom navigation and safe-area clearance are untouched. U4–U6 and profile frontend work were not started.

## Verification and acceptance limits

Commands run from `frontend/`:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed, including updated browser specs. |
| `node --test tests/home-presentation.test.mjs tests/navigation-model.test.mjs` | Passed: 2 executed test files, including the account-state matrix and existing navigation permission tests. |
| `npx playwright test --config=playwright.signed-in-home.config.ts --list` | Discovered 63 mocked Home/guest tests. **Discovery is not execution.** |
| `npm run build` | Failed before completion in Next/Turbopack CSS processing while creating a process/binding a port: `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-be7aa415842e79b259317bbea4230912.log`. This is the same environment failure class as U2; no repeat attempt was made. |
| Scoped `git diff --check` and trailing-whitespace search | No issues in the authored files. |

No browser tests or screenshots ran here: U2's browser inventory found no browser/app surface and the current normal build cannot complete in this environment. Therefore the 320px/390px/768px/1440px rendered layout, both themes, tile focus/contrast, overflow and full-dashboard 390px/1440px screenshots are **unverified**. U1/U2 build and browser acceptance gaps remain open; this task adds no evidence that closes them.

Owner-side fish-compatible commands on a machine where Next can create processes and Chromium can launch:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/home-presentation.test.mjs tests/navigation-model.test.mjs
npm run build
npx playwright test --config=playwright.signed-in-home.config.ts
```

The existing Playwright config starts the production server after the completed build and uses mocked API responses. Inspect the entire light/dark dashboard screenshots under `frontend/test-results/signed-home/` for the 390px and 1440px cases, alongside its 320px/768px focus and overflow assertions. Do not treat discovery or source inspection as visual acceptance.
