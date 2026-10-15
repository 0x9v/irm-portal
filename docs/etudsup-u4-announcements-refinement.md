# EtudSup U4 — Announcements refinement

## Scope and reference

Inspected the dirty worktree before editing and preserved all existing modified and untracked work. Read the F7 Announcements implementation report (`docs/etudsup-f7-feature-theme-mobile.md`), the Delegate moderation report, and U1–U3 reports. Inspected the list/detail/reply source, confirmation and moderation contracts, shared action CSS, tests, and the installed Next.js CSS guide. Backend and concurrent Discussion files were not edited.

The supplied Announcements reference was available at `/tmp/codex-clipboard-4RqG6G.png` and inspected. The result keeps its community eyebrow, strong heading and ink latest card. It deliberately omits the reference's “caught up” claim and “IRM admins” attribution: no read tracking or authoritative author role is present in the announcement response. The API's first ordered array item is featured exactly once; subsequent items remain neutral. The list endpoint has no pagination; reply pagination retains its existing cursor contract.

## Exact changed files

| File | U4 change |
| --- | --- |
| `frontend/src/app/communities/irm/announcements/page.tsx` | Full-width announcement stream, compact heading, capability-gated jump to the existing publishing form, integrated list actions. |
| `frontend/src/app/communities/irm/announcements/[announcementId]/page.tsx` | Places parent moderation inside the detail header. |
| `frontend/src/components/AnnouncementCard.tsx` | Makes the article the visual card and keeps its navigation link separate from the header action; real title, date, optional username and bounded excerpt remain. |
| `frontend/src/components/AnnouncementReplies.tsx` | Places reply actions beside actual author/time in each reply header, including newly posted replies. |
| `frontend/src/components/Announcements.module.css` | Scoped card, detail, reply and disclosure geometry in existing tokens. |
| `frontend/src/components/AnnouncementModerationAction.tsx` | Announcement-only overflow disclosure using the existing moderation request/result functions and confirmation dialog. |
| `frontend/e2e/delegate-moderation.spec.ts` | Updates existing announcement removal interactions for the disclosure. Other moderation cases are unchanged. |
| `frontend/e2e/u4-announcements.spec.ts` | Adds mocked browser scenarios and list/detail screenshot captures. |
| `frontend/playwright.u4.config.ts` | Focused browser runner without backend or server startup. |
| `docs/etudsup-u4-announcements-refinement.md` | This report. |

## Composition and behavior

The list heading gives community context and an authorized “Post an announcement” link to the real form, which now follows the stream. This keeps the ink featured notice at readable width on desktop. The first API result is featured; no extra sort, duplication, invented urgency, status or author authority is added. Remaining notices use neutral bordered cards with one linked content region. The link and disclosure are siblings, so no button is nested in a link. Narrow titles and usernames wrap without requiring narrower controls.

Detail retains its return link, plain-text body with preserved whitespace, actual author/date/meaningful update metadata, and the existing reply composer. Replies use fine borders and attached author/time/action headers. The heading remains “Discussion” to retain established navigation/tests; the local explanation now says these are replies. No raw HTML, attachment, reaction or read-state rendering was added.

Delegate-only removal is reached through a 44px neutral ⋯ trigger in the corresponding card/reply/detail header, then a restrained danger choice. The disclosure has `aria-expanded`/`aria-controls`, Escape, outside-pointer and focus-out dismissal, and trigger focus return. Its panel opens above the trigger near the viewport bottom. It does not use ARIA menu roles. The existing native confirmation dialog still handles initial/contained focus, Escape, pending lock, duplicate-submit prevention and focus return. The same `moderationRequest`, `performModeration` and `moderationCopy` functions preserve endpoints and result handling: confirmed success/404 reconciles the visible item; 401/403 refreshes authority; conflict or uncertain outcomes retain content and the explicit refresh/check path. Non-Delegates do not receive the trigger. Discussion's component was not changed.

Existing ACTIVE-membership access, `create_announcements` publishing gate, read aborts, request-generation and account-scope guards, removed-item ledger, reply cursor/pending/newly-posted reconciliation, draft retention and retry behavior remain. An API failure still shows retry rather than an empty notice. The shared shell, bottom navigation and footer are untouched.

## Verification and gaps

| Command or check | Actual result |
| --- | --- |
| `npm run lint` | Passed after final UI changes. |
| `npx tsc --noEmit` | Passed after final UI changes. |
| `node --test tests/moderation.test.mjs tests/mobile-presentation.test.mjs` | Passed, 2 suites. |
| `npx playwright test --config=playwright.u4.config.ts --list` | Discovered 5 U4 scenarios; **no browser scenario executed**. |
| `npm run build` | Failed in Turbopack processing pre-existing `SiteFooter.module.css`: creating a process/binding a port returned `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-b1871c6c8e1ed2f5b647b00140b94e43.log`. No completed production build. |
| Scoped `git diff --check` and trailing-whitespace search | Passed for U4 paths. Repository-wide `git diff --check` also reports pre-existing backend whitespace, which was left untouched. |
| Browser inventory | `apps: []`, `browsers: []`; no actual application or screenshots could be inspected. |

The U4 browser suite covers featured uniqueness, metadata and escaped text, navigation, error/empty retry, authorized removal disclosure/confirmation, reply cursor loading, unauthorized absence, narrow-width overflow/touch target checks, and light/dark 390px/1440px list/detail captures. Existing announcement/reply/moderation browser suites provide additional creation, cancellation, stale-response and access-loss checks. They were **not executed here**. Browser visual acceptance, real keyboard/focus behavior, actual contrast and the requested screenshot comparison remain open. The normal build gap is unchanged from U1–U3.

On an owner machine with browser and build permissions, use separate fish terminals:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/moderation.test.mjs tests/mobile-presentation.test.mjs
npm run build
npm run start -- -p 3154
```

```fish
cd /home/yasso/irm-platform/frontend
env IRM_U4_TEST_URL=http://127.0.0.1:3154 npx playwright test --config=playwright.u4.config.ts
env IRM_F7_TEST_URL=http://127.0.0.1:3154 node tests/run-f7-regressions.mjs announcements announcement-replies
```

The U4 config selects only the new suite; the F7 regression runner uses the project's isolated mocked fixtures for the existing announcement/reply suites. Inspect screenshots under `frontend/test-results/` and compare the 390px/1440px list/detail in both themes with the reference. Check 320px overflow, action placement, focus and mobile bottom-bar clearance. No screenshots were produced in this sandbox.

U5 document-row borders, U6 global feedback, profile frontend and Discussion changes were not started. No files were staged, committed, pushed or deployed.
