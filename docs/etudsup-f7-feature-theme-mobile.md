# EtudSup F7 — feature pages, compact appearance, and mobile navigation

Implementation is complete in the current frontend. **Browser and visual acceptance remain unverified.** Lint, TypeScript, the normal production build, and the focused Node regressions passed. The broader moderation harness retains two existing membership-form expectation failures, described below.

## Reference mapping and inspection

All three attached images were opened and inspected before editing:

| Reference | Exact responsibility | Intentional adaptations |
| --- | --- | --- |
| Image 1 — `/tmp/codex-clipboard-4RqG6G.png` | Announcements page | Community eyebrow, strong heading, featured ink latest notice, quieter remaining notices. Real API title/date/excerpt and optional returned author replace sample text. No fabricated “IRM admins” attribution or read-status claim. Existing creation/removal actions remain. |
| Image 2 — `/tmp/codex-clipboard-0YW52B.png` | Modules and document browsing | Real module chooser beside selected-module documents; title, Type, Source and explicit Search/Clear actions. No illustrative records or preview notice. Upload replaces the redundant Browse documents action when authorized. Mobile uses a disclosure above documents. |
| Image 3 — `/tmp/codex-clipboard-MetjDo.png` | Mobile Home and bottom-navigation structure | Compact EtudSup/IRM header; existing ink/lavender welcome hero; four tiles in two columns; feeds, supporting content, footer; five bottom destinations. Current EtudSup tokens replace older IRM branding and saturated purple. |

The current landing/account composition and approved F6 desktop Home remain the brand authority. No older worktree was entered or copied. The Next.js local CSS guide was read before implementing scoped CSS modules.

## Initial implementation inventory

The inspected owners were `ApplicationShell`, `SidebarNav`, `MobileHeader`, `MobileBottomNav`, `ContextBar`, `AccountPanel`, `ThemeSelector`, `ThemeContext`, `lib/theme`, announcement list/detail/replies/moderation, module list/detail/upload, document presentation helpers/detail/reader, Home presentation, AuthContext, API helpers and relevant tests. F2, F3, F5, F6 and the document-search/metadata reports were read.

Existing behavior absent from the references was retained: account verification failures and retries; public layouts; library destinations and logout feedback; authorized management navigation; announcement creation and Delegate removal; replies with cursor pagination and composer validation; filtered/unfiltered empty distinctions; request cancellation; document saves; active-membership upload entry; safe My Submissions/pending return context; PDF viewing, reading position and download behavior.

The ordered announcements endpoint returns an array, without list pagination. Replies have their own existing cursor contract. Module documents return an approved-only array, without counts/pagination/sorting. Those contracts have not been expanded.

## Completion table

| Requested area | Implementation | Executed verification | Visual acceptance |
| --- | --- | --- | --- |
| Compact theme control and mobile navigation | Complete: existing theme store, sun/moon action, System disclosure, signed-in five-slot bar, drawer containment and safe-area clearance | Theme/navigation/mobile Node checks; lint/TS/build | Unverified: server/Chromium blocked |
| Announcements list/detail/replies | Complete: latest featured exactly once, neutral remaining cards, readable detail body, retained creation/reply/moderation behavior | Actual announcement presentation and focused moderation checks; lint/TS/build | Unverified: captures blocked |
| Module/document browsing | Complete: shared chooser/workspace, explicit index guidance, real selected module, URL filters, compact rows, authorized upload/save/reader actions | Lint/TS/build; search/return/reader browser suites attempted | Unverified: browser interaction and captures blocked |
| Mobile Home/navigation structure | Complete: four tiles, status-aware guidance, ordered feeds/support/footer, desktop F6 composition retained | 16 Home presentation checks plus mobile navigation/presentation checks | Unverified: mobile and desktop captures blocked |

## Exact F7 changed-file inventory

These are the files edited or created by F7, independent of the many pre-existing modified/untracked files in this workspace:

