# EtudSup P2.2 — own-account profile editing frontend

## Scope and source

I inspected Git status before editing. The worktree already had extensive modified and untracked frontend, backend, migration, avatar and Discussion work; it was preserved. I read the P2.1 account handoff, P1.2/P1.3 profile contracts, U1/U6 design and feedback reports, the current `/account` page, `AuthContext`, `fetchApi`, shared controls, avatar, backend `UserProfileUpdate`/`UserResponse`, and actual PATCH route. No backend, dependency, environment, deployment or reference-worktree file was edited.

## Exact P2.2 changed files

| File | Change |
| --- | --- |
| `frontend/src/app/account/page.tsx` | Keeps the P2.1 auth/guest gate and mounts the account-owned editor across same-account refreshes while visually masking protected details during checks. |
| `frontend/src/app/account/AccountPage.module.css` | Adds the neutral bordered inline form, wrapped actions and responsive field spacing. |
| `frontend/src/app/account/ProfileContent.tsx` | Adds read-only details plus inline edit, baseline, PATCH, refresh, error, uncertainty, reconciliation and account-scope behavior. |
| `frontend/src/lib/profileEditing.ts` | Pure changed-field payload, Unicode validation and field-location error mapping. |
| `frontend/tests/account-controls.test.mjs` | Updates the P2.1 state assertions for a hidden, retained same-account editor. |
| `frontend/tests/profile-editing.test.mjs` | Tests partial payloads, normalization, Unicode code-point limits, forbidden controls and sanitized 422 mapping. |
| `frontend/e2e/profile-editing.spec.ts` | Prepares 13 mocked browser scenarios for form, errors, uncertain outcomes, races, theme and responsive captures. |
| `frontend/playwright.p2-2.config.ts` | Focused production-server browser test configuration. |
| `docs/etudsup-p2-2-profile-editing-frontend.md` | This report. |

## Form and request behavior

The account page retains the P2.1 identity card, avatar display and read-only email. “Edit profile” opens a bordered inline section for username, first name and family name. The username hint explains its display beside community contributions; account-name guidance states that submitted membership applications are separate. Labels remain visible, placeholders are examples, field errors use `aria-invalid` and `aria-describedby`, and Save/Cancel use the shared button and pending-label styles. Cancel restores the latest saved baseline and clears local feedback.

`PATCH /api/v1/auth/me` is sent through the existing credentialed `fetchApi`, with JSON containing only normalized values that changed from the saved baseline. The request never includes User UUID, email, avatar, password, role or membership data. Save is disabled for no effective change and while pending, and a synchronous ref prevents duplicate submission. The browser supplies Origin; the frontend does not set it.

Local validation rejects raw Unicode `Cc`, `Cs`, `Zl`, `Zp` and the backend's bidi ranges before stripping boundary Unicode spaces. It counts Unicode code points with `Array.from`, applying 3–50 for username and 1–100 for each name. It preserves case, internal spaces, punctuation and Unicode form; it does not impose a Latin or username-character whitelist. Backend validation remains authoritative. Sanitized 422 locations map to the matching field, 409 appears beside username, and technical response text is not rendered. A 401 rechecks authentication; a 403 gives a safe Origin-rejection message. Network and 5xx outcomes are treated as uncertain, not declared failed.

## Baseline, refresh, uncertainty and account scope

On confirmed 200, the returned profile becomes the form baseline, including the returned read-only email and `avatar_url`; the editor closes and shows restrained success feedback. The shared `AuthContext.refresh()` then updates navigation identity. Because `refresh()` returns a result rather than throwing for HTTP failures, the editor checks its returned user. A failed refresh after a confirmed save is reported separately, without repeating PATCH or retracting the save confirmation. A same-account refresh with different server fields updates the baseline; if the draft is dirty, its typed values remain and an explanatory note appears. Cancel then restores that latest baseline. This is reconciliation, not ETag or cross-tab conflict prevention; the backend has no version contract.

When a PATCH response is lost, the draft remains and a read-only “Check saved profile” GET is offered. The GET compares the freshly returned account fields with the submitted values and reports whether they match or differ **without claiming that the original PATCH succeeded or failed**. It updates the local baseline and refreshes shared identity, but never automatically retries PATCH. If the check fails, the draft and check action remain with neutral retry guidance.

The editor is keyed by the authenticated User UUID. A logout immediately masks the profile, aborts the in-flight request and invalidates its completion; a confirmed logout or account switch unmounts the old UUID's draft, validation and feedback. Same-account auth refreshes temporarily mask the form without unmounting it. Late responses are guarded by the existing async-scope epoch and cannot update another account's form. The backend still authorizes the target from the current session; this frontend makes no claim about preventing an unseen cross-tab session change before a request reaches the server.

The page requires authentication but not ACTIVE membership. The existing Membership destination, account dropdown, System appearance, P2.1 avatar, U2 header, footer, and other page workflows were not changed. No avatar upload/removal, password form, email edit, application edit, My communities or administration was added.

## Verification and acceptance

Commands ran from `frontend/` unless stated otherwise.

| Check | Actual result |
| --- | --- |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed. |
| `node --test tests/profile-editing.test.mjs tests/account-controls.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/actions.test.mjs` | Passed: 5 files. |
| `npx playwright test --config=playwright.p2-2.config.ts --list` | Discovery passed: 13 tests listed. **No browser assertions executed.** |
| `npm run build` | Failed before completion: Turbopack processing `src/components/layout/SiteFooter.module.css [app-client]` could not create a new process that binds a port: `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-7b18aa34f5696470787d414810f1d4c7.log`. This is the same environment boundary seen in P2.1; it is not a passing production build. |
| `npx playwright test --config=playwright.p2-2.config.ts` | Failed before tests: `Process from config.webServer was not able to start. Exit code: 1`. The P2.1 direct Chromium probe also failed at `sandbox_host_linux.cc:41` with `Operation not permitted`; no further browser-launch retries were made here. |
| Scoped whitespace | `git diff --check` passed for touched tracked files. A trailing-whitespace search of new P2.2 source/spec/config files returned no matches. |

No 390px/1440px light/dark screenshots were produced. Browser acceptance remains open for live form interactions, same-account refresh timing, 320px overflow, focus, actual contrast and 44px controls. P2.1 and U1–U6 visual/build gaps are not closed by the test discovery or source checks.

Owner-side fish-compatible commands, on a machine where the production build/listener and Chromium are permitted:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/profile-editing.test.mjs tests/account-controls.test.mjs tests/navigation-model.test.mjs tests/theme.test.mjs tests/actions.test.mjs
npm run build
npx playwright test --config=playwright.p2-2.config.ts
```

Inspect `frontend/test-results/p2-2/` for the four `profile-edit-<theme>-<width>.png` captures and the full 13-scenario results. Review keyboard focus, 320px wrapping and account-switch outcomes in the actual browser before visual acceptance.
