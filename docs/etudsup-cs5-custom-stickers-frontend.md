# ETUDSUP CS5 — Custom sticker frontend

## Result

The existing Discussion sticker entry point now offers **Built-in** and **My stickers**. The private tab calls the CS3 owner-library routes, supports cursor paging and management, and uploads one PNG/JPEG without sending it. Selecting a library tile sends one `CUSTOM_STICKER` message using the CS4 contract. Custom images are fetched with the authenticated session from either the owner-only preview route or the community-scoped message route, according to where they appear.

Discussion ownership still compares `message.author_id === user.id`. Text and built-in stickers retain their current message and selection behavior. The library also remains manageable for an authenticated account whose community membership is not active: the access guidance view exposes the same private-library picker in management-only mode, with sending disabled.

The worktree was already broadly dirty with account, avatar, U6, Discussion and other concurrent changes. Those changes were preserved. No backend, migration, database, dependency, environment, deployment or reference-worktree changes were made.

## Exact changed files

- `frontend/src/types/discussion.ts` — adds `CUSTOM_STICKER`, required nullable `custom_sticker_id`, private library item/page types, and custom identity to pending submissions.
- `frontend/src/lib/discussion.ts` — normalizes `CUSTOM_STICKER` and validates its optional custom asset UUID without changing author ownership fallback behavior.
- `frontend/src/app/communities/irm/discussion/page.tsx` — sends the exact custom JSON shape, retains asset UUID and client message UUID for retry, preserves event/POST ID deduplication, passes the authenticated account to media rendering, and exposes library-only mode to authenticated non-members.
- `frontend/src/components/discussion/DiscussionComposer.tsx` — extends the current picker with private library listing, paging, upload/preview/cancel, quota and uncertain-outcome feedback, and confirmed library removal.
- `frontend/src/components/discussion/DiscussionMessageItem.tsx` — renders custom message media using the community and message-scoped URL.
- `frontend/src/components/discussion/AuthenticatedStickerImage.tsx` — new credentialed WebP loader with API-base resolution, abort handling, local object URL cleanup, fixed square geometry and a compact unavailable state.
- `frontend/e2e/discussion-stickers.spec.ts` — adds six mocked browser scenarios for upload/send, quota, retry, uncertain upload, retained message media after library removal, and non-member library access.
- `frontend/playwright.d1.config.ts` — includes the custom sticker browser spec in the focused Discussion regression selection.
- `docs/etudsup-cs5-custom-stickers-frontend.md` — this report.

## Picker, upload, removal and send

The picker remains a single **Sticker** entry point. It opens without sending. Built-in stickers retain their existing one-click send behavior. In **My stickers**, selecting a tile sends that item; a separate adjacent Remove control prevents nested buttons and accidental sends. The picker has library loading, empty, retry, load-more and error states.

Upload accepts PNG/JPEG up to 2,097,152 bytes, shows a local object URL preview, and presents explicit Upload and Cancel actions. The explanation says PNG transparency is preserved, the full image is fitted into a sticker, and background removal is not included. `FormData` contains only a `file` part; `fetchApi` supplies credentials and leaves multipart boundary and Origin headers to the browser. A confirmed 201 clears the file and preview, then refreshes the list; it never sends automatically. A quota response with `detail.code === "sticker_quota_exceeded"` advises removing an available library item and clarifies that sent messages keep their sticker. For a network or unexpected-status outcome, upload is not replayed automatically; the retained preview offers a library refresh/check first.

Removal uses the shared accessible confirmation dialog and sends an empty DELETE body. On confirmed 204 the item is removed from picker state, while existing message components remain. A pending custom send retains the original asset UUID and `client_message_id`; retry does not consult current library contents, so it can replay after library removal. No separate local/session storage cache was introduced.

Unauthenticated users keep the existing access gate. An authenticated user without active membership receives a management-only picker on that gate: library GET/POST/DELETE remain available, while Discussion send controls and history remain unavailable. An account-keyed composer remount, request aborts and per-request current checks prevent a prior account's library/cursor/preview from being reused after an account transition. A cursor error's Retry reloads from the first page rather than reusing the failing cursor.