| File | F7 change |
| --- | --- |
| `frontend/src/components/navigation/ThemeSelector.tsx` | Compact opposite-resolved-theme toggle and native System disclosure using the existing context. |
| `frontend/src/components/navigation/ThemeSelector.module.css` | 44px control, focus, small associated options, reduced-motion icon behavior. |
| `frontend/src/components/navigation/MobileBottomNav.tsx` | Five signed-in destinations, conservative access guidance, nested selection, retained height measurement. |
| `frontend/src/components/navigation/MobileShell.module.css` | Neutral bottom bar, active state, safe-area and measured page clearance, hide during text/select editing. |
| `frontend/src/components/layout/ApplicationShell.tsx` | Mounts one bottom bar only in the signed-in application frame. |
| `frontend/src/components/navigation/MobileHeader.tsx` | Uses signed-in modal drawer behavior. |
| `frontend/src/components/navigation/useNavigationDisclosure.ts` | Optional focus containment, inert background and restored scroll state for the signed-in drawer; public disclosure behavior retained. |
| `frontend/src/components/AnnouncementCard.tsx` | Featured/default presentations, bounded excerpts, optional author, existing detail links. |
| `frontend/src/components/Announcements.module.css` | Page hierarchy, ink signature, quiet cards, detail/body typography. |
| `frontend/src/app/communities/irm/announcements/page.tsx` | Correct heading/description, first ordered result featured once, full-width ordinary feed, retained controls. |
| `frontend/src/app/communities/irm/announcements/[announcementId]/page.tsx` | Always-available return action, readable header/body/replies layout. |
| `frontend/src/components/modules/ModuleBrowserFrame.tsx` | Shared real chooser, canceled requests, selected link state, mobile disclosure. Exports the existing module response type. |
| `frontend/src/components/modules/ModuleBrowser.module.css` | Two-panel workspace, stacked mobile chooser/filters and compact document rows. |
| `frontend/src/app/communities/irm/modules/page.tsx` | Shared workspace with real choices and explicit no-selection guidance; retains module response type export compatibility. |
| `frontend/src/app/communities/irm/modules/[moduleSlug]/page.tsx` | Selected-module workspace, reactive validated URL criteria and history, metadata cancellation, compact rows and preserved reader context. |
| `frontend/src/components/home/HomeMobileShortcuts.tsx` | Four distinct tiles; community entries use membership/status/Support guidance when unavailable. |
| `frontend/src/components/home/HomeDashboard.module.css` | Mobile-only tile/module/support layout, desktop feature cards hidden at the mobile breakpoint, preserved desktop declarations. |
| `frontend/src/app/page.tsx` | Inserts mobile shortcuts after the hero and desktop feature section, using existing permission/status decisions. |
| `frontend/tests/theme.test.mjs` | Updates actual selector SSR expectations; existing bootstrap/store tests retained. |
| `frontend/tests/mobile-presentation.test.mjs` | Five-slot permission guidance, guests/loading, nested destinations, four tiles and real optional featured metadata. |
| `frontend/tests/moderation.test.mjs` | CSS-module stub for its isolated TSX loader, enabling existing actual announcement/moderation component tests. No product moderation change. |
| `frontend/e2e/navigation-shell.spec.ts` | Compact theme and mounted bottom-bar expectations. |
| `frontend/e2e/signed-in-home.spec.ts` | Mobile tile versus desktop-card composition and keyboard expectations. |
| `frontend/e2e/theme-preference.spec.ts` | Toggle/System semantics, preserved store scenarios, current public account and signed-in shell expectations. |
| `frontend/e2e/theme-account-surfaces.spec.ts` | Current account/control/status/focus/logout expectations in both themes. |
| `frontend/e2e/announcements.spec.ts` | Reconciles older Home/guest assertions with the approved EtudSup composition and status guidance. Announcement behavior scenarios retained. |
| `frontend/e2e/f7-feature-theme-mobile.spec.ts` | Capture matrix, four/five destinations, URL history and reader round trip, request errors, permissions and detail capture scenarios. |
| `frontend/playwright.f7.config.ts` | Frontend-only regression/capture configuration; no server/backend/database hooks. |
| `frontend/tests/run-f7-regressions.mjs` | Runs temporary copies of existing suites behind the existing deny-by-default API fixture. Only its own temporary directory is removed. |
| `docs/etudsup-f7-feature-theme-mobile.md` | This inventory, decisions, results and remaining acceptance work. |

The normal package prebuild copied the already-installed PDF worker as usual; it was not an authored reader change. No backend, database, migration, dependency, environment/configuration, deployment or other-worktree edits were made. Nothing was staged, committed, pushed or deployed. Existing concurrent work was preserved.

## Theme and shell semantics

The primary action is named “Switch to dark mode” or “Switch to light mode” and chooses the opposite **resolved** appearance. This deliberately selects an explicit preference even when the previous preference was System. The 44px sun/moon target changes only the shared provider's preference; it adds no auth request or new store.

The adjacent native disclosure exposes “Use system appearance” and indicates selection with `aria-pressed`. Selecting System immediately resolves the live OS preference. Escape closes an open appearance disclosure first and returns focus to its summary. The existing `irm-theme` persistence key, head bootstrap, server snapshot/hydration, cross-tab subscription, OS subscription, storage-failure fallback and native color-scheme implementation were not changed. System follows OS changes; explicit light/dark ignores them. The same compact component is reused in existing public account positions without rebuilding those layouts.

Signed-in navigation appears below 1280px, matching the existing header/sidebar breakpoint. The five slots are Home, Modules, Posts, Discussion, Membership; active state is based on each intended route and its nested paths, not a redirected guidance destination. Secondary library, Support and permitted management links remain in the drawer. Public landing/login/register do not mount the bar.

