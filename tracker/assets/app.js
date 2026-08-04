/* ============================================================
   JEM Incident Tracker
   Live map + trends view of documented hate incidents. Reads either
   a published Google Sheet (when configured) or the bundled JSON
   snapshot, plots every located incident, aggregates the filtered
   set into charts, and opens a source-linked detail card.

   The URL hash is the single source of truth for shareable state:
   filters, dates, selected record, view, sort and language.
   ============================================================ */

(() => {
'use strict';

const CFG = window.JEM_CONFIG;
const OTHER = 'other';

/* ------------------------------------------------------------------
   State
   ------------------------------------------------------------------ */

const state = {
  incidents: [],
  filtered: [],
  selected: null,
  sortDesc: true,
  clustered: true,
  mapMode: 'pins',          // 'pins' | 'heat' | 'states'
  view: 'map',              // 'map' | 'trends'
  lang: ['ur', 'hi'].includes(document.documentElement.lang) ? document.documentElement.lang : 'en',
  theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  source: 'loading',        // 'sheet' | 'static' | 'error'
  updatedAt: null,
  embed: new URLSearchParams(location.search).get('embed') === '1',
  filters: { category: new Set(), state: new Set(), minority: new Set(), from: '', to: '', q: '' },
};

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------
   i18n
   ------------------------------------------------------------------ */

const t = (key) => {
  const L = CFG.strings[state.lang] || CFG.strings.en;
  return (key in L ? L[key] : CFG.strings.en[key]) ?? key;
};
const locale = () => (state.lang === 'ur' ? 'ur-PK' : state.lang === 'hi' ? 'hi-IN' : 'en-GB');

function applyStrings() {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ur' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = t(el.dataset.i18n);
    if (typeof v === 'string') el.textContent = v;
  });
  $('search').placeholder = t('searchPlaceholder');
  $('search').setAttribute('aria-label', t('searchLabel'));
  if ($('fb-search')) {
    $('fb-search').placeholder = t('searchPlaceholder');
    $('fb-search').setAttribute('aria-label', t('searchLabel'));
  }
  if ($('fb-category')) $('fb-category').setAttribute('aria-label', t('category'));
  if ($('fb-state')) $('fb-state').setAttribute('aria-label', t('state'));
  $('date-from').setAttribute('aria-label', t('from'));
  $('date-to').setAttribute('aria-label', t('to'));
  $('card-close').setAttribute('aria-label', t('closeDetail'));
  $('btn-theme').setAttribute('aria-label', state.theme === 'dark' ? t('themeLight') : t('themeDark'));
  $('btn-lang').textContent = t('langToggle');
  $('btn-lang').title = t('langToggleTitle');
  $('btn-lang').setAttribute('lang', state.lang === 'en' ? 'ur' : state.lang === 'ur' ? 'hi' : 'en');
  $('sort').textContent = state.sortDesc ? t('newestFirst') : t('oldestFirst');
  renderPresets();
}

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

const normKey = (s) => String(s || '')
  .replace(/\s+/g, ' ')
  .replace(/[\r\n]+/g, ' ')
  .trim()
  .toLowerCase();

function categoryKey(raw) {
  const k = normKey(raw);
  if (!k) return OTHER;
  const aliased = CFG.categoryAliases[k] || k;
  return CFG.categories[aliased] ? aliased : OTHER;
}

const catCfg = (raw) => CFG.categories[categoryKey(raw)] || CFG.categories[OTHER];
const catColor = (raw) => (state.theme === 'dark' && catCfg(raw).dark) ? catCfg(raw).dark : catCfg(raw).color;
const catLabel = (raw) => catCfg(raw)['label_' + state.lang] || catCfg(raw).label;

/* Short stable slugs for the URL hash. */
const CAT_SLUGS = {
  'act of violence': 'violence',
  'attacks on religious spaces': 'religious',
  'police atrocity': 'police',
  'state-sponsored discriminatory practice': 'state',
  'act of hate': 'hate',
  'discrimination, exclusion & prejudice': 'discrimination',
  'media manipulation & distortion of facts': 'media',
  'other': 'other',
};
const SLUG_CATS = Object.fromEntries(Object.entries(CAT_SLUGS).map(([k, v]) => [v, k]));
const catSlug = (key) => CAT_SLUGS[key] || encodeURIComponent(key);
const slugCat = (slug) => {
  if (SLUG_CATS[slug]) return SLUG_CATS[slug];
  // A truncated share link can carry a malformed escape — never let it throw.
  try { return decodeURIComponent(slug); } catch { return slug; }
};

function formatDate(isoDate) {
  if (!isoDate) return t('dateNotRecorded');
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d)) return isoDate;
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function monthLabel(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return isNaN(d) ? '' : d.toLocaleDateString(locale(), { month: 'short', year: '2-digit' });
}

/* Bin labels for the charts/timeline: '2026-06-08' or '2026-06'. */
function binLabel(key, mode, short) {
  if (mode === 'month') {
    const d = new Date(key + '-01T00:00:00');
    return d.toLocaleDateString(locale(), { month: 'short', year: short ? '2-digit' : 'numeric' });
  }
  const d = new Date(key + 'T00:00:00');
  const s = d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  if (mode === 'week' && !short) {
    const wf = t('weekOf');
    return typeof wf === 'function' ? wf(s) : `${wf} ${s}`;
  }
  return s;
}

/* Escape before anything from the sheet touches innerHTML. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = () => window.innerWidth <= 820;

/* JS port of scripts/xlsx_to_json.py clean() — the canonical text form the
   batch pipeline hashes and publishes. Applied to sheet rows so live data
   and the snapshot agree byte-for-byte. */
function cleanText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