## Message and image contract

New custom sends contain exactly:

```json
{
  "client_message_id": "70000000-0000-4000-8000-000000000001",
  "kind": "CUSTOM_STICKER",
  "custom_sticker_id": "80000000-0000-4000-8000-000000000001"
}
```

No text, built-in sticker ID, author UUID, preview URL or storage key is sent. TEXT and built-in STICKER keep their previous payload shapes. History, REST creation/retry and WebSocket payloads normalize through the same runtime message parser; REST/event deduplication remains keyed on message UUID. The existing author UUID comparison remains unchanged.

Library tile images use the returned owner-only `preview_url`. Conversation messages construct `/api/v1/communities/irm/discussion/messages/{message_id}/sticker`; they never use the owner's preview route. Both paths are resolved against `API_URL`, checked to stay on its origin, fetched with `credentials: "include"`, and displayed from a local blob URL without Next's image optimizer. Geometry is reserved in a 144px square with `object-fit: contain`, retaining alpha and aspect ratio. The image fetch aborts on path/account/message unmount or change, and its blob URL is revoked on cleanup. Removed messages unmount their media/reaction/moderation controls through the existing removal ledger; late fetch results are ignored.

The frontend cannot revoke bytes already delivered to an authorized browser. Backend visibility checks and removal concealment remain authoritative as documented in CS4.

## Verification

Commands run in `frontend/`:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed. |
| `npm run lint` | Passed with no warnings/errors in the final run. |
| `node --test tests/moderation.test.mjs tests/account-controls.test.mjs` | Passed: 2 test files, 2 passed, 0 failed. |
| `npx playwright test --config=playwright.d1.config.ts --list --grep 'sticker\|custom sticker'` | Discovery only: 9 tests across 2 files, including all 6 new custom sticker scenarios. No browser assertions executed by listing. |
| `npx playwright test --config=playwright.d1.config.ts --grep 'private stickers upload' --max-failures=1 --timeout=8000` | Blocked before test code/assertions: Chromium launch failed at `sandbox_host_linux.cc:41`, `shutdown: Operation not permitted (1)`. One scenario was selected; zero assertions ran. No screenshots were produced. |
| `npm run build` | Failed in Next 16.3.6 Turbopack while processing the existing `SiteFooter.module.css`: worker creation attempted to bind a port and received `Operation not permitted (os error 1)`. This is not a completed production build. Panic log: `/tmp/next-panic-470f7a53dca529638118bb0c49c0ef62.log`. Its existing `prebuild` hook copied `public/pdf.worker.min.mjs`; `frontend/public/` was already an untracked concurrent tree before this task, so it was preserved. |
| Scoped trailing-whitespace scan | Passed with no trailing whitespace in the listed changed files. |

The browser attempt also confirmed a Next dev process already holds the local `.next` development lock for port 3000. A local dev start on 3100 refused because of that existing process. It was not stopped or restarted. No rendered 320px/390px/1440px checks, light/dark screenshots, real image decode checks or live two-account workflow ran. The six mocked scenarios are added but remain unexecuted in this environment.

## Remaining acceptance gates

- Run the six new Playwright cases plus the focused Discussion/redesign/moderation suites on a machine where Chromium can launch; inspect 390px and 1440px light/dark captures and 320px overflow/touch-target behavior.
- Run a live two-account workflow against the updated CS3/CS4 backend to verify owner previews, authorized message media, send/retry/event merge and permission loss.
- CS6 still owns lifecycle/orphan cleanup, storage/database failure races, guarded PostgreSQL race acceptance and end-to-end lifecycle acceptance. CS4's guarded PostgreSQL target was blocked before identity verification with zero assertions; this frontend work does not change that.
- Prior reports still record unresolved live/browser and guarded PostgreSQL/storage deployment gates for profile/password/avatar and earlier Discussion author alignment. CS4 reports S1 as unlocated/unconfirmed; no S1 completion is claimed here. Production sticker/avatar persistence and backup behavior remain deployment acceptance items.

No files were staged, committed, pushed, deployed or used to restart owner services.
