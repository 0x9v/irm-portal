# EtudSup F2 — confirmed-guest landing

## Reference comparison before editing

The supplied target shows a full-width public page with a compact header inside a broad ink hero. The current implementation renders `GuestHomeShell` on `/`, which adds a persistent desktop sidebar and a mobile menu before the hero. The current hero uses a small IRM Hub label, plain “to learn.” line, and a standalone E mark. The target uses EtudSup identity, lavender emphasis, a two-column composition, and layered interface artwork. Below the hero, the current page has three plain cells and a short Support row. The target has a featured IRM card beside a clearly future-only community concept, three illustrated cards, three onboarding steps, a fuller Support panel, and a restrained footer. Current navigation and some actions inherit visible underlines that do not fit the target’s button/card treatment.

The prompt describes the current-result image; only the target image was available as an attached file in this turn. The current code and the prompt’s comparison bullets were inspected before editing. Visual acceptance requires rendered browser screenshots after implementation.

The older `/home/yasso/etudsup/frontend/src/app/page.tsx` and `home.module.css` were inspected read only for its EtudSup/IRM wording, fixed ink hero, and semantic use of violet. Its implementation was not copied into the current application.

## Scope

Only confirmed-guest Home presentation and the explicit `/` shell decision will change. Login, registration, Support, signed-in Home, feature routes, session and membership requests, permission rules, and the backend remain as they are.

## Changed-file inventory

| File | F2 change |
| --- | --- |
| `frontend/src/components/layout/ApplicationShell.tsx` | Gives `/` without a user a plain Home wrapper; other guest routes keep `GuestHomeShell`, and signed-in routes keep their existing shell/sidebar. |
| `frontend/src/app/page.tsx` | Keeps logout transition neutral when there is no user and labels the session-check state EtudSup. Signed-in dashboard logic and requests are unchanged. |
| `frontend/src/components/home/GuestHome.tsx` | Rebuilds the confirmed-guest content, real route links, community row, explanation cards, steps, Support panel, and footer. |
| `frontend/src/components/home/GuestLandingArtwork.tsx` | Adds original decorative SVG interface shapes and card illustrations without sample records or notifications. |
| `frontend/src/components/home/GuestLanding.module.css` | Scoped light/dark landing presentation and responsive layout. It does not style login, registration, Support, or signed-in pages. |
| `frontend/e2e/guest-home.spec.ts` | Updates existing mocked checks for the explicit shell, links, auth states, focus order, themes, widths, and screenshot capture. |
| `docs/etudsup-f2-guest-landing.md` | This comparison and verification report. |

No changes were made to `/home/yasso/etudsup`, backend files, dependencies, deployment, or environment files. Existing unrelated modified and untracked work was preserved.

## Auth, shell, and route decisions

`AuthContext` still resolves `/api/v1/auth/me` and, for signed-in users, `/api/v1/communities/irm/membership/me`. Home still renders `GuestHome` only after a confirmed 401 guest response. Initial checking and a retry in progress render a neutral status; a non-401 auth failure renders the existing retry action. The `/` shell omits the sidebar while there is no user. Once a user is resolved, the existing application shell and permission-aware dashboard render. Each branch owns one visible `<main>` through either `GuestHome` or `PageContainer`.

The IRM card links to `/login` with “Sign in to explore IRM.” The existing `/communities/irm/modules` page fetches data and reports 401 for guests, so a direct guest card link there would fail. Sign-in currently redirects to `/communities/irm/membership`, where the real IRM access journey continues. Header Communities links to the current page’s `#communities`; Support, Sign in, and Create an account link to `/support`, `/login`, and `/register`. “More communities” is a noninteractive future concept.

The artwork is decorative and `aria-hidden`. Its interface shapes contain no names, counts, records, notification labels, or state claims. The copy distinguishes signed-in module browsing from active-member announcements and participation. The independent-initiative wording was already present in the current EtudSup content; no pre-alpha label or institutional endorsement was added.

## Target comparison after implementation

The page structure now follows the target: a full-width ink hero with an internal EtudSup header, two-column desktop copy/artwork, lavender headline emphasis, and immediate auth actions; warm-neutral sections with a dark IRM card and distinct Coming soon card; three illustrated explanation cards; three onboarding steps; Support and footer. The hero stays ink in both themes, while cards and canvas read the existing semantic tokens. At tablet widths the hero and community row stack; at 390px and 320px the artwork drops away and both auth actions remain in the hero before the lower sections. Navigation and card actions use button/link styles without incidental underlines.

This is a **source and composition comparison only**. No rendered screenshot could be opened here, so exact alignment, spacing, artwork scale, and the four requested light/dark viewport comparisons remain unverified. No screenshot-driven revision was possible.

## Verification

Commands from `frontend/`:

- `npm run lint` — passed after the final code and test edits.
- `npx tsc --noEmit` — passed after the final code and test edits.
- `npm run build` — normal Next.js 16.3.6/Turbopack build passed after the final code edit; the existing prebuild copied the PDF worker.
- `git diff --check --` the scoped F2 frontend paths — passed.
- `npx playwright test --config playwright.guest-home.config.ts --list` — discovered 25 mocked browser checks; this **does not mean they passed**.
- `npx playwright test --config playwright.guest-home.config.ts --grep 'holds a neutral checking state|confirmed guest gets clear auth actions|auth errors and a delayed retry|authenticated transition|captures light guest page at 1440px'` — the configured web server did not start in this sandbox.
- A direct `npm run dev -- --hostname 127.0.0.1 --port 3108` started successfully. A temporary no-server Playwright config then attempted one 1440px screenshot check. **Chromium exited before the test body** with `sandbox_host_linux.cc:41 … Operation not permitted`. The temporary config was deleted and the server stopped. No screenshots were generated or inspected.

Owner-side command in an environment that permits Chromium:

```bash
cd /home/yasso/irm-platform/frontend
npx playwright test --config playwright.guest-home.config.ts
```

The four screenshot checks write `guest-light-390.png`, `guest-dark-390.png`, `guest-light-1440.png`, and `guest-dark-1440.png` under `frontend/test-results/guest-home/` test-specific directories. Open those files beside the supplied target. Check hero width and height, header alignment, headline emphasis and line breaks, artwork scale, IRM/future card balance, three-card artwork, section spacing, mobile action visibility, and horizontal overflow. Revise the page after that rendered comparison if any of those differ materially.

## Remaining gap

Visual acceptance is blocked by Chromium launch restrictions in this environment. The responsive screenshots and mocked interaction assertions are unexecuted, not passing tests. The authenticated dashboard and other feature pages were intentionally left for later tasks.