function validYmd(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* The date exactly as the batch pipeline would parse it — used ONLY for the
   stable-id hash, so a sheet row mints the same id its snapshot row will.
   (The display path keeps the more tolerant parseDate below.) */
function pipelineDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + parseFloat(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/);
  if (m) return validYmd(+m[4], +m[3], +m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return validYmd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

/* Content-derived stable id — mirrors stable_id() in scripts/geocode.py
   (FNV-1a over UTF-16 code units of place|date|description-head). */
function stableId(place, date, description, used) {
  const text = `${place || ''}|${date || ''}|${Array.from(description || '').slice(0, 80).join('')}`;
  let h = 0x811C9DC5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const base = 'r' + h.toString(16).padStart(8, '0');
  let out = base, n = 2;
  while (used.has(out)) out = `${base}-${n++}`;
  used.add(out);
  return out;
}

/* ------------------------------------------------------------------
   URL hash — shareable state
   ------------------------------------------------------------------ */

let applyingHash = false;
let booted = false;      // undo entries only record user actions, not boot
const undoStack = [];

function hashFromState() {
  const p = new URLSearchParams();
  const f = state.filters;
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.category.size) p.set('cat', [...f.category].map(catSlug).join(','));
  if (f.state.size) p.set('st', [...f.state].join('|'));
  if (f.minority.size) p.set('com', [...f.minority].join('|'));
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (state.selected) p.set('sel', state.selected);
  if (state.view !== 'map') p.set('view', state.view);
  if (state.mapMode !== 'pins') p.set('mode', state.mapMode);
  if (!state.sortDesc) p.set('sort', 'asc');
  if (state.lang !== 'en') p.set('lang', state.lang);
  const s = p.toString();
  return s ? '#' + s : '';
}

function writeHash(push = false) {
  if (applyingHash) return;
  const h = hashFromState();
  if (h === location.hash || (!h && !location.hash)) return;
  // Every distinct state is undoable via the toolbar Back button,
  // independent of browser history (filters use replaceState).
  if (booted) {
    undoStack.push(location.hash);
    if (undoStack.length > 60) undoStack.shift();
  }
  const url = location.pathname + location.search + h;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
  syncEmbedLink();
  updateBackButton();
}

function updateBackButton() {
  const b = $('btn-back');
  if (b) b.hidden = !undoStack.length;
}

function goBack() {
  if (!undoStack.length) return;
  const h = undoStack.pop();
  applyingHash = true;
  history.replaceState(null, '', location.pathname + location.search + h);
  readHash();
  applyingHash = false;
  applyHashToUI();
  syncEmbedLink();
  updateBackButton();
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const f = state.filters;
  f.q = p.get('q') || '';
  f.category = new Set((p.get('cat') || '').split(',').filter(Boolean).map(slugCat).filter((k) => CFG.categories[k]));
  f.state = new Set((p.get('st') || '').split('|').filter(Boolean));
  f.minority = new Set((p.get('com') || '').split('|').filter(Boolean));
  f.from = /^\d{4}-\d{2}-\d{2}$/.test(p.get('from') || '') ? p.get('from') : '';
  f.to = /^\d{4}-\d{2}-\d{2}$/.test(p.get('to') || '') ? p.get('to') : '';
  state.selected = p.get('sel') || null;
  state.view = p.get('view') === 'trends' ? 'trends' : 'map';
  const mode = p.get('mode');
  const want = (mode === 'heat' || mode === 'states') ? mode : 'pins';
  // Applied synchronously (setMapMode assigns state.mapMode before any
  // await), so the very next render serializes the same mode back into
  // the hash instead of stripping it.
  if (want !== state.mapMode) setMapMode(want);
  state.sortDesc = p.get('sort') !== 'asc';
  const lang = p.get('lang');
  if (['en', 'ur', 'hi'].includes(lang)) state.lang = lang;
}

function applyHashToUI() {
  applyingHash = true;
  $('search').value = state.filters.q;
  $('date-from').value = state.filters.from;
  $('date-to').value = state.filters.to;
  applyStrings();
  setView(state.view, false);
  render();
  if (state.selected) {
    const inc = state.incidents.find((i) => String(i.id) === String(state.selected));
    if (inc) { renderCard(inc); $('card').classList.add('open'); }
    else { state.selected = null; $('card').classList.remove('open'); }
  } else {
    $('card').classList.remove('open');
  }
  applyingHash = false;
}

function syncEmbedLink() {
  const a = $('embed-open');
  if (a) a.href = 'index.html' + hashFromState();
}

/* Permalink for sharing — always an absolute URL without ?embed. */
function permalink() {
  return location.origin === 'null' || location.protocol === 'file:'
    ? 'https://jem.org.in/tracker/' + hashFromState()
    : location.origin + location.pathname.replace(/\?.*$/, '') + hashFromState();
}

/* ------------------------------------------------------------------
   Source / media
   ------------------------------------------------------------------ */

const PLATFORMS = [
  { test: (h) => h === 'x.com' || h === 'twitter.com' || h.endsWith('.twitter.com'), key: 'x', name: 'X (Twitter)', glyph: 'X' },
  { test: (h) => h === 'facebook.com' || h.endsWith('.facebook.com') || h === 'fb.watch', key: 'facebook', name: 'Facebook', glyph: 'f' },
  { test: (h) => h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be', key: 'youtube', name: 'YouTube', glyph: '▶' },
  { test: (h) => h === 'instagram.com' || h.endsWith('.instagram.com'), key: 'instagram', name: 'Instagram', glyph: '◎' },
];

function platformOf(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { host = String(url); }
  const hit = PLATFORMS.find((p) => p.test(host));
  return hit || { key: 'web', name: host || 'Web source', glyph: '↗' };
}

/* YouTube is the one platform that embeds without a login or SDK, so it is
   the only one rendered inline; everything else is a link card. */
function youtubeId(url) {
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

const sourceUrls = (inc) => (inc.sources || []).filter((s) => s.url);

function renderSources(sources) {
  if (!sources || !sources.length) {
    return `<div class="source-note">${esc(t('noSource'))}</div>`;
  }
  const embeds = [];
  const links = sources.map((s) => {
    if (!s.url) {
      return `<div class="source"><div class="source-icon">•</div>
        <div class="source-text"><div class="source-note">${esc(s.note || '')}</div>
        <div class="source-kind">${esc(s.kind || t('source'))}</div></div></div>`;
    }
    const yt = youtubeId(s.url);
    if (yt && embeds.length < 2) {
      embeds.push(`<div class="media-frame"><iframe src="https://www.youtube-nocookie.com/embed/${esc(yt)}"
        title="Source video" loading="lazy" allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`);
    }
    const p = platformOf(s.url);
    let shown = s.url;
    try { const u = new URL(s.url); shown = u.hostname.replace(/^www\./, '') + u.pathname; } catch {}
    const kind = s.kind === 'Primary' ? t('primary') : s.kind === 'Secondary' ? t('secondary') : (s.kind || t('source'));
    return `<div class="source-row"><a class="source" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">
      <span class="source-icon" data-platform="${esc(p.key)}">${esc(p.glyph)}</span>
      <span class="source-text">
        <span class="source-platform">${esc(p.name)}</span>
        <span class="source-kind">${esc(kind)}</span>
        <span class="source-url">${esc(shown.slice(0, 58))}</span>
      </span></a>
      <a class="source-archive" href="https://web.archive.org/web/${esc(encodeURI(s.url))}" target="_blank"
         rel="noopener noreferrer" title="Wayback Machine">${esc(t('archived'))}</a></div>`;
  }).join('');

  return embeds.join('') + `<div class="sources">${links}</div>`;
}

/* ------------------------------------------------------------------
   CSV parsing (RFC 4180 — handles quoted commas and newlines)
   ------------------------------------------------------------------ */

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/* ------------------------------------------------------------------
   Data loading
   ------------------------------------------------------------------ */

function sheetCsvUrl(raw) {
  const idMatch = String(raw).match(/\/spreadsheets\/d\/([\w-]+)/);
  const id = idMatch ? idMatch[1] : (/^[\w-]{20,}$/.test(raw.trim()) ? raw.trim() : null);
  if (!id) return null;
  const gidMatch = String(raw).match(/[#?&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

/* Find the header row — the first row where at least three configured
   column names appear. The JEM workbook keeps its header on row 5. */
function locateHeader(rows) {
  const wanted = new Set(Object.values(CFG.columns).flat().map(normKey));
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const hits = rows[i].filter((c) => wanted.has(normKey(c))).length;
    if (hits >= 3) return i;
  }
  return 0;
}

function mapColumns(header) {
  const cols = {};
  header.forEach((raw, idx) => {
    const key = normKey(raw);
    for (const [field, names] of Object.entries(CFG.columns)) {
      if (names.some((n) => normKey(n) === key)) (cols[field] ||= []).push(idx);
    }
  });
  return cols;
}

const URL_RE = /https?:\/\/[^\s,]+/g;

function rowToIncident(row, cols, descIdx, i, used) {
  const first = (field) => {
    for (const idx of cols[field] || []) {
      const v = (row[idx] || '').trim();
      if (v) return v;
    }
    return '';
  };
  const all = (field) => (cols[field] || []).map((idx) => (row[idx] || '').trim()).filter(Boolean);

  const place = cleanText(first('place'));
  const description = cleanText(descIdx != null ? (row[descIdx] || '').trim() : first('description'));
  if (!place && !description) return null;

  const sources = [];
  const seen = new Set();
  [['source_primary', 'Primary'], ['source_secondary', 'Secondary']].forEach(([field, kind]) => {
    all(field).forEach((text) => {
      const urls = text.match(URL_RE) || [];
      urls.forEach((u) => {
        const clean = u.replace(/[).,]+$/, '');
        if (!seen.has(clean)) { seen.add(clean); sources.push({ kind, url: clean }); }
      });
      if (!urls.length) sources.push({ kind, note: text });
    });
  });

  // Editorial coordinates are published at locality precision (~1 km),
  // the same data-minimisation rule the batch pipeline applies.
  const lat = Math.round(parseFloat(first('lat')) * 100) / 100;
  const lon = Math.round(parseFloat(first('lon')) * 100) / 100;
  const ref = first('id') || String(i + 1);
  const rawDate = first('date');
  const date = parseDate(rawDate);
  const inc = {
    // Hash the pipeline-canonical date so ids match the published snapshot
    // even where the display parser is more forgiving.
    id: stableId(place, pipelineDate(rawDate), description, used),
    ref,
    date,
    place,
    state: titleState(first('state')),
    category: first('category'),
    minority: first('minority'),
    description,
    legal_status: first('legal_status'),
    perpetrator: first('perpetrator'),
    affiliation: first('affiliation'),
    intervention: first('intervention'),
    sources,
  };
  if (isFinite(lat) && isFinite(lon)) { inc.lat = lat; inc.lon = lon; }
  inc.geocodable = !NON_GEO.has(normKey(place)) && !NON_GEO.has(normKey(inc.state));
  return inc;
}

/* Keep in sync with NON_GEOGRAPHIC in scripts/xlsx_to_json.py. */
const NON_GEO = new Set(['', 'online', 'india', 'nationwide', 'national', 'social media',
                         'pan-india', 'pan india', 'various', 'multiple states']);

/* Alias lookup is case-insensitive so 'UP', 'Up' and 'up' all fold to
   'Uttar Pradesh' — the config keys stay human-readable. */
const STATE_ALIAS_LC = Object.fromEntries(
  Object.entries(CFG.stateAliases || {}).map(([k, v]) => [k.toLowerCase(), v]));

function titleState(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const alias = STATE_ALIAS_LC[s.toLowerCase()];
  if (alias) return alias;
  return s.split(' ')
    .map((w) => (w === w.toUpperCase() && w.length <= 3 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Excel/Sheets serial day number
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + parseFloat(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy.map(Number);
    if (y < 100) y += 2000;
    if (m > 12 && d <= 12) [d, m] = [m, d];   // an MDY slip in a DMY log
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (isNaN(parsed)) return null;
  // Build from local components — toISOString would shift IST dates back a day.
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

async function loadStatic() {
  try {
    const res = await fetch('data/incidents.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      return { incidents: json.incidents || json, generated: json.generated || null };
    }
  } catch {
    // file:// — fall through to the bundled script copy
  }
  if (window.JEM_DATA) {
    return { incidents: window.JEM_DATA.incidents, generated: window.JEM_DATA.generated };
  }
  throw new Error('no snapshot available');
}

async function loadSheet(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`sheet: ${res.status}`);
  const rows = parseCSV(await res.text());
  if (!rows.length) throw new Error('sheet is empty');

  const headerIdx = locateHeader(rows);
  const cols = mapColumns(rows[headerIdx]);
  if (!cols.place && !cols.description) throw new Error('no recognised columns — check config.columns');

  // The JEM sheet's description column carries no header; it sits directly
  // after Place. Only take it positionally if that column is truly unnamed.
  const named = new Set(Object.values(cols).flat());
  let descIdx = null;
  if (!cols.description && cols.place) {
    const candidate = cols.place[0] + 1;
    if (!named.has(candidate)) descIdx = candidate;
  }

  const used = new Set();
  return {
    incidents: rows.slice(headerIdx + 1)
      .map((r, i) => rowToIncident(r, cols, descIdx, i, used))
      .filter(Boolean),
    generated: new Date().toISOString(),
  };
}

/* --- Coordinates ------------------------------------------------- */

let geocache = {};
const GEO_LS_KEY = 'jem-geocache-v1';

function localGeocache() {
  try { return JSON.parse(localStorage.getItem(GEO_LS_KEY) || '{}'); } catch { return {}; }
}
function saveLocalGeocache(obj) {
  try { localStorage.setItem(GEO_LS_KEY, JSON.stringify(obj)); } catch {}
}

async function loadGeocache() {
  let batch = window.JEM_GEOCACHE || {};
  try {
    const res = await fetch('data/geocache.json', { cache: 'no-store' });
    if (res.ok) batch = await res.json();
  } catch {
    // file:// — the bundled script copy above is already in hand
  }
  geocache = Object.assign({}, batch, localGeocache());
}

const geoKey = (inc) => `${inc.place} | ${inc.state}`;

function applyGeocache(incidents) {
  incidents.forEach((inc) => {
    if (isFinite(inc.lat) && isFinite(inc.lon)) return;
    const hit = geocache[geoKey(inc)];
    if (hit && isFinite(hit.lat)) {
      // Locality precision only — same rule as the batch pipeline.
      inc.lat = Math.round(hit.lat * 100) / 100;
      inc.lon = Math.round(hit.lon * 100) / 100;
      inc.geo_approx = !!hit.approximate;
      inc.geo_matched = hit.matched || '';
    }
  });
}

/* Look up any rows the batch geocoder has not seen, one per 1.2s so the
   public Nominatim endpoint is not hammered. Results persist in
   localStorage; run scripts/geocode.py to fold them into the repo. */
let geocoding = false;

async function geocodeMissing(incidents) {
  if (!CFG.geocodeNewRows || geocoding) return;
  geocoding = true;
  try {
    await geocodeMissingInner(incidents);
  } finally {
    geocoding = false;
  }
}

async function geocodeMissingInner(incidents) {
  const local = localGeocache();
  const todo = [];
  incidents.forEach((inc) => {
    if (isFinite(inc.lat) || !inc.geocodable) return;
    const key = geoKey(inc);
    if (key in geocache || todo.includes(key)) return;
    todo.push(key);
  });
  if (!todo.length) return;

  setStatus(state.source, t('locating'));
  for (const key of todo) {
    const [place, st] = key.split(' | ');
    const q = st ? `${place}, ${st}, India` : `${place}, India`;
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=' + encodeURIComponent(q);
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      const hits = r.ok ? await r.json() : [];
      const hit = hits[0];
      local[key] = geocache[key] = hit
        ? { lat: Math.round(hit.lat * 100) / 100, lon: Math.round(hit.lon * 100) / 100,
            matched: String(hit.display_name || '').split(',').slice(-3).join(',').trim(), approximate: false }
        : null;
    } catch {
      break; // offline or rate-limited — try again next refresh
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  // Merge with whatever is in storage now — never clobber a parallel run.
  saveLocalGeocache(Object.assign(localGeocache(), local));
  applyGeocache(incidents);
  render();
  setStatus(state.source);
}

/* ------------------------------------------------------------------
   Map
   ------------------------------------------------------------------ */

let map = null, mapReady = false;

function toGeoJSON(incidents) {
  return {
    type: 'FeatureCollection',
    features: incidents
      .filter((i) => isFinite(i.lat) && isFinite(i.lon))
      .map((i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
        properties: { id: i.id, cat: categoryKey(i.category), color: catColor(i.category) },
      })),
  };
}

/* The default basemap is a clean, self-contained India: background colour
   plus the bundled state polygons (Government of India boundaries), so no
   neighbouring-country detail and no disputed-boundary rendering appears.
   Only glyphs for labels are fetched externally. */
function baseStyle() {
  if (CFG.basemap !== 'india') {
    return (state.theme === 'dark' && CFG.mapStyleDark) ? CFG.mapStyleDark : CFG.mapStyle;
  }
  const dark = state.theme === 'dark';
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {},
    layers: [{
      id: 'background',
      type: 'background',
      paint: { 'background-color': dark ? '#14122B' : '#EFEDF6' },
    }],
  };
}

function initMap() {
  if (typeof maplibregl === 'undefined') {
    $('map').innerHTML =
      `<div class="empty" style="padding-top:80px;color:var(--text-muted)">${esc(t('mapFailed'))}<br>${esc(t('mapFailedHint'))}</div>`;
    return;
  }

  map = new maplibregl.Map({
    container: 'map',
    style: baseStyle(),
    center: CFG.center,
    zoom: CFG.zoom,
    maxZoom: CFG.basemap === 'india' ? Math.min(CFG.maxZoom, 9) : CFG.maxZoom,
    attributionControl: CFG.basemap === 'india'
      ? { compact: true, customAttribution: 'Boundaries as published by the Government of India' }
      : { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-right');

  // The container can measure empty at construction (fonts/layout still
  // settling), leaving the canvas at MapLibre's 400×300 fallback — track
  // the panel's real size instead of trusting the first measurement.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => map && map.resize()).observe($('map-panel'));
  }
  window.addEventListener('load', () => map && map.resize());

  // 'style.load' fires as soon as the style JSON is usable — and again after
  // every setStyle (theme swap) — unlike 'load', which waits for every tile
  // and sprite and can hang the layers on a slow connection. The deferral
  // matters: a GeoJSON source added synchronously inside this handler never
  // gets processed by MapLibre 4.7's worker; one tick later it works.
  map.on('style.load', () => { setTimeout(() => { addIncidentLayers(); addStateLayers(); }, 0); });
  wireMapInteractions();
  wireStateInteractions();

  map.on('error', (e) => {
    if (e && e.error && /style|tiles/i.test(String(e.error.message || ''))) {
      console.warn('Basemap failed to load:', e.error.message);
    }
  });
}

/* A font stack the current style's glyph server actually hosts — hardcoding
   one (e.g. 'Noto Sans Bold') wedges the whole GeoJSON source when the
   style's endpoint doesn't serve it: the failed glyph fetch never resolves
   and the source's tiles stay pending forever. */
function styleFont() {
  const layers = (map.getStyle() || {}).layers || [];
  let fallback = null;
  for (const l of layers) {
    const f = l.layout && l.layout['text-font'];
    if (Array.isArray(f) && f.length && typeof f[0] === 'string') {
      if (!/italic/i.test(f[0])) return f; // prefer an upright stack
      fallback = fallback || f;
    }
  }
  return fallback || ['Noto Sans Regular'];
}

/* Source + layers, kept separate from the interaction handlers so toggling
   clustering (a source-level option) can rebuild them without stacking up
   duplicate click listeners. */
function addIncidentLayers() {
  if (map.getSource('incidents')) return;
  map.addSource('incidents', {
    type: 'geojson',
    data: toGeoJSON(state.filtered),
    cluster: state.clustered,
    clusterRadius: 42,
    clusterMaxZoom: 11,
  });
  // Unclustered twin for the density (heatmap) layer.
  map.addSource('incidents-flat', { type: 'geojson', data: toGeoJSON(state.filtered) });

  map.addLayer({
    id: 'heat',
    type: 'heatmap',
    source: 'incidents-flat',
    layout: { visibility: state.mapMode === 'heat' ? 'visible' : 'none' },
    paint: {
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 18, 9, 34],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 9, 1.6],
      'heatmap-opacity': 0.75,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(42,35,96,0)',
        0.25, 'rgba(74,65,145,0.45)',
        0.55, 'rgba(94,90,154,0.75)',
        0.8, 'rgba(221,149,51,0.85)',
        1, 'rgba(221,149,51,1)'],
    },
  });

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'incidents',
    filter: ['has', 'point_count'],
    layout: { visibility: state.mapMode === 'pins' ? 'visible' : 'none' },
    paint: {
      'circle-color': state.theme === 'dark' ? '#4A4191' : '#2A2360',
      'circle-opacity': 0.9,
      'circle-radius': ['step', ['get', 'point_count'], 15, 5, 20, 15, 26, 40, 33],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': 'rgba(255,255,255,0.85)',
    },
  });

  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'incidents',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': styleFont(),
      'text-size': 12,
      visibility: state.mapMode === 'pins' ? 'visible' : 'none',
    },
    paint: { 'text-color': '#ffffff' },
  });

  map.addLayer({
    id: 'points',
    type: 'circle',
    source: 'incidents',
    filter: ['!', ['has', 'point_count']],
    layout: { visibility: state.mapMode === 'pins' ? 'visible' : 'none' },
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 8, 13, 12],
      'circle-stroke-width': 1.6,
      'circle-stroke-color': state.theme === 'dark' ? 'rgba(20,18,43,0.9)' : 'rgba(255,255,255,0.9)',
      'circle-opacity': 0.92,
    },
  });

  // A saffron ring marks the incident whose card is open.
  map.addLayer({
    id: 'points-selected',
    type: 'circle',
    source: 'incidents',
    filter: ['==', ['get', 'id'], '__none__'],
    layout: { visibility: state.mapMode === 'pins' ? 'visible' : 'none' },
    paint: {
      'circle-color': 'rgba(0,0,0,0)',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 11, 13, 20],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#DD9533',
    },
  });

  mapReady = true;
  updateMapData();
}

