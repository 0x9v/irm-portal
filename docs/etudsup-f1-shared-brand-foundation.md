# EtudSup F1 — shared brand foundation

## Scope and baseline

The worktree was already heavily modified and untracked on `main` before this task, including backend, frontend, tests, and documentation. Those changes were preserved. F1 touches shared frontend presentation and this report only. The current guest Home, signed-in Home, navigation structure, feature content, routes, authentication, API calls, and PDF reader behavior remain as they were. The EtudSup worktree was read only.

The supplied EtudSup screenshots established the warm canvas, white cards, ink signature surface, compact E mark, restrained violet, and quiet type hierarchy. `/home/yasso/etudsup/frontend/src/app/globals.css` supplied a second read-only reference for semantic light/dark colors. The current application's existing `FeatureIdentity.module.css` already used a related warm palette; aligning the root tokens to it avoids an abrupt color split between Home and feature pages.

## Changed-file inventory

| File | F1 change |
| --- | --- |
| `frontend/src/app/globals.css` | Aligned root semantic light/dark tokens, ink hero alias, control radii, and shared moderator badge to the brand direction. Kept the white document paper token. |
| `frontend/src/app/layout.tsx` | Set EtudSup page metadata. Kept the pre-paint theme script, providers, and shell. |
| `frontend/src/components/home/GuestBrandMark.tsx` | Replaced the old open-book artwork with one compact EtudSup E monogram shared by guest and signed-in shells. |
| `frontend/src/components/home/GuestHome.module.css` | Pointed existing guest color aliases at the root semantic tokens in both themes; layout and content are unchanged. |
| `frontend/src/components/home/GuestHomeShell.tsx` | Changed shared shell wordmark/accessibility label to EtudSup, retaining the IRM and FST Mohammedia context. |
| `frontend/src/components/navigation/SidebarNav.tsx` | Same wordmark update in the desktop signed-in shell. |
| `frontend/src/components/navigation/MobileHeader.tsx` | Same wordmark update in the mobile signed-in shell. |
| `frontend/src/components/navigation/ContextBar.tsx` | Updated the generic context fallback label to EtudSup. |
| `docs/etudsup-f1-shared-brand-foundation.md` | This scope and verification record. |

The pre-existing `GuestBrandMark` component is reused instead of adding another icon family. Existing navigation icons remain labeled. Global controls continue to use `.ui-button`, `.ui-field`, `.ui-surface`, `.role-badge`, and `.ui-link`; their mapped semantic colors and radii now read as one system. The separate IRM label in shell context remains a community identity, while EtudSup is the product wordmark. No live selector or new community data was added.

## Final root tokens and typography

| Role | Light | Dark |
| --- | --- | --- |
| Canvas `--page` | `#F4F2EE` | `#17161B` |
| Card `--surface` | `#FFFFFF` | `#211F25` |
| Muted surface `--surface-secondary` | `#EEEBE6` | `#2A272F` |
| Ink `--brand-ink` | `#19171E` | `#19171E` |
| Main text `--text` | `#211F24` | `#F1EEF3` |
| Muted text `--text-muted` | `#625D65` | `#C7C1CA` |
| Fine border `--border` | `#D8D4CE` | `#48444D` |
| Interactive border `--control-border` | `#8B828F` | `#968B9F` |
| Action `--accent` | `#65558F` | `#B6A8D1` |
| Action hover / pressed | `#57477C` / `#493B69` | `#C9BDE0` / `#D7CBE8` |
| Action foreground `--on-accent` | `#FFFFFF` | `#211C29` |
| Soft action surface `--accent-soft` | `#EEE9F4` | `#36303F` |
| Focus `--focus` | `#65558F` | `#D0C3E5` |
| Disabled surface / text | `#EBE7E2` / `#746D77` | `#2A272F` / `#B8B0BF` |
| Success text / surface | `#15803D` / `#F0FDF4` | `#4ADE80` / `#132B1E` |
| Warning text / surface | `#B45309` / `#FFFBEB` | `#FBBF24` / `#2C1E0A` |
| Error text / surface | `#B91C1C` / `#FEF2F2` | `#F87171` / `#2D1317` |
| Info text / surface | `#1D4ED8` / `#EFF6FF` | `#60A5FA` / `#122340` |
| Reader viewport `--reader-viewport` | `#E7E3DD` | `#121116` |
| PDF paper `--document-paper` | `#FFFFFF` | `#FFFFFF` |

Controls use a 12px radius, cards 16px, and badges a pill radius. The existing local system sans stack remains `ui-sans-serif` with no remote font. Existing `.ui-page-heading` and `.ui-section-heading` sizes stay 28/32px and 20px; the current feature scope supplies larger page headings where needed. Semantic status colors and the reader's fixed white paper remain intact.

## Reference comparison and protected consumers

