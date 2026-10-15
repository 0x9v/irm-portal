# EtudSup R1 — consolidated frontend release acceptance

## Scope and changed files

This is an owner-run entry point for implemented frontend features. I inspected Git status before editing and preserved the existing backend, CS6A, Discussion and frontend work. The repository was already extensively dirty. No application behavior, API contract, dependency or lockfile was changed for R1.

| File | R1 change |
| --- | --- |
| `frontend/package.json` | Adds the single `release:acceptance` script. |
| `frontend/scripts/release-acceptance-core.mjs` | Suite groups, safe argument parsing, readiness and owned-process cleanup, discovery counts and summary formatting. |
| `frontend/scripts/release-acceptance.mjs` | Finite staged runner, isolated mocked fixtures, one optional production build/server, report and screenshot collection. |
| `frontend/playwright.release.config.ts` | One Chromium config using the supplied frontend URL and per-run output directory; no implicit web server. |
| `frontend/tests/release-acceptance-runner.test.mjs` | Runner unit checks. |
| `frontend/e2e/avatar-management.spec.ts` | Adds the missing late profile response versus confirmed new photo race assertion. |
| `frontend/e2e/password-security.spec.ts` | Extends confirmed 204 coverage to assert that the authenticated header trigger is gone on login. |
| `docs/etudsup-r1-frontend-release-acceptance.md` | Coverage, actual evidence and owner procedure. |

## Coverage inventory and selection

The repo has many feature-specific Playwright configs and overlapping suite selections. R1 selects each existing spec filename once, without duplicating test bodies in the repository or changing permission assertions. The current selection is **33 distinct Playwright spec files**. A single Chromium project runs the viewports/themes expressed by those tests; the summary reports Playwright cases and a separately normalized scenario-family count. Normalization groups test titles that differ only by a 320/390/768/1024/1440 viewport and light/dark label. It is a reporting aid, not a claim that all viewports are interchangeable.

| Group | Existing suites and feature coverage |
| --- | --- |
| `guest` | `guest-home`, `account-pages`, `support`: landing, registration, login, validation, guest routing and Support. |
| `shell` | `signed-in-home`, `home-composition`, `navigation-shell`, `theme-preference`, `u2-mobile-header-theme`, `actions-underlines`: dashboard, authenticated/guest navigation, bottom bar, appearance persistence and System recovery, focus and shared actions. |
| `content` | `u4-announcements`, `announcement-replies`, `community-posts`, `delegate-moderation`: announcements, replies, posts, capability gates, removals and reconciliation. |
| `documents` | `module-document-search`, `document-metadata-navigation`, `u5-document-rows`, `saved-documents`, `recent-documents`, `my-document-submissions`, `document-reader`, `page-layouts`: module filters/return, personal lists, pending voting, reader and responsive rows. |
| `membership` | `membership-application`, `member-directory`: request/application and member management gates, filters, unban and account cleanup. |
| `discussion` | `discussion`, `discussion-redesign`, `discussion-stickers`: owner UUID alignment, history/reactions, socket/removal behavior and private custom sticker library. |
| `account` | `account-foundation`, `profile-editing`, `password-security`, `avatar-management`: entry states, profile, password 204 handoff, photo and header identity. |
| `feedback` | `u6-feedback-states`: loading/empty/error distinctions, retry and uncertain mutation feedback. |
| `visual` | `f7-feature-theme-mobile`, `theme-account-surfaces`: cross-page theme/layout and account surface contrast. |

The critical cross-feature audit found existing assertions for logout/account-switch private-state cleanup (`navigation-shell`, `discussion-redesign`, `profile-editing`, `avatar-management`, `password-security`); reversible System/theme persistence (`theme-preference`, `u2-mobile-header-theme`, `f7-feature-theme-mobile`); own-message alignment after navigation/reload (`discussion-redesign`); library removal retaining an already-sent sticker (`discussion-stickers`); reader return with filters (`document-metadata-navigation`, `u5-document-rows`); removed content staying absent (`delegate-moderation`); and mobile header/bottom-bar clearance (`u2-mobile-header-theme`, `discussion-redesign`, `home-composition`). The two R1 assertions close the narrow coverage gaps for a stale profile response after a photo change and the authenticated header after password 204. These new browser assertions have **not** executed in this environment.

`frontend/e2e/moderation-fixtures.ts` remains the deny-by-default source. The runner creates temporary copies of selected specs and imports that fixture for every suite. Its context routes abort unmatched `**/api/**` and all unmatched WebSockets; existing suite mocks still supply the deliberate API/socket responses. A temporary rewrite turns `route.continue()` in suite mocks into `route.fallback()` so an unhandled API call reaches the deny route. The runner rejects selected specs containing a direct backend URL or Playwright request API. The temporary copies are removed after each run. The release config has no backend startup, seeding or default `webServer`, and `NEXT_PUBLIC_API_URL` for a runner-owned build points to that same frontend origin. An explicitly supplied existing server uses a loopback origin only. Live backend, PostgreSQL, account and storage workflows are outside this mocked run.

## Runner contract and owner commands

