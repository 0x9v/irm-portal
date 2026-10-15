# EtudSup U6 — loading, feedback, empty states and confirmations

## Scope and inventory

Inspected the dirty worktree before editing and preserved concurrent backend, avatar and Discussion work. Read U1–U5 and the D1, D1.1 and D1.2 Discussion reports. Inspected Home, Announcements/replies, Modules/document lists, Saved/Recent/My Submissions/Pending, Posts/replies, membership/Delegate management, account forms, Support, the shared feedback/button/dialog components, and Discussion and DocumentReader read-only before editing. The installed Next.js CSS guide had already been read in this conversation.

| State | Existing owner and U6 consolidation |
| --- | --- |
| Initial content loading | Home panels, announcement feed, module chooser/results and personal document lists used plain loading text. `ContentLoading` now supplies matching quiet skeleton geometry with one accessible status and hidden decoration. Account and membership verification remain neutral text/gates. |
| Background refresh | Home already tracked result account ownership. Same-account announcements/modules now remain visible with a small refresh status; account or access changes still clear/hide protected data. Posts retain their existing manual-refresh rows and now show a section error alongside them. |
| Empty results | `ContentEmpty` gives the main lists and Delegate queues one fine-border surface, compact icon, heading, explanation and one useful permitted action where applicable. Ordinary empty and filtered empty remain distinct. |
| Request errors/retry | Existing `FeedbackMessage` remains the inline semantic primitive. Read errors in the edited lists, detail surroundings, replies and management views now use concise safe copy. Existing retry callbacks, filters and draft state remain. Access expiration, denial, missing content and invalid cursors retain their existing dedicated branches. |
| Success/field feedback | Existing inline success feedback and U1 buttons remain. Voting threshold validation now uses `aria-invalid` and `aria-describedby` with a field error, separate from operation feedback. Registration and membership field associations were inspected and left intact. |
| Operation pending/uncertainty | Announcement publishing uses `PendingLabel` and `aria-busy`. Ambiguous announcement, post/reply, voting, saved-state and management outcomes do not claim a definite failure; read-only check/refresh paths are offered before another mutation. |
| Confirmations | The existing native `ConfirmationDialog` remains the single shared confirmation control. Its spacing, heading and mobile button widths are compacted; focus, Escape, pending lock, focus return and confirmation handlers are unchanged. |

Discussion's bubbles, ownership classification, reaction portal, composer, connection status, scroll anchoring and moderation integration were not edited. DocumentReader's PDF.js lifecycle, paper, zoom, selection, page controls, reading records and downloads were not edited. Only the surrounding document-detail error copy changed.

## Exact U6 changed-file inventory

| File | U6 change |
| --- | --- |
| `frontend/src/components/ContentState.tsx` | Shared presentation-only loading and empty states. |
| `frontend/src/components/ContentState.module.css` | Token-based skeleton/card geometry, wrapping and compact empty icon without animation. |
| `frontend/src/components/moderation/ConfirmationDialog.tsx` | Compact dialog typography/width and full-width mobile controls. |
| `frontend/src/components/SavedDocumentButton.tsx` | Ambiguous Save/Unsave response offers a status GET before another mutation. |
| `frontend/src/components/modules/ModuleBrowserFrame.tsx` | Module-choice skeleton, empty state and safe inline failure copy. |
| `frontend/src/app/page.tsx` | Dashboard panel skeletons/empty states, owner-safe same-account refresh retention and safe failure copy. |
| `frontend/src/app/communities/irm/announcements/page.tsx` | Announcement skeleton/empty state, safe read errors, uncertain publish check and pending button label. |
| `frontend/src/app/communities/irm/announcements/[announcementId]/page.tsx` | Safe surrounding detail/access failure copy. |
| `frontend/src/components/AnnouncementReplies.tsx` | Safe read/validation failures while retaining established uncertain-submit reconciliation. |
| `frontend/src/app/communities/irm/modules/[moduleSlug]/page.tsx` | Document-row loading/empty states and safe read failure copy. |
| `frontend/src/app/communities/irm/modules/[moduleSlug]/documents/[documentId]/page.tsx` | Safe surrounding detail/download error copy; reader untouched. |
| `frontend/src/app/communities/irm/documents/saved/page.tsx` | Loading/empty states, safe read errors and read-only check after uncertain removal. |
| `frontend/src/app/communities/irm/documents/recent/page.tsx` | Loading/empty states and safe read errors. |
| `frontend/src/app/communities/irm/documents/mine/page.tsx` | Loading, ordinary/filtered empty states and safe read errors. |
| `frontend/src/app/communities/irm/documents/pending/page.tsx` | Loading/empty states and safe preview/vote/read failure copy; preview/voting gates unchanged. |
| `frontend/src/app/communities/irm/posts/page.tsx` | Unified feed empty states, safe read errors and retained rows after failed manual refresh. |
| `frontend/src/app/communities/irm/posts/new/page.tsx` | Safe module/validation errors and uncertain creation guidance. |
| `frontend/src/app/communities/irm/posts/[postId]/page.tsx` | Safe surrounding detail/access failure copy. |
| `frontend/src/components/CommunityPostReplies.tsx` | Safe read/validation failures and uncertain unknown-submit guidance. |
| `frontend/src/app/communities/irm/membership/review/page.tsx` | Consistent empty queue and safe Delegate verification copy. |
| `frontend/src/app/communities/irm/membership/staff/page.tsx` | Consistent roster empty state and safe/uncertain management feedback. |
| `frontend/src/components/moderation/MemberDirectory.tsx` | Safe Delegate verification copy. |
| `frontend/src/app/communities/irm/document-voting/settings/page.tsx` | Associated field validation, safe read failures and check-current-settings action after uncertain PATCH. |
| `frontend/tests/content-state.test.mjs` | Actual component rendering checks for one loading status, hidden skeletons and a meaningful empty state. |
| `frontend/e2e/saved-documents.spec.ts` | Existing removal regression now checks read-only reconciliation before another DELETE. |
| `frontend/e2e/u6-feedback-states.spec.ts` | Mocked loading/empty/error/filter, draft/uncertainty, saved status and voting-field scenarios plus responsive captures. |
| `frontend/playwright.u6.config.ts` | Focused U6 and existing mocked state/account/moderation regression selection. |
| `docs/etudsup-u6-feedback-state-consistency.md` | This report. |

