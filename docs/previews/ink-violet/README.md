# Ink & Violet preview

Open `index.html` directly in a modern browser. The artifact is standalone: it uses inline CSS, JavaScript, and SVG, with no backend, database, build server, or remote font/icon requests.

## Font inspection

I inspected `/home/yasso/etudsup/frontend/src/app/globals.css`, `layout.tsx`, the source tree, and `package.json` read-only. EtudSup declares this family on `body`:

```css
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

There is no `next/font` use, `@font-face`, font `@import`, local WOFF/TTF/OTF file, or font package in the inspected frontend. Therefore Inter is named in the stack but is not bundled or fetched by the application; the browser uses it only if already installed, then falls back through the listed system families. Explicit CSS weights found are 550, 650, 700, 730, 750, 760, and 800, alongside Tailwind’s normal medium/semibold/bold utility weights. The preview uses the same stack and makes no claim that Inter is present on this machine.

## Palette and component rules

| Use | Light | Dark |
| --- | --- | --- |
| Page canvas | `#F6F4F0` | `#141319` |
| Card surface | `#FFFFFF` | `#201F25` |
| Secondary surface | `#F1EFEC` | `#29272F` |
| Main text | `#211F24` | `#F2EFF5` |
| Muted text | `#5F5A63` | `#C2BDC7` |
| Quiet metadata | `#6F6973` | `#ADA7B2` |
| Fine card border | `#DAD6DF` | `#49444F` |
| Control border | `#77717F` | `#9B94A2` |
| Link violet | `#532AAE` | `#D0C0FF` |
| Accent hover | `#472194` | `#E0D5FF` |
| Soft accent surface | `#EEE8FA` | `#352B47` |
| Primary background | `#6338C4` | `#C5B2FF` |
| Primary foreground | `#FFFFFF` | `#21192E` |
| Focus ring | `#714DE2` | `#CEBCFF` |
| Hero background | `#19171E` | `#19171E` |
| Hero headline | `#F8F6FA` | `#F8F6FA` |
| Success status | `#176B48` | `#7CD5A8` |
| Danger status | `#9C3847` | `#FF9BA5` |
| PDF paper | `#FFFFFF` | `#FFFFFF` |
| PDF paper text | `#25232A` | `#25232A` |

Primary cards use a 1px border, 16px radius, 16px padding, and no resting shadow. Controls use 12px corners, pills use full radius. Violet marks active navigation, links, selected icons, and one solid primary action per screen. Dark mode uses lavender for that primary action. Secondary actions have neutral fills and visible borders. Icons are inline SVGs with consistent 1.8px stroke weight and distinct shapes for modules, documents, announcements, discussion, and membership. Color and border transitions are 170ms; reduced-motion rules shorten transitions and scrolling. `color-scheme` follows the selected theme for native controls. The paper placeholder stays white with fixed dark text in either theme.

## Contrast calculations

Ratios were calculated from the listed sRGB hex values using the WCAG relative-luminance formula (foreground against the adjacent surface):

| Combination | Ratio |
| --- | ---: |
| Light main text / canvas | 14.86:1 |
| Light muted text / canvas | 6.11:1 |
| Light quiet metadata / canvas | 4.85:1 |
| Light primary white / violet | 7.26:1 |
| Light link violet / card surface | 9.09:1 |
| Light focus ring / card surface | 5.44:1 |
| Light focus ring / ink hero | 3.27:1 |
| Light control border / white control | 4.72:1 |
| Dark main text / canvas | 16.22:1 |
| Dark muted text / canvas | 10.02:1 |
| Dark quiet metadata / canvas | 7.87:1 |
| Dark primary ink / lavender | 9.00:1 |
| Dark link violet / card surface | 9.86:1 |
| Dark focus ring / card surface | 9.55:1 |
| Dark focus ring / ink hero | 10.37:1 |
| Dark control border / neutral control | 5.57:1 |
| Hero white / ink | 16.53:1 |
| Hero muted / ink | 9.79:1 |
| Hero violet / ink | 9.22:1 |
| Paper text / white paper | 15.53:1 |

The focused ring remains distinguishable against the charcoal hero at 3.27:1 in light mode and 10.37:1 in dark mode. The fine card border is deliberately quieter than the control border; it does not carry control meaning.

