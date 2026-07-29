# jem.org.in — rebuild

A ground-up reconstruction of jem.org.in on the JEM Design System, with the
live hate incident tracker embedded on the homepage and available full-screen
at `/tracker/`.

Static HTML/CSS/JS — no server, no build step to run it. Open `index.html`,
or serve the folder:

```bash
cd "/Users/alijaved/Desktop/Projects/Identities/JEM/Website" && python3 -m http.server 8733
```

Then open <http://localhost:8733>.

```
Website/
├── index.html, about.html, our-work.html, publications.html, reports.html,
│   report-a-hate-crime.html, gallery.html, video.html, contact.html,
│   volunteer.html, methodology.html, press.html, accessibility.html,
│   404.html               the 14 pages (all generated — see _build/)
├── sitemap.xml, robots.txt, feed.xml (Atom), site.webmanifest
├── tracker/                 the hate incident tracker (copy of ../Tracker),
│                             embedded on the homepage behind a
│                             click-to-load facade and linked from the nav;
│                             owned by its own workstream — do not edit here
├── assets/
│   ├── css/                 source styles: JEM Design System tokens
│   │                         (tokens-*.css), fonts.css (generated),
│   │                         site.css — flattened by the build into
│   │                         styles.css, the one file pages actually link
│   ├── fonts/               self-hosted woff2 (Archivo, Source Serif 4,
│   │                         Noto Nastaliq Urdu) — zero third-party
│   │                         requests at runtime; regenerate via
│   │                         `node _build/fetch-fonts.mjs`
│   ├── js/site.js           nav + dropdown a11y, quick exit, live tracker
│   │                         stats/records/sparkline, tracker facade,
│   │                         publications filter, report builder,
│   │                         mailto composer, copy buttons
│   ├── logos/                brand marks, copied from the design system
│   ├── downloads/            toolkits, reports, reviews and newsletters
│   │                         mirrored locally (see note below)
│   ├── publications/         cover thumbnails per issue
│   ├── og/og-default.png     1200×630 share card (see "Generated art")
│   ├── favicon-*.png, apple-touch-icon.png, icon-192/512.png
│   ├── gallery/              the 4 photos from the live site's gallery
│   └── video/                jem-intro.mp4 (720p re-encode, ~19MB) + a
│                             branded poster per video
└── _build/                   the generator. Not needed to run the site:
    ├── build.mjs             `node _build/build.mjs` — renders all pages,
    │                         flattens styles.css, emits sitemap/robots/
    │                         feed/manifest, then scans every generated
    │                         page for references to missing local files
    │                         (build fails if any are found)
    ├── layout.mjs            shared shell: head (canonical, OG, JSON-LD
    │                         NGO/Dataset/Breadcrumb), header/nav, footer
    ├── pages.mjs             page bodies + helpers (cover existence check,
    │                         image dimensions, tracker-data snapshot)
    ├── fetch-fonts.mjs       downloads + rewrites the self-hosted fonts
    ├── og-card.html          source for assets/og/og-default.png
    ├── video-poster.html     source for the video posters
    └── CHANGES.md            what the 2026-07 upgrade changed
```

## Generated art (posters, OG card)

Every video card shows a branded poster — JEM + Jamiat logos, tricolour
rule, a title — instead of a frame grabbed from the film itself. That's
deliberate: these films are real hate-crime documentation and a random frame
could surface graphic or identifying footage, which the brand's
subject-safety rule ("identifiable people appear only with consent") and
image-free visual language both argue against. The same pattern produces the
social share card (`_build/og-card.html` → `assets/og/og-default.png`).

Both are rendered to static PNG via headless Chrome, with the site served
locally (they load `/assets/css/tokens.css` and logos by root-relative path):

```bash
python3 -m http.server 8733 &   # from the Website directory
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --screenshot="assets/og/og-default.png" \
  "http://localhost:8733/_build/og-card.html"
# posters: same command with --window-size=1280,720 against
# _build/video-poster.html?kicker=...&title=...&meta=...
```

## Forms (static hosting, no backend)

- **Report a hate crime** builds a structured plain-text report client-side
  and offers three guaranteed delivery paths: a WhatsApp deep link to the
  helpline (primary), a prefilled `mailto:`, and copy-to-clipboard. The form
  itself transmits nothing. The page also carries a fixed **Quick exit**
  button (`location.replace` — no history entry), a safety note, and a
  mobile sticky Call/WhatsApp bar.
- **Contact** composes a prefilled `mailto:` URL on submit (a plain
  `<form action="mailto:">` silently fails on most systems).

## Content sourcing

Copy (mission text, objectives, helpline numbers, document titles) was
pulled from the live jem.org.in on 2026-07-28, not invented.

- **Mirrored locally** (`assets/downloads/`): the toolkit/guidance PDFs, the
  reports, both Annual Reviews, JEM's Annual Report 2025, and — since the
  2026-07 upgrade — the 10 Quarterly Reviews and the 32 monthly
  English/Urdu newsletters (best-effort; `_build/CHANGES.md` records any
  that failed and stayed remote). Cover thumbnails for every review and
  newsletter issue are in `assets/publications/`.
- **Video**: the JEM Intro film is mirrored and re-encoded to 720p
  (`assets/video/jem-intro.mp4`). The other two films still stream from
  `jem.org.in/video/*.mp4` — 545MB and 123MB at source, too large to
  mirror; re-encode them locally if jem.org.in's hosting proves unreliable.
- **Gallery**: only 4 photos exist on the live site; mirrored as-is.

## Known gaps to close before this goes live

- `tracker/data/incidents.csv` is linked from methodology.html but is
  produced by the tracker workstream; until that syncs in, the link 404s
  (the build's asset scan reports it as tracker-owned).
- The films lack captions/subtitles (noted on accessibility.html).
- Only 4 gallery photos exist; add more directly to `assets/gallery/`.
