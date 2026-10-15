# ETUDSUP D1.3 — Frontend author UUID integration and alignment acceptance

## Result

The frontend now models `DiscussionMessage.author_id` as a required string for the supported contract and compares it directly with the authenticated user UUID: `message.author_id === user.id`. History, POST confirmations and retries, and `message_created` payloads all pass through the same runtime normalizer. A missing or malformed UUID becomes an empty sentinel and remains unclassified; the frontend never infers ownership from `author_username` and malformed payloads do not crash the conversation.

The existing bubble renderer maps `isOwn` to right alignment and other messages to left alignment. No page redesign was made. The bubble/footer sizing, reaction portal, emoji/sticker sizes, reversible System appearance, contextual moderation, drafts/retries, scroll anchoring, and removed-message guards were preserved.

## Changed files

- `frontend/src/types/discussion.ts` — made `author_id: string` required in the supported message type.
- `frontend/src/lib/discussion.ts` — added shared message and message-list normalization. Only UUID-shaped author identifiers are retained; missing/invalid identifiers become an unclassified empty string.
- `frontend/src/app/communities/irm/discussion/page.tsx` — normalizes initial and older history, REST creation/retry responses, and WebSocket creation events before merging. Uses direct UUID equality for alignment. Tags in-memory history and retry state with the current user ID, hides stale state during account transitions, and clears message, retry, reaction, pagination, unread, and history-error state when account/access changes.
- `frontend/e2e/discussion.spec.ts` — added UUID author values to mocked history, send, retry and event records, with a mix of current and other authors.
- `frontend/e2e/discussion-redesign.spec.ts` — added ownership regressions for two authors, history pagination, module navigation/back, reload, username changes, live event and REST response deduplication, same-ID retry, malformed author IDs, account switch/logout, and existing 320/390/1440px rendering cases. Missing/invalid author cases deliberately use incomplete payloads to exercise runtime handling.
- `frontend/tests/moderation.test.mjs` — covers actual page normalization of missing/invalid author IDs and ownership based on UUID rather than username.
- `docs/etudsup-d1-3-author-alignment-frontend.md` — this handoff and acceptance report.

The U6 files present in the initial worktree were left untouched. No backend, migration, dependency, environment, deployment, or reference-worktree files were changed. No localStorage/sessionStorage ownership cache was added.

## Account and message behavior

- Initial, refreshed, and older history items are normalized before entering the message list; each retains the backend `author_id` when it is a UUID.
- A successful send or idempotent retry is normalized before merge. The existing message ID deduplication also handles the event arriving before the response, so the UI retains one row.
- Incoming `message_created` events are normalized before merge and use the same `author_id` meaning as history and POST responses.
- Unknown author IDs keep the message visible but unclassified at the other-message edge. Username equality does not affect alignment.
- A user ID change gates old history from rendering immediately, then aborts old scoped requests and clears old conversation/retry state. In-flight old requests remain guarded by the existing async scope and socket checks. Username changes with the same UUID leave ownership stable.
- On logout or access loss, existing protected state is cleared; retry text is rendered only for the account that owns that pending submission.

## Verification results

- `npm run lint` — **passed**.
- `npx tsc --noEmit` — **passed**.
- `node tests/moderation.test.mjs` — **73 passed**, 0 failed.
- `node --test --test-reporter=tap tests/*.test.mjs` — **12 test files passed**, 0 failed.
- `npx playwright test --config=playwright.d1.config.ts --list e2e/discussion-redesign.spec.ts` — discovered **18 tests**. Discovery is not execution.
- Focused Playwright execution of four ownership/navigation/retry/defensive/account tests — **blocked before test bodies**: Chromium exited during launch with `sandbox_host_linux.cc:41: Check failed: . shutdown: Operation not permitted`. No browser assertions or screenshots ran.
- `npm run build` — **blocked by the environment** during Turbopack compilation: `creating new process` / `binding to a port` / `Operation not permitted (os error 1)`, while processing the existing `SiteFooter.module.css`. The prebuild copy ran; the destination PDF worker matched its source before that command.
- Direct trailing-whitespace scan over the six changed frontend source/test files — **0 issues**.

No live two-account backend workflow was run. Chromium could not launch here, and no isolated two-account backend environment was available for this turn. No owner or production accounts/data were seeded, changed, or used. Rendered mobile/desktop alignment and live account transitions therefore remain unaccepted despite the implemented integration and prepared browser regressions.

## Owner acceptance checklist

Use two existing isolated active test accounts in the approved local IRM test community; do not use owner or production accounts. Record each account UUID from `/api/v1/auth/me` and compare it with the author UUID in history, the send response, and the `message_created` event.

1. Sign in as account A, send a text message and a built-in sticker. Confirm both are right-aligned and their author UUID matches A.
2. Have account B send a text and sticker. Confirm they appear left-aligned for A; account A's own history remains right-aligned.
3. Load older history and confirm ownership follows each message UUID.
4. Navigate to Modules and back, then reload Discussion. Confirm the same alignment persists from the server history.
5. Retry a failed submission with its original `client_message_id`. Confirm the replay returns the same message/author UUID and no duplicate row appears when the live event also arrives.
6. Change account A's username using the normal profile flow. Refresh Discussion and confirm the message UUID and alignment remain unchanged.
7. Switch to B and separately log out. Confirm A's cached history and retry text are never displayed during the transition or after logout.
8. Repeat at 320px, 390px, and desktop width. Confirm own messages remain at the right edge and other messages at the left while reaction controls and the composer stay usable.

Fish-compatible checks from `frontend/`:

```fish
npm run lint
npx tsc --noEmit
node tests/moderation.test.mjs
node --test --test-reporter=tap tests/*.test.mjs
npx playwright test --config=playwright.d1.config.ts e2e/discussion-redesign.spec.ts --grep 'UUID ownership survives|confirmed send and live event|missing and invalid author UUIDs|account switch hides cached history'
npm run build
```

Run Playwright only where Chromium can launch and the frontend is reachable. The mocked suite does not require a live backend. A two-account live run requires the approved isolated backend accounts described above; the test task does not create them automatically.
