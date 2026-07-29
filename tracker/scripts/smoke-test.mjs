/* Headless smoke test for the tracker.
 *
 * Runs the real assets/app.js (+ charts.js) against a minimal DOM stub and a
 * fetch that reads from disk, then asserts on what it rendered. Catches the
 * failures that matter — data not loading, rows not rendering, a card missing
 * its sources, HTML injection from sheet text, unstable permalink ids —
 * without needing a browser.
 *
 * Usage: node scripts/smoke-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* --- minimal DOM ------------------------------------------------- */

class El {
  constructor(id = '') {
    this.id = id;
    this._html = '';
    this.textContent = '';
    this.value = '';
    this.title = '';
    this.hidden = false;
    this.placeholder = '';
    this.dataset = {};
    this.style = {};
    this.attrs = {};
    this.classes = new Set();
    this.listeners = {};
    this.scrollTop = 0;
    this.clientWidth = 600;
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      contains: (c) => this.classes.has(c),
      toggle: (c, on) => (on === undefined ? (this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c))
                                           : (on ? this.classes.add(c) : this.classes.delete(c))),
    };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
  closest() { return null; }
  appendChild(c) { return c; }
  scrollIntoView() {}
  focus() {}
  blur() {}
  click() {}
  remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 46 }; }
  setPointerCapture() {}
}

const els = new Map();
const byId = (id) => {
  if (!els.has(id)) els.set(id, new El(id));
  return els.get(id);
};

const documentElement = new El('html');
documentElement.lang = 'en';
documentElement.dir = 'ltr';

const document = {
  documentElement,
  body: new El('body'),
  getElementById: byId,
  querySelector: (sel) => (sel.startsWith('.row[') ? null : new El(sel)),
  querySelectorAll: () => [],
  createElement: () => new El(),
  createElementNS: () => new El(),
  addEventListener() {},
  contains: () => false,
  activeElement: null,
};

/* --- sandbox ------------------------------------------------------ */

const sandbox = {
  document,
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  URL, Date, Math, JSON, isFinite, parseFloat, parseInt,
  encodeURIComponent, decodeURIComponent, encodeURI, URLSearchParams, Blob,
  CSS: { escape: (s) => s },
  localStorage: { getItem: () => null, setItem() {}, },
  navigator: {},
  location: { protocol: 'http:', origin: 'http://localhost:8321', pathname: '/', search: '', hash: '' },
  history: {
    replaceState(_s, _t, url) { sandbox.location.hash = url.includes('#') ? '#' + url.split('#')[1] : ''; },
    pushState(_s, _t, url) { sandbox.location.hash = url.includes('#') ? '#' + url.split('#')[1] : ''; },
  },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
  innerWidth: 1440,
  innerHeight: 900,
  fetch: async (url) => {
    if (/^https?:/.test(url)) return { ok: false, status: 0, json: async () => [] };
    const file = join(ROOT, url.split('?')[0]);
    try {
      const text = readFileSync(file, 'utf8');
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
    } catch {
      return { ok: false, status: 404 };
    }
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const run = (rel) => vm.runInContext(readFileSync(join(ROOT, rel), 'utf8'), sandbox, { filename: rel });

run('assets/config.js');
// Geocoding new rows would hit the network; the snapshot is already located.
sandbox.JEM_CONFIG.geocodeNewRows = false;
run('assets/charts.js');
run('assets/app.js');

/* --- assertions --------------------------------------------------- */

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); failures++; }
};

await sandbox.JEM.ready;

const { state } = sandbox.JEM;
const list = byId('list').innerHTML;
const rowCount = (list.match(/class="row"/g) || []).length;

console.log('\nData');
check('incidents loaded', state.incidents.length > 100, `got ${state.incidents.length}`);
check('all incidents pass empty filters', state.filtered.length === state.incidents.length);
check('every incident has an id', state.incidents.every((i) => i.id));
check('ids are unique', new Set(state.incidents.map((i) => i.id)).size === state.incidents.length,
  `${new Set(state.incidents.map((i) => i.id)).size} unique of ${state.incidents.length}`);
