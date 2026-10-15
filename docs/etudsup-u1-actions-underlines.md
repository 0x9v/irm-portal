# EtudSup U1 — shared actions and underline correction

## Scope and initial inventory

Frontend-only work in `/home/yasso/irm-platform`. Inspected git status and snapshotted existing frontend/report contents in `/tmp/irm-u1-before` before editing. Existing modified and untracked work was preserved. The agent inventory contained only this frontend agent; no second frontend editor was visible. Concurrent backend profile work was left untouched.

Read `frontend/AGENTS.md`, the installed Next.js CSS guide, F8/F9 reports and the current F6 dashboard/F7 theme/mobile report. Inspected the guest landing, login/register, signed-in Home, shell and theme controls, Announcements, Modules/document views, Saved/Recent/My submissions, membership/application/review/staff/directory, Posts, Discussion, reader, feedback and confirmation controls. No new route or profile integration was introduced.

| Existing action style | Competing ownership found | Decision |
| --- | --- | --- |
| `Button` / `buttonStyles` | Four variants in Tailwind's components layer; utility fills could override them; feature module redefined quiet/destructive/active states | Keep this API; make shared action styling authoritative and remove redundant feature rules |
| Feature `ui-action` | Separate unlayered miniature button implementation plus custom utility classes | Migrate actual consumers to the existing secondary/quiet variants; remove the second implementation |
| Native form/reader/management controls | Repeated fill, border, radius, focus, padding and disabled utility strings | Reuse the shared variants while preserving native elements and handlers |
| Home hero/cards/header/help actions | Separate primary/secondary styles, 9–10px action radii, explicit hover underlines | Shared variants for actions; shared opt-in card boundary for whole-card navigation |
| Sidebar/bottom navigation/module chooser | Custom active-route styles; decoration resets repeated on surrounding shells | Keep route styling and mark actual anchors as `ui-nav-link` |
| Theme/menu/account/reaction/reader icons | Several independent dimensions and focus treatments; reaction targets as small as 28px | Shared 44px icon treatment; preserve names, disclosure/pressed state and placement |
| Ordinary prose / account alternatives | `ui-link` and account module underlines | Retain identifiable prose links; breadcrumbs use navigation semantics |
| Pending labels | Conditional strings could change a control's width; some controls only dimmed when disabled | Shared width-reserving labels, busy state and native disabled semantics |

The approved public page sections, typography, illustration and layout composition were retained. Only their action presentation was adjusted where it needed the shared system.

## Underline diagnosis and precise uncertainty

Confirmed source causes for **hover** underlines existed in `HomeDashboard.module.css`: `.textLink:hover, .accessLinks a:hover`, `.signedPanelAction:hover`, `.managementLinks a:hover`, and `.signedInlineAction:hover, .supportLink:hover` explicitly requested `text-decoration: underline`. These conflict directly with the requested undecorated section-header, membership/help and management actions. They were removed/replaced as those controls adopted the shared variants.

Other affected anchors already had module-level `text-decoration: none` at the starting snapshot: dashboard feature-card roots, shortcut tiles, announcement/module links and sidebar/mobile controls. Source inspection found no general app rule decorating the whole dashboard ancestor. It therefore does **not** establish the winning rule behind all of the user's visible resting underlines, nor whether their rendered build matches this source.

A clean installed Chromium launch failed before any page could open: `sandbox_host_linux.cc:41`, `shutdown: Operation not permitted (1)`, reported as `browserType.launch: Target page, context or browser has been closed`. Log: `/tmp/irm-u1-browser-probe.log`. Computer-use inventory returned no apps or browsers. No browser preferences, user stylesheets, launch flags, external services or owner locks were changed. The same blocked browser was not repeatedly launched.

Consequently no actual computed style, ancestor chain, winning rendered rule, visited-state evidence or after screenshot was obtained here. **Visual acceptance and the complete rendered underline root cause remain unverified.** This report does not attribute the issue to user browser settings or claim that a source-only change proves it fixed.

The component boundary now explicitly owns decoration on `.ui-button`, `.ui-nav-link` and `.ui-card-link`, including hover/focus/active/visited states. Whole-card links receive that boundary on the anchor, because a descendant cannot cancel a line painted by an ancestor. This is opt-in to action/navigation/card elements, not a blanket `a` reset, and introduces no underline `!important`. Existing per-page action overrides were reduced rather than expanded. Ordinary paragraph `ui-link` anchors and account alternatives retain their underlines.

## Shared system and application

