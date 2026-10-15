# ETUDSUP D2 — WhatsApp-style Discussion rework

## Implemented

The existing single IRM community conversation now uses a compact conversation frame rather than the large feature-page container. Mobile fills the space below the application header, reserves the measured bottom-navigation space, hides that navigation while the composer is focused, and keeps message history as the scrollable region. The broad desktop conversation uses the available workspace width with a compact header and composer attached to its history.

Messages align using only `author_id === authenticated user.id`. Invalid or missing UUIDs remain unclassified. Incoming/outgoing surfaces, compact widths, readable multiline text, date separators, five-minute same-author grouping, lower-edge timestamps, larger emoji-only messages and 160px sticker artwork are styled in the conversation. Reactions remain per-message, use 44px controls and expose the picker on hover, keyboard focus and touch. Picker placement accounts for its measured row geometry and remains bounded by the viewport. Delegate actions stay in their existing contextual disclosure.

The composer is a compact rounded multiline surface with integrated sticker-library entry and a send button. Enter inserts a newline; Ctrl+Enter or Cmd+Enter sends, with IME composition guarded. Retry remains a compact attached notice. Existing synchronous single-flight behavior and original text/sticker retry identifiers are preserved. Access gates, history cursors, scroll anchoring, near-bottom following, unread affordance, removal ledger, account scoping, private sticker loading and S1 WebSocket behavior remain on their existing code paths.

## Changed files

- `docs/etudsup-d2-whatsapp-discussion-rework.md`
- `frontend/src/app/communities/irm/discussion/page.tsx`
- `frontend/src/components/discussion/Discussion.module.css`
- `frontend/src/components/discussion/DiscussionMessageItem.tsx`
- `frontend/src/components/discussion/DiscussionComposer.tsx`
- `frontend/src/components/discussion/ReactionPicker.tsx`
- `frontend/e2e/discussion-redesign.spec.ts`
- `frontend/e2e/discussion.spec.ts`
- `frontend/e2e/discussion-stickers.spec.ts`
- `frontend/e2e/delegate-moderation.spec.ts` (shared fail-closed browser fixture import)
- `frontend/playwright.d1.config.ts`
- `frontend/tests/discussion-composer.test.mjs`
- `frontend/tests/moderation.test.mjs` (Node fixture only)

No backend, migration, dependency, global theme, post-reply or module files were changed for D2.

## Verification

- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `node tests/discussion-composer.test.mjs` — passed (retry single-flight and busy state).
- `node tests/moderation.test.mjs` — passed, 75/75. The Node VM now receives Node's Web Crypto implementation; the PR4.1 post-reply fixture now returns a valid UUID and post ID and waits for the asynchronous submit. Production UUID generation was unchanged. No PR4.1 agent was visible in this conversation's agent roster, so direct agent coordination remains outstanding.
- `IRM_D2_FRONTEND_URL=http://127.0.0.1:3170 ./node_modules/.bin/playwright test --config=playwright.d1.config.ts --list` — collected 89 cases in exactly four files. This was collection only. The selected specs inherit context-level fail-closed API and WebSocket routes, then install explicit per-test mocks. The config starts no server.
- Browser execution and screenshots remain outstanding: `http://127.0.0.1:3170` refused a connection in this environment. No rendered visual comparison is claimed.
- `npm run build` — passed as one normal production build after confirming no other build or lock was present. Its prebuild hook restored `frontend/public/pdf.worker.min.mjs`; the 1,375,838-byte generated file matches `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` by SHA-256 and remains present and untracked. It was not deleted.

## Focused owner browser review

With an existing frontend running at `http://127.0.0.1:3170`, run from `frontend/`:

```sh
IRM_D2_FRONTEND_URL=http://127.0.0.1:3170 npx playwright test --config=playwright.d1.config.ts
```

This focused config selects only the D2 conversation, sticker, and delegate moderation specs. Their shared fixture aborts unmatched `/api/**` requests and intercepts all WebSockets before test-specific mocks. Review any screenshots produced by the tests and the 320/390/768/1440px, short-height, sticker picker, and reduced-motion assertions.

## Remaining finite review

1. Run the focused Playwright command against the owner's existing frontend and inspect its browser results at 320, 390, 768 and 1440px in both themes, including the short-height case.
2. Share the completed PR4.1 Node fixture correction with that agent when a contact channel is available; no PR4.1 agent was exposed in this conversation.