function wireMapInteractions() {
  map.on('click', 'points', (e) => selectIncident(e.features[0].properties.id, false));
  map.on('click', 'clusters', (e) => {
    const f = e.features[0];
    map.getSource('incidents').getClusterExpansionZoom(f.properties.cluster_id).then((z) => {
      if (reducedMotion()) map.jumpTo({ center: f.geometry.coordinates, zoom: z });
      else map.easeTo({ center: f.geometry.coordinates, zoom: z, duration: 500 });
    });
  });
  ['points', 'clusters'].forEach((layer) => {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  });
}

function updateMapData() {
  if (!mapReady) return;
  const geo = toGeoJSON(state.filtered);
  map.getSource('incidents').setData(geo);
  map.getSource('incidents-flat').setData(geo);
  map.setFilter('points-selected', ['==', ['get', 'id'], state.selected || '__none__']);
  updateStateFill();
}

/* Theme switch rebuilds the style; the persistent 'style.load' handler
   re-adds the incident layers on top of it. */
function swapMapStyle() {
  if (!map) return;
  mapReady = false;
  map.setStyle(baseStyle(), { diff: false });
}

/* ------------------------------------------------------------------
   State choropleth — current-boundary states shaded by incident count.
   Geometry loads lazily on first use (bundled as a script over file://).
   ------------------------------------------------------------------ */

