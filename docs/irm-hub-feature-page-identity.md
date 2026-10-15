# IRM Hub feature-page identity

Implemented the actual guest Home identity across the feature pages and shared navigation. Product branding remains **IRM Hub**. The actual guest files and their handoff were the design reference; no older preview was used as design authority.

**Visual and interaction acceptance is pending.** Chromium and the isolated frontend web server could not render in this environment. No screenshots were captured or inspected, and no browser assertions passed. Lint, TypeScript, scoped CSS compilation, contrast arithmetic and source-preservation checks ran successfully.

## Coordination and preservation

Before editing, Git status was inspected and source/dependency/Git-index SHA-256 baselines were recorded. The extensive existing unstaged/untracked work was preserved. The Recently Opened frontend handoff (`docs/v0.1-6.2b-recent-reading-frontend.md`) documents its completed implementation; its reader, recent route and module entry point were present. The available agent inventory showed only this agent, with no concurrent frontend owner identified. Reader/recent edits began after this inspection.

Read the requested GuestBrandMark, GuestHome, GuestHome CSS, GuestHomeShell and guest handoff, the shared navigation/theme/components, representative feature contracts, and the installed Next.js CSS guide before implementation. The report supplied by the guest task lives in the repository-root `docs/`, not `frontend/docs/`.

Signed-in `src/app/page.tsx` remains byte-identical to the task-start snapshot. Its dashboard composition, Home CSS, data requests and membership-state treatments were not redesigned. The shared shell around it now uses the IRM mark and ink navigation. Feature palette/type/layout selectors deliberately do not wrap the signed-in Home workspace.

## Exact changed-file inventory

- `frontend/e2e/feature-page-identity.spec.ts`
- `frontend/playwright.feature-identity.config.ts`
- `frontend/src/app/communities/irm/announcements/[announcementId]/page.tsx`
- `frontend/src/app/communities/irm/announcements/page.tsx`
- `frontend/src/app/communities/irm/discussion/page.tsx`
- `frontend/src/app/communities/irm/document-voting/settings/page.tsx`
- `frontend/src/app/communities/irm/documents/mine/page.tsx`
- `frontend/src/app/communities/irm/documents/pending/page.tsx`
- `frontend/src/app/communities/irm/documents/recent/page.tsx`
- `frontend/src/app/communities/irm/documents/saved/page.tsx`
- `frontend/src/app/communities/irm/membership/page.tsx`
- `frontend/src/app/communities/irm/membership/review/page.tsx`
- `frontend/src/app/communities/irm/membership/staff/page.tsx`
- `frontend/src/app/communities/irm/modules/[moduleSlug]/documents/[documentId]/page.tsx`
- `frontend/src/app/communities/irm/modules/[moduleSlug]/page.tsx`
- `frontend/src/app/communities/irm/modules/[moduleSlug]/upload/page.tsx`
- `frontend/src/app/communities/irm/modules/page.tsx`
- `frontend/src/app/communities/irm/posts/[postId]/page.tsx`
- `frontend/src/app/communities/irm/posts/new/page.tsx`
- `frontend/src/app/communities/irm/posts/page.tsx`
- `frontend/src/app/login/page.tsx`
- `frontend/src/app/register/page.tsx`
- `frontend/src/app/support/page.tsx`
- `frontend/src/components/AnnouncementCard.tsx`
- `frontend/src/components/AnnouncementReplies.tsx`
- `frontend/src/components/CommunityPostCard.tsx`
- `frontend/src/components/CommunityPostReplies.tsx`
- `frontend/src/components/DocumentReader.tsx`
- `frontend/src/components/PageContainer.tsx`
- `frontend/src/components/discussion/DiscussionComposer.tsx`
- `frontend/src/components/discussion/DiscussionMessageItem.tsx`
- `frontend/src/components/discussion/ReactionPicker.tsx`
- `frontend/src/components/discussion/StickerAsset.tsx`
- `frontend/src/components/home/GuestHome.module.css`
- `frontend/src/components/home/GuestHomeShell.tsx`
- `frontend/src/components/layout/ApplicationShell.tsx`
- `frontend/src/components/layout/FeatureIdentity.module.css`
- `frontend/src/components/moderation/ConfirmationDialog.tsx`
- `frontend/src/components/moderation/MemberDirectory.tsx`
- `frontend/src/components/moderation/ModerationAction.tsx`
- `frontend/src/components/navigation/ContextBar.tsx`
- `frontend/src/components/navigation/MobileHeader.tsx`
- `frontend/src/components/navigation/MobileShell.module.css`
- `frontend/src/components/navigation/NavIcons.tsx`
- `frontend/src/components/navigation/SidebarNav.tsx`
- `frontend/src/components/navigation/useNavigationDisclosure.ts`
- `docs/irm-hub-feature-page-identity.md`