No backend, migration, database, dependency, environment, deployment or `/home/yasso/etudsup` file was edited. No profile pages, stickers, APIs or future features were added. Nothing was staged, committed, pushed, deployed or restarted.

## Representative behavior and preservation

- A document or announcement request now shows content-shaped neutral placeholders while loading, then either real rows, an explained empty state, or an inline error with Retry. Skeletons contain no fake title/count and have `aria-hidden`; the status appears once. No motion was added, so reduced-motion users receive the same quiet state.
- A filtered document/submission result explains that filters matched nothing and offers the existing clear action. Empty Saved/Recent views offer the real Modules route. Pending review and Delegate queues offer their existing refresh action where useful. No empty state appears for a failed request.
- Home keeps its U3 Quick access and existing desktop/mobile reading order. A same-account refresh leaves valid announcements/modules visible; switching account, logout or losing membership still uses existing owner/eligibility cleanup. Protected links remain withheld during unresolved verification.
- Announcement creation keeps the draft after an uncertain response and offers a list GET; it does not replay POST. Save and saved-list removal similarly ask for a server read before another write. Voting settings keep the entered value after an uncertain PATCH and offer a current-settings GET. Existing moderation confirmation uses its established refresh/check path. No mutation is retried automatically.
- Existing statuses, URL filters/return context, cursor endpoints, preview/vote flags, permission checks, duplicate-submit guards, PDF paper styling, U2 header, U4 announcement structure, U5 bordered rows and F9 footer exceptions remain.

## Verification and remaining acceptance

Commands ran from `frontend/` unless stated otherwise.

| Check | Actual result |
| --- | --- |
| `npm run lint` | Passed after the final code changes. An earlier run caught concurrent Discussion lint errors; they were resolved by their owner before the final run, without U6 editing Discussion. |
| `npx tsc --noEmit` | Passed after the final code changes. An earlier run saw a concurrent Discussion spec type error; it was resolved independently. |
| `node --test tests/content-state.test.mjs tests/document-row.test.mjs tests/actions.test.mjs tests/moderation.test.mjs tests/home-presentation.test.mjs tests/navigation-model.test.mjs tests/account-controls.test.mjs` | Passed: 7 executed files. These include actual state rendering, U1 action semantics, confirmation focus/pending behavior, moderation uncertainty, account gates and Home composition. |
| `npx playwright test --config=playwright.u6.config.ts --list` | Discovered 105 tests in 8 files after the final scenario addition. Discovery is not execution. |
| `npm run build` | Normal Next 16.3.6/Turbopack build failed while processing existing `SiteFooter.module.css`: `creating new process` → `binding to a port` → `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-2510be09d39d48ad4abf13e3995605f3.log`. This is an environment/process restriction, not a completed build or a demonstrated U6 source failure. It was not retried. |
| `npx playwright test --config=playwright.u6.config.ts --grep 'document loading' --max-failures=1` | One attempted scenario failed at Chromium startup before navigation/assertions: `sandbox_host_linux.cc:41`, `shutdown: Operation not permitted (1)`. It was not retried. |
| Scoped `git diff --check` | Passed for tracked U6 files. A direct trailing-whitespace scan found existing lines in the previously edited pending/document-detail files; no new diff whitespace was introduced. |

**No screenshots were produced or inspected.** The U6 suite prepares 390px/1440px light/dark filtered-empty and uncertain-publish captures, and checks 320px/768px overflow and control height. Existing selected suites cover authentication gating, field errors, confirmation focus/pending behavior, U4 announcements and Home at additional sizes. Their browser assertions were not executed here. U1–U5 build and visual acceptance gaps remain open; U6 does not close them by test discovery or source inspection.

Owner-side fish-compatible commands on a machine where Next can build/listen and Chromium can launch:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/content-state.test.mjs tests/document-row.test.mjs tests/actions.test.mjs tests/moderation.test.mjs tests/home-presentation.test.mjs tests/navigation-model.test.mjs tests/account-controls.test.mjs
npm run build
npm run start -- -p 3156
```

In another fish terminal:

```fish
cd /home/yasso/irm-platform/frontend
env IRM_U6_TEST_URL=http://127.0.0.1:3156 npx playwright test --config=playwright.u6.config.ts
```

Inspect `frontend/test-results/u6/captures/` at 390px and 1440px in both themes, then validate 320px/768px focus, wrapped feedback, reduced motion, 44px controls and the existing U1–U5 visual gaps in the actual browser. The current Discussion and reader workspaces require their separate browser acceptance without U6 layout changes.