Bar height is measured, including wrapped labels/safe-area padding, and reserved after the route content. Editing inputs, textareas, selects or editable content hides the bar while retaining clearance. The drawer initially focuses Home, traps Tab/Shift+Tab with the Menu trigger, makes background siblings inert, locks background scroll and restores its prior state on dismissal. Escape/backdrop restores the trigger; route changes dismiss the drawer. The public disclosure continues to use its existing non-modal behavior.

## Routes, search and permissions

- `/communities/irm/announcements` and `/announcements/[announcementId]` retain active-membership access, real metadata, API ordering and all request/submit/moderation behavior. The first array record is Latest; subsequent records are rendered once. No read/unread state is asserted.
- Announcement creation remains capability-gated by `create_announcements`; Delegate removal remains in the existing moderation component and confirmation dialog. Reply cursors, submit/error/retry behavior, permissions and cancellation are unchanged.
- `/communities/irm/modules` deliberately selects no default. Its left panel lists real modules; its right panel explains how to start. The index never requests another module's documents under its URL.
- `/communities/irm/modules/[moduleSlug]` requests that real module and its documents, retaining approved-only authenticated browsing even for non-members, pending, rejected, removed or banned users. The real links implement selection and browser history. Stale metadata is canceled and a mismatched module is not rendered as the current selection.
- Existing `q`, `type`, `source` validation and human-readable type/source helpers remain. Type values are `COURSE`, `TD`, `TP`, `EXAM`, `SOLUTION`, `OTHER`; source values are `OFFICIAL`, `STUDENT`. Draft title text applies on explicit Search; the existing select changes apply their criteria immediately. Search/Clear/select actions push validated address-bar state. `useSearchParams` restores controls and requests on Back/Forward. Retry retains applied criteria. Requests retain AbortController plus generation checks.
- Document rows retain real title, type/source/date, Read Document and Save. Ordinary browsing does not display or link pending/rejected records. My Submissions and pending review remain separate workflows.
- Upload remains at the existing module upload route and requires verified active membership. Official upload remains governed by the destination's existing capability checks. The selected-module panel retains My Submissions.
- Reader links preserve validated filter criteria and allowlisted `from=module|mine|pending`. The unchanged reader/detail helpers retain safe direct-visit module fallback and contextual return. No PDF.js, reading/page restoration, position sequencing, file/preview/download or white-paper behavior was changed.
- Home keeps the approved F6 desktop composition. Below 1024px four mobile tiles replace its three desktop cards; CSS hides the inactive set so it has no visible or focusable duplicate controls. Source order is hero, shortcuts, permitted announcements, modules, Quick access, membership/help, footer.
- Modules always follows its authenticated browsing policy. Unavailable community tiles/slots lead to existing membership/status guidance; banned/restricted access leads to Support. Refreshing/failed verification never claims active membership through shortcut guidance. The Home announcement feed remains visible only with its existing permitted membership state.

## Executed checks and limitations

Commands ran from `/home/yasso/irm-platform/frontend` unless stated otherwise.

| Command | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed after correcting a test fixture name that shadowed browser `document`. |
| `npm run build` | Completed normal Next.js 16.3.6/Turbopack production build, including TypeScript, page generation and final optimization. 21 static pages generated; dynamic routes retained. Existing warning about `/home/yasso/package-lock.json` outside the repository remains. |
| `node tests/theme.test.mjs` | 12 passed: bootstrap/store, hydration snapshot, storage failures, OS/cross-tab behavior, compact SSR. |
| `node tests/navigation-model.test.mjs` | 7 passed: existing roles/capabilities and nested route ownership. |
| `node tests/home-presentation.test.mjs` | 16 passed: approved hero/composition, membership states, private-data avoidance, routes and management gates. |
| `node tests/mobile-presentation.test.mjs` | 19 passed: five slots and permission guidance, guest/loading omission, nested selection, four shortcuts, safe real announcement metadata/excerpts. |
| Focused moderation command below | 40 passed, including actual announcement/detail/reply removals, confirmation lifecycle, stale scope, response classification, permission visibility and removal ledger. |
| `git diff --check -- frontend/src frontend/tests frontend/e2e` from repository root | Passed. New authored files also checked for trailing whitespace/final newline. |
| `node tests/run-f7-regressions.mjs --list` | 163 discovered in the initial ten-file suite; discovery is not execution. Four detail-capture scenarios were subsequently added. |
| `node tests/run-f7-regressions.mjs` | 163 failed at Chromium launch, 0 reached page assertions. All failures had `browserType.launch` startup errors. |
| `node tests/run-f7-regressions.mjs --grep 'F7 detail capture'` | Four added detail scenarios attempted; Chromium startup blocked before assertions. |
| `npm run start -- --hostname 127.0.0.1 --port 3147` | Failed before serving: `listen EPERM: operation not permitted 127.0.0.1:3147`. |
| Default Playwright Chromium launch probe | Failed with `sandbox_host_linux.cc:41`, `shutdown: Operation not permitted (1)`. No custom browser flags or sandbox changes were made. |
| UI automation surface inventory | No apps or browser surfaces available. |