## Shared presentation rules

`FeatureIdentity.module.css` overrides **existing semantic variables** within the feature workspace and context bar. ThemeProvider, Light/Dark/System resolution, persistence, AuthContext and global styles are unchanged. There is no new preference store, remote font, package or alternate theme provider. A small ink scope styles the sidebar and signed-in mobile shell in both themes. The confirmation dialog carries the feature scope because it renders through a portal outside the workspace.

The exact original connected-learning-spaces vector from `GuestBrandMark.tsx` is reused for the sidebar, mobile header and account forms; its vector and the guest welcome content remain unchanged. Distinct Saved, Recently Opened, My Submissions and member-directory icons extend the existing line-icon style. Support emojis were replaced with existing line icons; actual Discussion reactions/stickers/user content retain their appearance.

Ordinary pages use a small context label, compact heading, existing purpose/metadata and actual task content. Headings have responsive 28–38px scale, weight 750, line-height 1.14 and tight tracking. No welcome hero was copied to feature pages. Font remains `var(--font-body)`: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Actual rendered fallback-font inspection is blocked with browser rendering.

Page containers use 16px mobile padding, 24px tablet padding and 32px desktop padding. Wide feature pages expand to 1260px maximum; approved-reader pages use a 1600px maximum and reduced inner padding. Account forms remain focused at 520px maximum. Existing signed-in Home page-container dimensions remain unchanged.

Content surfaces are quiet, finely bordered, typically 16px radius with no resting shadows. Controls use 12px radius, 44px or greater targets, readable input text, visible 3px focus and matching native color scheme. Selected filters use soft violet rather than solid primary fills. Search/submit/publish/send remains the primary task; repeated module/document/roster actions are neutral secondary actions. Destructive confirmations retain their explicit destructive treatment. Success, warning, error and connection states retain semantic colors and text, including dark mode.

Component navigation/card/button actions have no default underline; inline prose links explicitly retain underlines. The full AnnouncementCard presentation is scoped to feature pages; only a data attribute was added to the shared card, so its existing Home presentation is preserved. Long titles wrap and module document lists show full titles instead of truncating them to two lines.

PDF viewport chrome becomes neutral; the PDF paper is still explicitly `#ffffff` in both themes. Neither PDF/image content nor the PDF text layer is inverted, filtered or recolored. Zoom can scroll within the viewer, while the toolbar wraps independently. Color/border transitions are 170ms; presentation animation/transitions are disabled for reduced motion in the new scopes.

### Palette / changed token values

| Existing semantic token/use | Light | Dark |
| --- | --- | --- |
| `--page` | `#f4f2ee` | `#17161b` |
| `--surface` | `#ffffff` | `#211f25` |
| `--surface-secondary` | `#eeebe6` | `#2a272f` |
| `--text` | `#211f24` | `#f1eef3` |
| `--text-muted` | `#625d65` | `#c7c1ca` |
| `--text-subtle` | `#6b646f` | `#b8b0bf` |
| `--border` | `#d8d4ce` | `#48444d` |
| `--control-border` | `#8b828f` | `#968b9f` |
| `--accent` / active | `#65558f` | `#b6a8d1` |
| `--accent-hover` | `#57477c` | `#c9bde0` |
| `--accent-pressed` | `#493b69` | `#d7cbe8` |
| `--accent-soft` | `#eee9f4` | `#36303f` |
| `--accent-soft-pressed` | `#e0d8eb` | `#443b50` |
| `--on-accent` | `#ffffff` | `#211c29` |
| `--focus` | `#65558f` | `#d0c3e5` |
| `--disabled-surface` | `#ebe7e2` | `#2a272f` |
| `--disabled-text` | `#746d77` | `#b8b0bf` |
| `--reader-viewport` | `#e7e3dd` | `#121116` |
| `--document-paper` | `#ffffff` | `#ffffff` |