check('most incidents are located',
  state.incidents.filter((i) => isFinite(i.lat)).length / state.incidents.length > 0.85,
  `${state.incidents.filter((i) => isFinite(i.lat)).length}/${state.incidents.length}`);
check('coordinates published at locality precision (≤2 dp)',
  state.incidents.filter((i) => isFinite(i.lat)).every((i) =>
    Math.abs(i.lat * 100 - Math.round(i.lat * 100)) < 1e-9 &&
    Math.abs(i.lon * 100 - Math.round(i.lon * 100)) < 1e-9));
check('dates parsed to ISO',
  state.incidents.filter((i) => i.date).every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.date)));
check('no incident falls into "other" category',
  !state.incidents.some((i) => sandbox.JEM.categoryKey(i.category) === 'other' && i.category),
  state.incidents.filter((i) => sandbox.JEM.categoryKey(i.category) === 'other' && i.category)
    .map((i) => i.category)[0] || '');

console.log('\nStable ids (pipeline ↔ client parity)');
const sample = state.incidents.find((i) => i.place && i.description && !String(i.id).includes('-'));
const recomputed = sandbox.JEM.stableId(sample.place, sample.date, sample.description, new Set());
check('client stableId reproduces the pipeline id', recomputed === sample.id,
  `${recomputed} vs ${sample.id}`);

