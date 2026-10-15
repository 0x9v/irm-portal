# ETUDSUP CS6B — custom sticker lifecycle acceptance

## Scope and owner direction

This task continues the existing CS2–CS6 sticker work. The earlier release-audit recommendation to defer stickers is superseded by the owner's direction: custom sticker uploads and sends remain available. No feature gate, hide/disable path, or release deferral was implemented. No unsafe orphan deletion was added.

## Corrections and current source findings

- **Pending Retry single-flight:** source review confirmed the defect: Retry invoked the callback directly without setting `isSubmitting`, allowing overlapping POSTs. A pre-fix Playwright reproduction was attempted but Chromium could not launch. The post-fix Node regression harness invokes the actual `DiscussionComposer` handler twice synchronously and confirms only one operation starts. A synchronous ref-backed operation lock now guards text, built-in sticker, custom sticker and retry sends before React state updates. Retry now shows `Retrying…`, `aria-busy=true` and disabled state while pending. It passes the original `PendingSubmission` unchanged, preserving `client_message_id` and `custom_sticker_id`. The page/backend idempotency contract remains unchanged, and an uncertain result keeps the same retry payload.
- **Picker disclosure and keyboard:** the picker remains a nonmodal dialog disclosure; it has no `aria-modal` and does not trap focus. Opening focuses the selected tab. Escape and the explicit close control return focus to the trigger. Outside pointer dismissal returns focus only if it was inside the picker; ordinary focus movement outside closes without stealing focus. Tabs use a roving tab stop with Left/Right and Home/End navigation, and controls remain in normal Tab order. Browser acceptance checks for 320px geometry, keyboard tab order, focus return, Escape and outside dismissal were added.
- **Image access and cleanup:** private library previews use the authenticated owner-only preview URL; conversation media uses the active-community/message-scoped URL. The image loader uses credentialed same-origin fetch, aborts stale requests and revokes blob URLs. Account-keyed composer remount and Discussion account-transition cleanup clear private library state and reset cursors. Message removal unmounts media; the backend checks visibility before and after reading. Bytes already delivered to a browser cannot be recalled.
- **Removal and retry retention:** removing a library item leaves visible message media intact. Retry retains the original asset and client message UUID. Backend idempotency can replay a committed send after library removal; if the original attempt never committed and the item is removed, a retry can fail because the asset is no longer available. This behavior remains explicit in the pending feedback/retry contract.
- **Acceptance runner warnings:** the current full lint run is clean. The two reported unused-variable warnings for `DEFAULT_PORT` and `GROUPS` in `frontend/scripts/release-acceptance.mjs` no longer reproduce in the current source. The consolidated runner remains intact; no runner code change was needed.
- **Discussion and account regressions:** the previously reported Discussion lint/type errors remain corrected and were not reopened. The top-bar saved-avatar integration remains complete and was not changed.

## Files changed for CS6B

- `frontend/src/components/discussion/DiscussionComposer.tsx` — synchronous submission lock; truthful retry pending controls; nonmodal picker focus handling and accessible roving tabs.
- `frontend/tests/discussion-composer.test.mjs` — duplicate retry and busy-state component regression.
- `frontend/e2e/discussion-stickers.spec.ts` — held-request retry single-flight assertion and keyboard/focus/nonmodal/320px picker acceptance.
- `docs/etudsup-cs6b-sticker-lifecycle-acceptance.md` — this closure report.

No backend, schema, migration, storage cleanup, acceptance-runner, dependency, deployment, owner-service or existing sticker-data change was made.

## Verification performed