The existing `src/components/ui/Button.tsx` remains the only button primitive:

- Primary: current calm violet tokens and contrasting foreground; Home hero and independently scoped submission/approval actions.
- Secondary: neutral surface, visible semantic control border and clear text; practical help, membership, return actions, reader navigation, Save state, refresh/load-more and Support actions.
- Quiet: compact neutral action with restrained hover/border; All announcements/All modules, management links, Clear filters and comparable small actions.
- Destructive: dedicated `danger-action` foreground/fill tokens, separate from ordinary violet and feedback colors; existing removal, rejection, cancellation, ban and confirmation actions. Both themes' normal/hover/pressed danger pairs are numerically checked for at least 4.5:1 text contrast.
- Icon button: `iconButtonStyles` reuses the secondary variant with a 44px square, consistent focus and icon size. Existing theme, sidebar/menu, reader zoom, account disclosure and reaction controls retain their behavior and placement. The account trigger retains its adaptive identity layout while using the shared quiet action.

Action rules are unlayered and scoped to the opt-in classes so utility fill/padding strings cannot silently compete with semantic variants. Consumer paint strings and duplicate feature definitions were removed. Layout utilities remain supported, including the existing absolutely positioned New messages action. The standard radius is the existing `--radius-control` (12px); ordinary targets are at least 44px; transitions are 170ms; no resting action shadow is added. Ink hero controls override existing semantic tokens locally to preserve their approved lavender/dark-ink contrast.

Disabled buttons retain native `disabled` and use a dashed border plus disabled surface/text, rather than opacity alone. Pending controls retain accessible names and use `aria-busy`, solid borders and an unobtrusive indicator; reduced motion leaves the indicator static. `PendingLabel` keeps both existing label widths in one grid cell and exposes only the current label to assistive technology. Existing operation labels and duplicate-submit prevention remain intact. Existing native confirmation dialog focus placement, Tab containment, Escape restrictions and focus return are preserved.

Applied to Home actions/cards/shortcuts, landing actions, existing account submission controls, Announcements and replies, Posts and replies, Modules' existing shared actions/chooser, document browsing/recent/saved/submissions/pending/upload/reader, membership/review/staff/directory and moderation, Discussion controls, Support and shell navigation. The Modules/document pages already using `buttonStyles` receive the common treatment without a structural rewrite.

## Preservation

Desktop retains the broad main column **hero → feature cards → latest announcements → modules**, and the supporting column **Quick access → Your IRM access/help**. Mobile retains **hero → the same four shortcuts/grid → announcements → modules → supporting panels**. Shared copyright remains after the full content, with existing mobile clearance.

A snapshot audit compared behavioral JSX attributes across modified TSX consumers: hrefs, operation/submit/change handlers, native types, disabled conditions, keys, current/expanded state, existing pressed state, disclosure targets and confirmation handlers are unchanged in consumers. The two Posts filter buttons now expose their existing selection through `aria-pressed`; their selection logic and handlers are unchanged. The shared Button's optional pending API is the intentional exception; it adds native disabling/busy state without changing caller authentication logic. Existing gate/cancellation/stale-response/logout/permission tests were rerun.

F9's contribution/contact mechanism, unavailable state and separate help remain truthful and unchanged. The one shared footer and PDF/discussion omissions are unchanged. PDF paper/canvas/text-layer colors and reader logic are unchanged.

**U2–U6 structural work was not started:** the mobile appearance chevron/System placement, Quick access content (including active-member Membership), Announcement composition, module/document row structure, and app-wide feedback/dialog/layout flows remain as they were. Reaction/button targets and confirmation action styling are U1 presentation changes; no workflow or dialog architecture was replaced.

## Exact changed-file inventory

These paths are relative to the repository root and describe changes from the U1 starting snapshot, including previously untracked files.

