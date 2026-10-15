# EtudSup F3 — account pages

## Scope and changed files

This task changes presentation and route-level account UX only. Existing modified and untracked work was preserved. No backend, API, dependency, environment, or deployment file was edited.

| File | Change |
| --- | --- |
| `frontend/src/components/layout/ApplicationShell.tsx` | Explicit account-route frame, without the guest or signed-in application sidebar. Other routes keep their existing shell. |
| `frontend/src/components/auth/AccountPage.tsx` | Shared account composition, theme selector, EtudSup identity, and session checking/error/signed-in states. |
| `frontend/src/components/auth/AccountPage.module.css` | Scoped responsive split layout, ink panel, warm form area, and light/dark styling. |
| `frontend/src/app/login/page.tsx` | New layout and copy; existing login request, refresh, error mapper, and membership destination retained. |
| `frontend/src/app/register/page.tsx` | New layout and copy; all fields, request, validation, and success-without-login behavior retained. |
| `frontend/e2e/account-pages.spec.ts` | Mocked account route, request, state, theme, responsive, and focus cases. |
| `frontend/playwright.account-pages.config.ts` | Isolated account test config, using the production server for browser checks. |
| `frontend/e2e/feature-page-identity.spec.ts` | Account button names updated; guest mobile menu tested on `/support`, where that menu still belongs. |
| `frontend/e2e/foundation-acceptance.spec.ts` | Account button names and form-input selector updated to exclude the new theme radios. |
| `docs/etudsup-f3-account-pages.md` | This report. |

## Contracts preserved

- Login still sends `{ email, password }` to `POST /api/v1/auth/login`, refreshes shared session state, then navigates to `/communities/irm/membership`. A failed refresh after a successful login does not discard the successful login, as before.
- Registration still sends `{ username, email, first_name, family_name, password }` to `POST /api/v1/auth/register`. Backend rules remain username 3–50 characters, valid email, first and family names 1–100 characters, and password at least 8 characters. `formatFormError` still maps server field errors and network failures.
- Registration success remains on `/register` and offers sign-in. It does not sign in or enroll the user. The copy now says IRM membership must be requested and reviewed separately.
- Pending forms disable controls, and submit handlers now also ignore duplicate submit events. Passwords are held only in React form state.
- Initial auth checking shows a neutral state. A session check error offers Retry; an authenticated direct visitor sees a signed-in state with a Home action. This avoids presenting a guest form while the session is unresolved. No return-path redirect was added.

## Composition and visual comparison

The registration reference uses a half-width ink panel, large lavender-emphasis headline, IRM identity chip, and a warm form side. The implementation follows that composition and uses the guest landing's actual EtudSup mark, near-black `#17151c` signature panel, restrained lavender `#b9a7ef`, warm page token, and shared form/button/theme controls. Sign in uses the same structure. The five real registration fields make its form taller than the three-field reference. The form starts higher on the page and the ink panel is hidden at tablet/mobile widths so fields and submit remain the priority. The reference's “verify membership” wording was adapted to the actual request-and-review flow. The public landing screenshot named in the prompt was not available as a file in this workspace; the current landing component and tokens were used as the primary brand source.

At widths up to 900px, the brand link moves above the form and the marketing panel disappears. Form controls remain at least 52px high; theme radio targets are 44px. The same semantic page, text, border, accent, feedback, and focus tokens serve both themes. The ink panel stays fixed in dark mode on desktop. Styling is scoped to the account component, with no global token changes.

Static contrast calculations against adjacent surfaces: light body/page 14.60:1, muted/page 5.74:1, placeholder/input 6.42:1, primary-button text/button 6.46:1, error/error surface 5.91:1; dark equivalents 15.65:1, 10.20:1, 9.25:1, 7.53:1, and 6.24:1. These are token-color checks; browser rendering remains unverified.

## Verification

| Command | Result |
| --- | --- |
| `cd frontend && npm run lint` | Passed. |
| `cd frontend && npx tsc --noEmit` | Passed. |
| `cd frontend && npm run build` | Passed; `/login` and `/register` generated. |
| `cd frontend && npx playwright test --config playwright.account-pages.config.ts --list` | Five cases discovered. Discovery is not execution. |
| `cd frontend && npx playwright test --config playwright.account-pages.config.ts` | Blocked before tests: local server could not start. Direct `npm run start -- --hostname 127.0.0.1 --port 3110` returned `listen EPERM: operation not permitted`. A dev attempt also found a stale/external `.next` dev-server lock, so the test config uses `next start`. |

No browser screenshots were produced. Browser visual acceptance, including the requested 390px and 1440px captures in both themes, is **unverified**. The UI automation inventory also returned no available browsers or apps. The mocked Playwright cases cover guest direct entry, navigation, payloads, pending submission, validation, successful registration, post-login navigation, delayed auth, retry, signed-in state, theme, focus, and overflow, but none could execute in this environment.

Owner-side visual review from the repository root (the responsive test saves eight full-page screenshots under `frontend/test-results/account-pages/`):

```bash
cd frontend
npm run build
npx playwright test --config playwright.account-pages.config.ts
```

The Playwright config starts `next start` on port 3110 and mocks `/api/v1/auth/me` as 401 for these screenshots. Compare the brand panel, field width, submit position, and vertical spacing with the current landing and the supplied registration image. Check 320px for overflow and keyboard focus. Because visual inspection was blocked here, further spacing adjustments may be needed after those captures.
