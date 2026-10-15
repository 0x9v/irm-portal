# EtudSup F6 — dashboard composition

## Scope and changed files

Existing modified/untracked work was inspected and preserved. F6 changed exactly these files relative to the working tree at task start:

| File | F6 change |
| --- | --- |
| `frontend/src/app/page.tsx` | Main/supporting columns, three contextual feature cards, compact shortcuts and access panel, final copyright footer. |
| `frontend/src/components/home/DashboardActionCard.tsx` | One named link target per feature card, preserving desktop actions and compact mobile presentation. |
| `frontend/src/components/home/HomeWelcomeHero.tsx` | EtudSup/IRM context, resources/people headline, signed-in username, one Modules action, decorative conversation artwork. |
| `frontend/src/components/home/HomeDashboard.module.css` | Scoped dashboard composition, neutral/lavender styling, compact responsive rows, focus and mobile source-order presentation. |
| `frontend/e2e/signed-in-home.spec.ts` | Composition, DOM/visual order, footer, capability gates, verification retry, announcement retry, current hero expectations. |
| `frontend/e2e/guest-home.spec.ts` | Authenticated-transition expectations for the new dashboard headline and existing verification guidance; guest assertions retained. |
| `frontend/tests/home-presentation.test.mjs` | Mocked rendered presentation checks for states, ordered content, permissions, routes, hero and footer. |
| `frontend/playwright.signed-in-home.config.ts` | Uses the completed production build with `next start`, avoiding the unrelated dev-server lock. |
| `docs/etudsup-f6-dashboard-composition.md` | This report. |

The navigation shell, guest landing/account implementations, feature pages, AuthContext, API helper, PDF and WebSocket code were not edited. No backend, database, migrations, dependencies, environment, deployment or separate worktree changes were made. Nothing was staged, committed, pushed or deployed.

## Reference inspection and comparison

Image 4 (`/tmp/codex-clipboard-Cvvupz.png`, supplied as `image(20261012-111859).png`) was opened and inspected directly. Its broad left column and narrower right column are the composition authority. Images 2 and 3 were not implemented.

Before: full-width compact hero, a horizontal shortcut strip, full-width membership panel. Legacy announcement/module `order` rules placed those sections after otherwise unnumbered flex children, including the footer, despite their earlier source position.

After:

| Image 4 element | F6 implementation |
| --- | --- |
| Broad main column / narrow supporting column | `2.3fr / 1fr` desktop grid, 24px gap; approximately 70% / 30%. |
| Ink hero with balanced text/artwork | 338px minimum desktop height, resources/people headline with lavender emphasis, actual username, single Browse modules action, quiet decorative SVG speech bubbles. |
| Three feature cards | Study resources, Community spaces, Latest announcements in one desktop row, distinct shared navigation icons and real destinations. |
| Announcement and module feed | Existing actual API rows/cards below the feature row; module presentation uses three desktop columns without changing the four-record limit or API order. |
| Two-column Quick access | Six tiles for ACTIVE users; four for other signed-in states. Authorized management links sit beneath the tiles. |
| Compact access panel | Status/role, IRM/FST context, concise status-specific guidance and membership/retry/Support actions. |
| Footer after content | Outside and after the entire grid: “© 2026 EtudSup · v0.1 · All rights reserved.” |

The current warm canvas, neutral surfaces, ink identity, semantic borders and violet tokens remain. Hero lavender uses the same fixed signature colors already used by the guest/account panels. The previous saturated purple and lavender page wash were not restored. CSS removes incidental underlines from buttons, tiles and entire rows/cards; inline actions retain color, arrow, hover feedback and visible keyboard focus. The supplied screenshot's underline discrepancy still requires live browser inspection, as described below.

This comparison describes the implemented source composition. **Rendered visual acceptance is unverified** because Chromium could not launch. No dashboard screenshots were captured locally. The user-supplied current desktop screenshot was inspected during the follow-up described below; no exact visual-match claim is made.

## Desktop and mobile reading order

Source order is identical at every width:

