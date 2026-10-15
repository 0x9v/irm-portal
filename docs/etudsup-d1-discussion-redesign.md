# D1 — Discussion interface and integrated moderation

## Scope and composition

The Discussion screenshots described in the request were not attached to this turn, so no before/after image comparison was possible. The pre-edit source rendered a large introductory header, green pulsing **Live** badge, full-width message cards, and a separate red **Remove message** button. Discussion now uses a compact IRM conversation header, a chronological scroll region with bounded message bubbles, a restrained composer, and an action disclosure inside each message. Incoming messages begin at the start edge; messages with a reliable current-user identity end at the opposite edge. Real timestamps, multiline content, existing stickers and reaction counts remain. Normal connection does not occupy visible header space; connecting, reconnecting and offline states still have accessible status text, and the existing refresh/retry action remains.

The page remains in the application shell. Its sidebar, U2 mobile header, bottom navigation, guest/access gates and F9 no-footer exception are unchanged. On mobile the conversation height accounts for the bottom navigation and dynamic viewport; focusing the textarea still invokes the existing shell rule that hides bottom navigation. The four desktop dashboard columns/sections and every other page are untouched.

## Ownership contract limitation

The current backend `DiscussionMessageResponse`, history items, send response and `message_created` WebSocket event expose `author_username`, but **do not expose `author_id`**. The frontend cannot identify historical own messages from a username without violating the UUID requirement. D1 therefore aligns a message as own only if it carries an `author_id` equal to the authenticated user's UUID, or if its ID came from a confirmed submission in this account session. All other history remains at the incoming edge, including same-name messages. The local ID set is cleared on account/access changes. No backend or profile contract was changed. When the server adds `author_id` to its existing message representations, the optional `DiscussionMessage.author_id` field and `isOwn` selection in `page.tsx` are the integration point; historical messages will then align correctly without a frontend redesign. This is an outstanding product/API gap, not a claim that every historic message is identified today.

## Message actions, composer and state

The shared `ModerationAction` retains its existing Delegate-only authority check, exact DELETE route, native confirmation dialog, pending lock, uncertain-result check, 401/403 refresh, and removal reconciliation. Discussion opts into its new `message-menu` presentation: a neutral 44px ⋯ button named for the message opens an anchored **Remove message** choice in semantic danger text. The disclosure closes with Escape (returning focus), outside pointer interaction, or selection; it does not shift the bubble. The existing dialog owns confirmation focus, containment and return. Other Posts/Announcements moderation controls keep their prior presentation. The same disclosure pattern can later be applied there without changing the current workflows.

Reactions remain directly under their parent bubble, with real counts, selected state, existing API calls and removed-message guards. The picker now chooses its vertical side using available viewport space and aligns inward for own messages. It retains Escape/outside dismissal and the same reaction set.

The existing sticker chooser remains because it is supported today; no image/audio attachment or recording was added. The textarea is a neutral rounded field with a compact Send control and visible focus. **Enter inserts a newline; Ctrl/Cmd+Enter sends; Shift+Enter also inserts a newline.** IME composition and key code 229 do not trigger the shortcut. Existing character limit, submission lock, idempotent retry ID, failure card, draft retention after failure, and account-scoped stale-result checks remain. Future media support belongs in the existing composer component, but no media feature was implemented.

The prior WebSocket lifecycle, exponential reconnect, history cursors, loading older while preserving the visible offset, new-message affordance, removal ledger, reaction races, and account/community guards were not rewritten. Incoming and confirmed local messages scroll automatically only while the reader is near the bottom. Removing a message above the visible reading position uses the existing scroll-height anchor to retain that position. The history log uses `aria-live="off"` so initial history does not get announced wholesale; connection status and actionable failures remain separate. Reduced motion disables visual transitions and smooth programmatic scrolling.

## Changed files