`list` performs Playwright discovery only. `static` performs discovery, full lint, full TypeScript and all existing `frontend/tests/*.test.mjs` Node checks. `mocked-browser` performs discovery, a real normal `npm run build`, starts one runner-owned `next start` server and runs the selected mocked suites. `screenshots` uses the same build/server and selects existing capture-oriented browser cases by title. `all` runs discovery, static checks, normal build and all selected mocked cases. `--groups` selects named groups for browser discovery/execution; static checks stay repository-wide. The default owned port is **3170**, changeable with `--port`. `--url` selects an already running loopback frontend, skips build/start and labels the build **not verified**. The runner never stops that existing server.

All commands below are fish compatible. Open the report and one capture after a completed browser run:

```fish
cd /home/yasso/irm-platform/frontend
npm run release:acceptance -- list
npm run release:acceptance -- static
npm run release:acceptance -- all
npm run release:acceptance -- screenshots --groups=guest,shell,content,documents,discussion,account,feedback,visual
npm run release:acceptance -- mocked-browser --url http://127.0.0.1:3000
npm run release:acceptance -- mocked-browser --groups=documents
set latest (ls -dt test-results/release-acceptance/* | head -n 1)
cat $latest/summary.md
xdg-open $latest/playwright-report/index.html
set image (find $latest/artifacts -type f -name '*.png' | head -n 1)
test -n "$image"; and xdg-open $image
```

The existing-server example assumes the owner has already started a compatible frontend on port 3000. It does **not** verify the production build; use `all` for that gate. Every run writes a timestamped `test-results/release-acceptance/<UTC timestamp>/summary.md` with Git HEAD, dirty-entry counts, stage commands/status/exit codes, selected suites, discovery counts, actual Playwright result totals when run, build mode, frontend URL, artifact paths and cleanup result. Playwright HTML and test output paths are under that timestamped directory. Existing D1/U5/U6 tests also write some captures to their established `test-results/d1`, `d1-1`, `u5/captures` and `u6/captures` directories; the runner lists only PNGs created during its run. Reports contain no credentials, cookies, private API bodies or password/file payloads. Stage timeouts and SIGINT/SIGTERM are bounded; only the process group started by this runner can be signaled. A port collision or failed HTTP readiness stops before browser execution. A nonzero build/test status remains the command exit status after the report is written.

## Verification actually performed

| Check | Result |
| --- | --- |
| `npm run release:acceptance -- list --groups=account,documents` | Discovery completed: 12 selected files, 93 Playwright cases. **No browser assertions.** |
| `npm run release:acceptance -- static` | Passed: 33 selected files, 497 discovered Playwright cases; full lint 0, TypeScript 0, all **16 distinct Node test files** passed with 0 failures. Summary: `frontend/test-results/release-acceptance/2026-10-13T20-30-39-068Z/summary.md`. Discovery is not execution. |
| Final `npm run release:acceptance -- list` after count normalization | Passed: 497 cases / **363 normalized scenario families** in 33 files. Summary: `frontend/test-results/release-acceptance/2026-10-13T20-38-55-410Z/summary.md`; 0 browser assertions. |
| Runner unit checks | Argument rejection and focused suite selection, exit-code propagation, timestamped summary content, HTTP readiness failure (including a non-ready HTTP status), and signal cleanup of only the tracked process group are covered in `release-acceptance-runner.test.mjs`. |
| `npm run release:acceptance -- mocked-browser --groups=account` | 4 account specs / 51 cases discovered. The **normal production build exited 1** in Next 16.3.6 Turbopack while processing `src/components/layout/SiteFooter.module.css`: `creating new process` → `binding to a port` → `Operation not permitted (os error 1)`. Summary: `frontend/test-results/release-acceptance/2026-10-13T20-31-26-217Z/summary.md`. HTTP server and Chromium were not started; 0 browser assertions and 0 screenshots. The build was not retried or replaced with dev/webpack mode. |
| Final focused checks | `node --test tests/release-acceptance-runner.test.mjs`, scoped ESLint and `npx tsc --noEmit` passed after the last runner edits. |
| Scoped whitespace | `git diff --check -- frontend/package.json frontend/e2e/avatar-management.spec.ts frontend/e2e/password-security.spec.ts` and a trailing-whitespace scan of every R1 file passed. Repository-wide `git diff --check` still reports four pre-existing backend EOF blank lines, outside R1 scope. |

The current agent environment has not accepted the production build or browser suites. Source checks, discovery and runner unit tests do not close U1–U6, Discussion, CS5 or Account visual/browser acceptance. Normal build and actual Chromium execution on an owner machine remain required; inspect the generated 320/390/768/1440 light/dark captures, focus, wrapping, bottom-bar clearance and contrast. The existing-server mode can exercise mocked browser cases independently but does not substitute for the normal-build gate. A real backend walkthrough must separately validate server authorization, session revocation, PostgreSQL concurrency and durable media handling.

## Finite live owner checklist

Use isolated **local test accounts**, never owner or production accounts. Run `all`, inspect the summary/HTML report and produced captures, then rerun only any failing group. With a disposable account, register/sign in, apply for membership, inspect Home/Announcements/Modules and save/open/return to a document. With an authorized isolated delegate, verify post/announcement removal and member management; with two isolated users, check Discussion ownership, reactions and that a sent custom sticker remains after its library item is removed. On `/account`, edit a profile, add/change/remove a photo and confirm the header, then change the password last: verify the old session is denied and the new password signs in. Record this live result separately from mocked acceptance and close the backend PostgreSQL/storage gates through their own procedures.

Nothing was staged, committed, pushed, deployed, seeded or used to restart an owner service. No backend, database, migration, dependency, environment or reference worktree file was edited.