- `frontend/src/app/communities/irm/announcements/[announcementId]/page.tsx`
- `frontend/src/app/communities/irm/announcements/page.tsx`
- `frontend/src/app/communities/irm/discussion/page.tsx`
- `frontend/src/app/communities/irm/document-voting/settings/page.tsx`
- `frontend/src/app/communities/irm/documents/mine/page.tsx`
- `frontend/src/app/communities/irm/documents/pending/page.tsx`
- `frontend/src/app/communities/irm/documents/recent/page.tsx`
- `frontend/src/app/communities/irm/documents/saved/page.tsx`
- `frontend/src/app/communities/irm/membership/page.tsx`
- `frontend/src/app/communities/irm/membership/review/page.tsx`
- `frontend/src/app/communities/irm/membership/staff/page.tsx`
- `frontend/src/app/communities/irm/modules/[moduleSlug]/upload/page.tsx`
- `frontend/src/app/communities/irm/posts/[postId]/page.tsx`
- `frontend/src/app/communities/irm/posts/new/page.tsx`
- `frontend/src/app/communities/irm/posts/page.tsx`
- `frontend/src/app/globals.css`
- `frontend/src/app/login/page.tsx`
- `frontend/src/app/page.tsx`
- `frontend/src/app/register/page.tsx`
- `frontend/src/app/support/Support.module.css`
- `frontend/src/components/AnnouncementCard.tsx`
- `frontend/src/components/AnnouncementReplies.tsx`
- `frontend/src/components/Breadcrumbs.tsx`
- `frontend/src/components/CommunityPostCard.tsx`
- `frontend/src/components/CommunityPostReplies.tsx`
- `frontend/src/components/DocumentReader.tsx`
- `frontend/src/components/SavedDocumentButton.tsx`
- `frontend/src/components/discussion/DiscussionComposer.tsx`
- `frontend/src/components/discussion/DiscussionMessageItem.tsx`
- `frontend/src/components/discussion/ReactionPicker.tsx`
- `frontend/src/components/home/DashboardActionCard.tsx`
- `frontend/src/components/home/GuestHome.module.css`
- `frontend/src/components/home/GuestHome.tsx`
- `frontend/src/components/home/GuestHomeShell.tsx`
- `frontend/src/components/home/GuestLanding.module.css`
- `frontend/src/components/home/HomeAnnouncementRow.tsx`
- `frontend/src/components/home/HomeDashboard.module.css`
- `frontend/src/components/home/HomeMobileShortcuts.tsx`
- `frontend/src/components/home/HomeModuleCard.tsx`
- `frontend/src/components/home/HomeWelcomeHero.tsx`
- `frontend/src/components/layout/FeatureIdentity.module.css`
- `frontend/src/components/moderation/ConfirmationDialog.tsx`
- `frontend/src/components/moderation/MemberDirectory.tsx`
- `frontend/src/components/moderation/ModerationAction.tsx`
- `frontend/src/components/modules/ModuleBrowserFrame.tsx`
- `frontend/src/components/navigation/AccountControls.module.css`
- `frontend/src/components/navigation/AccountControls.tsx`
- `frontend/src/components/navigation/AccountPanel.tsx`
- `frontend/src/components/navigation/ContextBar.tsx`
- `frontend/src/components/navigation/MobileBottomNav.tsx`
- `frontend/src/components/navigation/MobileHeader.tsx`
- `frontend/src/components/navigation/NavigationLinks.tsx`
- `frontend/src/components/navigation/NavigationShell.module.css`
- `frontend/src/components/navigation/SidebarNav.tsx`
- `frontend/src/components/navigation/ThemeSelector.module.css`
- `frontend/src/components/navigation/ThemeSelector.tsx`
- `frontend/src/components/ui/Button.tsx`
- `frontend/tests/home-presentation.test.mjs`
- `frontend/tests/member-directory.test.mjs`
- `frontend/tests/moderation.test.mjs`
- `frontend/tests/theme.test.mjs`
- `frontend/tests/actions.test.mjs`
- `frontend/e2e/actions-underlines.spec.ts`
- `frontend/playwright.u1.config.ts`
- `docs/etudsup-u1-actions-underlines.md`

`frontend/tsconfig.tsbuildinfo` was refreshed by TypeScript. Generated build/test artifacts are not authored features. The normal prebuild recopies the existing installed PDF worker. No backend, migration, database, authentication contract, dependency/lockfile, environment, deployment, acceptance-runner or `/home/yasso/etudsup` changes. Nothing staged, committed, pushed or deployed.

## Verification

| Command/check | Actual result |
| --- | --- |
| `npm run lint` | Final code passed |
| `npx tsc --noEmit` | Final code passed |
| `node --test --test-reporter=tap tests/*.test.mjs` | All 10 Node test files passed; includes the six new action checks and existing Home/navigation/theme/account/Support/moderation/member-directory regressions |
| `node tests/moderation.test.mjs` | 67 checks passed |
| `node tests/member-directory.test.mjs` | 83 checks passed |
| `git diff --check -- frontend/src frontend/tests frontend/e2e docs/etudsup-u1-actions-underlines.md` plus introduced-line/new-file whitespace scan | Passed; existing whitespace was preserved |
| Installed PostCSS/Tailwind processing of current globals and Lightning CSS compilation of six changed modules | Passed; separate CSS syntax/cascade-boundary checks, not a production build or visual acceptance |
| `npx playwright test --config playwright.u1.config.ts --list` | 173 tests discovered in seven files; no browser assertions executed |
| Normal `npm run build` | Incomplete: stalled in compile with no new output for over ten minutes; stopped only this task’s build with Ctrl+C (exit 130) |
| Default Chromium launch and computer-use inventory | Blocked before rendering; no screenshots |