The screenshots show a compact letter mark, strong ink panels, a warm off-white canvas, white cards, soft borders, and violet accents. F1 applies these to shared tokens and shell identity. It does not copy the supplied guest hero composition, signed-in dashboard, announcements, membership, or registration page layouts; those are later tasks. The existing guest and feature layouts therefore still differ from the supplied screens in spacing, content, and page-specific artwork.

`FeatureIdentity.module.css` keeps its existing scoped colors and adjustments for Modules, document reader, Discussion, membership, and delegate pages. They are close to the new root palette and protect feature content from unexpected inherited color changes. Existing guest Home uses aliases to the root colors but retains its own layout. Status text uses semantic success/warning/error/info tokens; the shared moderator badge now uses those tokens in both themes. The PDF canvas/text layer is untouched, and `--document-paper` stays white in both themes.

Existing signed-in Home and some feature copy still say “IRM Hub”; page-content renaming and composition belong to later migrations. The shell now distinguishes the EtudSup platform from its first IRM space. Existing local navigation, feature routes, authorization, and theme storage key `irm-theme` were not changed.

Token consumers inspected before editing: `--page` and `--text` feed the root body and `ApplicationShell`; `--surface`, `--border`, and `--control-border` feed sidebar, mobile navigation, context bar, cards, forms, and reader toolbar; `--accent`, `--on-accent`, and `--focus` feed shared buttons, links, selected navigation, and form focus; status tokens feed `FeedbackMessage` and role badges; `--reader-viewport` and `--document-paper` feed `DocumentReader`. The existing feature-scoped palette limits risk to modules, discussion, membership, and delegate views while the root foundation changes.

## Contrast checks

WCAG relative-luminance calculations against adjacent opaque surfaces:

| Pair | Ratio |
| --- | ---: |
| Light main text / canvas | 14.60:1 |
| Light muted text / canvas | 5.74:1 |
| Light muted text / white card | 6.42:1 |
| Light primary foreground / action | 6.46:1 |
| Light accent text / soft action surface | 5.42:1 |
| Light control border / white card | 3.69:1 |
| Dark main text / canvas | 15.65:1 |
| Dark muted text / card | 9.25:1 |
| Dark primary foreground / action | 7.53:1 |
| Dark accent text / soft action surface | 5.76:1 |
| Dark control border / card | 5.04:1 |
| Ink-panel light text / ink | 16.51:1 |
| Focus / white card (light) | 6.46:1 |
| Focus / card (dark) | 9.80:1 |
| Success, warning, error, info text / matching light status surface | 4.79:1, 4.84:1, 5.91:1, 6.16:1 |
| Success, warning, error, info text / matching dark status surface | 8.66:1, 9.70:1, 6.24:1, 6.16:1 |

The fine card border is decorative; the stronger control border distinguishes inputs and secondary actions. Existing 44px control heights, focus rings, native `color-scheme`, keyboard behavior, and reduced-motion rules remain in place.

## Commands and results

From `frontend/`:

- `npm run lint` — passed.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed using Next.js 16.3.6/Turbopack; 21 static pages were generated. The build's existing `prebuild` copied the PDF worker file. No dependency manifests were changed.
- `git diff --check` from the repository root — found five pre-existing blank-line-at-EOF issues in backend files outside F1. A scoped check is required for these changes.
- `git diff --check --` the F1 frontend paths — passed.
- `node --test frontend/tests/theme.test.mjs` — passed (1 test); the existing theme storage/bootstrap logic was preserved.
- `npx playwright test --config playwright.feature-identity.config.ts --grep 'captures (light|dark) guest page at (390|1440)px|representative feature pages fit (390|1440)px in (light|dark)'` — its configured web server did not start in this sandbox.
- A direct local frontend server started, then the eight selected mocked browser checks were attempted against it with a temporary test config. **No test body ran:** Chromium exited at launch with `sandbox_host_linux.cc:41 … Operation not permitted`. The temporary config was removed. No new screenshots were captured or inspected. The local server was stopped.

Owner-side visual review: from `frontend/`, run the focused Playwright command above in an environment that permits Chromium launch. Its guest screenshot tests cover 390px and 1440px in light and dark; its representative feature tests cover login, module, PDF reader, Discussion, membership, and a delegate page at those widths, also in both themes. Review the generated files under `frontend/test-results/feature-identity/` and inspect 320px with the same representative test pattern if needed. Existing tests that assert the old “IRM Hub” shell label will need an expectation update when that suite is next maintained.

## Remaining visual gaps

- Browser screenshot comparison and 320px visual inspection remain unverified in this sandbox.
- Guest landing, signed-in dashboard, navigation composition, and feature-page redesigns are reserved for later tasks.
- Some page-specific color literals and legacy “IRM Hub” copy remain in existing feature content; replacing them broadly in F1 would change screens outside this task.