Commands ran in `frontend/`:

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, no errors or warnings. This rechecks the two earlier release-runner warnings. |
| `npx tsc --noEmit` | Passed. |
| `node --test tests/discussion-composer.test.mjs tests/release-acceptance-runner.test.mjs` | Passed: both test files, 0 failures. The composer test invokes the actual component and proves a second immediate Retry call does not start another operation, while busy state is true and the original retry object is preserved. |
| Current CS6B recheck: same lint, TypeScript and Node commands | Passed again in the present workspace: lint clean; TypeScript exit 0; Node tests 2 passed, 0 failed. |
| `npx playwright test --config=playwright.d1.config.ts e2e/discussion-stickers.spec.ts --list` | Passed discovery: all 7 sticker cases, including retry single-flight and nonmodal picker keyboard/focus cases. This does not execute browser assertions. |
| Pre-change focused Chromium retry reproduction | Blocked before test code/assertions: Chromium exited at `sandbox_host_linux.cc:41` with `shutdown: Operation not permitted (1)`. **Zero browser assertions executed.** |
| Post-change Playwright `--list` for the new retry and picker cases | Passed discovery: 2 cases in `discussion-stickers.spec.ts`. Discovery is not browser acceptance. |
| Post-change focused Chromium execution | Blocked before test code/assertions by the same `sandbox_host_linux.cc:41` `Operation not permitted (1)` failure. **Zero browser assertions executed; one selected case did not run.** |

## Retention, capacity, backup and reconciliation

CS6A's database cleanup remains bounded and only removes eligible rows after rechecking age and all message references. The filesystem orphan and temporary-file inventories remain **dry-run-only**. No deletion path was added: CS3 may publish a file before its row commits and retain it when commit outcome is uncertain, and there is no writer/reconciler lease, publication ledger or definitive end-of-write marker that would prove an unreferenced file is abandoned.

Operational gaps are separate from cleanup correctness:

- **Capacity:** durable sticker storage capacity, growth rate, orphan backlog, alert thresholds and production mount behavior have not been measured or accepted.
- **Backup/restore:** coordinated database plus sticker-file backup and restore has not been exercised; matching consistency and recovery objectives are unverified.
- **Reconciliation:** safe automated orphan/temp reconciliation remains unfinished until writer/reconciler coordination and a database recheck immediately before any future deletion are designed and accepted. Age alone does not authorize deletion.

## Finite CS6B acceptance checklist

1. **Frontend checks — passed:** retain the clean full lint and TypeScript results and the composer/release-runner Node regression results above.
2. **Browser interaction — owner-side blocked:** on a machine where Chromium can launch, run the focused retry and picker cases in `discussion-stickers.spec.ts`; confirm one POST during a held retry, truthful busy/disabled state, identical retry identifiers, Enter/Space opening, initial tab focus, arrow-key tabs, Escape/close focus return, outside dismissal without a focus trap, tab/control keyboard reachability, and no horizontal overflow at 320px. Then run the complete CS5 sticker browser cases and focused Discussion/redesign/moderation suites in light and dark themes at supported mobile and desktop widths. Current sandbox failure ran zero assertions.
3. **Live two-account flow — unexecuted:** verify owner-only preview denial for a different account; authorized community message media; first send, uncertain retry and committed replay after library removal; nonmember management-only behavior; account switch/cursor reset; and media concealment after message removal. Confirm text and built-in sticker behavior in the same Discussion session.
4. **Guarded database acceptance — open:** run the existing CS2 migration, CS3 quota/removal, CS4 send/removal and CS6A cleanup PostgreSQL acceptance suites against their approved disposable targets. Confirm race outcomes, retained message references and no row/file deletion on failure.
5. **Storage operations — open, tracked separately:** establish durable capacity and monitoring; exercise database-plus-file backup/restore; and define writer/reconciler coordination before proposing any orphan/temp deletion. Keep inventory dry-run-only until those checks are accepted.
6. **Cross-cutting security acceptance — unconfirmed:** locate the S1 report and confirm fail-closed WebSocket behavior; no CS6B source change or evidence currently closes this item.

No CS6C, redesign, new feature, implementation beyond this bounded existing work, staging, commit, push, cleanup apply, owner-service restart or deployment was performed.
