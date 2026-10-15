# EtudSup A1 — subtle application animations

## Scope and exact changed files

I inspected Git status before editing and preserved the concurrent modified and untracked backend/frontend work. A1 changes presentation only. No API, permission, form lifecycle, layout geometry, theme palette or dependency changed.

| File | Change |
| --- | --- |
| `frontend/src/app/globals.css` | Adds shared 170ms/200ms motion variables, bounded entrance utilities, button press feedback and reduced-motion overrides; removes the continuous account-placeholder pulse and a duplicate navigation-link transition. |
| `frontend/src/components/navigation/AccountControls.tsx` | Opts the existing account dropdown into the disclosure entrance. |
| `frontend/src/components/navigation/AccountControls.module.css` | Uses shared timing for the trigger's color and border changes. |
| `frontend/src/components/navigation/MobileHeader.tsx` | Opts the existing drawer and backdrop into short entrances. |
| `frontend/src/components/navigation/ThemeSelector.module.css` | Adds a small reversible sun/moon rotation with a reduced-motion reset. |
| `frontend/src/components/moderation/ConfirmationDialog.tsx` | Opts the native dialog into a gentle entrance. |
| `frontend/src/components/AnnouncementModerationAction.tsx` | Opts the announcement action disclosure into the shared entrance. |
| `frontend/src/components/moderation/ModerationAction.tsx` | Opts the message action disclosure into the shared entrance. |
| `frontend/src/components/discussion/ReactionPicker.tsx` | Opts the existing portal panel into the disclosure entrance without changing its coordinates. |
| `frontend/src/components/discussion/DiscussionComposer.tsx` | Opts the existing sticker picker into the disclosure entrance. |
| `frontend/src/app/account/ProfileContent.tsx` | Opts the newly opened edit section into the inline entrance. |
| `frontend/src/app/account/SecuritySection.tsx` | Opts the newly opened password form into the inline entrance. |
| `frontend/src/app/account/AvatarManager.tsx` | Opts the unsaved local photo preview into the inline entrance. |
| `frontend/src/components/Announcements.module.css` | Smooths existing card border and read-action colors; disables them for reduced motion. |
| `frontend/src/components/DocumentRow.module.css` | Smooths the existing border hover and adds a very light surface tint without moving rows. |
| `frontend/src/components/home/HomeDashboard.module.css` | Smooths existing module-card and announcement-row hover colors without changing dashboard order. |
| `docs/etudsup-a1-motion-polish.md` | Records the motion rules, verification and remaining visual review. |

## Motion and preserved behavior

`--motion-fast` is **170ms** for button/link/control and inline-section changes; `--motion-disclosure` is **200ms** for popovers, drawer and dialog. Both use `cubic-bezier(.2, 0, 0, 1)`, with no overshoot. Disclosures enter with opacity and 5px vertical translation; inline account content uses 4px; the drawer uses 6px horizontal translation and a 170ms backdrop fade; the native dialog enters from scale `.98`. The sun/moon icon turns between −7° and +7° as the explicit effective theme changes. Pointer-pressed non-icon buttons move 1px without changing layout; keyboard focus does not trigger that movement. Existing hover/active colors and U1 pending-label width reservation remain.

The account dropdown remains mounted but hidden when closed; its animation is disabled while `hidden` so it cannot keep intercepting clicks. Other panels still use their existing conditional mount/unmount, and none waits for an exit animation. Their anchoring, portal top/left values, viewport bounds and stacking are untouched. The mobile Menu remains on the left; the drawer, dialog and dropdown keep their existing focus, Escape/outside dismissal, route cleanup, scroll lock and mutual-exclusion code. Confirmation authorization and duplicate-submit handlers still run immediately. Account drafts, secret cleanup, avatar preview ownership, Discussion message/history anchoring and PDF rendering/position restoration are unchanged. No page-wide fade, list stagger, message animation, skeleton loop, timer, listener or `will-change` was added.

With `prefers-reduced-motion: reduce`, the new entrances, rotation and pressed movement disappear. Color transitions on the scoped controls/cards are disabled or already covered by their existing reduced-motion selectors; focus outlines and immediate state changes remain. The existing continuous account-check placeholder pulse was removed for both preferences. The pending-button spinner still communicates an active operation for ordinary motion and is static under reduced motion.

## Verification actually performed

Commands ran in `frontend/` unless stated otherwise.

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, exit 0. |
| `npx tsc --noEmit` | Passed, exit 0. |
| `node --test tests/actions.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/moderation.test.mjs tests/account-controls.test.mjs tests/avatar-management.test.mjs tests/profile-editing.test.mjs tests/password-change.test.mjs tests/discussion-composer.test.mjs` | Passed: 9 test files, 0 failures. These are source/Node checks, not rendered motion checks. |
| `npm run build` | Passed, exit 0 on the final source. Next 16.3.6 Turbopack compiled and generated 22 static pages; the ordinary prebuild copied the existing PDF worker. No build-mode substitution was used. |
| `npx playwright test --config=playwright.p4-2.config.ts --list --grep '390px avatar preview capture'` | Discovery only: 2 light/dark 390px cases; 0 browser assertions. |
| Focused Playwright execution with the same config/grep and `--max-failures=1` | Blocked before test code: `Process from config.webServer was not able to start. Exit code: 1`. Chromium, rendered animation assertions and screenshots did not run. The server attempt was not repeated. |
| Scoped whitespace | `git diff --check -- frontend/src/app/globals.css` and a trailing-whitespace scan of every A1 file passed. |

The build succeeding does not establish that the animations render correctly. A1 produced no screenshots. The existing R1 and earlier visual/browser acceptance gaps remain open.

## Owner review

On a machine where an isolated frontend server and Chromium can start, use existing mocked browser fixtures or an isolated local test account. At 390px and 1440px in both themes, open/close the account dropdown, mobile drawer, an announcement or message action menu, sticker/reaction pickers, and a confirmation dialog. Confirm initial focus, Escape and outside dismissal, route navigation, no click interception after close, unchanged portal anchoring while scrolling, and no 320px horizontal overflow. Open profile edit, password and local photo preview once each; check that typing and routine refresh do not replay motion. Switch Light/Dark/System and verify the icon only moves subtly. Repeat with OS reduced motion enabled: no entrance translation, scale, rotation or pressed movement, with focus still visible and controls immediately usable.

No backend, database, migration, dependency, environment, deployment or reference-worktree file was edited. Nothing was staged, committed, pushed, deployed or used to restart an owner service.