- `frontend/src/app/communities/irm/discussion/page.tsx` — compact conversation composition, honest status, ownership selection, local-send tracking, reduced-motion scroll.
- `frontend/src/components/discussion/Discussion.module.css` — scoped EtudSup conversation geometry, bubbles, disclosures and composer surfaces.
- `frontend/src/components/discussion/DiscussionMessageItem.tsx` — author/time/body bubble, own/incoming semantics and integrated reaction row.
- `frontend/src/components/discussion/DiscussionComposer.tsx` — compact field and accessible shortcut guidance; IME guard.
- `frontend/src/components/discussion/ReactionPicker.tsx` — viewport-aware picker direction and edge alignment.
- `frontend/src/components/moderation/ModerationAction.tsx` — opt-in Discussion overflow disclosure, leaving other moderation actions unchanged.
- `frontend/src/types/discussion.ts` — optional author UUID for future compatible responses.
- `frontend/e2e/discussion.spec.ts` — updates existing expectations for the compact heading/accessible connection state.
- `frontend/e2e/delegate-moderation.spec.ts` — opens the Discussion disclosure before existing confirmation assertions.
- `frontend/e2e/discussion-redesign.spec.ts` — mocked browser cases for ownership, no Live badge, Delegate action keyboard flow, multiline/IME/send, mobile/desktop clearance and light/dark captures.
- `frontend/playwright.d1.config.ts` — no-backend, no-webServer config for the three mocked browser suites.
- `frontend/tests/moderation.test.mjs` — rendered message semantics, permission-aware disclosure and confirmed-local ownership checks.
- `docs/etudsup-d1-discussion-redesign.md` — this report.

No backend, environment, dependency, deployment, dashboard, shell, footer, PDF or other content-page source was edited for D1. No files were staged, committed or pushed.

## Verification and remaining acceptance

| Command/check | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed. |
| `node tests/moderation.test.mjs` | 70 checks passed, including 3 D1 checks and existing removal/send/reaction race guards. |
| `node --test --test-reporter=tap tests/*.test.mjs` | All 10 Node test files passed. |
| `npx playwright test --config=playwright.d1.config.ts --list` | Discovered 70 mocked browser cases in 3 files; **discovery only**. |
| `npm run build` | Failed during Turbopack CSS processing: `creating new process` → `binding to a port` → `Operation not permitted (os error 1)`. The reported asset was the existing `SiteFooter.module.css`; this is the same sandbox process restriction observed in U1–U3, not a completed build. |
| Playwright Chromium launch probe | Failed before navigation: Chromium sandbox host `Operation not permitted (1)`, exit SIGTRAP. No browser test or screenshot ran. |
| Scoped whitespace inspection | No trailing whitespace found in new files; scoped `git diff --check` had no findings for tracked paths. These D1 paths were already untracked in this checkout, so the check cannot substitute for source review. |

There are **no D1 screenshots** and no rendered visual acceptance. In particular, 320/390px keyboard clearance, anchored popover clipping, real focus behavior and both-theme contrast require owner-side browser inspection. The current mocked suite checks 320/390px overflow and bottom-bar clearance and writes `frontend/test-results/d1/discussion-{light,dark}-{390,1440}.png` when it actually executes. Inspect 320px and short-height behavior manually as well. Compare the actual rendered EtudSup account/dashboard shell and conversation in both themes, including disconnected/retrying state.

Fish-compatible owner commands, in a shell where process/port creation is permitted:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node tests/moderation.test.mjs
node --test --test-reporter=tap tests/*.test.mjs
npm run build
npm run start
```

Then in a second terminal (the D1 config mocks API/WebSocket responses and does not start or stop owner services):

```fish
cd /home/yasso/irm-platform/frontend
npx playwright test --config=playwright.d1.config.ts
```

Inspect the four generated screenshots and repeat at 320px/short viewport with the browser's keyboard emulation or a mobile device. The mocked suites cover initial history, pagination, reconnection, reaction and removal races in addition to the D1 presentation checks, but passing them would still not replace comparison against the missing request screenshots.