Account/community secondary surfaces alias the corresponding neutral feature surfaces. `--surface-aubergine` is the fixed identity ink `#19171e`; popovers use the appropriate neutral surface. Radius tokens are 12px controls, 16px surfaces, full-radius tags. Resting `--shadow-sm` and `--shadow-card` are transparent in this scope; modal overlays retain separation.

Ink navigation: background `#19171e`, main text `#f8f6f8`, secondary text `#d4d0d8`, metadata `#c7c2cc`, selected surface `#3a3443`, indicator/mark `#b6a8d1`, control surface `#24212a`, boundary `#9c95a4`, focus `#e2d9f0`. Appearance controls on ink explicitly use dark native scheme even when the workspace is light. Existing success/warning/error/info workspace tokens are reused.

### Mobile navigation

One compact header and one Menu disclosure replace competing header/bottom navigation surfaces. Desktop navigation remains on the left at the existing 1280px breakpoint. The obsolete bottom-navigation component is preserved in the worktree but is no longer mounted by ApplicationShell.

Guests use the short public navigation on every unauthenticated route: Home, Sign in, Create an account, Support and Appearance. Auth actions stay suppressed while checking/error/retry is unresolved. Guest Home still presents both actions in its hero without opening the menu; login/register forms themselves are prominent on their routes.

Signed-in Study/Community/Management grouping and existing permission gates remain. Saved Documents and Recently Opened are added for authenticated accounts; My Submissions is limited to the existing ACTIVE access rule. No new destination or API was invented. Delegate/capability shortcuts retain their existing conditions. Account usernames wrap, and logout/retry logic remains unchanged.

Menus provide a visible Menu/Close control, first-link focus on opening, Escape dismissal with trigger focus return, backdrop dismissal with focus return, outside-pointer/focus dismissal, desktop-resize dismissal, internal short-viewport scrolling and bottom safe-area padding. These are non-modal disclosures; keyboard users can tab onward to page content. Guest menu styling was refined without changing the guest welcome copy or hero.

## Route-by-route functional preservation

| Route/component | Presentation change | Preserved contract |
| --- | --- | --- |
| `/login` | IRM mark/wordmark, focused neutral form, consistent fields/actions | Original POST login body, validation messages, refresh, session cookies and membership redirect. |
| `/register` | Matching account form and success treatment | Original registration fields/body, server field errors, success state and login link. |
| `/support` | Compact heading, real contact section moved near the top, neutral explanations, consistent icons | Existing WhatsApp environment setting, digit validation, exact real contact URL/message, external-link safety and fallback guidance. No new contact method. |
| `/communities/irm/modules` | Calm module cards with neutral destinations and context heading | Existing module query/loading/error/retry; Recently Opened entry retained. |
| `/communities/irm/modules/[moduleSlug]` | Full document titles in concise rows, coherent type/source/search controls | Existing encoded title query, exact type/source filters, URL restoration/return context, cancellation/stale protection, saving and real document/upload routes. |
| Module `/upload` | Unified form/validation and status surfaces | Existing ACTIVE/capability gates, student/official source behavior, PDF/JPEG/PNG accept rules, 50 MiB rule, actual FormData upload and success states. |
| Module `/documents/[documentId]`, DocumentReader | Compact metadata, wider reader, wrapping toolbar, themed error fallbacks | Document access checks, return/filter links, PDF.js worker/render/text layer, zoom/pages, MIME probe, downloads, saved state. Existing one-open-per-visit/account, restoration clamp, 500ms debounce, serialized writes, keepalive flush and account-remount cleanup unchanged. |
| `/documents/saved` | Shared private-list hierarchy and neutral read/remove actions | Cursor paging, saved-at metadata, account ownership, remove/error/retry handling unchanged. |
| `/documents/recent` | Matching hierarchy and neutral actual Continue reading links | Bounded cursor API, actual last page/time, authenticated eligibility, ownership checks, abort and access clearing unchanged. |
| `/documents/mine` | Own-submission context and neutral status/list styling | ACTIVE gate, status filter, cursor lifecycle, owner isolation, pending preview/reader restrictions unchanged. |
| `/documents/pending` | Readable metadata, neutral preview/download actions and semantic voting feedback | Protected first-page preview, one-vote/uploader rules, YES/NO behavior, original download eligibility, rejection handling and queue refresh unchanged. |
| `/announcements`, detail, replies | Compact headings, calm notice cards, neutral reply emphasis, coherent composer | Active-member gate, real list/detail/reply requests, retries, authors/times, create permission, moderation/removal reconciliation unchanged. |
| `/posts`, `/posts/new`, detail, replies | Matching community type hierarchy, soft selected tags and readable composers | Actual feed/cursors/filter state, three-tag limit, validation/idempotent error behavior, role gates, reply and moderation calls unchanged. |
| `/discussion` and its components | Comfortable conversation/composer, themed connection/error states, larger controls | REST history, pagination/scroll logic, WebSocket lifecycle, real reactions/stickers, Enter newline and Ctrl/Cmd+Enter submit, idempotent retries, removal ledger and role gates unchanged. No invented unread state. |
| `/membership` | Compact application/status framing, conditional sections and readable feedback | Student/Laureate conditional validation, Massar/foreign identifiers, real promotion options/custom formats, privacy text, pending estimate, Support prose link, cancel/reapply/ban rules unchanged. |
| `/membership/review` | Neutral queue rows and semantic approve/reject actions | Existing Delegate verification, actual private application fields, approval/rejection calls and refresh behavior unchanged. |
| `/membership/members`, `/membership/staff` | Readable directory/roster, consistent controls/dialog scope | Delegate gates, status/cursor filters, private-field boundaries, protected-target rules, role/capability updates, explicit remove/ban/unban confirmations unchanged. |
| `/document-voting/settings` | Focused settings form and neutral explanatory surface | Actual capability gate, threshold read/save validation, existing backend request and effect-on-new-uploads guidance unchanged. |