The action checks exercise real native Button props, pending submission disabling/naming, anchor semantics/destinations, external-link protection, width-reserving accessible labels, icon state preservation and danger contrast. Existing rendering/handler suites check persona gates, session/logout behavior, async cancellation/stale scopes and confirmation focus/duplicate protection. They do not prove browser styling or geometry.

Adjusted existing test adapters to load the real shared controls/CSS imports and inspect visible action text rather than raw child-string/class-name assumptions. Membership form assertions now check the actual form availability; the student identifier is already conditional on applicant type. Navigation fixtures traverse the real factored NavigationLinks component. No production gate or workflow was changed to satisfy a test.

Compiled CSS artifacts: `/tmp/irm-u1-global-compiled.css` and `/tmp/irm-u1-landing-compiled.css`. The landing check confirms the navigation selector excludes the global `.ui-button` class after CSS-module compilation; it cannot overwrite primary action text with navigation text color.

The default `npm run build` ran the normal existing prebuild and Next.js 16.3.6 Turbopack build. It remained at “Creating an optimized production build ...” from 16:45 UTC for over ten minutes; `.next/diagnostics/build-diagnostics.json` remained at `compile`. It emitted no terminal error identifying a source or port failure during this U1 attempt. Only this task’s own command was interrupted (exit 130); no owner process was stopped and no lock was removed. This is an incomplete build, not a successful production build. The Chromium EPERM is separately confirmed; the current build’s stall cause remains uncertain. The same build was not retried.

Logs: `/tmp/irm-u1-lint-final.log`, `/tmp/irm-u1-tsc-final.log`, `/tmp/irm-u1-node-final.log`, `/tmp/irm-u1-actions.log`, `/tmp/irm-u1-directory-final.log`, `/tmp/irm-u1-moderation-final.log`, `/tmp/irm-u1-discovery.log`, `/tmp/irm-u1-build.log`, `/tmp/irm-u1-browser-probe.log`.

## Owner-side browser/build acceptance

Terminal 1, in an environment permitting local processes/port binding and Chromium:

```bash
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test --test-reporter=tap tests/*.test.mjs
npm run build
npm run start -- --hostname 127.0.0.1 --port 3151
```

Start the server only after the normal production build succeeds. Terminal 2:

```bash
cd /home/yasso/irm-platform/frontend
npx playwright test --config playwright.u1.config.ts actions-underlines.spec.ts
npx playwright test --config playwright.u1.config.ts
```

For an already running frontend, set `IRM_U1_TEST_URL=http://127.0.0.1:<port>` on these test commands. Do not change environment files, restart unrelated services or delete their locks. This runner uses the existing deny-by-default API/socket fixture and has no backend/startup hooks.

The focused suite checks the real Home, Modules, Announcements, Membership and Support pages in both themes at 320/390/768/1024/1440px. It checks representative semantic elements, 44px targets, focus-visible, enabled action contrast, overflow, card descriptions, normal/hover/focus/active decoration and the complete ancestor chain. It records matching CSSOM decoration declarations with stylesheet URLs for rendered-source evidence. A navigation/back check records the visited destination's decoration. Separate cases exercise an actual prose link, account pending/error return and unchanged destructive keyboard cancellation.

Expected output: `frontend/test-results/u1/captures`, screenshots named `<home|modules|announcements|membership|support>-<light|dark>-<390|1440>.png`, and attached `<page>-<theme>-<width>-decoration.json` evidence. Inspect the actual captures against the existing guest/account/EtudSup theme, and inspect computed rules in any owner browser still showing an underline. Check the served current source/build and any decorating ancestors before drawing a root-cause conclusion.

Remaining acceptance gaps: successful normal production build, actual screenshot inspection, computed styles/winning rule in the affected rendered app, visited/focus/pressed appearance, contrast against adjacent surfaces, 320px and long-label geometry, reader controls/PDF-white appearance, reaction/composer interaction and safe-area clearance. No visual acceptance is claimed by test discovery or Node rendering.
