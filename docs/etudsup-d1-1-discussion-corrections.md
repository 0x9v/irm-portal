# D1.1 — Discussion reactions, ownership and appearance corrections

## Findings and corrections

The four D1.1 screenshots were not available in this turn. The accessible clipboard files were older Announcements/Modules/Home references, so this report makes no visual comparison to the reported Discussion captures. The causes below were identified from the actual frontend and current backend contract; browser reproduction remains open.

| Reported defect | Source finding | Frontend correction |
| --- | --- | --- |
| Short-message reactions disappear or clip | D1 constrained the reaction row to a percentage width and nested its absolutely positioned picker in the scrollable history. A short bubble provided a poor sizing boundary, while the history's overflow could cut off the picker. | A message group now sizes its bubble and footer independently. Reaction chips and the 44px picker trigger wrap without shrinking to the text width. The picker renders in a viewport-bounded portal, follows the triggering edge, focuses its first choice for keyboard use, and closes on Escape, focus leaving, outside pointer interaction, scroll or resize. Existing counts, selection, requests and authorization are unchanged. These are source-level causes and fixes, pending actual computed-style/browser inspection. |
| System appearance cannot be deselected | `SystemAppearanceAction` always called `setPreference("system")`; the store intentionally ignores an unchanged preference. | Pressing the active control now stores explicit Light or Dark equal to the currently resolved appearance. Pressing it while inactive stores System. `aria-pressed` and the selected indicator still derive from the actual preference. The existing sun/moon button still stores the opposite resolved appearance explicitly. No theme store, key, bootstrap, OS listener, cross-tab logic or chevron changed. |
| Own messages move left after navigation/reload | Current backend `DiscussionMessageResponse` has `author_username` but **no `author_id`**. History, POST responses and `message_created` WebSocket events all omit author UUID. D1's local set of confirmed message IDs only lasted for that page/account session. | Removed session-only ownership classification. Messages are marked own only when an authoritative `author_id` equals `AuthContext.user.id`; otherwise they remain unclassified at the start edge. This avoids username guesses and false ownership, including during initial auth loading. It does **not** make current historical own messages right-aligned; that requires the existing backend contract to expose author UUID in all three response/event shapes in a separately authorized backend task. The optional frontend `author_id` field is already the integration point. No backend contract was edited here. |
| Emoji/stickers too small | Ordinary text and emoji-only text both used `.9rem`; reaction glyphs inherited the small button font; supported built-in sticker SVGs were requested at 96px. | Short emoji-only grapheme runs use larger text; emoji inside normal sentences retain normal text sizing. Reaction glyphs and picker glyphs are larger while their 44px controls remain compact. Built-in sticker SVGs now render at a bounded 144px and keep aspect ratio. |

The message group still keeps the timestamp, reaction controls and Delegate action together with the bubble. The picker is portaled solely to prevent scroll-container clipping; it remains visually anchored and keeps the trigger's focus/dismissal behavior. Other Discussion history, composer, WebSocket, moderation and removal semantics remain intact.

The current composer does not insert an optimistic message row. It retains a pending submission/retry record and merges the confirmed POST response; that response also lacks author UUID today. Realtime events and history use the same missing-identifier shape, so there is no alternate frontend field to normalize into ownership.

## Actual emoji and sticker capability

Reactions and emoji-only text use Unicode emoji rendered by the user's operating system/browser. The repository has no approved Apple-style emoji asset set. The six supported built-in **stickers** are inline SVG illustrations in `StickerAsset.tsx`, selected by IDs from the backend's fixed sticker catalog; they are distinct from Unicode emoji messages. On an iPhone, Unicode emoji normally use the platform's rendering, but CSS cannot guarantee identical iPhone artwork across Linux, Android and other systems. No Apple artwork was downloaded, copied, embedded or requested remotely. Exact cross-platform iPhone appearance needs an approved, appropriately licensed asset source before implementation.

Custom sticker upload was **inspected only**. A future feature needs a private per-user library; authenticated upload and safe image decoding/conversion with strict file type, dimensions and byte limits; canonical image storage; a durable sticker-message representation; conversation access and library ownership checks; supported send/history/WebSocket payloads; a defined rule for library deletion while already-sent messages remain readable; and a picker/upload flow. None of these were implemented. No attachment placeholder, local-only persistence or image-in-text encoding was added.