let statesGeo = null;
let worldGeo = null;

async function ensureWorldGeo() {
  if (worldGeo) return true;
  if (window.JEM_WORLD_GEO) { worldGeo = window.JEM_WORLD_GEO; return true; }
  try {
    const r = await fetch('data/world.json');
    if (r.ok) { worldGeo = await r.json(); return true; }
  } catch {}
  return false;
}

async function ensureStatesGeo() {
  if (statesGeo) return true;
  if (window.JEM_STATES_GEO) { statesGeo = window.JEM_STATES_GEO; return true; }
  try {
    const r = await fetch('data/india-states.json');
    if (r.ok) { statesGeo = await r.json(); return true; }
  } catch {}
  return false;
}

const normStateName = (s) => String(s || '').toLowerCase()
  .replace(/&/g, 'and').replace(/\s+/g, ' ').trim();

function stateCountMap() {
  const m = new Map();
  state.filtered.forEach((i) => {
    if (!i.state) return;
    const k = normStateName(i.state);
    m.set(k, { n: (m.get(k) || { n: 0 }).n + 1, name: i.state });
  });
  return m;
}

function lerpHex(a, b, t) {
  const c = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = c(a), [r2, g2, b2] = c(b);
  const mix = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${mix(r1, r2)},${mix(g1, g2)},${mix(b1, b2)})`;
}

function stateFillExpr() {
  const counts = stateCountMap();
  const max = Math.max(1, ...[...counts.values()].map((v) => v.n));
  const light = state.theme !== 'dark';
  const lo = light ? '#DDD9EC' : '#2A2453';
  const hi = light ? '#2A2360' : '#A79FE0';
  const zero = light ? 'rgba(42,35,96,0.05)' : 'rgba(255,255,255,0.05)';
  const expr = ['match', ['get', 'state']];
  (statesGeo.features || []).forEach((f) => {
    const hit = counts.get(normStateName(f.properties.state));
    // sqrt keeps the low counts distinguishable instead of one dark leader
    expr.push(f.properties.state, hit ? lerpHex(lo, hi, Math.sqrt(hit.n / max)) : zero);
  });
  expr.push('rgba(0,0,0,0)');
  return { expr, max };
}

function stateLabelPoints() {
  return {
    type: 'FeatureCollection',
    features: (statesGeo.features || [])
      .filter((f) => isFinite(f.properties.lx))
      .map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [f.properties.lx, f.properties.ly] },
        properties: { state: f.properties.state },
      })),
  };
}

function addStateLayers() {
  if (!statesGeo || map.getSource('states')) return;
  const india = CFG.basemap === 'india';
  const vis = state.mapMode === 'states' ? 'visible' : 'none';
  const alwaysVis = india ? 'visible' : vis;
  // Everything slides beneath the incident layers when those already exist,
  // and beneath any tile-basemap labels otherwise.
  const firstSymbol = (map.getStyle().layers || []).find((l) => l.type === 'symbol');
  const before = map.getLayer('heat') ? 'heat' : (firstSymbol && firstSymbol.id);
  map.addSource('states', { type: 'geojson', data: statesGeo });
  if (india) {
    const dark = state.theme === 'dark';
    // Unlabeled world context first — neutral land, faint country lines.
    // India is absent from this layer; the official geometry below covers it.
    if (worldGeo && !map.getSource('world')) {
      map.addSource('world', { type: 'geojson', data: worldGeo });
      map.addLayer({
        id: 'world-fill',
        type: 'fill',
        source: 'world',
        paint: { 'fill-color': dark ? '#181430' : '#DEDAE9' },
      }, before);
      map.addLayer({
        id: 'world-lines',
        type: 'line',
        source: 'world',
        paint: {
          'line-color': dark ? 'rgba(255,255,255,0.12)' : 'rgba(42,35,96,0.14)',
          'line-width': 0.6,
        },
      }, before);
    }
    // The country itself — the ground everything sits on.
    map.addLayer({
      id: 'india-fill',
      type: 'fill',
      source: 'states',
      paint: { 'fill-color': dark ? '#211C42' : '#FFFFFF' },
    }, before);
  }
  map.addLayer({
    id: 'state-fills',
    type: 'fill',
    source: 'states',
    layout: { visibility: vis },
    paint: { 'fill-color': stateFillExpr().expr, 'fill-opacity': india ? 1 : 0.8 },
  }, before);
  map.addLayer({
    id: 'state-lines',
    type: 'line',
    source: 'states',
    layout: { visibility: alwaysVis },
    paint: india ? {
      'line-color': state.theme === 'dark' ? 'rgba(255,255,255,0.35)' : 'rgba(42,35,96,0.30)',
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.7, 7, 1.2],
    } : {
      'line-color': state.theme === 'dark' ? 'rgba(20,18,43,0.85)' : 'rgba(255,255,255,0.85)',
      'line-width': 0.8,
    },
  }, before);
  // Legible state names, drawn above the fills (collision hides the
  // crowded ones automatically at low zoom).
  map.addSource('state-label-pts', { type: 'geojson', data: stateLabelPoints() });
  map.addLayer({
    id: 'state-labels',
    type: 'symbol',
    source: 'state-label-pts',
    layout: {
      visibility: alwaysVis,
      'text-field': ['get', 'state'],
      'text-font': styleFont(),
      'text-size': ['interpolate', ['linear'], ['zoom'], 3.5, 9.5, 6, 13],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.06,
      'text-max-width': 7,
    },
    paint: {
      'text-color': state.theme === 'dark' ? '#EDEBFA' : '#2A2360',
      'text-halo-color': state.theme === 'dark' ? 'rgba(20,18,43,0.9)' : 'rgba(255,255,255,0.9)',
      'text-halo-width': 1.3,
    },
  }, before);
}

function wireStateInteractions() {
  map.on('click', 'state-fills', (e) => {
    const name = e.features[0].properties.state;
    const hit = stateCountMap().get(normStateName(name));
    if (!hit) return; // no records there — nothing to isolate
    const set = state.filters.state;
    if (set.size === 1 && set.has(hit.name)) set.clear();
    else { set.clear(); set.add(hit.name); }
    render();
  });
  map.on('mousemove', 'state-fills', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const name = e.features[0].properties.state;
    const hit = stateCountMap().get(normStateName(name));
    window.JEMCharts.showTip(
      `<span class="v">${hit ? hit.n : 0}</span> <span class="k">· ${esc(name)}</span>`,
      e.originalEvent.clientX, e.originalEvent.clientY);
  });
  map.on('mouseleave', 'state-fills', () => {
    map.getCanvas().style.cursor = '';
    window.JEMCharts.hideTip();
  });
}

function updateStateFill() {
  if (!mapReady || !map.getSource('states')) return;
  map.setPaintProperty('state-fills', 'fill-color', stateFillExpr().expr);
}

async function setMapMode(mode) {
  // Assign synchronously so overlapping calls can't read a stale mode
  // across the geometry await below.
  const prev = state.mapMode;
  state.mapMode = mode;
  if (mode === 'states' && !(await ensureStatesGeo())) {
    state.mapMode = prev; // offline and no bundled copy — stay where we were
    return;
  }
  $('btn-heat').setAttribute('aria-pressed', String(mode === 'heat'));
  $('btn-states').setAttribute('aria-pressed', String(mode === 'states'));
  renderLegend();
  if (!mapReady) return;
  if (mode === 'states') addStateLayers();
  ['clusters', 'cluster-count', 'points', 'points-selected'].forEach((l) =>
    map.setLayoutProperty(l, 'visibility', mode === 'pins' ? 'visible' : 'none'));
  map.setLayoutProperty('heat', 'visibility', mode === 'heat' ? 'visible' : 'none');
  const modeGated = CFG.basemap === 'india' ? ['state-fills'] : ['state-fills', 'state-lines', 'state-labels'];
  modeGated.forEach((l) => {
    if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', mode === 'states' ? 'visible' : 'none');
  });
  updateStateFill();
}

function flyToIncident(inc) {
  if (!mapReady || !isFinite(inc.lat)) return;
  const pad = {};
  if (window.innerWidth > 820) pad[document.documentElement.dir === 'rtl' ? 'left' : 'right'] = 460;
  if (reducedMotion()) {
    map.jumpTo({ center: [inc.lon, inc.lat], zoom: Math.max(map.getZoom(), inc.geo_approx ? 6.5 : 10) });
  } else {
    map.easeTo({
      center: [inc.lon, inc.lat],
      zoom: Math.max(map.getZoom(), inc.geo_approx ? 6.5 : 10),
      duration: 750,
      padding: pad,
    });
  }
}

/* ------------------------------------------------------------------
   Filters
   ------------------------------------------------------------------ */

function matchesFilters(i, skipField) {
  const f = state.filters;
  if (skipField !== 'category' && f.category.size && !f.category.has(categoryKey(i.category))) return false;
  if (skipField !== 'state' && f.state.size && !f.state.has(i.state || '—')) return false;
  if (skipField !== 'minority' && f.minority.size && !f.minority.has(i.minority || '—')) return false;
  if (f.from && (!i.date || i.date < f.from)) return false;
  if (f.to && (!i.date || i.date > f.to)) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = [i.place, i.state, i.description, i.perpetrator, i.affiliation,
                 i.category, i.minority, i.legal_status].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function applyFilters() {
  state.filtered = state.incidents.filter((i) => matchesFilters(i, null));

  state.filtered.sort((a, b) => {
    const av = a.date || '', bv = b.date || '';
    if (av === bv) {
      return String(a.ref || a.id).localeCompare(String(b.ref || b.id), undefined, { numeric: true });
    }
    if (!av) return 1;
    if (!bv) return -1;
    return state.sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
  });
}

const hasAnyFilter = () => {
  const f = state.filters;
  return !!(f.q.trim() || f.category.size || f.state.size || f.minority.size || f.from || f.to);
};

function clearAllFilters() {
  const f = state.filters;
  f.q = ''; f.from = ''; f.to = '';
  f.category.clear(); f.state.clear(); f.minority.clear();
  $('search').value = '';
  $('date-from').value = $('date-to').value = '';
  render();
}

/* Facet counts follow standard faceted-search behaviour: each group's
   counts are computed against the set filtered by every OTHER filter,
   so a chip always says how many results choosing it would yield. */
function facetCounts(field) {
  const all = new Map();
  state.incidents.forEach((i) => {
    const key = field === 'category' ? categoryKey(i.category) : (i[field] || '—');
    if (!all.has(key)) all.set(key, 0);
  });
  state.incidents.filter((i) => matchesFilters(i, field)).forEach((i) => {
    const key = field === 'category' ? categoryKey(i.category) : (i[field] || '—');
    all.set(key, (all.get(key) || 0) + 1);
  });
  return [...all.entries()].sort((a, b) => b[1] - a[1]);
}

function renderChips(field, containerId) {
  const el = $(containerId);
  const active = state.filters[field];
  el.innerHTML = facetCounts(field).map(([key, n]) => {
    const label = field === 'category' ? catLabel(key) : key;
    const swatch = field === 'category'
      ? `<span class="swatch" style="background:${esc(catColor(key))}"></span>` : '';
    return `<button class="chip${n === 0 ? ' zero' : ''}" aria-pressed="${active.has(key)}" data-field="${field}" data-key="${esc(key)}">
      ${swatch}<span>${esc(label)}</span><span class="n">${n}</span></button>`;
  }).join('');
  $('fg-' + field).classList.toggle('has-active', active.size > 0);
}

function renderAllChips() {
  ['category', 'state', 'minority'].forEach((f) => renderChips(f, 'chips-' + f));
}

/* --- Quick date presets --- */

const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isoDaysAgo = (n) => {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* Presets are anchored to the record, not the clock: "last 7 days" means
   the last 7 days of documented data, so the chips stay meaningful when a
   snapshot is older than today. */
function presetDefs() {
  const dates = state.incidents.map((i) => i.date).filter(Boolean).sort();
  const latest = dates[dates.length - 1] || isoToday();
  const shift = (n) => {
    const d = new Date(latest + 'T00:00:00');
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return [
    { key: 'presetLast7', from: shift(6), to: latest },
    { key: 'presetLast30', from: shift(29), to: latest },
    { key: 'presetThisMonth', from: latest.slice(0, 7) + '-01', to: latest },
    { key: 'presetAll', from: '', to: '' },
  ];
}

function renderPresets() {
  const f = state.filters;
  const html = presetDefs().map((p) =>
    `<button class="preset" data-from="${p.from}" data-to="${p.to}"
       aria-pressed="${f.from === p.from && f.to === p.to}">${esc(t(p.key))}</button>`).join('');
  ['presets', 'fb-presets'].forEach((id) => { const el = $(id); if (el) el.innerHTML = html; });
}

/* The toolbar dropdowns are quick single-pick filters (the sidebar chips
   remain the multi-select interface). '' = all; a value replaces the set. */
function renderTopBar() {
  const build = (el, field, allLabel) => {
    if (!el || document.activeElement === el) return; // don't yank an open menu
    const set = state.filters[field];
    const opts = [`<option value="">${esc(allLabel)}</option>`];
    if (set.size > 1) {
      opts.push(`<option value="__multi" selected>${esc(typeof t('nSelected') === 'function' ? t('nSelected')(set.size) : set.size)}</option>`);
    }
    facetCounts(field).forEach(([key, n]) => {
      const label = field === 'category' ? catLabel(key) : key;
      const sel = set.size === 1 && set.has(key) ? ' selected' : '';
      opts.push(`<option value="${esc(key)}"${sel}>${esc(label)} (${n})</option>`);
    });
    el.innerHTML = opts.join('');
    if (!set.size) el.value = '';
  };
  build($('fb-category'), 'category', t('allCategories'));
  build($('fb-state'), 'state', t('allStates'));
  const fs = $('fb-search');
  if (fs && document.activeElement !== fs) fs.value = state.filters.q;
}

/* ------------------------------------------------------------------
   Sidebar rendering
   ------------------------------------------------------------------ */

function renderCounters() {
  $('c-total').textContent = state.incidents.length;
  $('c-states').textContent = new Set(state.incidents.map((i) => i.state).filter((s) => s && s !== 'Online')).size;
  const dates = state.incidents.map((i) => i.date).filter(Boolean).sort();
  if (!dates.length) { $('c-period').textContent = '—'; return; }
  const a = dates[0], b = dates[dates.length - 1];
  const mon = (d) => new Date(d + 'T00:00:00').toLocaleDateString(locale(), { month: 'short' });
  const yr = (d) => d.slice(0, 4);
  // "May–Jun 2026", never the ambiguous "May 26–Jun 26".
  $('c-period').textContent =
    a.slice(0, 7) === b.slice(0, 7) ? `${mon(a)} ${yr(a)}`
  : yr(a) === yr(b) ? `${mon(a)}–${mon(b)} ${yr(a)}`
  : `${mon(a)} ${yr(a)} – ${mon(b)} ${yr(b)}`;
}

function rowHtml(i, tabbable) {
  const summary = (i.description || '').replace(/\s+/g, ' ').slice(0, 190);
  const nSrc = (i.sources || []).length;
  return `<button class="row" data-id="${esc(i.id)}" aria-current="${state.selected === i.id}"
      tabindex="${tabbable ? 0 : -1}">
    <div class="row-meta">
      <span class="dot" style="background:${esc(catColor(i.category))}" aria-hidden="true"></span>
      <span class="date">${esc(formatDate(i.date))}</span>
      ${i.state ? `<span>· ${esc(i.state)}</span>` : ''}
      ${!isFinite(i.lat) ? `<span>· ${esc(t('notMapped'))}</span>` : ''}
      ${nSrc ? `<span class="srcs">${esc(typeof t('srcCount') === 'function' ? t('srcCount')(nSrc) : nSrc)}</span>` : ''}
    </div>
    <div class="row-place">${esc(i.place || t('locationNotRecorded'))}</div>
    <div class="row-summary">${esc(summary)}</div>
  </button>`;
}

function renderList() {
  const el = $('list');
  $('result-count').textContent = state.filtered.length;
  $('list-head').classList.toggle('has-filters', hasAnyFilter());

  if (!state.filtered.length) {
    el.innerHTML = `<div class="empty">${esc(t('noMatch'))}<br>
      <button class="clear-all" id="empty-clear">${esc(t('clearAll'))}</button></div>`;
    return;
  }

  const selIdx = state.filtered.findIndex((i) => i.id === state.selected);
  el.innerHTML = state.filtered.map((i, n) => rowHtml(i, n === (selIdx >= 0 ? selIdx : 0))).join('');
}

/* Selection changes touch only the two affected rows — no list rebuild,
   so keyboard focus survives. */
function updateListSelection(prevId) {
  const el = $('list');
  [prevId, state.selected].forEach((id) => {
    if (!id) return;
    const row = el.querySelector(`.row[data-id="${CSS.escape(String(id))}"]`);
    if (row) row.setAttribute('aria-current', String(id === state.selected));
  });
  const rows = [...el.querySelectorAll('.row')];
  const target = el.querySelector(`.row[data-id="${CSS.escape(String(state.selected || ''))}"]`) || rows[0];
  rows.forEach((r) => r.setAttribute('tabindex', r === target ? '0' : '-1'));
  if (target && state.selected) target.scrollIntoView({ block: 'nearest' });
}

function renderLegend() {
  // In the choropleth mode the legend is a count ramp, not the category key.
  if (state.mapMode === 'states' && statesGeo) {
    const counts = stateCountMap();
    const max = Math.max(1, ...[...counts.values()].map((v) => v.n));
    const light = state.theme !== 'dark';
    const lo = light ? '#DDD9EC' : '#2A2453';
    const hi = light ? '#2A2360' : '#A79FE0';
    $('legend-title').textContent = t('legendShade');
    $('legend-items').innerHTML =
      `<div class="ramp" role="img" aria-label="${esc(t('legendShade'))}: 0–${max}">
        <div class="ramp-bar" style="background:linear-gradient(90deg, ${lo}, ${hi})"></div>
        <div class="ramp-scale"><span>0</span><span>${max}</span></div>
      </div>`;
    $('legend-note').textContent = t('legendShadeHint');
    return;
  }
  $('legend-title').textContent = t('legend');
  const present = new Set(state.incidents.map((i) => categoryKey(i.category)));
  const activeSet = state.filters.category;
  $('legend-items').innerHTML = Object.entries(CFG.categories)
    .filter(([k]) => present.has(k))
    .map(([k, c]) => {
      const label = c['label_' + state.lang] || c.label;
      const isolated = activeSet.size === 1 && activeSet.has(k);
      const dimmed = activeSet.size > 0 && !activeSet.has(k);
      return `<button class="legend-item${dimmed ? ' dimmed' : ''}" data-cat="${esc(k)}"
        aria-pressed="${isolated}" title="${esc(t('legendHint'))}">
        <span class="swatch" style="background:${esc(catColor(k))}"></span>${esc(label)}</button>`;
    }).join('');

  const unmapped = state.incidents.filter((i) => !isFinite(i.lat)).length;
  const note = unmapped
    ? (typeof t('unmappedNote') === 'function' ? t('unmappedNote')(unmapped, state.incidents.length) : '')
    : t('pinsNote');
  $('legend-note').textContent = note;
}

/* ------------------------------------------------------------------
   Detail card
   ------------------------------------------------------------------ */

function factRow(label, value) {
  if (!value || !String(value).trim()) return '';
  return `<div class="fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function interventionTag(value) {
  if (!value) return '';
  const v = value.toLowerCase();
  const cls = /completed|resolved|filed|collected|done|closed/.test(v) ? 'positive'
            : /pending|sent|awaiting|ongoing|progress/.test(v) ? 'pending' : '';
  return `<span class="tag ${cls}">${esc(value)}</span>`;
}