A TypeScript AST audit compared API calls, state/hooks, AbortController/WebSocket construction and event-handler attributes against the pre-edit snapshot in **33 feature files**: all matched. This supports source preservation; it does not substitute for browser/backend behavior tests.

## Verification results

All frontend commands ran from `/home/yasso/irm-platform/frontend`. No owner backend/database or service restart was used.

| Command/check | Actual result |
| --- | --- |
| `npm run lint` | Passed, exit 0 after final TypeScript/source edits. |
| `npx tsc --noEmit` | Passed, exit 0 after correcting a new test fixture's `document` name collision. Earlier diagnostic run found that test-only error; it was fixed. |
| `npm run build` | Blocked, exit 1. Normal production Turbopack processing failed creating a process/binding a port: `Operation not permitted (os error 1)`, writing `/page`. Panic log `/tmp/next-panic-7623e14224ffe3078785aa1644f03afe.log`. The existing prebuild PDF-worker copy ran; worker hash remained identical. |
| `npx playwright test --config=playwright.feature-identity.config.ts --list` | Discovered 43 tests in two files. Discovery is not a test pass. |
| `npx playwright test --config=playwright.feature-identity.config.ts` | Blocked before assertions: configured frontend webServer exited 1. Zero browser assertions executed. |
| Separate Playwright launch using `/usr/sbin/chromium`, headless, `--no-sandbox` | Failed before rendering: crashpad `setsockopt: Operation not permitted (1)`; browser closed. No probe page rendered. |
| In-process Lightning CSS module compilation (`transform({filename, code, cssModules:true})`) | Passed for FeatureIdentity, MobileShell and GuestHome CSS modules (5, 8 and 30 exported classes). This verifies CSS syntax/module processing, not layouts. |
| `node /tmp/irm-feature-behavior-audit.cjs` | Passed: unchanged behavior signatures in 33 feature files as described above. |
| SHA-256 baseline comparison | Passed for signed-in Home source, GuestHome content, original brand mark, AuthContext, API helpers, package manifests/lockfile, Git index and PDF worker. Existing regression files are unchanged. |
| WCAG relative-luminance calculations | Completed for the specified solid adjacent surfaces below; these are arithmetic checks, not rendered browser results. |

The focused config starts only an isolated frontend on `127.0.0.1:3142`. Tests intercept every API call and Discussion socket, with unexpected API requests blocked. Mock records/PDFs appear only in tests. Existing guest tests are included unchanged. New checks cover account payload/redirect behavior, search/filter routes, approved PDF restoration/page-saving and saved/recent links, pending-preview voting gates, Discussion sending, Student application submission, Delegate confirmation/cancel/focus/removal, guest/non-member/member/Delegate menus, and six representative views at 320/390/768/1024/1440 in both themes.

