# Ink Campus — IRM Hub visual exploration

This is a local, interactive brand preview. Open `index.html` directly in a browser; it uses inline HTML, CSS, JavaScript, and SVG, with no backend, database, build server, network requests, or font/icon CDN. It does not change the application UI.

## Visual acceptance status

**BLOCKED.** This environment could not start either installed browser, so I could not inspect rendered pixels, capture screenshots, or run viewport, keyboard, or interaction assertions. The HTML and script checks and contrast calculations below are not visual acceptance. No screenshots are included.

To complete the visual review on a machine with a working browser, open this file and capture the preview at 1440 × 1000 and 390 × 844. Use the controls to capture these eight combinations:

| File name | Composition | Theme | Screen | Persona | Width |
| --- | --- | --- | --- | --- | --- |
| `A-home-light-1440.png` | Ink Spine | Light | Home | Active member | Desktop |
| `A-home-dark-1440.png` | Ink Spine | Dark | Home | Active member | Desktop |
| `B-home-light-1440.png` | Ink Canvas | Light | Home | Active member | Desktop |
| `B-home-dark-1440.png` | Ink Canvas | Dark | Home | Active member | Desktop |
| `A-home-light-390.png` | Ink Spine | Light | Home | Active member | Mobile · 390px |
| `A-home-dark-390.png` | Ink Spine | Dark | Home | Active member | Mobile · 390px |
| `B-home-light-390.png` | Ink Canvas | Light | Home | Active member | Mobile · 390px |
| `B-home-dark-390.png` | Ink Canvas | Dark | Home | Active member | Mobile · 390px |

Also capture the side-by-side **Home** and **Modules** comparison at desktop width. At 320px and 390px, inspect the Home order from header/navigation through hero, actions, announcements, modules, and supporting panels; check horizontal overflow. Tab through the controls and screen actions in both themes, including selected and focus states. The Width control applies the mobile composition inside a 390px frame even in a desktop-sized browser; resizing the actual browser to 390px also activates the responsive rules.

## What changed

Only these new files belong to this task:

- `docs/previews/ink-campus/index.html`
- `docs/previews/ink-campus/README.md`

The earlier `docs/previews/ink-violet/` preview remains an untouched comparison. Production frontend and backend files, EtudSup files, and staged Git content were not changed for this task.

## Direction and composition

### A · Ink Spine

The desktop navigation rail is a continuous near-black brand surface. The main hero begins flush beside its upper edge, extending the same ink field into the warm workspace. Study, Community, and Delegate Management stay grouped as in IRM’s current sidebar. The rail uses a subdued lavender selection fill and a narrow violet marker. The hero is broad but compact, with the actions and useful content below it.

### B · Ink Canvas

The rail returns to a neutral surface with more open spacing and a light selected state. A separate, oversized ink header takes more vertical space in the content area, repeats the mark and IRM context, and uses a small contrasting edge detail. Larger gaps and more generous action cards create a different silhouette from A. Both directions retain left desktop navigation and the same Home content order.

Both Home compositions use the order **hero → three action cards → announcements → modules** in the main column, with contextual Quick Access, membership, and Support information in the following supporting column. Mobile styles use a single column and preserve that source order; they do not use CSS `order`. The preview’s two-column comparison shows both variants on Home and Modules. Below 821px the comparison columns stack.

The mobile navigation is a short text-labelled set of destinations in the app header. Desktop navigation follows the current Study / Community / Management route groups. Guest Home surfaces **Sign in** and **Create an account** in the hero; member and Delegate Home use a module action. Quick Access is short and persona-specific rather than repeating the sidebar.

The mark is an original pair of open, page-like learning spaces joined through a shared center and a small connection point. The same inline SVG appears beside **IRM Hub** and in a clearly labelled **EtudSup shared mark study**. It is a concept, not an official FST mark or endorsement. The hero’s outlined connected panels echo this spatial motif at a larger scale.

### Four screens

- **Home:** IRM dashboard hierarchy, contextual actions, membership guidance, and sample announcement/module rows. Guest content explains account and membership requirements. Every example record is labelled as preview content.
- **Modules:** Four illustrative module names, a selected-module document list, type and source filters, and a local title filter. Filters work against the in-page sample list. The preview does not imply progress or academic completion. Guests see the account-access gate instead of the sample list.
- **Reader:** For a signed-in persona, return navigation, sample metadata, page/zoom controls, and a permanently white paper placeholder in both themes. Guests see the sign-in gate. The reader explicitly says it does not execute PDF.js or download a real file.
- **Discussion:** For an active member or Delegate, readable sample messages, a composer, a small connection-state toggle, and Delegate action placement. Guests see the sign-in and membership gate. Text and actions identify all content as sample-only; no WebSocket or moderation API is connected.

Screen actions within the preview work locally. Links that point to application routes announce that the route is shown for reference; this standalone file does not open the app or authenticate anyone.

## Font finding and strategy

Read-only inspection of `/home/yasso/etudsup/frontend/src/app/globals.css`, `layout.tsx`, and its source files found that EtudSup declares this family on `body`:

```css
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

The app does not import `next/font`, define an `@font-face`, import a font stylesheet, or reference an app-owned font file. Its CSS requests weights 550, 650, 700, 730, 750, 760, and 800 in the global and Home styles. The font family is declared, but Inter is not loaded by the app; it appears only when the host already provides it, otherwise the browser falls through the system stack. Next’s dependency tree contains internal font files, but the inspected EtudSup app does not reference them.

This preview deliberately uses `Arial, Helvetica, sans-serif` with no remote or bundled font. On this machine, `fc-match` resolved Arial regular and bold to `/usr/share/fonts/TTF/Arial.TTF` and `/usr/share/fonts/TTF/Arialbd.TTF`. The typography rhythm is set by layout and spacing: a tightly tracked 32–60px display heading, 34–36px page heading, compact 11px eyebrow, 15px body copy, and 11–12px metadata. The browser launch failures mean I could not inspect `getComputedStyle()` or confirm the actual rendered font in a browser. On another machine the stack will use its available Arial/Helvetica or generic sans-serif face.

## Palette and component rules

| Role | Light | Dark |
| --- | --- | --- |
| Page canvas | `#F4F2EE` | `#17161B` |
| Card surface | `#FFFFFF` | `#211F25` |
| Secondary surface | `#ECE9E4` | `#2B2930` |
| Main text | `#211F24` | `#F1EEF3` |
| Body-muted text | `#5F5A63` | `#C7C1CA` |
| Quiet metadata | `#716B73` | `#B0AAB4` |
| Card border | `#D8D4CE` | `#48444D` |
| Control border | `#79737B` | `#A39CA7` |
| Ink hero and Spine rail | `#19171E` | `#19171E` |
| Hero text | `#F8F6F8` | `#F8F6F8` |
| Hero body / metadata | `#CEC9D2` / `#AAA4B0` | `#CEC9D2` / `#AAA4B0` |
| Primary action background | `#65558F` | `#B6A8D1` |
| Primary action foreground | `#FFFFFF` | `#211C29` |
| Accent hover | `#514274` | `#C9BDE0` |
| Selected / soft accent | `#EAE6F0` | `#383242` |
| Focus on content | `#65558F` | `#D0C3E5` |
| Focus on ink | `#D4C7EC` | `#D4C7EC` |
| Reader paper and text | `#FFFFFF` / `#242129` | `#FFFFFF` / `#242129` |

Violet is reserved for the primary action, selected navigation, small hero emphasis, and focus. Secondary actions remain neutral. Cards use one 1px border, 16px radius, 16px baseline padding, and no resting shadow. Buttons and inputs use 12px corners; tags and status pills use full-radius corners. Iconography is original inline SVG with consistent 1.8px line weight and separate shapes for modules, documents, announcements, posts, discussion, membership, support, and navigation.

Color and border transitions are 170ms; `prefers-reduced-motion: reduce` disables smooth scrolling and shortens transitions. Native form controls follow `color-scheme`. The PDF paper is fixed white with fixed dark text. Focus indicators are 3px outlines with offset, and links in prose retain underlines.

## Contrast calculations

Ratios below use the WCAG relative-luminance calculation on the specified sRGB foreground and its actual adjacent surface. Text combinations are above 4.5:1. Focus indicators and control borders are above the 3:1 non-text target on their stated surfaces. Pale card outlines are intentionally decorative; they do not identify an interactive control.

| Foreground / adjacent surface | Ratio |
| --- | ---: |
| Light main text `#211F24` / canvas `#F4F2EE` | 14.60:1 |
| Light muted text `#5F5A63` / white card | 6.71:1 |
| Light quiet metadata `#716B73` / canvas `#F4F2EE` | 4.63:1 |
| Light primary text `#FFFFFF` / violet `#65558F` | 6.46:1 |
| Light accent `#65558F` / canvas `#F4F2EE` | 5.78:1 |
| Light control border `#79737B` / white field | 4.61:1 |
| Light control border `#79737B` / secondary `#ECE9E4` | 3.81:1 |
| Light focus `#65558F` / white card | 6.46:1 |
| Light focus `#D4C7EC` / ink `#19171E` | 11.14:1 |
| Hero body `#CEC9D2` / ink `#19171E` | 10.92:1 |
| Dark main text `#F1EEF3` / canvas `#17161B` | 15.65:1 |
| Dark muted text `#C7C1CA` / canvas `#17161B` | 10.20:1 |
| Dark quiet metadata `#B0AAB4` / canvas `#17161B` | 7.93:1 |
| Dark primary text `#211C29` / violet `#B6A8D1` | 7.53:1 |
| Dark accent `#B6A8D1` / canvas `#17161B` | 8.15:1 |
| Dark control border `#A39CA7` / card `#211F25` | 6.11:1 |
| Dark control border `#A39CA7` / secondary `#2B2930` | 5.38:1 |
| Dark focus `#D0C3E5` / card `#211F25` | 9.80:1 |
| Dark focus `#D4C7EC` / ink `#19171E` | 11.14:1 |

## Verification and limitations

| Check | Result |
| --- | --- |
| HTMLParser structural check: one main landmark, unique literal IDs, all preview controls present | **Passed** (static source only) |
| `node --check` on extracted inline script | **Passed** (syntax only) |
| WCAG contrast calculations above | **Passed** for the listed combinations; not a full accessibility audit |
| Playwright with `/usr/sbin/chromium`, headless, `--no-sandbox` | **Blocked before page load**: Chromium exited with SIGTRAP after `crashpad ... setsockopt: Operation not permitted` |
| Playwright with `/usr/sbin/firefox`, headless | **Blocked before page load**: Firefox exited with SIGSEGV after `You are running in headless mode` |
| Desktop/mobile screenshots, actual rendered-font inspection, 320/390 overflow, visual mobile order, keyboard, theme and interaction checks | **Not run** because no browser could render the page |

The successful checks were run with Python’s standard `html.parser`, `node --check`, and an inline Python implementation of the WCAG 2.x relative-luminance formula. They confirm document shape, JavaScript syntax, and the listed color ratios only. They do not establish that the UI renders correctly. Consequently **visual acceptance remains blocked pending owner-side browser review**.

## Scope confirmation

The only deliverables are the two files listed above. No application source, backend, database, owner data, EtudSup file, dependency, lockfile, or deployment file was changed. The rejected `docs/previews/ink-violet/` preview was preserved. No files were staged, committed, pushed, or deployed.