function renderCard(inc) {
  $('card-cat').innerHTML =
    `<span class="swatch" style="background:${esc(catColor(inc.category))}"></span>${esc(catLabel(inc.category))}`;
  $('card-place').textContent = inc.place || t('locationNotRecorded');

  const nUrls = sourceUrls(inc).length;
  const badge = nUrls >= 2
    ? `<span class="badge-verify multi">${esc(t('corroborated'))}</span>`
    : nUrls === 1 ? `<span class="badge-verify">${esc(t('singleSource'))}</span>` : '';

  const sub = [];
  if (inc.state) sub.push(esc(inc.state));
  sub.push(esc(formatDate(inc.date)));
  if (inc.minority) sub.push(esc(inc.minority));
  sub.push(`${esc(t('ref'))} ${esc(inc.ref || inc.id)}`);
  $('card-sub').innerHTML = sub.join('<span class="sep">·</span>') + (badge ? ` ${badge}` : '');

  const parts = [];

  if (inc.description) {
    parts.push(`<div class="card-narrative">${toParagraphs(inc.description)}
      ${state.lang !== 'en' && t('narrativeNote') ? `<p class="lang-note" dir="auto">${esc(t('narrativeNote'))}</p>` : ''}</div>`);
  }

  const facts = [
    factRow(t('community'), inc.minority),
    factRow(t('perpetrator'), inc.perpetrator),
    factRow(t('affiliation'), inc.affiliation),
    factRow(t('legalStatus'), inc.legal_status),
  ].join('');
  if (facts) {
    parts.push(`<div class="card-section"><div class="kicker">${esc(t('record'))}
      <span class="note"> · ${esc(t('asReported'))}</span></div><dl class="facts">${facts}</dl></div>`);
  }

  if (inc.intervention) {
    parts.push(`<div class="card-section"><div class="kicker">${esc(t('intervention'))}</div>${interventionTag(inc.intervention)}</div>`);
  }

  parts.push(`<div class="card-section"><div class="kicker">${esc(t('sourcesMedia'))}</div>${renderSources(inc.sources)}</div>`);

  if (!isFinite(inc.lat)) {
    parts.push(`<div class="caveat">${esc(t('noMapLocation'))}</div>`);
  } else if (inc.geo_approx) {
    parts.push(`<div class="caveat">${esc(t('statePin'))}</div>`);
  } else if (inc.geo_matched) {
    parts.push(`<div class="caveat">${esc(t('pinMatched'))} <strong>${esc(inc.geo_matched)}</strong>. ${esc(t('pinNote'))}</div>`);
  }

  parts.push(`<div class="card-section"><a href="mailto:${esc(CFG.methodology.contact)}?subject=${encodeURIComponent('Correction: record ' + (inc.ref || inc.id) + (inc.date ? ' (' + inc.date + ')' : ''))}"
    style="font-size:11.5px">${esc(t('reportError'))}</a></div>`);

  $('card-body').innerHTML = parts.join('');
  $('card-body').scrollTop = 0;
  $('card-disclaimer').textContent = CFG['disclaimer_' + state.lang] || CFG.disclaimer;
  $('card-locate').style.display = isFinite(inc.lat) ? '' : 'none';
  $('card').classList.add('open');
}