console.log('\nSidebar');
check('a row per incident', rowCount === state.filtered.length, `${rowCount} rows`);
check('counters filled', String(byId('c-total').textContent) === String(state.incidents.length));
check('state count is plausible', +byId('c-states').textContent > 10, byId('c-states').textContent);
check('period shown', byId('c-period').textContent !== '—', byId('c-period').textContent);
check('category chips rendered', (byId('chips-category').innerHTML.match(/class="chip/g) || []).length >= 5);
check('state chips rendered', (byId('chips-state').innerHTML.match(/class="chip/g) || []).length >= 10);
check('legend rendered', byId('legend-items').innerHTML.includes('legend-item'));
check('status line set', !/Loading/.test(byId('status-text').textContent), byId('status-text').textContent);
check('source counts shown on rows', /class="srcs"/.test(list));

console.log('\nSorting & filtering');
const dates = state.filtered.map((i) => i.date).filter(Boolean);
check('newest first by default', dates.every((d, i) => i === 0 || dates[i - 1] >= d));

state.filters.category.add('act of violence');
sandbox.JEM.render();
check('category filter narrows the set',
  state.filtered.length > 0 && state.filtered.length < state.incidents.length &&
  state.filtered.every((i) => sandbox.JEM.categoryKey(i.category) === 'act of violence'),
  `${state.filtered.length} shown`);
check('filter state written to the URL hash',
  /cat=violence/.test(sandbox.JEM.hashFromState()), sandbox.JEM.hashFromState());
state.filters.category.clear();

state.filters.q = 'madrasa';
sandbox.JEM.render();
check('search narrows the set', state.filtered.length > 0 && state.filtered.length < state.incidents.length,
  `${state.filtered.length} hits`);
state.filters.q = '';
sandbox.JEM.render();
check('clearing filters restores everything', state.filtered.length === state.incidents.length);

console.log('\nURL hash round-trip');
sandbox.location.hash = '#cat=violence,religious&st=Delhi&from=2026-05-01&to=2026-06-30&sort=asc&view=trends';
sandbox.JEM.readHash();
check('categories decoded from slugs',
  state.filters.category.has('act of violence') && state.filters.category.has('attacks on religious spaces'));
check('state + dates decoded', state.filters.state.has('Delhi') &&
  state.filters.from === '2026-05-01' && state.filters.to === '2026-06-30');
check('sort + view decoded', state.sortDesc === false && state.view === 'trends');
const rt = sandbox.JEM.hashFromState();
check('hash re-encodes losslessly',
  /cat=/.test(rt) && /st=Delhi/.test(rt) && /from=2026-05-01/.test(rt) && /sort=asc/.test(rt) && /view=trends/.test(rt), rt);
sandbox.location.hash = '';
sandbox.JEM.readHash();
state.view = 'map';
sandbox.JEM.render();

console.log('\nTrends & timeline');
state.view = 'trends';
sandbox.JEM.render();
const trends = byId('trends-inner').innerHTML;
check('hero figure rendered', /hero-stat/.test(trends) && trends.includes(String(state.filtered.length)));
check('time chart rendered', /chart-card/.test(trends) && /<svg/.test(trends));
check('category bars use entity colours', /#5E5A9A|#5e5a9a/.test(trends));
check('bars carry tooltips + labels', /data-tip=/.test(trends) && /bar-hit/.test(trends));
state.view = 'map';
sandbox.JEM.render();

console.log('\nExport & citation');
const csvOut = sandbox.JEM.csvOf(state.filtered.slice(0, 5));
check('CSV carries citation + license header', /^# Justice and Empowerment/.test(csvOut) && /License: CC BY/.test(csvOut));
const csvBody = csvOut.split('\n').filter((l) => !l.startsWith('#')).join('\n');
const csvRows = sandbox.JEM.parseCSV(csvBody);
check('CSV has a row per incident (+header)', csvRows.length === 1 + 5, `${csvRows.length} parsed rows`);
check('CSV escapes quoted fields', /""/.test(csvOut) || !/[^,]"[^,]/.test(csvOut));

console.log('\nDetail card');
const withSources = state.incidents.find((i) => i.sources.filter((s) => s.url).length >= 2 && i.description);
sandbox.JEM.selectIncident(withSources.id);
const card = byId('card-body').innerHTML;
check('card opens', byId('card').classList.contains('open'));
check('narrative rendered', card.includes('card-narrative') && card.includes('<p>'));
check('sources rendered', card.includes('class="source"') && card.includes('href='));
check('source opens safely', card.includes('rel="noopener noreferrer"'));
check('archive companion links present', card.includes('web.archive.org/web/'));
check('corroboration badge shown', byId('card-sub').innerHTML.includes('badge-verify'));
check('correction path present', card.includes('mailto:') && card.includes('Correction'));
check('place shown in head', byId('card-place').textContent === withSources.place);
check('category swatch shown', byId('card-cat').innerHTML.includes('swatch'));
check('provenance caveat present', /caveat/.test(card));
check('selection lands in the URL hash', new RegExp(`sel=${withSources.id}`).test(sandbox.JEM.hashFromState()));

const yt = state.incidents.find((i) => i.sources.some((s) => /youtu/.test(s.url || '')));
if (yt) {
  sandbox.JEM.selectIncident(yt.id);
  check('youtube source embeds', byId('card-body').innerHTML.includes('youtube-nocookie.com/embed/'));
}
sandbox.JEM.closeCard();
check('closing clears the selection from the hash', !/sel=/.test(sandbox.JEM.hashFromState()));

console.log('\nUrdu + Hindi interfaces');
state.lang = 'ur';
check('urdu strings resolve', sandbox.JEM.t('title') === 'نفرت انگیز واقعات کا ٹریکر');
check('urdu category labels resolve', /زمرہ|تشدد/.test(sandbox.JEM.t('category') + 'تشدد'));
state.lang = 'hi';
check('hindi strings resolve', sandbox.JEM.t('title') === 'नफ़रत आधारित घटनाओं का ट्रैकर');
check('hindi week label is a function', typeof sandbox.JEM.t('weekOf') === 'function');
state.lang = 'en';
check('english fallback intact', sandbox.JEM.t('title') === 'Hate Incident Tracker');

console.log('\nChoropleth geometry');
const statesGeo = JSON.parse(readFileSync(join(ROOT, 'data/india-states.json'), 'utf8'));
check('36 current states/UTs bundled', statesGeo.features.length === 36, `${statesGeo.features.length}`);
const geoNames = new Set(statesGeo.features.map((f) =>
  f.properties.state.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim()));
const trackerStates = [...new Set(state.incidents.map((i) => i.state).filter((s) => s && s !== 'Online' && s !== 'India'))];
const unmatched = trackerStates.filter((s) =>
  !geoNames.has(s.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim()));
check('every tracker state matches a polygon', unmatched.length === 0, unmatched.join(', '));

console.log('\nEscaping');
const nasty = { id: 'X1', place: '<img src=x onerror=alert(1)>', state: 'Delhi', date: '2026-05-01',
  category: 'Act of hate', minority: 'Muslim', description: 'a "quoted" <script>bad()</script> line',
  legal_status: '', perpetrator: '', affiliation: '', intervention: '', sources: [], geocodable: false };
state.incidents.push(nasty);
sandbox.JEM.render();
sandbox.JEM.selectIncident('X1');
const nastyHtml = byId('card-body').innerHTML + byId('list').innerHTML;
// The dangerous part is an unescaped tag opener; the literal words survive
// escaped, which is exactly what should happen.
check('sheet text cannot inject markup',
  !/<script|<img/i.test(nastyHtml) && nastyHtml.includes('&lt;'));
sandbox.JEM.closeCard();
state.incidents.pop();

/* --- live sheet path ---------------------------------------------- */
/* Reproduces the quirks of the real workbook when it is published as CSV:
   four blank rows above the header, an unlabelled description column after
   Place, and 'Source of Information (Primary Source)' appearing twice. */

console.log('\nGoogle Sheet path');

const csv = [
  ',,,,,,',
  ',,,,,,',
  ',,,,,,',
  ',,,,,,',
  ['Sr. No', 'Reporting Date', 'Place', '', 'Category', 'Minority',
   'Source of Information\n(Primary Source)', 'Source of Information\n(Primary Source)',
   'Secondary Source', 'Legal Status', "Perpetrator's details",
   'Social and Political affiliation', 'State', 'JEM Intervention Status Final']
    .map((h) => `"${h}"`).join(','),
  ['1', '01-05-2026', 'Trilokpuri', '"A mob attacked, per eyewitnesses."', 'Act of violence', 'Muslim',
   'https://example.org/a', 'https://x.com/x/status/1', 'https://example.org/a',
   'FIR registered', 'Not disclosed', 'Not specified', 'uttrakhand', 'info collected'].join(','),
  // Same Sr. No as the row above — the log restarts numbering each month.
  ['1', '02-06-2026', 'Bhopal', '"A second, unrelated incident."', '"Discrimination,Exclusion & prejudice"',
   'Muslim', 'https://example.org/b', '', '', '', '', '', 'Madhya Pradesh', 'pending'].join(','),
].join('\n');

sandbox.JEM_CONFIG.sheetUrl = 'https://docs.google.com/spreadsheets/d/1TESTTESTTESTTESTTEST/edit#gid=7';
const realFetch = sandbox.fetch;
sandbox.fetch = async (url) => (/gviz/.test(url)
  ? { ok: true, status: 200, text: async () => csv }
  : realFetch(url));

await sandbox.JEM.refresh();
const sheetRows = state.incidents;

check('sheet rows parsed', sheetRows.length === 2, `${sheetRows.length} rows`);
check('header found below blank rows', sheetRows[0] && sheetRows[0].place === 'Trilokpuri');
check('unlabelled description column picked up',
  sheetRows.some((i) => /mob attacked/.test(i.description)));
check('quoted comma survives CSV parse',
  sheetRows.some((i) => i.description.includes('attacked, per')));
check('repeated Sr. No still yields unique, content-stable ids',
  sheetRows[0].id !== sheetRows[1].id && sheetRows[0].ref === sheetRows[1].ref &&
  /^r[0-9a-f]{8}/.test(sheetRows[0].id), `${sheetRows[0].id} / ${sheetRows[1].id}`);
check('dd-mm-yyyy dates parsed', sheetRows.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.date)));
check('duplicate source URL de-duplicated',
  sheetRows[0].sources.filter((s) => s.url === 'https://example.org/a').length === 1);
check('both primary source columns read',
  sheetRows[0].sources.some((s) => /x\.com/.test(s.url || '')));
check('category alias folded',
  sandbox.JEM.categoryKey(sheetRows[0].category) === 'act of violence' &&
  sandbox.JEM.categoryKey(sheetRows[1].category) === 'discrimination, exclusion & prejudice');
check('state typo folded', sheetRows[0].state === 'Uttarakhand', sheetRows[0].state);
check('cached coordinates reattached to sheet rows',
  isFinite(sheetRows.find((i) => i.place === 'Bhopal').lat));
check('status reports the live source', /Live from sheet/.test(byId('status-text').textContent),
  byId('status-text').textContent);

console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
