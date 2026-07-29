# Website upgrade — 2026-07-29

What changed in the jem.org.in rebuild, in spec order. All page HTML is
generated: the changes live in `_build/layout.mjs`, `_build/pages.mjs`,
`_build/build.mjs`, `assets/css/*`, `assets/js/site.js`. Regenerate with
`node _build/build.mjs` from the Website directory.

## A · Defects fixed

- **Mobile layout**: every inline two-column `style="display:grid…"` replaced
  with shared `.split` / `.split-wide` / `.split-narrow` classes that collapse
  to one column under 900px (home, about, report-a-hate-crime, contact,
  volunteer). Verified at 375px: `scrollWidth === viewport`, no overflow.
- **Report intake rebuilt**: the broken `<form action="mailto:" method="post">`
  is gone. The form now builds a structured plain-text report client-side
  (new fields: incident date, state/UT + district, category select matching
  the 8 tracker categories, what happened, required consent checkbox
  "I consent to JEM storing and reviewing this report"; email optional) and
  offers three guaranteed paths: WhatsApp deep link (primary), prefilled
  `mailto:`, copy-to-clipboard. A plain-language line states what happens to
  the data. The contact form now composes a prefilled `mailto:` URL on submit
  instead of the silently-failing form action.
- **Quick exit + visitor safety** on report-a-hate-crime.html: fixed
  "Quick exit →" button (`location.replace('https://www.google.com')` — no
  history entry) plus a "Your safety" note (safe device, clear history,
  WhatsApp disappearing messages).
- **Contrast (WCAG AA)**: added `--jem-saffron-text: #9A6416` (4.99:1 on
  white) and `--jem-mist-text: #6E6A80` (5.20:1) to tokens-colors.css;
  `--text-muted` now aliases the darkened mist. Applied to `.kicker`,
  `.stat-card .v.focus`, `.objective .n`, `.step .n`. Decorative uses (kicker
  bar, tricolour rule, borders) keep brand saffron. On-dark faint text that
  fell below 4.5:1 (`.tf-note`, `.helpline .l`, `.gc-kicker`) moved to
  `--jem-on-indigo-muted` (8.5:1). All introduced pairs computed ≥4.5:1.
- **Broken images**: `docTop()` and `pubCard()` now check `fs.existsSync`
  for every cover; a missing cover renders a branded CSS-only cover (indigo
  panel, kicker, title, tricolour rule) instead of a broken `<img>`. Note:
  at build time all referenced covers (including `assets/publications/
  reviews/*`, `covers/jem-annual-report-2025.png`, `covers/sambhal-report.jpg`)
  were found present on disk — the spec's missing-file list was stale — so the
  generated pages currently use real covers; the fallback guards the future.
  The build's asset scan (below) fails the build if a page ever references a
  missing local file.
- **Brand name**: nothing under Website/ outside `tracker/` says "Jamiat
  Evidence & Monitoring" (verified by grep; the tracker copy is the other
  workstream's to fix).

## B · SEO / share / crawl

- Per-page canonical, og:title/description/type/url/site_name/image(+alt)/
  locale, twitter:card, theme-color; unique 120–155-char descriptions; new
  homepage title.
- `assets/og/og-default.png` (1200×630) generated from new `_build/og-card.html`
  via headless Chrome (same pattern as the video posters).
- JSON-LD emitted by layout.mjs: NGO Organization on every page (parent org,
  address, helpline contactPoint en/hi/ur, sameAs, logo); Dataset on
  index + methodology (temporalCoverage 2026-05-01/.., CC BY 4.0,
  DataDownload → tracker/data/incidents.json); BreadcrumbList on inner pages.
- build.mjs also emits `sitemap.xml` (all pages + tracker), `robots.txt`,
  `404.html` (branded, nav + helpline strip), `feed.xml` (Atom over
  reports/reviews; dates are period-end markers), `site.webmanifest`.
- Favicon set generated from `assets/logos/jem-mark.png` via `sips`:
  favicon-32/16, apple-touch-icon (180, indigo ground), icon-192/512.

## C · New pages

- `methodology.html` — "How we document": category inclusion lines,
  primary/secondary sourcing + archive links, verification pipeline and the
  undercount/presumption-of-innocence language, geolocation precision,
  subject safety, corrections, CC BY 4.0 data reuse with JSON/CSV downloads
  and a copy-button citation (client-side accessed date), Berkeley
  Protocol / HURIDOCS standards line.
- `press.html` — boilerplate, press contact, logo pack with previews,
  suggested citation, live key statistics (build-time snapshot + live
  refresh), copy-paste tracker embed snippet.
- `accessibility.html` — WCAG 2.2 AA target, list-as-map-equivalent, known
  gaps, barrier contact.
- `404.html` — branded, with helpline strip and recovery links.
- Nav: About dropdown (About JEM / Methodology & data / Press & media);
  footer Explore column + Accessibility in the bottom line; sitemap updated.

## D · Accessibility baseline