let cardOpener = null;

function selectIncident(id, fly = true) {
  const inc = state.incidents.find((i) => String(i.id) === String(id));
  if (!inc) return;
  const prev = state.selected;
  const wasOpen = !!prev;
  state.selected = String(inc.id);
  cardOpener = document.activeElement && document.activeElement.closest
    ? document.activeElement.closest('.row') : null;
  renderCard(inc);
  updateMapData();
  updateListSelection(prev);
  if (isMobile()) $('sidebar').classList.remove('expanded');
  if (fly) flyToIncident(inc);
  writeHash(!wasOpen); // opening pushes history, so Back closes the card
  $('card').focus({ preventScroll: true });
}

function closeCard() {
  if (!state.selected) return;
  const prev = state.selected;
  state.selected = null;
  $('card').classList.remove('open');
  updateMapData();
  updateListSelection(prev);
  writeHash(false);
  const row = $('list').querySelector(`.row[data-id="${CSS.escape(prev)}"]`);
  (cardOpener && document.contains(cardOpener) ? cardOpener : row || $('list')).focus({ preventScroll: true });
}

/* ------------------------------------------------------------------
   Views
   ------------------------------------------------------------------ */

function setView(view, update = true) {
  state.view = view;
  $('view-map').setAttribute('aria-pressed', String(view === 'map'));
  $('view-trends').setAttribute('aria-pressed', String(view === 'trends'));
  $('map-panel').style.display = view === 'map' ? '' : 'none';
  $('trends-panel').hidden = view !== 'trends';
  $('map-tools').style.display = view === 'map' ? '' : 'none';
  if (view === 'trends') renderTrends();
  else if (mapReady) map.resize();
  if (update) writeHash(false);
}

function chartsCtx() {
  return {
    t, binLabel,
    fmtDate: formatDate,
    categoryKey, catColor, catLabel,
    seriesMain: state.theme === 'dark' ? '#7974C5' : '#5E5A9A',
    filtered: hasAnyFilter(),
    isActive: (field, key) => {
      const set = state.filters[field === 'category' ? 'category' : field];
      return !!(set && set.has(key));
    },
    onBarClick: (field, key) => {
      if (!field || !key) return;
      const set = state.filters[field === 'category' ? 'category' : field];
      if (!set) return;
      set.has(key) ? set.delete(key) : set.add(key);
      render();
    },
  };
}

function renderTrends() {
  if (state.view !== 'trends') return;
  window.JEMCharts.renderTrends($('trends-inner'), state.filtered, chartsCtx());
}

function renderTimeline() {
  window.JEMCharts.renderTimeline($('timeline'), state.incidents,
    { from: state.filters.from, to: state.filters.to },
    {
      t, binLabel,
      onBrush: (from, to, commit) => {
        state.filters.from = from;
        state.filters.to = to;
        $('date-from').value = from;
        $('date-to').value = to;
        render();
      },
    });
  $('timeline').classList.toggle('has-range', !!(state.filters.from || state.filters.to));
  const r = $('tl-range');
  r.textContent = (state.filters.from || state.filters.to)
    ? `${state.filters.from ? formatDate(state.filters.from) : '…'} – ${state.filters.to ? formatDate(state.filters.to) : '…'}`
    : '';
}

/* ------------------------------------------------------------------
   Status line
   ------------------------------------------------------------------ */