1. Welcome hero.
2. Study resources, Community spaces, Latest announcements feature cards.
3. Latest announcement feed, only for verified ACTIVE users.
4. Your modules.
5. Quick access.
6. Your IRM access / Support.
7. Footer.

Desktop puts items 1–4 in the main column and 5–6 in the supporting column. Below 1000px of available content width the supporting content follows the feed; below 650px it stacks. Mobile feature cards become compact icon/copy/action rows. Module cards become compact rows, announcement previews are bounded to two lines, artwork disappears, and controls retain at least 44px targets. The footer follows the taller of the two desktop columns. Scoped overrides neutralize the old feed `order` rules. Safe-area bottom padding remains, and the F5 drawer/navigation behavior is preserved.

## Permission decisions and real routes

Existing `membershipKnownForUser`, `isEligible`, Delegate role and `manage_document_voting` capability checks remain authoritative for dashboard presentation. Backend authorization remains authoritative for requests.

| State | Dashboard actions and guidance |
| --- | --- |
| Guest | Existing F2 guest Home after confirmed guest auth; no signed-in dashboard. |
| Auth loading/session check error | Existing neutral checking or session retry branch; no protected-content flash. |
| No membership | Modules, Saved, Recent, Membership, Support; community feature cards offer Request membership. |
| PENDING | Same authenticated routes; View application / Check application; no announcement feed or community destinations. |
| REJECTED | Same authenticated routes; truthful not-approved guidance and Review or reapply. |
| REMOVED | Same authenticated routes; membership-ended guidance and Review or reapply. |
| BANNED | Same basic authenticated routes; explicit restricted access and reapplication unavailable; community feature actions lead to Support. |
| Verification error/checking | Modules/Saved/Recent/basic Membership/Support remain available; protected routes hidden; access panel offers Retry verification on error. |
| ACTIVE MEMBER | Modules, Saved, Recent, My submissions, Pending documents, Posts, Discussion, Announcements, Membership, Support; actual announcement feed. |
| ACTIVE MODERATOR | ACTIVE routes; no Delegate management. Voting settings only with the existing capability. |
| ACTIVE DELEGATE | ACTIVE routes plus Review applications, Manage staff, Members; Voting settings only with the existing capability. |

All signed-in heroes link to `/communities/irm/modules`, which supports authenticated browsing independently of ACTIVE membership. Feature cards link to `/communities/irm/modules`, `/communities/irm/discussion`, `/communities/irm/announcements` when permitted; otherwise membership guidance links to `/communities/irm/membership` or `/support`.

Quick access uses real `/communities/irm/documents/saved`, `/documents/recent`, `/documents/mine`, `/documents/pending`, `/posts`, and `/membership` destinations. Management uses `/communities/irm/membership/review`, `/membership/staff`, `/membership/members`, and `/document-voting/settings`. These routes were checked against the implemented navigation model and route files. Modules/announcements already have feature and feed links, so they are not duplicated in the shortcut panel. Support remains in the access panel for ACTIVE users and is also a shortcut for other states.

A comparison against the pre-F6 working-tree snapshot confirmed that Home's auth/request/effect/owner/cancellation/eligibility block is unchanged. Requests remain `GET /api/v1/communities/irm/modules` (first four in API order) and, only when eligible, `GET /api/v1/communities/irm/announcements?limit=3`. Existing credentials, AbortControllers, request IDs, stale-owner guards, loading, empty, error and retry behavior remain. Announcement rows retain actual title/date/author, bounded excerpt and detail route. No progress, counts, sample records or recent activity were added.

## Verification

Commands run from `frontend/`:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed, including the updated browser tests. |
| `npm run build` | **Passed normal Next.js 16.3.6/Turbopack production build**, compiled, TypeScript checked, all 21 static pages generated, optimization completed. Existing warning about an external `/home/yasso/package-lock.json` appeared; no configuration/dependency change was made. |
| `node --test tests/home-presentation.test.mjs` | Passed test-file execution. |
| `node tests/home-presentation.test.mjs` | All **16 named mocked rendering checks passed**. |
| `npx playwright test --config playwright.signed-in-home.config.ts --list` | **63 checks discovered** across dashboard and guest suites; discovery is not execution. |
| `npx playwright test --config playwright.signed-in-home.config.ts --grep 'composition and reading order\|none:\|captures light guest page at 1440px'` | Blocked before test bodies: production web server could not start. |
| `npm run start -- --hostname 127.0.0.1 --port 3110` | Confirmed `listen EPERM: operation not permitted`. |
| Direct Playwright `chromium.launch()` | Failed before opening a page: `sandbox_host_linux.cc:41`, `Operation not permitted`. |
| Scoped `git diff --check` | Passed. |