Focused moderation command:

```sh
node --test --test-isolation=none --test-name-pattern='announcement|IRM authority|rendered moderation visibility|classified once|network loss|stale scope|actual scope|confirmation|pending prevents|action refreshes|action reconciles|action preserves|unmount before|duplicate removals|bounded ledger|parent copy' tests/moderation.test.mjs
```

The broader `node tests/moderation.test.mjs` was also run: after repairing its CSS-module adapter it reports **65 passed, 2 failed**. The REMOVED/REJECTED membership-form checks at line 174 expect an initial `id="cne"` input; the current applicant-type form presents that field after choosing its type. These unrelated assertions/forms were not changed. The focused command excludes that membership-form work and passes the relevant F7 behavior. Earlier broad execution failed while attempting to parse an existing CSS module as JavaScript; the adapter correction resolves those component-loading failures.

Browser logs are `/tmp/irm-f7-browser.log` and `/tmp/irm-f7-detail-browser.log`; the latest machine-readable browser result is `frontend/test-results/f7/results.json`. The regression runner uses temporary copies and the existing `e2e/moderation-fixtures.ts` deny-by-default API fixture so unmatched API calls cannot reach a backend. It does not start/restart any service.

## Screenshots and direct comparison status

**No actual application screenshots could be captured or inspected.** No source/SSR rendering check is counted as visual acceptance. The capture matrix is implemented for 320, 390, 768, 1024 and 1440px in both themes, covering Announcements, selected-module browsing and Home; detail captures add 320/1440px in both themes. Captures are written to `frontend/test-results/f7/captures/` when a browser is available.

Source-level comparison with the inspected references produced these deliberate corrections: the Announcements heading is larger than ordinary feature-page headings; latest has a full-width ink panel rather than repeating neutral cards; chooser/documents form two panels at desktop widths; document cards become compact rows; mobile retains exactly two columns of shortcuts, including tablet mobile widths; Quick access remains available below feeds; desktop F6 cards, hero and column structure remain unchanged. Actual spacing, long-text rendering, theme contrast, native menus, keyboard/virtual-keyboard behavior and screenshot matching remain unverified.

## Exact owner-side browser rerun and manual acceptance

In a terminal where loopback listening and Chromium are available:

```sh
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
npm run build
npm run start -- --hostname 127.0.0.1 --port 3147
```

In a second terminal:

```sh
cd /home/yasso/irm-platform/frontend
node tests/run-f7-regressions.mjs
```

The second command runs mocked frontend tests, including existing theme, shell, dashboard, announcements/replies, module search, return-navigation and reader regressions. It has no backend/database/startup hooks. A different test server can be selected with an ephemeral `IRM_F7_TEST_URL` value; no `.env` edits are necessary. Browser results cannot currently be claimed to pass.

Manual acceptance after that run:

1. Inspect the Announcements and module captures at desktop/mobile in light/dark against Images 1/2; inspect mobile Home against Image 3's structure and desktop Home against the approved F6 dashboard. Correct visible spacing/contrast/wrapping mismatches before accepting visuals.
2. At 320/390/768/1024/1440px, inspect long usernames/titles, stacked filters and document actions, no horizontal overflow, footer clearance, reader controls and composer/submit access. Check safe-area devices and actual mobile keyboard opening/closing.
3. Use keyboard only: four mobile tiles, five bottom destinations, nested selected states, secondary drawer links, Tab trap, Escape/backdrop/navigation dismissal and focus return. Confirm inactive desktop/mobile controls are not focusable.
4. Toggle both explicit appearances, reload, use another tab, select System, change OS appearance and test blocked storage. Check first paint/hydration, native form color-scheme and fixed white PDF paper.
5. Exercise guest/loading/error/non-member/pending/rejected/removed/banned/active/Delegate states. Ensure unavailable community actions provide status/application/Support guidance and authorized management stays accessible without changes to its workflows.
6. Select modules, apply Search/Type/Source, Clear, empty/filtered-empty/error/retry and Back/Forward; open a document and return with criteria intact. Check direct reader entry and My Submissions/pending return contexts and existing PDF/page/download regressions.
7. Exercise authorized announcement creation, replies/pagination/errors, submit disabling and Delegate removal confirmation/cancellation/errors. Verify absence of those permissions for other roles and stale/access-loss cleanup.

Remaining issues: blocked browser execution/visual acceptance and the two unrelated broader membership harness expectations. No demonstrated F7 application defect remains from executed checks; interactive behavior awaits the browser run above.