function setStatus(kind, message) {
  const el = $('status');
  el.dataset.state = kind;
  if (message) { $('status-text').textContent = message; return; }
  const when = state.updatedAt
    ? new Date(state.updatedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
    : '';
  const snapDate = state.updatedAt
    ? new Date(state.updatedAt).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  $('status-text').textContent =
    kind === 'sheet'   ? `${t('liveFrom')} ${when}`
  : kind === 'static'  ? `${t('snapshot')}${snapDate ? ' · ' + snapDate : ''}`
  : kind === 'error'   ? t('liveUnavailable')
  : t('loading');
}

/* ------------------------------------------------------------------
   Export / citation / share
   ------------------------------------------------------------------ */

const CSV_FIELDS = ['id', 'ref', 'date', 'place', 'state', 'category', 'minority',
                    'description', 'legal_status', 'perpetrator', 'affiliation',
                    'intervention', 'lat', 'lon', 'sources'];

function csvOf(incidents) {
  const escCell = (v) => {
    let s = String(v == null ? '' : v);
    // Neutralize spreadsheet formula injection from sheet-controlled text,
    // leaving plain numbers (negative coordinates) untouched.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const meta = CFG.methodology || {};
  const lines = [
    `# ${meta.citation || ''} Accessed ${isoToday()}.`,
    `# License: ${meta.license || ''}`,
    `# ${incidents.length} records · ${permalink()}`,
    CSV_FIELDS.join(','),
  ];
  incidents.forEach((i) => {
    lines.push(CSV_FIELDS.map((f) => {
      if (f === 'sources') return escCell((i.sources || []).map((s) => s.url || s.note || '').join(' ; '));
      return escCell(i[f]);
    }).join(','));
  });
  return lines.join('\n');
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportCsv() {
  const suffix = hasAnyFilter() ? '-filtered' : '';
  download(`jem-incidents-${isoToday()}${suffix}.csv`, csvOf(state.filtered), 'text/csv;charset=utf-8');
}

function exportJson() {
  const meta = CFG.methodology || {};
  const suffix = hasAnyFilter() ? '-filtered' : '';
  download(`jem-incidents-${isoToday()}${suffix}.json`, JSON.stringify({
    generated: state.updatedAt,
    accessed: isoToday(),
    count: state.filtered.length,
    license: meta.license,
    citation: meta.citation,
    permalink: permalink(),
    filters: hashFromState().slice(1) || null,
    incidents: state.filtered,
  }, null, 1), 'application/json');
}

function citationText() {
  const meta = CFG.methodology || {};
  const dates = state.filtered.map((i) => i.date).filter(Boolean).sort();
  const period = dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : '';
  return `${meta.citation} ${period ? `Records ${period} (${state.filtered.length} incidents). ` : ''}Accessed ${isoToday()}. ${permalink()}`;
}

function citationBibtex() {
  const year = new Date().getFullYear();
  return `@misc{jem-hate-incident-tracker,
  author = {{Justice and Empowerment of Minorities (JEM)}},
  title = {Hate Incident Tracker},
  publisher = {Jamiat Ulama-i-Hind},
  year = {${year}},
  url = {${permalink()}},
  note = {${state.filtered.length} records. Accessed ${isoToday()}. License: CC BY 4.0}
}`;
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    // file:// or denied — fall back to a prompt the user can copy from
    window.prompt('Copy:', text);
  }
}

async function share() {
  const url = permalink();
  if (navigator.share && isMobile()) {
    try { await navigator.share({ title: document.title, url }); return; } catch {}
  }
  copyText(url, t('shareCopied'));
}

/* ------------------------------------------------------------------
   Dialogs
   ------------------------------------------------------------------ */

let dialogOpener = null;

function openDialog(id) {
  dialogOpener = document.activeElement;
  const dlg = $(id);
  dlg.hidden = false;
  const closeBtn = dlg.querySelector('.dialog-close');
  if (closeBtn) closeBtn.focus();
}

/* Keep Tab inside the open dialog — a minimal focus trap. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const open = [...document.querySelectorAll('.dialog-backdrop')].find((d) => !d.hidden);
  if (!open) return;
  const focusables = [...open.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!open.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
});

function closeDialogs() {
  let closed = false;
  document.querySelectorAll('.dialog-backdrop').forEach((d) => {
    if (!d.hidden) { d.hidden = true; closed = true; }
  });
  if (closed && dialogOpener && document.contains(dialogOpener)) dialogOpener.focus();
  return closed;
}

function renderAboutDialog() {
  const meta = CFG.methodology || {};
  const sections = meta['sections_' + state.lang] || meta.sections || [];
  $('dlg-about-body').innerHTML =
    sections.map((s) => `<h3>${esc(s.h)}</h3><p>${esc(s.p)}</p>`).join('')
    + `<h3>${esc(t('license'))}</h3><p>${esc(meta.license || '')}</p>
       <p class="meta-line">${esc(t('exportFullNote'))}</p>
       <p class="meta-line">${esc(meta.citation || '')}</p>`;
}

function renderExportDialog() {
  $('dlg-export-body').innerHTML = `
    <button class="dl-btn" id="dl-csv"><span class="glyph">⇩</span>
      <span>${esc(t('exportCsv'))}<span class="sub">${state.filtered.length} ${esc(t('incidents')).toLowerCase()} · ${esc(t('exportNote'))}</span></span></button>
    <button class="dl-btn" id="dl-json"><span class="glyph">{}</span>
      <span>${esc(t('exportJson'))}<span class="sub">${esc(t('exportNote'))}</span></span></button>
    <button class="dl-btn" id="dl-print"><span class="glyph">⎙</span>
      <span>${esc(t('print'))}<span class="sub">${esc(t('exportNote'))}</span></span></button>
    <p class="meta-line">${esc(t('exportFullNote'))}</p>`;
  $('dl-csv').addEventListener('click', exportCsv);
  $('dl-json').addEventListener('click', exportJson);
  $('dl-print').addEventListener('click', () => { closeDialogs(); setTimeout(() => window.print(), 60); });
}

function renderCiteDialog() {
  $('dlg-cite-body').innerHTML = `
    <div class="cite-box" id="cite-plain">${esc(citationText())}</div>
    <button class="dl-btn" id="copy-cite"><span class="glyph">❝</span><span>${esc(t('copyCitation'))}</span></button>
    <h3>BibTeX</h3>
    <div class="cite-box" style="font-family:ui-monospace,monospace;font-size:11px" id="cite-bib">${esc(citationBibtex())}</div>
    <button class="dl-btn" id="copy-bib"><span class="glyph">❝</span><span>${esc(t('copyCitation'))} (BibTeX)</span></button>`;
  $('copy-cite').addEventListener('click', () => copyText(citationText(), t('citationCopied')));
  $('copy-bib').addEventListener('click', () => copyText(citationBibtex(), t('citationCopied')));
}

/* ------------------------------------------------------------------
   Theme & language
   ------------------------------------------------------------------ */

function setTheme(theme, persist = true) {
  state.theme = theme;
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  if (persist) { try { localStorage.setItem('jem-theme', theme); } catch {} }
  $('btn-theme').setAttribute('aria-label', theme === 'dark' ? t('themeLight') : t('themeDark'));
  swapMapStyle();
  render();
}

function setLang(lang) {
  state.lang = lang;
  try { localStorage.setItem('jem-lang', lang); } catch {}
  applyStrings();
  render();
  if (state.selected) {
    const inc = state.incidents.find((i) => String(i.id) === state.selected);
    if (inc) renderCard(inc);
  }
  setStatus(state.source);
  writeHash(false);
}

/* ------------------------------------------------------------------
   Render + events
   ------------------------------------------------------------------ */

/* The chips, presets, legend and chart bars are rebuilt via innerHTML on
   every render — remember which one held focus and re-focus its replacement,
   so activating a filter never dumps a keyboard user back to <body>. */
function focusSelector() {
  const ae = document.activeElement;
  if (!ae || !ae.matches) return null;
  const escA = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
  if (ae.matches('.chip')) return `.chip[data-field="${escA(ae.dataset.field)}"][data-key="${escA(ae.dataset.key)}"]`;
  if (ae.matches('.preset')) return `.preset[data-from="${escA(ae.dataset.from)}"][data-to="${escA(ae.dataset.to)}"]`;
  if (ae.matches('.legend-item')) return `.legend-item[data-cat="${escA(ae.dataset.cat)}"]`;
  if (ae.matches('.bar-hit')) return `.bar-hit[data-field="${escA(ae.dataset.field || '')}"][data-key="${escA(ae.dataset.key || '')}"]`;
  return null;
}

function render() {
  const refocus = focusSelector();
  applyFilters();
  renderList();
  renderAllChips();
  renderPresets();
  renderTopBar();
  renderCounters();
  renderLegend();
  renderTimeline();
  updateMapData();
  renderTrends();
  writeHash(false);
  if (refocus) {
    const el = document.querySelector(refocus);
    if (el) el.focus({ preventScroll: true });
  }
}

function wireEvents() {
  $('list').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (row) selectIncident(row.dataset.id);
    const clear = e.target.closest('#empty-clear');
    if (clear) clearAllFilters();
  });

  /* Roving keyboard navigation through the result list. */
  $('list').addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const rows = [...$('list').querySelectorAll('.row')];
    if (!rows.length) return;
    const cur = rows.indexOf(document.activeElement);
    let next = cur;
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, cur + 1);
    if (e.key === 'ArrowUp') next = Math.max(0, cur - 1);
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = rows.length - 1;
    if (next !== cur && rows[next]) {
      e.preventDefault();
      rows.forEach((r) => r.setAttribute('tabindex', '-1'));
      rows[next].setAttribute('tabindex', '0');
      rows[next].focus();
    }
  });

  document.querySelector('.filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) {
      const set = state.filters[chip.dataset.field];
      set.has(chip.dataset.key) ? set.delete(chip.dataset.key) : set.add(chip.dataset.key);
      render();
      return;
    }
    const preset = e.target.closest('.preset');
    if (preset) {
      state.filters.from = preset.dataset.from;
      state.filters.to = preset.dataset.to;
      $('date-from').value = preset.dataset.from;
      $('date-to').value = preset.dataset.to;
      $('fg-date').classList.toggle('has-active', !!(preset.dataset.from || preset.dataset.to));
      render();
      return;
    }
    const clear = e.target.closest('.clear');
    if (clear) {
      const field = clear.dataset.clear;
      if (field === 'date') {
        state.filters.from = state.filters.to = '';
        $('date-from').value = $('date-to').value = '';
        $('fg-date').classList.remove('has-active');
      } else {
        state.filters[field].clear();
      }
      render();
    }
  });

  $('clear-all').addEventListener('click', clearAllFilters);

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.filters.q = e.target.value; render(); }, 160);
  });

  ['date-from', 'date-to'].forEach((id) => {
    $(id).addEventListener('change', () => {
      state.filters.from = $('date-from').value;
      state.filters.to = $('date-to').value;
      $('fg-date').classList.toggle('has-active', !!(state.filters.from || state.filters.to));
      render();
    });
  });

  $('sort').addEventListener('click', () => {
    state.sortDesc = !state.sortDesc;
    $('sort').textContent = state.sortDesc ? t('newestFirst') : t('oldestFirst');
    render();
  });

  $('card-close').addEventListener('click', closeCard);
  $('card-locate').addEventListener('click', () => {
    const inc = state.incidents.find((i) => String(i.id) === state.selected);
    if (inc) flyToIncident(inc);
  });
  $('card-link').addEventListener('click', () => copyText(permalink(), t('linkCopied')));

  $('btn-reset').addEventListener('click', () => {
    if (!mapReady) return;
    if (reducedMotion()) map.jumpTo({ center: CFG.center, zoom: CFG.zoom });
    else map.easeTo({ center: CFG.center, zoom: CFG.zoom, duration: 700, padding: 0 });
  });

  $('btn-cluster').addEventListener('click', () => {
    state.clustered = !state.clustered;
    $('btn-cluster').setAttribute('aria-pressed', String(state.clustered));
    if (!mapReady) return;
    // Clustering is a source-level option, so the layers have to be rebuilt.
    mapReady = false;
    ['points-selected', 'points', 'cluster-count', 'clusters', 'heat'].forEach((l) => map.removeLayer(l));
    map.removeSource('incidents');
    map.removeSource('incidents-flat');
    addIncidentLayers();
  });

  $('btn-heat').addEventListener('click', () => setMapMode(state.mapMode === 'heat' ? 'pins' : 'heat'));
  $('btn-states').addEventListener('click', () => setMapMode(state.mapMode === 'states' ? 'pins' : 'states'));

  $('view-map').addEventListener('click', () => setView('map'));
  $('view-trends').addEventListener('click', () => setView('trends'));

  $('btn-theme').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  $('btn-lang').addEventListener('click', () => setLang(state.lang === 'en' ? 'ur' : state.lang === 'ur' ? 'hi' : 'en'));

  $('btn-share').addEventListener('click', share);
  $('btn-about').addEventListener('click', () => { renderAboutDialog(); openDialog('dlg-about'); });
  $('btn-export').addEventListener('click', () => { renderExportDialog(); openDialog('dlg-export'); });
  $('btn-cite').addEventListener('click', () => { renderCiteDialog(); openDialog('dlg-cite'); });

  document.querySelectorAll('.dialog-close').forEach((b) =>
    b.addEventListener('click', closeDialogs));
  document.querySelectorAll('.dialog-backdrop').forEach((d) =>
    d.addEventListener('click', (e) => { if (e.target === d) closeDialogs(); }));

  $('legend-items').addEventListener('click', (e) => {
    const item = e.target.closest('.legend-item');
    if (!item) return;
    const k = item.dataset.cat;
    const set = state.filters.category;
    if (set.size === 1 && set.has(k)) set.clear();
    else { set.clear(); set.add(k); }
    render();
  });

  $('tl-clear').addEventListener('click', () => {
    state.filters.from = state.filters.to = '';
    $('date-from').value = $('date-to').value = '';
    $('fg-date').classList.remove('has-active');
    render();
  });

  $('refresh').addEventListener('click', () => refresh(true));

  $('btn-back').addEventListener('click', goBack);

  // Top filter bar — quick filters mirrored onto the same state.
  $('filter-bar').addEventListener('click', (e) => {
    const preset = e.target.closest('.preset');
    if (!preset) return;
    state.filters.from = preset.dataset.from;
    state.filters.to = preset.dataset.to;
    $('date-from').value = preset.dataset.from;
    $('date-to').value = preset.dataset.to;
    $('fg-date').classList.toggle('has-active', !!(preset.dataset.from || preset.dataset.to));
    render();
  });
  [['fb-category', 'category'], ['fb-state', 'state']].forEach(([id, field]) => {
    $(id).addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === '__multi') return; // informational option, not a choice
      const set = state.filters[field];
      set.clear();
      if (v) set.add(v);
      render();
    });
  });
  let fbTimer;
  $('fb-search').addEventListener('input', (e) => {
    clearTimeout(fbTimer);
    fbTimer = setTimeout(() => {
      state.filters.q = e.target.value;
      $('search').value = e.target.value;
      render();
    }, 160);
  });

  document.addEventListener('keydown', (e) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape') {
      if (closeDialogs()) return;
      if (inField) { document.activeElement.blur(); return; }
      closeCard();
      return;
    }
    if (inField) return;
    if (e.key === '/') {
      e.preventDefault();
      if (isMobile()) $('sidebar').classList.add('expanded');
      $('search').focus();
    }
  });

  window.addEventListener('popstate', () => {
    applyingHash = true;
    readHash();
    applyingHash = false;
    applyHashToUI();
  });

  // Mobile: the grab handle raises/lowers the bottom sheet.
  const sheetToggle = () => {
    const open = $('sidebar').classList.toggle('expanded');
    $('sheet-grab').setAttribute('aria-expanded', String(open));
  };
  $('sheet-grab').addEventListener('click', sheetToggle);
  $('sidebar').querySelector('.masthead').addEventListener('click', (e) => {
    if (isMobile() && !e.target.closest('button')) sheetToggle();
  });

  window.addEventListener('resize', () => {
    clearTimeout(wireEvents._rt);
    wireEvents._rt = setTimeout(() => { renderTimeline(); renderTrends(); }, 200);
  });
  // The strip measures its own width at render time — re-render when the
  // panel it sits on actually changes size (incl. the settling first layout).
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = 0;
    new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w && w !== lastW) { lastW = w; renderTimeline(); }
    }).observe($('timeline'));
  }

  // First-visit note (skipped in embeds).
  if (!state.embed) {
    let seen = null;
    try { seen = localStorage.getItem('jem-note-seen'); } catch {}
    if (!seen) {
      $('data-note').hidden = false;
      const dismiss = () => {
        $('data-note').hidden = true;
        try { localStorage.setItem('jem-note-seen', '1'); } catch {}
      };
      $('note-dismiss').addEventListener('click', dismiss);
      $('note-method').addEventListener('click', () => { dismiss(); renderAboutDialog(); openDialog('dlg-about'); });
    }
  }
}