Mocked browser checks include non-member, PENDING, REJECTED, REMOVED, BANNED, ordinary ACTIVE, Moderator with/without capability, Delegate, verification error/retry, auth loading, guest preservation, real-data ordering/links, loading, empty, error/retry, delayed responses, late logout responses, keyboard activation/focus, light/dark overflow at 320/390/768/1024/1280/1440, mobile reading order, desktop column proportions and footer placement. These browser assertions are **unexecuted**, not passing tests.

## Owner-side visual acceptance

In an environment that permits the server and Chromium:

```bash
cd /home/yasso/irm-platform/frontend
npm run build
npx playwright test --config playwright.signed-in-home.config.ts
```

The theme/width tests capture full-page `light-390.png`, `dark-390.png`, `light-1440.png`, and `dark-1440.png` in test-specific directories under `frontend/test-results/signed-home/`. Guest comparison captures are produced by the same suite. Account comparisons can be captured with `npx playwright test --config playwright.account-pages.config.ts`.

Inspect the 1440px dashboard beside image 4: left/right proportions; hero height, text/artwork balance; three feature cards in one row; announcement/module feed below; compact right panels; footer below both columns. Compare typography, ink, borders and lavender with the guest/account implementations. At 390px and 320px check first-screen welcome/action, stated reading order, compact rows, long usernames/titles, focus, touch targets, overflow and drawer clearance in both themes. Screenshot-driven revision and rendered contrast/layout acceptance remain open until this browser inspection can execute.

## Follow-up using the newly supplied mobile reference

The latest Image 1 (`/tmp/codex-clipboard-jS1icV.png`) was opened and inspected. It confirms that the desktop feed, three cards and right panels are present in the rendered application. It also shows an orphaned “place.” line in the hero lead and underlines across many links, including navigation. The footer and mobile/dark views are outside this supplied image.

The latest Image 4 (`/tmp/codex-clipboard-x9ZA8Q.png`) was opened and inspected directly. This attachment is a mobile reference with a welcome panel, shortcut tiles, announcement feed and compact module rows. The written requirements still specify three feature cards and the order hero → feature cards → announcements → modules → Quick access → membership → footer. The implementation follows that order, with compact feature rows and module rows on mobile. The current F5 drawer remains in place.

The follow-up changes only `DashboardActionCard.tsx`, `HomeDashboard.module.css`, `signed-in-home.spec.ts`, `home-presentation.test.mjs`, and this report. Each feature card now has one named anchor covering its content, with no nested interactive control. Mobile actions use a plain text/arrow treatment within that large target; the redundant Welcome back line disappears on mobile. Desktop hero lead width increases from 47ch to 52ch to reduce the observed short trailing line. Desktop columns, permissions, feed requests and footer remain as implemented above.

The stylesheet and compiled production CSS already declare `text-decoration: none` for hero actions, card/tile links and feed rows. The screenshot's underlines could not be reproduced or diagnosed in a live browser here; the follow-up does not claim that discrepancy is resolved. Browser checks now explicitly assert no computed underline on hero, feature and feed links, and keyboard activation/focus on the mobile feature card. The navigation shell was preserved.

Fresh checks after these adjustments: lint and TypeScript passed; the normal production build completed; all 16 mocked rendering checks passed; 63 browser checks were discovered. The focused composition/mobile-card browser run again failed before test bodies because its server could not start. Direct Chromium launch again failed with the sandbox Operation not permitted error. UI automation returned no available browser surfaces. No new local screenshots were produced. Full mobile/light/dark visual acceptance and the reported underline discrepancy remain unverified; use the owner commands above to run the checks and inspect captures.