**Unexecuted acceptance:** every browser assertion above, actual login/registration interactions, search/filter interaction, approved PDF controls/saving/reading-position calls, saved/recent navigation, preview/voting, Discussion composer/connection behavior, membership submission, Delegate moderation, menu dismissal/focus, actual theme rendering, computed focus, no horizontal overflow and screenshots. Broader existing Laureate/upload/pagination/reaction regressions were preserved but were not run through an owner/backend configuration.

### Contrast arithmetic

Calculated with WCAG sRGB linearization at 0.04045, luminance weights 0.2126/0.7152/0.0722, then `(Llighter+.05)/(Ldarker+.05)` using Python. Text exceeds 4.5:1 and listed interactive boundaries/focus exceed 3:1. Fine decorative card separators are intentionally quieter.

| Combination | Foreground / adjacent background | Ratio |
| --- | --- | --- |
| Light body | `#211f24` / `#f4f2ee` | 14.60:1 |
| Light metadata | `#6b646f` / `#ffffff` | 5.71:1 |
| Light control edge | `#8b828f` / `#f4f2ee` | 3.30:1 |
| Light primary/focus on white | `#ffffff` / `#65558f` | 6.46:1 |
| Light selected | `#65558f` / `#eee9f4` | 5.42:1 |
| Dark body | `#f1eef3` / `#17161b` | 15.65:1 |
| Dark metadata | `#b8b0bf` / `#211f25` | 7.77:1 |
| Dark control edge | `#968b9f` / `#2a272f` | 4.54:1 |
| Dark primary | `#211c29` / `#b6a8d1` | 7.53:1 |
| Dark focus | `#d0c3e5` / `#211f25` | 9.80:1 |
| Dark selected | `#b6a8d1` / `#36303f` | 5.76:1 |
| Ink navigation | `#d4d0d8` / `#19171e` | 11.68:1 |
| Ink control edge | `#9c95a4` / `#24212a` | 5.47:1 |
| Ink selected | `#f8f6f8` / `#3a3443` | 11.15:1 |
| Ink focus on selected surface | `#e2d9f0` / `#3a3443` | 8.80:1 |
| Light error feedback | `#b91c1c` / `#fef2f2` | 5.91:1 |
| Dark error feedback | `#f87171` / `#2d1317` | 6.24:1 |
| Dark destructive button | `#211c29` / `#f87171` | 6.01:1 |

## Exact owner-side visual steps

On a machine where the existing Playwright browser can launch and localhost can bind:

```sh
cd /home/yasso/irm-platform/frontend
npx playwright test --config=playwright.feature-identity.config.ts
```

This command starts only the isolated frontend; it does not start a backend/database. For screenshots/responsive checks alone:

```sh
npx playwright test --config=playwright.feature-identity.config.ts --grep 'representative feature pages fit|captures'
```

Evidence goes under `frontend/test-results/feature-identity/`, in test-specific directories. Inspect `login`, `module`, `reader`, `discussion`, `membership`, and `delegate` PNGs at 390 and 1440px in both themes, plus the four guest screenshots. Examples: `reader-dark-390.png`, `module-light-1440.png`, `delegate-dark-1440.png`. At 320/768/1024 the suite checks the same views without generating screenshots.

Compare guest/feature mark and ink navigation; check that headings are compact and content stays neutral, login fields/actions dominate, titles wrap, the PDF paper stays white and controls fit, Discussion composer stays clear, and destructive confirmations are unmistakable. Inspect menus at a short viewport, tab into/out of them, dismiss with Escape/backdrop and verify trigger focus returns. Review actual Support/contact, upload, staff/review queue, long announcement/post/reply content and Laureate forms on an authorized isolated owner test setup. Do not point these mocked tests at an owner backend.

## Remaining issues and stopping point

The build must be rerun outside this restricted process/port sandbox. Actual visual/interaction acceptance remains pending; no claim of screenshot approval or complete accessibility certification is made. The primary outstanding work is the owner-side rendering/review above, including broader upload/Laureate/real-time regression scenarios.

No backend/model/migration/API/authorization/database/storage/service/deployment/environment/EtudSup/dependency/lockfile changes, staging, commit, push or deployment were performed. Existing Recently Opened API/position logic, Saved Documents and their regression files were preserved. Work stops at shared shell and feature-page identity; signed-in Home remains for its separately reviewed dashboard redesign.