## Four-screen comparison

- **Home:** keeps the IRM sidebar and the established sequence of ink hero, three useful action cards, announcements, then modules. Active members see preview announcement rows and document shortcuts; guests see sign-in and membership guidance while protected announcements and module cards are withheld. Delegate shortcuts and per-message moderation placement appear only for the Delegate selection.
- **Modules:** pairs a compact module selector with the document listing. Example records are labeled as preview data. The title search, Type and Source controls reflect current filter concepts (Course, Tutorial, Practical work, Exam, Solution, Other; Official and Student submission). The local JavaScript wires these controls to the sample rows; browser interaction was not verified.
- **Document Reader:** shows return navigation, Course/Official/Approved metadata, page and zoom toolbar, and a white paper layout placeholder. It explicitly does not run PDF.js or render a PDF.
- **Discussion:** shows the connection badge, sample message/reaction layout, composer, and Delegate-only removal-action placement. The badge cycles among preview connection states. Messages and composer are hidden in Guest mode. It does not connect to WebSockets or moderation APIs.

Theme buttons are wired to switch the light and dark palettes across all four views. The Desktop/Mobile width control constrains the preview frame to 390px and uses the mobile header, stacked Home content, and bottom navigation. At actual narrow browser widths, the same responsive rules apply.

## Home order and verification

The Home DOM places hero, action cards, announcements, and modules in that order inside `.home-main`; `.home-aside` follows it as a sibling. Desktop CSS places those siblings in columns. Mobile CSS makes the grid one column and does not use CSS `order`, so the DOM reading order remains unchanged. This was checked by source inspection and an HTML parser; no responsive browser layout check ran.

Commands/results:

- `python - <<'PY'` with `HTMLParser` — **passed**: found the four screen panels and no duplicate IDs. There are four `<main>` elements in the source, mutually hidden so only the selected screen is exposed.
- `node --check /tmp/ink-violet-preview-check.js` — **passed** for the extracted inline script (syntax only). The extraction used `Path(...).read_text()`, split between `<script>` and `</script>`, and wrote the result under `/tmp`.
- A Node Playwright attempt (`require("playwright")`, headless launch of `/usr/sbin/chromium` with `--no-sandbox`, then `goto(file://...)`) — **blocked at launch**: Chromium exited with `SIGTRAP` after crashpad reported `setsockopt: Operation not permitted`. A direct check using `chromium --headless --no-sandbox --no-zygote --single-process --disable-dev-shm-usage --disable-crash-reporter --disable-breakpad --disable-features=Crashpad --user-data-dir=/tmp/ink-chrome-profile-2 --dump-dom file:///home/yasso/irm-platform/docs/previews/ink-violet/index.html` — **blocked** with the same crashpad error. No screenshots, viewport-overflow assertions, keyboard interaction checks, or browser accessibility checks ran.
- The contrast calculation script — **ran** and produced the ratios listed above; this is a calculation, not an accessibility audit.

The role and screen controls are native buttons with text labels and `aria-pressed`; links and controls have visible `:focus-visible` styling. Destination-only controls that lead outside the four-screen preview are deliberately inert and marked as preview-only in the markup. No live API actions are claimed.

The structural parser command was:

```sh
python - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
class Check(HTMLParser):
 def __init__(self): super().__init__(); self.ids=[]; self.screens=[]; self.mains=0
 def handle_starttag(self,t,attrs):
  a=dict(attrs)
  if t=='main': self.mains+=1
  if 'id' in a: self.ids.append(a['id'])
  if 'data-screen' in a: self.screens.append(a['data-screen'])
c=Check(); c.feed(Path('docs/previews/ink-violet/index.html').read_text())
assert c.screens == ['home','modules','reader','discussion']
assert len(c.ids)==len(set(c.ids))
assert c.mains==4
print('PASS')
PY
```

The extracted inline JavaScript was checked with `node --check /tmp/ink-violet-preview-check.js`. The offline browser attempt was started from Node with `require('playwright')`, `chromium.launch({headless:true, executablePath:'/usr/sbin/chromium', args:['--no-sandbox']})`, and a local `file://` navigation; it failed before page rendering as described above.
