# EtudSup U5 — module browsing and document rows

## Scope and reference

Inspected the dirty worktree before editing. Existing modified and untracked work, including concurrent backend, Discussion and avatar work, was preserved. Read the F7 theme/mobile report, document search and metadata/navigation reports, Saved/Recent/My Submissions reports, and U1–U4 reports. Inspected the live module chooser/detail, document lists, labels and URL helpers, saved control, pending preview/voting page, reader return route and existing browser suites. The installed Next.js CSS guide was read before editing CSS modules.

The F7 report identifies the supplied Modules reference as `/tmp/codex-clipboard-0YW52B.png`, but that file is no longer available here. The written F7 description provided the composition baseline. **No direct image comparison is claimed.** The existing desktop chooser and selected-module workspace remain, with real module names, explicit search and filters, and approved-only results. The module array has no count or cursor; none was added.

## Exact U5 changed-file inventory

| File | U5 change |
| --- | --- |
| `frontend/src/components/DocumentRow.tsx` | Small presentation-only article with title/open link, optional context/status, metadata and sibling action slots. |
| `frontend/src/components/DocumentRow.module.css` | One fine semantic border and radius per document, neutral light/dark surface, consistent padding/gaps, no resting shadow, wrapping, restrained hover/focus and mobile action layout. |
| `frontend/src/components/modules/ModuleBrowser.module.css` | Replaces dividing-line list styling with spaced rows; gives 320px filter actions more room. |
| `frontend/src/app/communities/irm/modules/[moduleSlug]/page.tsx` | Uses bordered rows for approved results, with dedicated title/read links and sibling Save control. |
| `frontend/src/app/communities/irm/documents/saved/page.tsx` | Uses the shared row while retaining module context, saved date, open and remove/retry actions. |
| `frontend/src/app/communities/irm/documents/recent/page.tsx` | Uses the shared row with actual last-opened time and last-page data. |
| `frontend/src/app/communities/irm/documents/mine/page.tsx` | Uses the shared row with actual review status, submitted date, module context and existing status-gated actions. |
| `frontend/tests/document-row.test.mjs` | Isolated rendering checks for escaped title, sibling link/button and optional file actions. |
| `frontend/e2e/u5-document-rows.spec.ts` | Mocked row geometry, navigation, 320px controls, personal-list behavior and 390px/1440px capture scenarios. |
| `frontend/playwright.u5.config.ts` | Runs U5 and relevant existing mocked document/search/navigation/reader browser suites against an owner-provided frontend server. |
| `docs/etudsup-u5-module-document-browsing.md` | This report. |

No pending queue, DocumentReader, detail route, API, backend, migration, dependency, environment, deployment, Discussion, avatar or `/home/yasso/etudsup` source was changed. Nothing was staged, committed, pushed or deployed.

## Shared treatment and page-specific contracts

Each result is now an `article` on the semantic `--surface`, with a 1px `--border`, the established surface radius, 12px spacing between results and no resting shadow. Titles are primary and wrap anywhere; type, source and dates are quieter. The title is its own anchor when opening is permitted. The action row is a separate sibling region, so Save/removal buttons cannot be nested in or covered by a link. Focus and hover change the border gently; title focus keeps the existing U1 visible focus rule. At narrow widths, status and actions wrap, while controls keep the shared 44px minimum.

The shared component handles **presentation only**. The module page still fetches and filters only APPROVED documents; it shows no redundant Approved badge, fabricated count or pagination. Saved retains server-backed Save/Unsave and removal retries. Recent renders the API's `last_opened_at` and `last_page`. My Submissions retains Awaiting review, Approved and Not approved status copy: approved rows link to the reader, pending rows have their existing first-page preview, and rejected rows have no file action or reader title link. Page-specific fetching, owner checks, generation guards, cursor pagination and access decisions remain in their pages.

The pending queue already has individually bordered cards and was not edited. Its response flags still govern full-document access and voting; uploader/voter preview and eligibility controls remain as implemented. The reader and PDF canvas/paper styling were not touched.

## Filters, navigation and privacy

The module page still submits Search explicitly, trims and caps `q` at 100 characters, validates Type/Source enums and URL state, supports Clear, Back/Forward and safe `from=module|mine|pending` return context, and restores filters after returning from detail. Ordinary and filtered empty states remain distinct; errors keep the controls and expose Retry. Existing AbortController and request-generation checks continue to suppress stale results. Saved, Recent and My Submissions retain their existing cursor endpoints; the module and pending array endpoints have no invented cursor/count.

No UUID, storage path, reviewer identity, unavailable author or private applicant field was added to row copy. Server authorization remains authoritative. The only new link in approved/personal rows is a title link to the same permitted destination already exposed by that row's existing action.

## Verification and acceptance gaps

Commands ran from `frontend/` unless noted.

| Check | Actual result |
| --- | --- |
| `npm run lint` | Passed with no warnings after the final test edit. |
| `npx tsc --noEmit` | Passed. |
| `node --test tests/document-row.test.mjs tests/navigation-model.test.mjs tests/home-presentation.test.mjs` | Passed: 3 executed files, including the new actual-row rendering checks. |
| `npx playwright test --config=playwright.u5.config.ts --list` | Discovered 37 tests in 7 files. Discovery is not execution. Existing cases cover filter clearing/retry/empty/stale responses, return context, Save/Unsave, Recent metadata, submission status gates, reader lifecycle and narrow/theme behavior. |
| `npm run build` | Failed during normal Next 16.3.6/Turbopack production build while processing existing `SiteFooter.module.css`: `creating new process` → `binding to a port` → `Operation not permitted (os error 1)`. Panic log: `/tmp/next-panic-6d847ed4672744a1b6bac6b463175e48.log`. This does not establish a U5 source error or a completed build. |
| `npx playwright test --config=playwright.u5.config.ts --grep 'module rows fit' --max-failures=1` | One attempted test failed at Chromium startup, before page navigation or assertions: `sandbox_host_linux.cc:41`, `shutdown: Operation not permitted (1)`. It was not retried. |
| Scoped `git diff --check` and authored-file trailing-whitespace check | Passed. |

**No application screenshots were captured or inspected.** The U5 suite is prepared to capture module browsing at 390px and 1440px in both themes, plus Saved, Recent and My Submissions representative views. The 320px overflow/44px controls, rendered borders, focus, long-title wrapping, theme contrast and screenshot comparison await browser execution. Existing pending preview/vote browser coverage remains in `page-layouts.spec.ts`; pending source was untouched. U1–U4's unresolved normal-build/browser visual acceptance remains unresolved.

Owner-side fish-compatible commands in an environment permitting Next builds, loopback listening and Chromium:

```fish
cd /home/yasso/irm-platform/frontend
npm run lint
npx tsc --noEmit
node --test tests/document-row.test.mjs tests/navigation-model.test.mjs tests/home-presentation.test.mjs
npm run build
npm run start -- -p 3155
```

In another fish terminal:

```fish
cd /home/yasso/irm-platform/frontend
env IRM_U5_TEST_URL=http://127.0.0.1:3155 npx playwright test --config=playwright.u5.config.ts
```

Inspect `frontend/test-results/u5/captures/` for the module and personal-list screenshots and compare the module composition with the original reference if it is available. Run the existing pending preview/voting suite when validating that separate workflow. Actual rendered and interaction acceptance remains open until those checks execute.