Skip link + `<main id="main">`; `nav aria-label="Primary"`; nav-toggle
aria-controls/expanded; dropdown arrow buttons with aria-haspopup/expanded,
keyboard-openable (site.js) plus `:focus-within` CSS fallback; shared 2px
saffron `:focus-visible` outline for all interactive elements;
`prefers-reduced-motion` kills transitions and smooth scroll; footer
headings are styled `<p class="foot-head">`; Urdu nodes carry `lang="ur"
dir="rtl"` with `--font-urdu` at 1.9 line-height (Noto Nastaliq Urdu
self-hosted); `scroll-margin-top: 96px` for anchored targets; gallery
photos have descriptive activity-based alt text (no identifications).

## E · Performance & privacy

- CSS flattened at build time into one `assets/css/styles.css` (fonts →
  tokens → base → site); pages link only that file.
- Fonts self-hosted (`_build/fetch-fonts.mjs` → `assets/fonts/*.woff2`,
  4 variable files ~417KB total: Archivo 400–900, Source Serif 4 400–600,
  Noto Nastaliq Urdu 400–700 arabic+latin). Zero requests to
  fonts.googleapis.com / gstatic from any shipped page.
- Homepage tracker iframe replaced by a click-to-activate branded facade
  (iframe src `tracker/index.html?embed=1` injected on demand); direct
  full-screen link kept.
- `assets/video/jem-intro.mp4` re-encoded 56MB → **15.8MB** (720p H.264,
  `-preset slow -c:a aac -b:a 96k`). The spec's `-crf 23` produced 44MB;
  the shipped encode uses `-crf 34`, visually indistinguishable for this
  motion-graphics film (frames compared) and inside the 10–15MB target.
- Hotlinked films NOT mirrored (kept remote, per the >80MB rule):
  `jem.org.in/video/jem.mp4` is 545MB; `Jiem-video-final.mp4` is 123MB.
  `video.html` automatically switches to local copies if
  `assets/video/jem-overview.mp4` / `jem-helpline.mp4` ever appear.
- Quarterly + newsletter PDFs mirrored into `assets/downloads/` (38 of 42,
  ~340MB, `curl --max-time 60` each); hrefs rewritten to local automatically
  by the existence check in pages.mjs. **Failed (kept remote, files exceed
  the 60s window):** JEM-Newsletters-English-December-24.pdf (161MB!),
  JEM-Newsletters-English-February-25.pdf (56MB),
  JEM-Newsletters-Urdu-December-24.pdf (55MB),
  JEM-Newsletters-Urdu-February-25.pdf (75MB).
- All `<img>` in pubGrid/gallery/logo-pack carry real width/height (read
  from the file headers at build time) and `loading="lazy"` below the fold.

## F · Feature upgrades

- Homepage: "Recently documented" (3 most recent records as cards — date,
  place, category dot-badge in the tracker's light-theme colours, clipped
  narrative, deep link `tracker/index.html#sel=<id>`), a 12-week inline-SVG
  sparkline (indigo line, saffron endpoint), and "Record last updated".
  All three are **prerendered from tracker/data/incidents.json at build
  time** so they are real even over file://, then refreshed live by site.js
  where fetch works (verified both paths).
- Publications hub: filter bar (type / year / title search) over data-*
  attributes, live count, groups auto-hide when empty, collapsed newsletter
  archives auto-open while filtering; per-year quarterly anchors
  (#quarterly-2024 etc.), #annual-reviews, #newsletters-en/-ur.
- Helpline ergonomics: sticky mobile Call/WhatsApp bar on
  report-a-hate-crime.html; compact saffron "Call" button replaces the
  header helpline chip below 1280px (never hidden entirely);
  helplineStrip() added to report, contact and 404 pages.
- Print styles: chrome hidden, single column, black on white, external
  link URLs printed, tricolour rule as plain border.
- About page: Jamiat Ulama-i-Hind lineage callout (founded 1919) and a
  3-step "How the record is made" strip linking methodology.html.
- Header fits at every width (tightened nav ≤1420px, compact call button
  ≤1280px, burger ≤1130px — previously the nav overflowed 980–1400px).

## G · Verification run

- `node _build/build.mjs` exits clean. Asset scan: **689 local references
  checked across 14 pages — 0 missing**, except one expected tracker-owned
  reference: `methodology.html → tracker/data/incidents.csv` (the CSV is
  produced by the tracker workstream; the scan reports tracker/ paths as
  warnings, not failures).
- sitemap.xml / feed.xml validated with xmllint; site.webmanifest parses.
- Contrast pairs computed (script in the build log): all introduced text
  pairs ≥4.5:1.
- Interactive flows tested in a real browser: report builder (text, wa.me
  link, mailto), publications filter, tracker facade injection, live stat/
  record/sparkline refresh, mobile action bar, quick exit button.
- No servers left running.

## Deferred / known gaps

- `tracker/data/incidents.csv` 404s until the tracker workstream ships it
  (methodology links it per spec).
- `tracker/index.html?embed=1` and `#sel=<id>` deep links are emitted per
  spec for the incoming tracker; the current placeholder tracker ignores
  them gracefully (it still loads).
- The 4 oversized newsletter PDFs and 2 films above stay remote.
- Films have no captions (flagged on accessibility.html).