## Changed files

- `frontend/src/app/communities/irm/discussion/page.tsx` — removes ephemeral own-message ID state; compares only authoritative message author UUID with authenticated user UUID.
- `frontend/src/components/discussion/Discussion.module.css` — independently sized footer, larger bounded glyph/sticker presentation and viewport picker surface.
- `frontend/src/components/discussion/DiscussionMessageItem.tsx` — grouped bubble/footer, emoji-only classification, 144px built-in sticker size.
- `frontend/src/components/discussion/ReactionPicker.tsx` — portal positioning and viewport-safe dismissal/focus behavior.
- `frontend/src/components/navigation/ThemeSelector.tsx` — reversible System action.
- `frontend/tests/moderation.test.mjs` — UUID-only ownership and emoji/sticker classification regressions.
- `frontend/tests/theme.test.mjs` — reversible System and sun/moon interaction regression.
- `frontend/e2e/discussion-redesign.spec.ts` — mocked short/long/emoji/sticker layout, picker bounds, focus and ownership navigation/reload/older/live scenarios.
- `frontend/e2e/u2-mobile-header-theme.spec.ts` — System toggle-off, explicit-mode OS stability and selected-state checks for account/guest paths.
- `frontend/playwright.d1.config.ts` — includes the existing U2 theme browser suite alongside Discussion suites without starting backend or owner services.
- `docs/etudsup-d1-1-discussion-corrections.md` — this report.

The extensive pre-existing dirty/untracked work was preserved. No backend, database, migration, dependency, environment, deployment, reference-worktree, global theme token or unrelated page source was changed. Nothing was staged, committed, pushed or deployed.

## Verification and gaps

| Check | Actual result |
| --- | --- |
| `npm run lint` | Passed. |
| `npx tsc --noEmit` | Passed. |
| `node tests/moderation.test.mjs` | 72 checks passed, including UUID ownership and emoji/sticker classification. |
| `node tests/theme.test.mjs` | 13 checks passed, including reversible System interaction. |
| `node --test --test-reporter=tap tests/*.test.mjs` | All 10 Node test files passed. |
| `npx playwright test --config=playwright.d1.config.ts --list` | 81 mocked cases discovered across four suites. This is discovery, **not browser execution**. |
| `npm run build` | Blocked again during normal Turbopack compilation: `creating new process` → `binding to a port` → `Operation not permitted (os error 1)`. The panic reports processing of the existing `SiteFooter.module.css` while writing `/page`. This is the same environment restriction seen in D1, not a successful production build. |
| Scoped whitespace | `git diff --check` passed; a direct trailing-whitespace scan of all 11 D1.1 paths found none (most paths are pre-existing untracked files, so `git diff` alone would not cover them). |
| Browser and screenshots | The browser-surface inventory returned no apps/browsers. The earlier D1 Chromium probe failed at launch with sandbox-host `Operation not permitted`; it was not retried repeatedly. No D1.1 browser checks or screenshots executed here. |

The prepared browser cases cover one-character, short-word, emoji-only, multiline and long content for both sides at 320px/390px in light/dark; picker bounds, 44px targets, focus, overflow, 144px sticker geometry, UUID-backed history/older/live navigation and reload; and System toggling with OS changes. They cannot certify actual layout until executed. The ownership cases with `author_id` explicitly model the missing future server field; the current backend cannot pass the historical-own requirement. The frontend also has a check showing that a send response without `author_id` stays unclassified.

Owner-side commands in fish, after running in an environment that permits build/browser processes:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node tests/moderation.test.mjs
node tests/theme.test.mjs
node --test --test-reporter=tap tests/*.test.mjs
npm run build
npm run start
```

In another terminal, with the frontend on port 3000:

```fish
cd /home/yasso/irm-platform/frontend
npx playwright test --config=playwright.d1.config.ts
```

Inspect the 390px light/dark captures generated under `frontend/test-results/d1-1/`, then check 320px, short viewport height, keyboard, pointer and touch behavior in a real browser. The D1 screenshot suite also writes its existing mobile/desktop captures. Confirm the portal neither overlaps the mobile bottom bar nor clips at the first and last messages. A separate backend task must add author UUID to Discussion history, POST and WebSocket representations before the own-message alignment acceptance can be completed.
