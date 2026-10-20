# ETUDSUP D2 — category-first resource frontend

## Delivered behavior

The module resource page now shows **Catégorie** before **Format** in visual and DOM order. Both are always visible and optional. Category choices are Tous, Cours, TD, TP, Examen, Solution, Autre, backed by the unchanged persisted values `COURSE`, `TD`, `TP`, `EXAM`, `SOLUTION`, `OTHER`. Format choices are Tous, PDF, Image, YouTube, Lien. Search and source filters remain available. The page always requests the typed mixed-resource feed; it never switches to the legacy file-only list for a category. Category-only sends `category=TD` without `kind`; format-only sends `kind=IMAGE` without `category`; combined filters send both. Unclassified resources remain visible under Tous and display “Non classé”.

Filter changes clear accumulated rows and cursors, invalidate the prior request, and fetch page one with the complete filter set. Load more keeps the same filters and bounded `limit=20`. A 404 on a load-more cursor reloads page one once with the selected filters; a first-page 404 stays a load error. Existing Back/Forward state and PDF reader return links carry the category filter. Old module `type` deep links are read as PDF category links and canonicalized; legacy document endpoint requests and direct legacy reader return links retain their `type` contract.

The submission form starts with a required “Choisir une catégorie” placeholder, followed by format. The same shared options stay visible for PDF, IMAGE, YOUTUBE, and LINK; changing format preserves the chosen category without changing source. The browser sends multipart `type=<value>` for PDF/IMAGE and JSON `type:<value>` for YOUTUBE/LINK. A missing or invalid category blocks the updated form. Success requires a response with matching resource identity, source, status, kind, title, and `category`; PDF also requires matching `document_type`. A malformed or contradictory response retains the draft under the existing uncertain-outcome flow without resending. File, URL, role, source, preview-cleanup, and duplicate-submit rules remain unchanged.

Typed approved and pending feed validation accepts supported category values or null and rejects contradictory PDF category/document_type pairs. For an older backend response with no `category`, a valid PDF `document_type` supplies its known display category; other formats remain unclassified. No value is inferred from titles, URLs, or formats. The complete feature requires D1 backend revision `c8e4f1a2b603` to be applied before this frontend: an older backend does not support `category` browse queries, and its creation response cannot confirm the category for IMAGE/YOUTUBE/LINK.

## Files

Authored: `frontend/playwright.d2.config.ts`, this report.

Modified: `frontend/src/lib/documentPresentation.ts`, `frontend/src/lib/moduleResources.ts`, `frontend/src/lib/moduleResourceSubmission.ts`, `frontend/src/app/communities/irm/modules/[moduleSlug]/page.tsx`, `frontend/src/app/communities/irm/modules/[moduleSlug]/upload/page.tsx`, `frontend/src/app/communities/irm/documents/pending/page.tsx`, `frontend/tests/module-resources.test.mjs`, `frontend/tests/module-resource-submission.test.mjs`, `frontend/e2e/module-resources.spec.ts`, `frontend/e2e/module-resource-submission.spec.ts`, `frontend/e2e/module-resource-review.spec.ts`, `frontend/e2e/module-document-search.spec.ts`, `frontend/e2e/document-metadata-navigation.spec.ts`, `frontend/e2e/saved-documents.spec.ts`, `frontend/e2e/recent-documents.spec.ts`.

## Verification and remaining gate

- `node --test tests/module-resources.test.mjs tests/module-resource-submission.test.mjs tests/document-row.test.mjs`: 3 test files passed, 0 failed.
- `npx tsc --noEmit`, `npm run lint`, and `git diff --check`: passed.
- The first normal `npm run build` completed successfully. A later final-state build attempt stopped in Turbopack while processing `globals.css`: its worker tried to bind a port and received `EPERM`. This is an environment boundary, not a passing final-state build result.
- A separate `npx next build --webpack` diagnostic stopped before compilation with `Could not parse output from TypeScript's --showConfig`. It is not a substitute for the normal build gate.
- The task-owned `next start` attempt on explicit loopback port 3107 failed with `listen EPERM`. No existing frontend URL was configured. Playwright `--list` discovered **28 tests in 3 files**; **zero browser tests executed**. Responsive, theme, keyboard, touch-target, and no-overflow assertions are written but await browser execution.

With an already running frontend URL, the owner can run the fail-closed mocked browser suite from fish:

```fish
cd /home/yasso/irm-platform/frontend
set -lx ETUDSUP_D2_FRONTEND_URL 'http://127.0.0.1:3107' # replace with the actual already-running frontend URL
npx playwright test --config=playwright.d2.config.ts
```

Manual acceptance: browse TD across all four formats; combine TD + Image, format-only PDF, search, and source; verify unclassified rows under Tous; change filters after loading more and use Back/Forward; submit each format with an explicit category; inspect pending and approved category labels; check 320px, 390px, and 1440px in light/dark with keyboard focus and touch targets; confirm role/source restrictions and uncertain-result handling.

No backend or production data was changed. No D3 deletion, D4 approval change, staging, commit, push, deployment, or owner-service restart was performed.
