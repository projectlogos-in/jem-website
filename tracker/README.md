# JEM Hate Incident Tracker

A live, source-linked record of documented hate incidents against religious
minorities in India — map, trends and list in one page. Zoomable map (with
cluster and density views) on one side, filterable incident list on the other,
a Trends view of charts computed from the same filters, and a detail card —
narrative, record fields, JEM intervention status, corroboration badge and
every source link with a Wayback companion — that opens when a pin or a row
is clicked.

Built as a static site: no server, no build step, no API keys, no third-party
requests beyond map tiles and the optional live sheet (fonts and the map
library are self-hosted). Open `index.html` and it runs.

```
Tracker/
├── index.html              the page
├── assets/
│   ├── config.js           ← everything an editor changes lives here,
│   │                         including every UI string (English + Urdu),
│   │                         the validated category palette (light + dark)
│   │                         and the methodology panel copy
│   ├── app.js              application logic
│   ├── charts.js           hand-rolled SVG charts (Trends view + timeline)
│   ├── styles.css          JEM design-system tokens, light + dark themes
│   ├── fonts/              self-hosted Archivo, Source Serif 4,
│   │                         Noto Nastaliq Urdu (woff2)
│   ├── vendor/             self-hosted MapLibre GL JS
│   └── logos/              JEM mark
├── data/
│   ├── incidents.json      the snapshot the site falls back to
│   ├── incidents.csv       the same records as CSV, for researchers
│   ├── incidents.js        same snapshot as a script, for file:// use
│   ├── archive/            frozen monthly snapshots (2026-06.json, …)
│   ├── geocache.json/.js   place name → coordinates (generated)
│   └── geocode.manual.json optional hand corrections (you create this)
└── scripts/
    ├── xlsx_to_json.py     workbook → incidents.raw.json
    ├── geocode.py          incidents.raw.json + geocoding → incidents.json
    └── smoke-test.mjs      headless check of the whole front end
```

## What the tracker does

- **Map view** — clustered pins coloured by category (a machine-validated,
  colour-blind-checked palette derived from the JEM brand), a density
  (heatmap) toggle, click-to-isolate legend, and a timeline strip under the
  map: drag across it to filter every view by date.
- **Trends view** — a hero count plus incidents-over-time, by-category,
  by-state and by-community charts, all recomputed from the active filters.
  Clicking a bar toggles that filter.
- **Shareable state** — filters, search, dates, selected record, view, sort
  and language all live in the URL hash. Any view is a permalink; every
  record has a stable id (`#sel=r1a2b3c4d`) that survives re-imports. The
  browser Back button closes an opened record.
- **Citable record** — Cite dialog (plain + BibTeX, with access date and
  permalink), CSV/JSON export of the filtered set with license and citation
  headers, print briefing, and a methodology panel ("About this data")
  documenting inclusion criteria, verification, precision and corrections.
- **Subject safety** — coordinates are published at ~1 km precision
  everywhere (batch pipeline, live-sheet rows and in-browser geocoding);
  cards show locality-level match strings only.
- **Two languages** — the full interface switches between English and Urdu
  (RTL, Noto Nastaliq) from the masthead; a shared link carries its language.
- **Two themes** — light and dark (auto-detects, manual toggle persists);
  the basemap, category colours and charts all re-theme.
- **Embeds** — `index.html?embed=1` renders a chrome-light version with a
  JEM attribution bar for iframes; filters passed in the hash still apply.
- **Accessible** — full keyboard navigation (`/` searches, ↑↓ move through
  the list, Enter opens, Esc closes), focus management on the card and
  dialogs, ARIA states on every control, reduced-motion support, and the
  list as the map's equivalent representation.

## Running it

Double-click `index.html` and it works — the snapshot is bundled as a script
as well as JSON, precisely so the `file://` case is not broken.

Serving the folder is still better (it lets the page fetch fresh JSON rather
than the bundled copy, which halves the payload):

```bash
cd "/Users/alijaved/Desktop/Projects/Identities/JEM/Tracker" && python3 -m http.server 8080
```

Then open <http://localhost:8080>.

Either way the map tiles and any live sheet come over the network, so the
page needs a connection. Without one the incident list, filters, trends and
detail cards still work; only the basemap is missing.

To publish, drag this folder onto Netlify Drop, or push it to a GitHub repo
and turn on GitHub Pages. Nothing needs configuring at the host.

## Going live off a Google Sheet

The site ships reading `data/incidents.json`. To make it live, put the
sheet's URL into `assets/config.js`:

```js
sheetUrl: 'https://docs.google.com/spreadsheets/d/1AbC…/edit#gid=0',
```

The sheet must be shared as **Anyone with the link → Viewer**. From then on,
every row the team adds appears on the map within one refresh cycle
(5 minutes by default, or immediately via the Refresh button).

Column headers are matched by name — see `columns` in `config.js`. The
current `MAY_26.xlsx` layout works as-is, including its header sitting on
row 5 and its unlabelled description column. If a column gets reworded in
the sheet, add the new wording to the relevant array rather than renaming
the sheet.

**Two optional columns pay for themselves:** add `Latitude` and `Longitude`
and the tracker uses them directly, skipping geocoding entirely. (Published
coordinates are still rounded to locality precision.)

## Refreshing the snapshot from a new workbook

```bash
python3 scripts/xlsx_to_json.py "../Documents/MAY_26.xlsx" && python3 scripts/geocode.py
```

The first command normalises the workbook (dates, category spellings, state
spellings, source URLs split out of the source columns). The second geocodes
any new places (cached, 1 request/1.1 s against Nominatim), mints stable
record ids, rounds coordinates to locality precision, and writes
`incidents.json`, `incidents.js`, `incidents.csv` and a frozen monthly
snapshot under `data/archive/`.

After refreshing, run the smoke test and re-copy the folder into
`../Website/tracker/`:

```bash
node scripts/smoke-test.mjs
```

## Editing the palette or the strings

Category colours (light and dark) live in `config.js` under `categories`.
They were derived from the JEM brand hues and validated for colour-vision
safety in both themes — if you change one, re-validate before shipping
(see `Design/JEM Design System` and the dataviz validator).

Every piece of interface text lives in `config.js` under `strings.en` /
`strings.ur`. The methodology panel's copy is `methodology.sections` (and
`sections_ur`). Editing those files requires no build step — reload and it
is live.