/* ------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------ */

async function refresh(manual = false) {
  const csv = CFG.sheetUrl ? sheetCsvUrl(CFG.sheetUrl) : null;
  if (manual) setStatus('loading', t('fetching'));

  let loaded = null;
  if (csv) {
    try {
      loaded = await loadSheet(csv);
      state.source = 'sheet';
    } catch (err) {
      console.warn('Sheet load failed:', err.message);
      state.source = 'error';
    }
  }
  if (!loaded) {
    try {
      loaded = await loadStatic();
      if (state.source !== 'error') state.source = 'static';
    } catch (err) {
      setStatus('error', t('noData'));
      console.error(err);
      return;
    }
  }

  state.incidents = loaded.incidents;
  state.updatedAt = loaded.generated || new Date().toISOString();
  applyGeocache(state.incidents);

  // Re-resolve the selection against the fresh data.
  if (state.selected && !state.incidents.some((i) => String(i.id) === state.selected)) {
    state.selected = null;
    $('card').classList.remove('open');
  }

  render();
  if (state.selected) {
    const inc = state.incidents.find((i) => String(i.id) === state.selected);
    if (inc) { renderCard(inc); $('card').classList.add('open'); }
  }
  setStatus(state.source);
  geocodeMissing(state.incidents);
}

async function init() {
  if (state.embed) document.body.classList.add('embed');
  readHash();
  applyStrings();
  setView(state.view, false);
  wireEvents();
  initMap();
  if (CFG.basemap === 'india') {
    Promise.all([ensureStatesGeo(), ensureWorldGeo()]).then(() => {
      // If the style finished loading before the geometry arrived, the
      // style.load handler found nothing to add — add it now.
      try { if (map && mapReady) addStateLayers(); } catch {}
    });
  }
  await loadGeocache();
  await refresh();
  applyHashToUI();
  booted = true;
  updateBackButton();
  if (CFG.refreshMs > 0) setInterval(() => refresh(), CFG.refreshMs);
}

/* Handle for the console and for scripts/smoke-test.mjs — e.g.
   JEM.selectIncident('r1a2b3c4') or JEM.state.filtered.length */
window.JEM = { state, selectIncident, closeCard, render, refresh, categoryKey,
               parseCSV, parseDate, stableId, csvOf, hashFromState, readHash, t,
               get map() { return map; } };

window.JEM.ready = init();

})();
