// Page bodies for the jem.org.in rebuild. Copy is sourced from the live
// jem.org.in (About Us, Our Work, Publications, Reports, Report a Hate
// Crime, Gallery, Video, Contact, Volunteer pages, fetched 2026-07-28) —
// not invented — so the rebuild carries the organisation's real mission
// language, helpline numbers and document list, not placeholder text.
//
// This module runs at authoring time only (node _build/build.mjs). It may
// therefore read the filesystem: cover images are checked for existence
// (missing ones get a branded CSS-only cover), image dimensions are read
// from the files themselves, and the tracker dataset is snapshotted into
// the homepage so the "recently documented" block and sparkline work even
// where fetch() cannot (file://, offline). site.js refreshes them live.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const exists = (rel) => existsSync(join(ROOT, rel));

const helplineNumbers = [
  '+91-98689 52786',
  '+91-78740 12584',
  '+91-98689 26562',
  '+91-95557 11373',
  '+91-95576 39878',
];
const whatsappNumber = '919868952786';

// The 8 tracker categories and their light-theme badge colours (used as a
// dot next to a neutral label — the colour never has to carry text).
// site.js carries the same map for the live-refresh path.
export const CATEGORY_COLORS = {
  'act of violence': '#5E5A9A',
  'attacks on religious spaces': '#11A68B',
  'police atrocity': '#1096E9',
  'state-sponsored discriminatory practice': '#BC549E',
  'act of hate': '#DD9533',
  'discrimination, exclusion & prejudice': '#87984F',
  'media manipulation & distortion of facts': '#7F4413',
  'other': '#848096',
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// --- Image dimensions (PNG + JPEG headers, no dependencies) --------------
// Lets every <img> ship width/height so the browser reserves space (no
// layout shift) even before CSS loads.
function imageSize(rel) {
  try {
    const buf = readFileSync(join(ROOT, rel));
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) { off++; continue; }
        const marker = buf[off + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { w: buf.readUInt16BE(off + 7), h: buf.readUInt16BE(off + 5) };
        }
        off += 2 + buf.readUInt16BE(off + 2);
      }
    }
  } catch { /* fall through */ }
  return null;
}

function imgTag(rel, alt, extra = '') {
  const size = imageSize(rel);
  const dims = size ? ` width="${size.w}" height="${size.h}"` : '';
  return `<img src="${rel}" alt="${esc(alt)}"${dims}${extra ? ' ' + extra : ''}>`;
}

// --- Tracker data snapshot ------------------------------------------------
function trackerData() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'tracker/data/incidents.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Build-time stat snapshot: real figures baked into the static markup so
// pages are truthful even where fetch() cannot run; site.js refreshes live.
function statSnapshot() {
  const data = trackerData();
  const incidents = data ? data.incidents || [] : [];
  const dates = incidents.map((i) => i.date).filter(Boolean).sort();
  return {
    total: incidents.length || 207,
    states: new Set(incidents.map((i) => i.state).filter(Boolean)).size || '—',
    period: dates.length ? `${dates[0].slice(0, 7)} – ${dates[dates.length - 1].slice(0, 7)}` : '—',
  };
}

function catBadge(category) {
  const key = String(category || 'other').toLowerCase();
  const color = CATEGORY_COLORS[key] || CATEGORY_COLORS.other;
  return `<span class="cat-badge" style="--cat:${color}">${esc(category || 'Other')}</span>`;
}

function recordCard(incident) {
  const fullText = String(incident.description || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).join(' ');
  // Append the state only when the place string doesn't already carry it.
  const place = String(incident.place || '');
  const state = incident.state && !place.toLowerCase().includes(String(incident.state).toLowerCase())
    ? ` · ${esc(incident.state)}` : '';
  return `<a class="record-card" href="tracker/index.html#sel=${encodeURIComponent(incident.id)}">
        <span class="rc-meta"><span class="rc-date">${esc(incident.date)}</span> ${catBadge(incident.category)}</span>
        <span class="rc-place">${esc(place)}${state}</span>
        <span class="rc-desc">${esc(fullText)}</span>
      </a>`;
}

// 12-week sparkline of weekly incident counts — inline SVG, no library.
// Indigo line, saffron dot on the latest week. site.js mirrors this for
// the live-refresh path; keep the two in step if the shape changes.
function sparklineSvg(counts) {
  const W = 260, H = 56, P = 6;
  const max = Math.max(1, ...counts);
  const step = (W - P * 2) / (counts.length - 1);
  const pts = counts.map((c, i) => [P + i * step, H - P - (c / max) * (H - P * 2)]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const [ex, ey] = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Documented incidents per week, last 12 weeks">` +
    `<polyline points="${line}" fill="none" stroke="var(--jem-indigo)" stroke-width="2"/>` +
    `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3.5" fill="var(--jem-saffron)"/></svg>`;
}

function weeklyCounts(incidents, weeks = 12) {
  const dates = incidents.map((i) => i.date).filter(Boolean).sort();
  if (!dates.length) return null;
  const end = new Date(dates[dates.length - 1] + 'T00:00:00Z');
  const counts = new Array(weeks).fill(0);
  for (const d of dates) {
    const diff = Math.floor((end - new Date(d + 'T00:00:00Z')) / 86400000);
    const bucket = weeks - 1 - Math.floor(diff / 7);
    if (bucket >= 0 && bucket < weeks) counts[bucket]++;
  }
  return counts;
}

// --- Document cards -------------------------------------------------------
// When the cover image exists on disk it becomes the card's background;
// when it doesn't, the card stays a branded indigo panel with the
// tricolour rule — deliberate, on-brand, no broken image.
function docTop({ badge, tone = '', title, cover }) {
  const hasCover = cover && exists(cover);
  const coverStyle = hasCover ? ` style="background-image:url('${cover}')"` : '';
  const coverClass = hasCover ? ' has-cover' : '';
  return `<div class="doc-top${coverClass}"${coverStyle}>
          <span class="badge ${tone}">${badge}</span>
          <div><h3 style="color:#fff">${title}</h3>${hasCover ? '' : '<div class="tricolour-rule"></div>'}</div>
        </div>`;
}

// `captions` is a WebVTT path; `transcript` a plain-text file read at build
// time and rendered as a disclosure under the card, so the film's content
// is reachable without playing it.
function videoCard({ src, poster, caption, label, captions, transcript }) {
  const track = captions
    ? `<track kind="captions" srclang="en" label="English (auto-generated, reviewed)" src="${captions}" default>` : '';
  let transcriptHtml = '';
  if (transcript && existsSync(join(ROOT, transcript))) {
    const text = readFileSync(join(ROOT, transcript), 'utf8')
      .split(/\n/).map((l) => l.trim()).filter(Boolean).join(' ')
      .split(/(?<=[.?!])\s+(?=[A-Z])/).join('\n');
    const paras = text.split('\n').reduce((acc, sentence) => {
      const last = acc[acc.length - 1];
      if (last && (last.join(' ').length < 420)) last.push(sentence);
      else acc.push([sentence]);
      return acc;
    }, []).map((p) => `<p>${p.join(' ')}</p>`).join('\n      ');
    transcriptHtml = `<details class="video-transcript">
      <summary>Read the transcript</summary>
      <div class="transcript-body">
      ${paras}
      <p class="form-note">Transcript auto-generated from the film's narration and lightly reviewed.</p>
      </div>
    </details>`;
  }
  return `<div class="video-card">
    <button type="button" class="video-poster" style="background-image:url('${poster}')" aria-label="Play: ${label}"><span class="play-btn" aria-hidden="true"></span></button>
    <video controls preload="none" playsinline src="${src}">${track}</video>
    <div class="cap">${caption}</div>
    ${transcriptHtml}
  </div>`;
}

function helplineStrip() {
  return `<div class="helpline-strip">
  <div class="container">
    <span>Report a hate crime now — call the JEM helpline:</span>
    ${helplineNumbers.map((n) => `<a href="tel:${n.replace(/[^\d+]/g, '')}">${n}</a>`).join('<span class="sep">·</span>')}
    <span class="sep">·</span>
    <a href="https://wa.me/${whatsappNumber}" target="_blank" rel="noopener">WhatsApp</a>
  </div>
</div>`;
}

// ---------------------------------------------------------------- Home
export function home() {
  const data = trackerData();
  const incidents = data ? data.incidents || [] : [];
  const recent = [...incidents].filter((i) => i.date).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3);
  const counts = incidents.length ? weeklyCounts(incidents) : null;
  const generated = data && data.generated ? String(data.generated).slice(0, 10) : null;
  const { total, states, period } = statSnapshot();

  return `
<section class="hero">
  <div class="container with-media">
    <div>
      <p class="kicker on-dark">A Jamiat Ulama-i-Hind initiative</p>
      <h1>Justice and Empowerment of Minorities</h1>
      <p class="lead">JEM safeguards the human rights of, and counters hate speech targeted against, religious minorities in India — documenting hate crimes, promoting the rule of law, and providing legal assistance to victims.</p>
      <div class="actions">
        <a class="btn btn-cta" href="report-a-hate-crime.html">Report a hate crime <span class="cta-arrow" aria-hidden="true">→</span></a>
        <a class="btn btn-secondary" href="tracker/index.html">Open the live tracker</a>
      </div>
    </div>
    ${videoCard({ src: 'assets/video/jem-intro.mp4', poster: 'assets/video/jem-intro-poster.png', caption: 'JEM introduction film · 05:56', label: 'the JEM introduction film', captions: 'assets/video/jem-intro.en.vtt', transcript: 'assets/video/jem-intro.en.txt' })}
  </div>
</section>

${helplineStrip()}

<section class="section">
  <div class="container">
    <div class="section-head">
      <div>
        <p class="kicker">Live · updated continuously</p>
        <h2>The hate incident tracker</h2>
      </div>
      <a class="btn btn-outline" href="tracker/index.html" target="_blank" rel="noopener">Open full-screen tracker →</a>
    </div>
    <p class="text-lead" style="margin-bottom:24px">A live, source-linked map of documented hate incidents against religious minorities in India. Every pin carries a narrative, record fields, JEM's intervention status and its source links — filterable by category, minority group, state and date. It opens on the state view; switch to pins, density or trends inside the map.</p>
    <div class="tracker-embed-wrap is-live">
      <iframe src="tracker/index.html?embed=1#mode=states" title="JEM hate incident tracker — live state map" loading="lazy"></iframe>
    </div>
    <div class="stat-grid" data-tracker-stats="tracker/" style="margin-top:18px">
      <div class="stat-card">
        <div class="v focus" data-stat="total">${total}</div>
        <div class="l">Documented incidents</div>
      </div>
      <div class="stat-card">
        <div class="v" data-stat="states">${states}</div>
        <div class="l">States reviewed</div>
      </div>
      <div class="stat-card">
        <div class="v" data-stat="period" style="font-size:22px">${period}</div>
        <div class="l">Reporting period</div>
      </div>
      <div class="stat-card dark">
        <div class="v">Live</div>
        <div class="l">Refreshes automatically</div>
      </div>
    </div>
    <div class="split-narrow" style="margin-top:32px">
      <div>
        <div class="section-head" style="margin-bottom:16px">
          <div>
            <p class="kicker">Recently documented</p>
          </div>
          <a class="btn btn-ghost" href="tracker/index.html">All records →</a>
        </div>
        <div class="record-grid" data-recent-records>
          ${recent.length ? recent.map(recordCard).join('\n          ') : '<p class="text-lead">The latest records appear on the live tracker.</p>'}
        </div>
      </div>
      <div>
        <p class="kicker">Twelve-week trend</p>
        <div class="spark-wrap" data-sparkline>
          ${counts ? sparklineSvg(counts) : ''}
          <span class="spark-cap">Documented incidents per week</span>
        </div>
        <p class="record-updated" style="margin-top:14px" data-record-updated>${generated ? `Record last updated: ${generated}` : ''}</p>
        <p style="margin-top:10px"><a href="methodology.html">How this record is made →</a></p>
      </div>
    </div>
  </div>
</section>

<section class="section" style="background:var(--jem-indigo-900);color:#fff;padding-top:36px;padding-bottom:36px">
  <div class="container" style="display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap">
    <div>
      <p class="kicker on-dark">From the record</p>
      <h2 style="color:#fff;margin-top:6px">Two months in the record: May–June 2026</h2>
      <p style="color:var(--jem-on-indigo-muted);margin-top:8px;max-width:560px">A guided reading of the tracker dataset — where documentation concentrated, what it holds, and what is known about the legal response.</p>
    </div>
    <a class="btn btn-accent" href="story.html">Read the story →</a>
  </div>
</section>

<section class="section alt">
  <div class="container split-narrow">
    <div>
      <p class="kicker">About JEM</p>
      <h2 style="margin-bottom:16px">Documentation, on the record.</h2>
      <p class="text-lead">JEM is an initiative of the Jamiat Ulama-i-Hind, the country's oldest and largest socio-cultural organisation of Indian Muslims. It collects, collates and presents cases of harassment perpetrated against the country's minorities — promoting rule of law, access to justice, equal rights and citizens' security. Alongside this documentation JEM publishes Monthly Reports, four Quarterly Reviews and an Annual Review of the record.</p>
      <div style="margin-top:22px;display:flex;gap:12px;flex-wrap:wrap">
        <a class="btn btn-outline" href="about.html">About JEM →</a>
        <a class="btn btn-ghost" href="our-work.html">See our work →</a>
      </div>
    </div>
    <div class="callout">
      <p><strong>Four Quarterly Reviews and an Annual Review</strong> are published every year, documenting hate crimes against minorities and JEM's response — besides working to ensure equal rights, justice, religious tolerance and coexistence in the country.</p>
    </div>
  </div>
</section>

<section class="section" id="resources">
  <div class="container">
    <div class="section-head">
      <div>
        <p class="kicker">Resources</p>
        <h2>Toolkits &amp; guidance</h2>
      </div>
    </div>
    <div class="card-grid">
      <div class="doc-card">
        ${docTop({ badge: 'Toolkit · English', tone: 'saffron', title: 'How to counter hate speech', cover: 'assets/publications/covers/hate-crime-toolkit-english.jpg' })}
        <div class="doc-body">
          <p>A toolkit for JEM's volunteers, civil society organisations and rights activists.</p>
          <span class="doc-meta">PDF</span>
          <a class="btn btn-outline btn-sm" href="assets/downloads/Hate-Crime-Toolkit-English.pdf" target="_blank" rel="noopener">Download</a>
        </div>
      </div>
      <div class="doc-card">
        ${docTop({ badge: 'Toolkit · Urdu', tone: 'saffron', title: '<span lang="ur" dir="rtl">نفرت انگیزی کی روک تھام کا طریقہ</span>', cover: 'assets/publications/covers/hate-crime-toolkit-urdu.jpg' })}
        <div class="doc-body">
          <p lang="ur" dir="rtl">اقلیتوں کو انصاف کی فراہمی اور انہیں بااختیار بنانے کے لیے جیم کے رضاکاروں، سول سوسائٹی اور کارکنان کے لیے ٹول کٹ۔</p>
          <span class="doc-meta">PDF</span>
          <a class="btn btn-outline btn-sm" href="assets/downloads/Hate-Crime-Toolkit-Urdu.pdf" target="_blank" rel="noopener">Download</a>
        </div>
      </div>
      <div class="doc-card">
        ${docTop({ badge: 'Guidance', title: 'How to report a hate crime', cover: 'assets/publications/covers/how-to-report.jpg' })}
        <div class="doc-body">
          <p>Step-by-step guidance for documenting and reporting an incident to JEM.</p>
          <span class="doc-meta">PDF</span>
          <a class="btn btn-outline btn-sm" href="assets/downloads/How-to-Report-a-Hate-Crime.pdf" target="_blank" rel="noopener">Download</a>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section alt">
  <div class="container">
    <div class="section-head">
      <div>
        <p class="kicker">Latest</p>
        <h2>Reports &amp; reviews</h2>
      </div>
      <a class="btn btn-ghost" href="reports.html">All reports →</a>
    </div>
    <div class="card-grid">
      <div class="doc-card">
        ${docTop({ badge: 'Featured', tone: 'solid', title: 'JEM Annual Report 2025', cover: 'assets/publications/covers/jem-annual-report-2025.png' })}
        <div class="doc-body">
          <p>The year's documented findings on hate crimes and minority rights in India.</p>
          <span class="doc-meta">2025 · PDF</span>
          <a class="btn btn-outline btn-sm" href="assets/downloads/JEM-Annual-Report-2025.pdf" target="_blank" rel="noopener">Download</a>
        </div>
      </div>
      <div class="doc-card">
        ${docTop({ badge: 'Report', title: 'Sambhal Violence Report', cover: 'assets/publications/covers/sambhal-report.jpg' })}
        <div class="doc-body">
          <p>Findings on the Sambhal violence, published jointly by the Jamiat Ulama-i-Hind and JEM.</p>
          <span class="doc-meta">Dec 2024 · PDF</span>
          <a class="btn btn-outline btn-sm" href="assets/downloads/Sambhal-Report-JUH-JEM-Dec-2024.pdf" target="_blank" rel="noopener">Download</a>
        </div>
      </div>
      <div class="doc-card">
        ${docTop({ badge: 'Review', title: 'Annual Review, 2023', cover: 'assets/publications/reviews/annual-review-2023.jpg' })}
        <div class="doc-body">
          <p>JEM's annual documentation of hate crimes against minorities.</p>
          <span class="doc-meta">2023 · PDF</span>
          <a class="btn btn-outline btn-sm" href="assets/downloads/Annual-Review-2023.pdf" target="_blank" rel="noopener">Download</a>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section" style="background:var(--jem-indigo);color:#fff">
  <div class="container" style="display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap">
    <div>
      <p class="kicker on-dark">Join JEM</p>
      <h2 style="color:#fff;max-width:520px">Volunteer to document hate crimes in your city</h2>
      <p style="color:var(--jem-on-indigo-muted);margin-top:10px;max-width:560px">Concerned citizens, media professionals, civil activists, lawyers and doctors — JEM welcomes volunteers from every field willing to help deliver justice and empowerment to minorities.</p>
    </div>
    <a class="btn btn-accent" href="volunteer.html">Join JEM as a volunteer</a>
  </div>
</section>
`;
}

// ------------------------------------------------------------- About us
export function about() {
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">About JEM</p>
    <h1>Justice and Empowerment of Minorities</h1>
    <p class="lead">An initiative of the Jamiat Ulama-i-Hind, the country's oldest and largest socio-cultural organisation of Indian Muslims.</p>
  </div>
</section>
<section class="section">
  <div class="container split-wide">
    <div class="measure">
      <p class="text-lead">JEM's mission is to safeguard the human rights of, and counter hate speech targeted against, religious minorities of the country. It endeavours to collect, collate and present cases of harassment, in any form, perpetrated against the country's minorities by right-wing elements.</p>
      <p class="text-lead">Its aim is to promote rule of law and access to justice, equal rights, citizens' security and human rights — to defend and empower religious minorities, marginalised and persecuted individuals, groups and communities. It publishes four Quarterly Reviews and an Annual Review every year, highlighting the hate crimes against minorities, besides responding to marginalisation and persecution of minorities, in addition to ensuring implementation of equal rights, justice and peace, religious tolerance and coexistence in the country.</p>
      <p class="text-lead">JEM's aim is to empower and provide justice and judicial assistance to the victims of such crimes, which could be categorised under 'hate crimes'. It further aims to strengthen the constitutional edifice of the country, which guarantees the rights and dignity of minority groups, besides helping to build a vibrant, thriving and affluent India.</p>
    </div>
    <div>
      <div class="callout green">
        <p><strong>Documentation, on the record.</strong> Every case JEM publishes is sourced, dated and built to be cited — the standard the organisation holds its own findings to.</p>
      </div>
      <div class="callout" style="margin-top:18px">
        <p><strong>The parent organisation.</strong> The Jamiat Ulama-i-Hind was founded in 1919 and has worked for a century on education, relief and civil rights of Indian Muslims. Its head office is at 1, Bahadur Shah Zafar Marg, New Delhi — the address JEM works from.</p>
      </div>
    </div>
  </div>
</section>
<section class="section alt">
  <div class="container">
    <p class="kicker">Method</p>
    <h2 style="margin-bottom:20px">How the record is made</h2>
    <div class="step-strip">
      <div class="step">
        <span class="n">01 · Report</span>
        <h3>An incident is reported</h3>
        <p>Through the helpline, WhatsApp, field volunteers or monitored press coverage — each report is logged with its date, place and source.</p>
      </div>
      <div class="step">
        <span class="n">02 · Verify</span>
        <h3>The report is verified</h3>
        <p>Editorial review checks sources and fields, and the Case Review Committee (CRC) screens each case and decides the intervention before anything is entered. Details remain as reported; allegations are not findings of fact.</p>
      </div>
      <div class="step">
        <span class="n">03 · Publish</span>
        <h3>The record is published</h3>
        <p>Verified entries reach the live tracker and the quarterly and annual reviews — sourced, dated and built to be cited.</p>
      </div>
    </div>
    <p style="margin-top:18px"><a href="methodology.html">Read the full methodology →</a></p>
  </div>
</section>
<section class="section" style="text-align:center">
  <div class="container">
    <p class="kicker" style="justify-content:center">Read next</p>
    <h2>See how JEM turns this mission into practice</h2>
    <div style="margin-top:22px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <a class="btn btn-primary" href="our-work.html">Our work →</a>
      <a class="btn btn-outline" href="tracker/index.html">The live tracker →</a>
    </div>
  </div>
</section>
`;
}

// ------------------------------------------------------------- Our work
const objectives = [
  'Connecting hate crime victims with professional legal assistance and victim support services',
  'Building and maintaining a database documenting incidents of anti-Muslim and anti-minority hate crimes',
  'Collaborating with law enforcement to protect victims and prosecute offenders',
  'Advocating for stronger hate crime legislation at all government levels',
  'Facilitating dialogue and mediation between communities to prevent hate crimes',
  'Raising public awareness about rising hate crimes and their threat to national stability',
  'Engaging international human rights mechanisms in defense of religious minorities',
  'Developing youth leaders capable of promoting peace, interfaith harmony, and equal citizenship',
];

export function ourWork() {
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Our work</p>
    <h1>Vision, mission &amp; goals</h1>
    <p class="lead">Safeguarding human rights and countering hate crimes and related incidents against minorities in India.</p>
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="card-grid" style="margin-bottom:8px">
      <div class="doc-card">
        <div class="doc-body" style="padding-top:24px">
          <span class="badge saffron">Vision</span>
          <p class="text-lead" style="margin-top:12px">Safeguarding human rights and countering hate crimes and related incidents against minorities in India.</p>
        </div>
      </div>
      <div class="doc-card">
        <div class="doc-body" style="padding-top:24px">
          <span class="badge">Mission</span>
          <p class="text-lead" style="margin-top:12px">Advance rule of law, ensure minorities' access to justice and equal rights, enhance understanding of hate crimes against minorities in India, foster community solidarity, and defend marginalised and persecuted groups.</p>
        </div>
      </div>
      <div class="doc-card">
        <div class="doc-body" style="padding-top:24px">
          <span class="badge green">Goal</span>
          <p class="text-lead" style="margin-top:12px">Address minority persecution in India through actionable strategies that promote equal rights, judicial access, and national peace.</p>
        </div>
      </div>
    </div>
  </div>
</section>
<section class="section alt">
  <div class="container">
    <p class="kicker">Eight core objectives</p>
    <h2 style="margin-bottom:8px">How JEM operates</h2>
    <div class="objective-list" style="margin-top:24px">
      ${objectives.map((o, i) => `<div class="objective"><div class="n">${String(i + 1).padStart(2, '0')}</div><p>${o}</p></div>`).join('\n      ')}
    </div>
  </div>
</section>
<section class="section" style="text-align:center">
  <div class="container">
    <h2>This work is documented, in real time, on the tracker</h2>
    <a class="btn btn-primary" style="margin-top:20px" href="tracker/index.html">Open the live hate incident tracker →</a>
  </div>
</section>
`;
}

// ---------------------------------------------------------- Publications
const annualReviews = [
  { title: 'Annual Review, 2023', file: 'Annual-Review-2023.pdf', cover: 'annual-review-2023.jpg', year: '2023' },
  { title: 'Annual Review, 2022', file: 'Annual-Review-2022.pdf', cover: 'annual-review-2022.jpg', year: '2022' },
];
export const quarterlyReviews = [
  { title: 'October – December, 2024', file: 'Quarterly-Review-October-December-2024.pdf', cover: 'quarterly-2024-oct-dec.jpg', year: '2024' },
  { title: 'July – September, 2024', file: 'Quarterly-Review-July-September-2024.pdf', cover: 'quarterly-2024-jul-sep.jpg', year: '2024' },
  { title: 'April – June, 2024', file: 'Quarterly-Review-April-June-2024.pdf', cover: 'quarterly-2024-apr-jun.jpg', year: '2024' },
  { title: 'January – March, 2024', file: 'Quarterly-Review-January-March-2024.pdf', cover: 'quarterly-2024-jan-mar.jpg', year: '2024' },
  { title: 'October – December, 2023', file: 'Quarterly-Review-October-December-2023.pdf', cover: 'quarterly-2023-oct-dec.jpg', year: '2023' },
  { title: 'July – September, 2023', file: 'Quarterly-Review-July-September-2023.pdf', cover: 'quarterly-2023-jul-sep.jpg', year: '2023' },
  { title: 'April – June, 2023', file: 'Quarterly-Review-April-June-2023.pdf', cover: 'quarterly-2023-apr-jun.jpg', year: '2023' },
  { title: 'January – March, 2023', file: 'Quarterly-Review-January-March-2023.pdf', cover: 'quarterly-2023-jan-mar.jpg', year: '2023' },
  { title: 'October – December, 2022', file: 'quarterly-review-Oct-Dec-2022.pdf', cover: 'quarterly-2022-oct-dec.jpg', year: '2022' },
  { title: 'July – September, 2022', file: 'quarterly-review-uly-sept-2022.pdf', cover: 'quarterly-2022-jul-sep.jpg', year: '2022' },
];
export const monthsEn = ['August-23', 'September-23', 'October-23', 'November-23', 'January-24', 'February-24', 'April-24', 'May-24', 'June-24', 'July-24', 'August-24', 'September-24', 'October-24', 'November-24', 'December-24', 'February-25'];
export const monthsUr = ['August-23', 'September-23', 'October-23', 'January-24', 'February-24', 'April-24', 'May-24', 'June-24', 'July-24', 'August-24', 'September-24', 'October-24', 'November-24', 'December-24', 'January-25', 'February-25'];

function monthLabel(code) {
  const [m, y] = code.split('-');
  return `${m} 20${y}`;
}

// Prefer a locally mirrored PDF in assets/downloads/ (see _build/CHANGES.md
// for the mirroring run); fall back to the live jem.org.in URL.
function mirroredOr(remoteUrl, filename) {
  const local = `assets/downloads/${filename}`;
  return exists(local) ? local : remoteUrl;
}

// One publication tile. Emits filter metadata (type, year, title) as
// data-* attributes for the client-side filter bar, real image dimensions,
// and a branded CSS-only cover when no image exists on disk.
function pubCard(it) {
  const hasCover = it.cover && exists(it.cover);
  const thumb = hasCover
    ? imgTag(it.cover, `${it.title} cover`, 'loading="lazy"')
    : `<div class="gen-cover"><span class="gc-kicker">JEM · ${esc(it.kicker)}</span><span class="gc-title">${esc(it.title)}</span><div class="tricolour-rule"></div></div>`;
  return `<a class="pub-card" href="${it.href}" target="_blank" rel="noopener" data-type="${it.type}" data-year="${it.year}" data-title="${esc(it.title.toLowerCase())}">
        <div class="pub-thumb">${thumb}<span class="dl-badge" aria-hidden="true">↓</span></div>
        <div class="t">${it.title}</div>
        <span class="sub">PDF · ${esc(it.kicker)}</span>
      </a>`;
}

function pubGrid(items) {
  return `<div class="pub-grid">
      ${items.map(pubCard).join('\n      ')}
    </div>`;
}

export function publications() {
  const annual = annualReviews.map((r) => ({
    title: r.title, href: `assets/downloads/${r.file}`, cover: `assets/publications/reviews/${r.cover}`,
    type: 'annual', year: r.year, kicker: 'Annual review',
  }));
  const quarterlyByYear = {};
  for (const r of quarterlyReviews) {
    (quarterlyByYear[r.year] = quarterlyByYear[r.year] || []).push({
      title: r.title, href: mirroredOr(`https://jem.org.in/${r.file}`, r.file), cover: `assets/publications/reviews/${r.cover}`,
      type: 'quarterly', year: r.year, kicker: 'Quarterly review',
    });
  }
  const nlYear = (m) => `20${m.split('-')[1]}`;
  const newsletterEn = monthsEn.map((m) => ({
    title: monthLabel(m), href: mirroredOr(`https://jem.org.in/Publications/JEM-Newsletters-English/JEM-Newsletters-English-${m}.pdf`, `JEM-Newsletters-English-${m}.pdf`),
    cover: `assets/publications/newsletters-en/${m}.jpg`, type: 'newsletter-en', year: nlYear(m), kicker: 'Newsletter · English',
  }));
  const newsletterUr = monthsUr.map((m) => ({
    title: monthLabel(m), href: mirroredOr(`https://jem.org.in/Publications/JEM-Newsletters-Urdu/JEM-Newsletters-Urdu-${m}.pdf`, `JEM-Newsletters-Urdu-${m}.pdf`),
    cover: `assets/publications/newsletters-ur/${m}.jpg`, type: 'newsletter-ur', year: nlYear(m), kicker: 'Newsletter · Urdu',
  }));
  const years = ['2025', '2024', '2023', '2022'];

  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Publications</p>
    <h1>Reviews &amp; newsletters</h1>
    <p class="lead">Four Quarterly Reviews and an Annual Review every year, plus a monthly newsletter in English and Urdu — every figure sourced and dated.</p>
  </div>
</section>
<section class="section">
  <div class="container">

    <form class="pub-filter" data-pub-filter>
      <label for="pf-type">Type</label>
      <select id="pf-type">
        <option value="">All</option>
        <option value="annual">Annual reviews</option>
        <option value="quarterly">Quarterly reviews</option>
        <option value="newsletter-en">Newsletters · English</option>
        <option value="newsletter-ur">Newsletters · Urdu</option>
      </select>
      <label for="pf-year">Year</label>
      <select id="pf-year">
        <option value="">All</option>
        ${years.map((y) => `<option value="${y}">${y}</option>`).join('\n        ')}
      </select>
      <label for="pf-search" class="visually-hidden-label">Search</label>
      <input id="pf-search" type="search" placeholder="Search titles…">
      <span class="pf-count" data-pf-count></span>
    </form>

    <div class="pub-group" id="annual-reviews">
      <h3>Annual reviews</h3>
      ${pubGrid(annual)}
    </div>

    ${Object.keys(quarterlyByYear).sort().reverse().map((y) => `<div class="pub-group" id="quarterly-${y}">
      <h3>Quarterly reviews — ${y}</h3>
      ${pubGrid(quarterlyByYear[y])}
    </div>`).join('\n\n    ')}

    <div class="pub-group collapsible" id="newsletters-en">
      <h3>JEM newsletters — English</h3>
      <button class="pub-toggle" data-count="${newsletterEn.length} issues" aria-expanded="false">Show all ${newsletterEn.length} issues</button>
      ${pubGrid(newsletterEn)}
    </div>

    <div class="pub-group collapsible" id="newsletters-ur">
      <h3>JEM newsletters — Urdu</h3>
      <button class="pub-toggle" data-count="${newsletterUr.length} issues" aria-expanded="false">Show all ${newsletterUr.length} issues</button>
      ${pubGrid(newsletterUr)}
    </div>

    <p class="pub-empty" data-pub-empty>No publications match the current filter.</p>
    <p class="source-line">Annual reviews are mirrored locally; issues not yet mirrored open from jem.org.in. Source: JEM, Publications (jem.org.in/publications.html).</p>
  </div>
</section>
`;
}

// -------------------------------------------------------------- Reports
export const reportItems = [
  { badge: 'Featured', tone: 'solid', title: 'JEM Annual Report 2025', desc: "The year's documented findings on hate crimes and minority rights in India.", meta: '2025 · PDF', file: 'JEM-Annual-Report-2025.pdf', cover: 'assets/publications/covers/jem-annual-report-2025.png', date: '2025-12-31' },
  { badge: 'Report', tone: '', title: 'Sambhal Violence Report', desc: 'Findings on the Sambhal violence, published jointly by the Jamiat Ulama-i-Hind and JEM.', meta: 'Dec 2024 · PDF', file: 'Sambhal-Report-JUH-JEM-Dec-2024.pdf', cover: 'assets/publications/covers/sambhal-report.jpg', date: '2024-12-31' },
  { badge: 'Report', tone: '', title: 'Hate Speech in India: An Overview', desc: "JEM's findings on hate speech and its escalation into communal violence.", meta: 'PDF', file: 'contextualising-Islamophobia.pdf', cover: 'assets/publications/covers/contextualising-islamophobia.jpg', date: '2023-12-31' },
  { badge: 'Report', tone: '', title: 'Judgment Report', desc: 'Documentation and analysis of judicial outcomes in hate crime cases JEM has tracked.', meta: 'PDF', file: 'judgement-report.pdf', cover: 'assets/publications/covers/judgement-report.jpg', date: '2023-12-31' },
  { badge: 'Report', tone: '', title: 'Hate Speech in India: An Overview Report', desc: 'A companion overview report on the scale and pattern of hate speech nationally.', meta: 'PDF', file: 'hate-speech-in-india-an-overview-report.pdf', cover: 'assets/publications/covers/hate-speech-overview.jpg', date: '2023-12-31' },
];

export function reports() {
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Reports</p>
    <h1>JEM reports</h1>
    <p class="lead">Findings on specific incidents, patterns of hate speech and judicial outcomes — each sourced and built to be cited.</p>
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="card-grid">
      ${reportItems.map((it) => `<div class="doc-card">
        ${docTop({ badge: it.badge, tone: it.tone, title: it.title, cover: it.cover })}
        <div class="doc-body">
          <p>${it.desc}</p>
          <span class="doc-meta">${it.meta}</span>
          <a class="btn btn-outline btn-sm" href="assets/downloads/${it.file}" target="_blank" rel="noopener">Download</a>
        </div>
      </div>`).join('\n      ')}
    </div>
  </div>
</section>
<section class="section alt">
  <div class="container" style="display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap">
    <div>
      <p class="kicker">From the record</p>
      <h2>Two months in the record: May–June 2026</h2>
      <p class="text-lead" style="margin-top:6px;max-width:560px">A guided reading of the tracker dataset — every figure computed from the published record.</p>
    </div>
    <a class="btn btn-primary" href="story.html">Read the story →</a>
  </div>
</section>
`;
}

// ---------------------------------------------------- Report a hate crime
export function reportHateCrime() {
  const categories = [
    'Act of violence',
    'Attacks on religious spaces',
    'Police atrocity',
    'State-sponsored discriminatory practice',
    'Act of hate',
    'Discrimination, exclusion & prejudice',
    'Media manipulation & distortion of facts',
    'Other',
  ];
  const states = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
    'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
    'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
    'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
    'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
  ];
  return `
<button type="button" class="quick-exit" data-quick-exit>Quick exit →</button>
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Report a hate crime</p>
    <h1>Report a hate crime</h1>
    <p class="lead">Call the JEM helpline, send full details over WhatsApp, or build a written report below. Every report is entered into JEM's record and reviewed.</p>
  </div>
</section>
${helplineStrip()}
<section class="section">
  <div class="container split">
    <div>
      <p class="kicker">Call now</p>
      <div class="row-list" style="margin-bottom:28px">
        ${helplineNumbers.map((n) => `<a class="row" href="tel:${n.replace(/[^\d+]/g, '')}" style="text-decoration:none"><span class="t">${n}</span><span class="s">Call</span></a>`).join('\n        ')}
      </div>
      <p class="kicker">Or message</p>
      <a class="btn btn-accent" href="https://wa.me/${whatsappNumber}" target="_blank" rel="noopener">Send details over WhatsApp</a>
      <p class="form-note">Include full details of the incident: what happened, where, when, and who was involved.</p>
      <div class="safety-note">
        <p><strong>Your safety.</strong></p>
        <ul>
          <li>Use a device the person you are reporting cannot access, and clear this page from your browser history afterwards.</li>
          <li>The "Quick exit" button at the top right replaces this page with Google — it will not appear in your back button.</li>
          <li>On WhatsApp, you can turn on disappearing messages for your chat with JEM.</li>
        </ul>
      </div>
    </div>
    <div class="form-card">
      <h3 style="margin-bottom:6px">Build a written report</h3>
      <p class="form-note" style="margin:0 0 18px">Fill in what you know. Nothing is sent until you choose WhatsApp, email or copy below — the form itself transmits nothing.</p>
      <form data-report-form>
        <div class="field-row">
          <div class="field"><label for="fname">First name</label><input id="fname" name="fname" type="text" required autocomplete="off"></div>
          <div class="field"><label for="lname">Last name</label><input id="lname" name="lname" type="text" autocomplete="off"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="phone">Phone number</label><input id="phone" name="phone" type="tel" autocomplete="off"></div>
          <div class="field"><label for="email">Email address (optional)</label><input id="email" name="email" type="email" autocomplete="off"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="idate">Date of incident</label><input id="idate" name="idate" type="date"></div>
          <div class="field"><label for="istate">State / union territory</label>
            <select id="istate" name="istate" required>
              <option value="">Select…</option>
              ${states.map((s) => `<option>${s}</option>`).join('\n              ')}
            </select>
          </div>
        </div>
        <div class="field"><label for="idistrict">District / locality</label><input id="idistrict" name="idistrict" type="text" placeholder="District, town or locality" autocomplete="off"></div>
        <div class="field"><label for="icategory">Type of incident</label>
          <select id="icategory" name="icategory" required>
            <option value="">Select…</option>
            ${categories.map((c) => `<option>${c}</option>`).join('\n            ')}
          </select>
        </div>
        <div class="field"><label for="message">What happened</label><textarea id="message" name="message" rows="6" required placeholder="What happened, who was involved, whether the police were informed"></textarea></div>
        <div class="choice">
          <input id="consent" name="consent" type="checkbox" required>
          <label for="consent">I consent to JEM storing and reviewing this report.</label>
        </div>
        <button class="btn btn-cta" type="submit">Submit</button>
        <p class="form-note">What happens to this report: it is stored by JEM, reviewed by the documentation team, and may be added to the tracker after verification. Contact details are used only to follow up and are never published.</p>
      </form>
      <div class="report-output" data-report-output hidden>
        <h4>Your report is ready to send</h4>
        <textarea rows="9" readonly data-report-text aria-label="The prepared report text"></textarea>
        <div class="ro-actions">
          <a class="btn btn-accent" data-report-wa href="#" target="_blank" rel="noopener">Send via WhatsApp</a>
          <a class="btn btn-outline" data-report-mail href="#">Send by email</a>
          <button type="button" class="btn btn-outline copy-btn" data-report-copy>Copy report text</button>
        </div>
        <p class="form-note">WhatsApp opens a chat with the JEM helpline with the report pre-filled. Email opens your mail app addressed to contact@jem.org.in. If neither works on this device, copy the text and send it any way that is safe for you.</p>
      </div>
    </div>
  </div>
</section>
<div class="report-actionbar">
  <a class="btn btn-accent" href="tel:+919868952786">Call the helpline</a>
  <a class="btn btn-secondary" href="https://wa.me/${whatsappNumber}" target="_blank" rel="noopener">WhatsApp</a>
</div>
`;
}

// ------------------------------------------------------------------ Gallery
export function gallery() {
  const photos = [
    { file: 'jem-1.jpg', alt: 'Two JEM facilitators beside a screen introducing a capacity-building workshop on Islamophobia and hate crimes against minorities, 2023-03-16.' },
    { file: 'jem-2.jpg', alt: 'A JEM trainer addresses an online session; the screen shows a diagram of the objectives of JEM\'s documentation work.' },
    { file: 'jem-3.jpg', alt: 'A speaker addresses rows of seated participants at a JEM awareness session on reporting hate crimes.' },
    { file: 'jem-4.jpg', alt: 'A facilitator opens a workshop and capacity-building programme on Islamophobia and hate crime, 2022-09-30.' },
  ];
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Gallery</p>
    <h1>Photo gallery</h1>
    <p class="lead">JEM in the field — outreach, documentation and community work.</p>
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="photo-grid">
      ${photos.map((p) => `<a href="assets/gallery/${p.file}" target="_blank" rel="noopener">${imgTag(`assets/gallery/${p.file}`, p.alt, 'loading="lazy"')}</a>`).join('\n      ')}
    </div>
  </div>
</section>
<section class="section alt">
  <div class="container" style="display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap">
    <div>
      <p class="kicker">Also in this gallery</p>
      <h2>Video gallery</h2>
      <p class="text-lead" style="margin-top:6px">The JEM introduction film, plus JEM's overview and helpline films.</p>
    </div>
    <a class="btn btn-primary" href="video.html">Watch the videos →</a>
  </div>
</section>
`;
}

export function video() {
  // Films mirrored into assets/video/ play locally; the rest stream from
  // jem.org.in (the overview film there is ~545MB, too large to mirror).
  const overviewSrc = exists('assets/video/jem-overview.mp4') ? 'assets/video/jem-overview.mp4' : 'https://jem.org.in/video/jem.mp4';
  const helplineSrc = exists('assets/video/jem-helpline.mp4') ? 'assets/video/jem-helpline.mp4' : 'https://jem.org.in/video/Jiem-video-final.mp4';
  const remoteCount = [overviewSrc, helplineSrc].filter((s) => s.startsWith('http')).length;
  const videos = [
    { src: 'assets/video/jem-intro.mp4', poster: 'assets/video/jem-intro-poster.png', caption: 'JEM introduction film · 05:56', label: 'the JEM introduction film', captions: 'assets/video/jem-intro.en.vtt', transcript: 'assets/video/jem-intro.en.txt' },
    { src: overviewSrc, poster: 'assets/video/jem-overview-poster.png', caption: 'JEM — overview film', label: 'the JEM overview film' },
    { src: helplineSrc, poster: 'assets/video/jem-helpline-poster.png', caption: 'JEM helpline', label: 'the JEM helpline film' },
  ];
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Gallery</p>
    <h1>Video gallery</h1>
    <p class="lead">Films from JEM.${remoteCount ? ` ${remoteCount === 1 ? 'One film streams' : 'Some films stream'} from jem.org.in.` : ''}</p>
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="video-grid">
      ${videos.map((v) => videoCard(v)).join('\n      ')}
    </div>
  </div>
</section>
`;
}

// -------------------------------------------------------------------- Contact
export function contact() {
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Contact</p>
    <h1>Get in touch</h1>
    <p class="lead">How can we help?</p>
  </div>
</section>
${helplineStrip()}
<section class="section">
  <div class="container split">
    <div>
      <p class="kicker">Office</p>
      <p class="text-lead">Justice and Empowerment of Minorities<br>(A Jamiat Ulama-i-Hind initiative)<br>1, Bahadur Shah Zafar Marg, New Delhi</p>
      <p class="kicker" style="margin-top:26px">Email</p>
      <p class="text-lead"><a href="mailto:contact@jem.org.in">contact@jem.org.in</a></p>
      <p class="kicker" style="margin-top:26px">Follow JEM</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <a class="btn btn-outline btn-sm" href="https://twitter.com/JEM_Jamiat" target="_blank" rel="noopener">X / Twitter</a>
        <a class="btn btn-outline btn-sm" href="https://www.facebook.com/profile.php?id=100089126280847" target="_blank" rel="noopener">Facebook</a>
        <a class="btn btn-outline btn-sm" href="https://www.linkedin.com/in/jem-jamiat-a7339125b" target="_blank" rel="noopener">LinkedIn</a>
      </div>
    </div>
    <div class="form-card">
      <h3 style="margin-bottom:18px">How can we help</h3>
      <form data-mailto-form data-mailto="contact@jem.org.in">
        <div class="field-row">
          <div class="field"><label for="fname">First name</label><input id="fname" name="fname" type="text" required></div>
          <div class="field"><label for="lname">Last name</label><input id="lname" name="lname" type="text"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="phone">Phone number</label><input id="phone" name="phone" type="tel"></div>
          <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" required></div>
        </div>
        <div class="field"><label for="city">Your city</label><input id="city" name="city" type="text"></div>
        <div class="field"><label for="subject">Subject</label><input id="subject" name="subject" type="text"></div>
        <div class="field"><label for="message">Your message</label><textarea id="message" name="message" rows="6" required></textarea></div>
        <button class="btn btn-primary" type="submit">Submit</button>
        <p class="form-note">Submitting opens your email app with the message prepared, addressed to contact@jem.org.in — for anything urgent, call the helpline above instead.</p>
      </form>
    </div>
  </div>
</section>
`;
}

// ------------------------------------------------------------------ Volunteer
export function volunteer() {
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Get involved</p>
    <h1>Join JEM as a volunteer</h1>
    <p class="lead">Volunteers bring skills, talent, experience, energy and new ideas — volunteering is a beneficial means towards the development of societies and individuals alike.</p>
  </div>
</section>
<section class="section">
  <div class="container split-wide">
    <div class="measure">
      <p class="text-lead">JEM welcomes volunteers from every background — concerned citizens, media professionals, civil activists, lawyers, doctors and others — all willing to help ensure the delivery of justice and empowerment of minorities.</p>
      <p class="text-lead">Volunteers report on hate crimes in their locality, city or state, feeding directly into JEM's record and the live incident tracker.</p>
      <div class="callout" style="margin-top:24px">
        <p>To apply, email <strong>contact@jem.org.in</strong> with your details, and put <strong>"Application for Volunteer"</strong> in the subject line.</p>
      </div>
      <a class="btn btn-accent" style="margin-top:22px" href="mailto:contact@jem.org.in?subject=Application%20for%20Volunteer">Email to volunteer →</a>
    </div>
    <div class="doc-card">
      <div class="doc-top">
        <span class="badge saffron">Also useful</span>
        <h3 style="color:#fff;margin-top:12px">Before you report your first case</h3>
      </div>
      <div class="doc-body">
        <p>Read the toolkit on countering hate speech and the guidance on reporting a hate crime.</p>
        <a class="btn btn-outline btn-sm" href="publications.html">Publications →</a>
        <a class="btn btn-outline btn-sm" href="report-a-hate-crime.html">Report a hate crime →</a>
      </div>
    </div>
  </div>
</section>
`;
}

// ------------------------------------------------------------ Methodology
export function methodology() {
  const inclusions = [
    ['Act of violence', 'Physical assault, killing or attempted harm where the victim\'s religious identity is a reported motive.'],
    ['Attacks on religious spaces', 'Damage, desecration, obstruction or forced closure of mosques, shrines, graveyards, madrasas or other places of worship.'],
    ['Police atrocity', 'Reported excess, custodial violence or discriminatory action by police directed at members of a minority.'],
    ['State-sponsored discriminatory practice', 'Demolitions, orders or administrative action reported to single out a minority community.'],
    ['Act of hate', 'Threats, harassment, hate speech, or intimidation directed at a person or community on account of their faith.'],
    ['Discrimination, exclusion & prejudice', 'Reported denial of housing, work, services, education or access on religious grounds.'],
    ['Media manipulation & distortion of facts', 'False or communally slanted reporting that targets a minority, as documented against the verifiable record.'],
    ['Other', 'Entries that do not fit the categories above; held in the record and reviewed at the next cycle.'],
  ];
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Methodology &amp; data</p>
    <h1>How we document</h1>
    <p class="lead">What is recorded, how it is verified, what precision it is published at, and how the data may be reused. A record exists to be cited — this page states the standard the record is held to.</p>
  </div>
</section>

<section class="section">
  <div class="container">
    <p class="kicker" id="what-is-recorded">What is recorded</p>
    <h2 style="margin-bottom:14px">Eight categories, defined plainly</h2>
    <p class="text-lead measure" style="margin-bottom:22px">An entry is made when a reported incident falls under one of the categories below and carries at least one source JEM can point to.</p>
    <dl class="def-list">
      ${inclusions.map(([t, d]) => `<div class="def-row"><dt>${t}</dt><dd>${d}</dd></div>`).join('\n      ')}
    </dl>
  </div>
</section>

<section class="section alt">
  <div class="container split-wide">
    <div>
      <p class="kicker" id="sourcing">Sourcing</p>
      <h2 style="margin-bottom:14px">Primary and secondary sources</h2>
      <p class="text-lead"><strong>Primary</strong> sources are first-hand: the victim or their family, JEM's field volunteers, police records such as FIRs, or direct testimony gathered by the helpline. <strong>Secondary</strong> sources are published accounts: press reporting, court records and statements by public bodies.</p>
      <p class="text-lead">Every entry in the tracker carries its source links, marked Primary or Secondary. Where possible, sources are preserved with a web.archive.org companion link, so an entry remains verifiable even if the original page changes or disappears.</p>
    </div>
    <div class="callout">
      <p><strong>Every figure travels with a source.</strong> A figure that cannot be corroborated is held outside the published totals and marked accordingly.</p>
    </div>
  </div>
</section>

<section class="section">
  <div class="container split-wide">
    <div>
      <p class="kicker" id="verification">Verification</p>
      <h2 style="margin-bottom:14px">From field log to published record</h2>
      <p class="text-lead">Reports enter a field log. Editorial review checks each report's sources, categorisation and record fields, and the Case Review Committee (CRC) screens every case — assessing the evidence and deciding the appropriate intervention — before it is entered into the documentation sheet. The sheet feeds the public tracker within one refresh cycle.</p>
      <p class="text-lead">Details are as reported; allegations are not findings of fact. Inclusion in the record is not adjudication — accused persons are presumed innocent unless convicted by a court. And because the record contains only what could be documented and verified, it is an undercount, not a census.</p>
    </div>
    <div class="callout green">
      <p><strong>Verified · entered into record.</strong> Report → editorial review → Case Review Committee → documentation sheet → tracker, within one refresh cycle.</p>
    </div>
  </div>
</section>

<section class="section alt">
  <div class="container split-wide">
    <div>
      <p class="kicker" id="geolocation">Geolocation &amp; precision</p>
      <h2 style="margin-bottom:14px">Pins mark localities, not addresses</h2>
      <p class="text-lead">Map pins mark the reported locality, never an exact address. Coordinates are published at roughly one-kilometre precision. Where only a state is known, the pin says so. Incidents that are online or nationwide carry no pin and appear in the list view only.</p>
    </div>
    <div>
      <p class="kicker" id="subject-safety">Safety of those we document</p>
      <h2 style="margin-bottom:14px">The record must not create new harm</h2>
      <p class="text-lead">Living victims are named only with documented consent. Minors and survivors of sexual violence are never named. Locations are held at locality level. Graphic media is never embedded in the tracker. A record is removed on the request of a victim or their family, and the removal is noted in the record.</p>
    </div>
  </div>
</section>

<section class="section">
  <div class="container split-wide">
    <div>
      <p class="kicker" id="corrections">Corrections</p>
      <h2 style="margin-bottom:14px">Errors are corrected on the record</h2>
      <p class="text-lead">To request a correction, write to <a href="mailto:contact@jem.org.in?subject=Correction%20request">contact@jem.org.in</a> quoting the record reference shown on the entry. Verified corrections are amended in place, and a corrections log is kept.</p>
      <p class="text-lead" style="margin-top:8px">JEM's method follows the spirit of the <a href="https://www.ohchr.org/en/publications/policy-and-methodological-publications/berkeley-protocol-digital-open-source" target="_blank" rel="noopener">Berkeley Protocol on digital open-source investigations</a> and HURIDOCS practice for human-rights documentation.</p>
    </div>
    <div>
      <p class="kicker" id="data-reuse">Data &amp; reuse</p>
      <h2 style="margin-bottom:14px">Open data, CC BY 4.0</h2>
      <p class="text-lead">The tracker dataset is published under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> — reuse it with attribution. The JEM name and logo are reserved.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 20px">
        <a class="btn btn-outline btn-sm" href="tracker/data/incidents.json" target="_blank" rel="noopener">Download the data · JSON</a>
        <a class="btn btn-outline btn-sm" href="tracker/data/incidents.csv" target="_blank" rel="noopener">Download the data · CSV</a>
      </div>
      <p class="kicker" style="margin-top:4px">Suggested citation</p>
      <div class="copy-block">
        <span class="cb-text" data-citation>Justice and Empowerment of Minorities (JEM). Hate Incident Tracker. Jamiat Ulama-i-Hind, New Delhi. https://jem.org.in/tracker/. Accessed <span data-accessed-date>[date]</span>.</span>
      </div>
      <button type="button" class="btn btn-outline btn-sm copy-btn" data-copy-target="citation">Copy citation</button>
    </div>
  </div>
</section>
`;
}

// ------------------------------------------------------------------ Press
export function press() {
  const { total, states, period } = statSnapshot();
  const logos = [
    { file: 'assets/logos/jem-mark.png', label: 'JEM mark (transparent PNG)' },
    { file: 'assets/logos/jem-tile.png', label: 'JEM tile (dark PNG)' },
    { file: 'assets/logos/jamiat-jem-lockup.png', label: 'Jamiat–JEM lockup (PNG)' },
    { file: 'assets/logos/jem-official-primary.jpeg', label: 'Official primary (JPEG)' },
    { file: 'assets/logos/jem-official-horizontal.jpeg', label: 'Official horizontal (JPEG)' },
  ];
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Press &amp; media</p>
    <h1>Reporting on hate crimes? Start from the record.</h1>
    <p class="lead">JEM maintains a live, source-linked record of hate incidents against India's religious minorities — open data a newsroom can filter, cite, embed and verify. This page carries everything needed to use it accurately: figures, citation, embeds, logos and a direct line to the team.</p>
  </div>
</section>

<section class="section">
  <div class="container split-wide">
    <div>
      <p class="kicker">Boilerplate</p>
      <h2 style="margin-bottom:14px">About JEM, in one paragraph</h2>
      <p class="text-lead">Justice and Empowerment of Minorities (JEM) is the human-rights documentation initiative of the Jamiat Ulama-i-Hind, the country's oldest and largest socio-cultural organisation of Indian Muslims. From 1, Bahadur Shah Zafar Marg, New Delhi, JEM documents hate crimes against India's religious minorities, verifies every case through its Case Review Committee, publishes a live, source-linked hate incident tracker alongside Monthly Reports, Quarterly Reviews and an Annual Review, and provides legal assistance to victims. Every entry in the record is dated, categorised and carries its sources.</p>
      <p class="kicker" style="margin-top:26px">What JEM can provide a newsroom</p>
      <ul class="press-list">
        <li>Filtered views of the tracker as citable permalinks — any state, category or date range</li>
        <li>The full dataset as CSV or JSON, under CC BY 4.0 with attribution</li>
        <li>An embeddable live map for articles (code below)</li>
        <li>Background and comment on documented cases, on the record</li>
      </ul>
      <p class="kicker" style="margin-top:26px">Press contact</p>
      <p class="text-lead"><a href="mailto:contact@jem.org.in?subject=Press%20enquiry">contact@jem.org.in</a> — mark the subject "Press enquiry". For urgent verification requests, call the helpline listed in the footer.</p>
      <p class="kicker" style="margin-top:26px">Suggested citation</p>
      <div class="copy-block">
        <span class="cb-text" data-citation>Justice and Empowerment of Minorities (JEM). Hate Incident Tracker. Jamiat Ulama-i-Hind, New Delhi. https://jem.org.in/tracker/. Accessed <span data-accessed-date>[date]</span>.</span>
      </div>
      <button type="button" class="btn btn-outline btn-sm copy-btn" data-copy-target="citation" style="margin-top:10px">Copy citation</button>
    </div>
    <div>
      <p class="kicker">Key statistics</p>
      <div class="stat-grid" data-tracker-stats="tracker/" style="grid-template-columns:1fr 1fr">
        <div class="stat-card">
          <div class="v focus" data-stat="total">${total}</div>
          <div class="l">Documented incidents</div>
        </div>
        <div class="stat-card">
          <div class="v" data-stat="states">${states}</div>
          <div class="l">States reviewed</div>
        </div>
        <div class="stat-card" style="grid-column:1 / -1">
          <div class="v" data-stat="period" style="font-size:22px">${period}</div>
          <div class="l">Reporting period</div>
        </div>
      </div>
      <p class="source-line" style="margin-top:10px">Figures update automatically from the tracker dataset. Source: JEM Hate Incident Tracker (jem.org.in/tracker/).</p>
    </div>
  </div>
</section>

<section class="section alt">
  <div class="container">
    <p class="kicker">Logo pack</p>
    <h2 style="margin-bottom:20px">Marks &amp; lockups</h2>
    <div class="card-grid">
      ${logos.map((l) => `<div class="doc-card">
        <div class="logo-preview">${imgTag(l.file, l.label, 'loading="lazy"')}</div>
        <div class="doc-body">
          <p style="margin-bottom:8px"><strong>${l.label}</strong></p>
          <span class="doc-meta">${l.file.split('.').pop().toUpperCase()}</span>
          <a class="btn btn-outline btn-sm" href="${l.file}" download>Download</a>
        </div>
      </div>`).join('\n      ')}
    </div>
    <p class="source-line" style="margin-top:14px">Use the marks unaltered, on indigo or white. The JEM name and logo are reserved; the data itself is CC BY 4.0 — see <a href="methodology.html#data-reuse">Data &amp; reuse</a>.</p>
  </div>
</section>

<section class="section">
  <div class="container split-wide">
    <div>
      <p class="kicker">Embed the tracker</p>
      <h2 style="margin-bottom:14px">Put the live map in your story</h2>
      <p class="text-lead">The tracker can be embedded as a responsive iframe. It carries its own attribution and updates automatically as records are verified.</p>
    </div>
    <div>
      <div class="copy-block">
        <code data-citation>&lt;iframe src="https://jem.org.in/tracker/index.html?embed=1"
  width="100%" height="640" style="border:0"
  title="JEM hate incident tracker" loading="lazy"&gt;&lt;/iframe&gt;</code>
      </div>
      <button type="button" class="btn btn-outline btn-sm copy-btn" data-copy-target="citation" style="margin-top:10px">Copy embed code</button>
    </div>
  </div>
</section>
`;
}

// -------------------------------------------------------- Accessibility
export function accessibility() {
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Accessibility</p>
    <h1>Accessibility statement</h1>
    <p class="lead">The record is for everyone. This site aims to conform to WCAG 2.2 level AA.</p>
  </div>
</section>
<section class="section">
  <div class="container split-wide">
    <div class="measure">
      <p class="kicker">What we provide</p>
      <p class="text-lead">Pages use semantic landmarks, a skip-to-content link, visible focus outlines, and colour pairs checked for WCAG AA contrast. Text scales with browser settings, motion is reduced when the operating system asks for it, and Urdu content is marked up in its own script and direction.</p>
      <p class="text-lead">The hate incident tracker's map has an equivalent representation: the incident list carries the same records with the same detail, so nothing on the map is available only by sight or pointer. The homepage tracker panel loads only on request.</p>
      <p class="kicker" style="margin-top:26px">Known gaps</p>
      <p class="text-lead">Some older PDF publications are scanned documents without a text layer. The introduction film carries English captions and a written transcript; the two films streamed from the legacy site do not yet. The embedded map itself relies on a third-party mapping library whose controls are partially keyboard-accessible; the incident list remains the reliable route.</p>
    </div>
    <div class="callout">
      <p><strong>Found a barrier?</strong> Write to <a href="mailto:contact@jem.org.in?subject=Accessibility">contact@jem.org.in</a> with the page address and what went wrong. Reports are handled like corrections: reviewed, fixed where possible, and noted.</p>
    </div>
  </div>
</section>
`;
}

// ------------------------------------------------------------------ Story
// "Two months in the record" — the scrollytelling reading of the tracker
// dataset. Every figure below is computed from tracker/data/incidents.json
// at build time and embedded as a literal; nothing is invented. The cited
// incidents are looked up by id so a record that leaves the dataset drops
// out of the page at the next build instead of going stale.
function storyStats() {
  const data = trackerData();
  const inc = data ? data.incidents || [] : [];
  const dated = inc.filter((i) => i.date);
  const dates = dated.map((i) => i.date).sort();
  const byMonth = {};
  const byState = {};
  const byCat = {};
  for (const i of dated) byMonth[i.date.slice(0, 7)] = (byMonth[i.date.slice(0, 7)] || 0) + 1;
  for (const i of inc) {
    if (i.state) byState[i.state] = (byState[i.state] || 0) + 1;
    if (i.category) byCat[i.category] = (byCat[i.category] || 0) + 1;
  }
  // Dated records per calendar week (weeks starting Monday).
  const weekOf = (iso) => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const byWeek = {};
  for (const i of dated) byWeek[weekOf(i.date)] = (byWeek[weekOf(i.date)] || 0) + 1;
  const byDay = {};
  for (const i of dated) byDay[i.date] = (byDay[i.date] || 0) + 1;
  const busiest = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0] || null;
  const catCount = (name) => inc.filter((i) => String(i.category || '').toLowerCase() === name);
  const rs = catCount('attacks on religious spaces');
  const pa = catCount('police atrocity');
  const ssd = catCount('state-sponsored discriminatory practice');
  return {
    incidents: inc,
    total: inc.length,
    dated: dated.length,
    undated: inc.length - dated.length,
    first: dates[0] || null,
    last: dates[dates.length - 1] || null,
    byMonth, byWeek, busiest,
    topStates: Object.entries(byState).filter(([s]) => s !== 'Online').sort((a, b) => b[1] - a[1]),
    online: byState['Online'] || 0,
    statesCount: Object.keys(byState).filter((s) => s !== 'Online').length,
    byCat: Object.entries(byCat).sort((a, b) => b[1] - a[1]),
    rs, pa, ssd,
    rsUP: rs.filter((i) => i.state === 'Uttar Pradesh').length,
    rsPeak: rs.filter((i) => i.date && i.date >= '2026-06-09').length,
    paStates: new Set(pa.map((i) => i.state).filter(Boolean)).size,
    up: inc.filter((i) => i.state === 'Uttar Pradesh'),
    fir: inc.filter((i) => /\bFIR\b/i.test(String(i.legal_status || ''))).length,
    noConfirmed: inc.filter((i) => /no confirmed/i.test(String(i.legal_status || ''))).length,
    multiSource: inc.filter((i) => (i.sources || []).filter((s) => s.url).length >= 2).length,
    geolocated: inc.filter((i) => i.lat != null && i.lon != null).length,
    generated: data && data.generated ? String(data.generated).slice(0, 10) : null,
  };
}

// One cited record inside a step. The date, place and category come from
// the dataset; the one-sentence summary is written for this page (subject
// safety: no names of victims or private individuals, no graphic detail —
// the tracker entry carries the full record and its sources).
function storyCite(incidents, id, summary) {
  const i = incidents.find((r) => r.id === id);
  if (!i) return '';
  const color = CATEGORY_COLORS[String(i.category || 'other').toLowerCase()] || CATEGORY_COLORS.other;
  const place = String(i.place || '').split('\n')[0];
  return `<a class="step-record" style="--rec:${color}" href="tracker/index.html#sel=${encodeURIComponent(i.id)}">
            <span class="sr-meta"><b>${esc(i.date || 'Date not recorded')}</b> · ${esc(place)}${i.state && !place.toLowerCase().includes(String(i.state).toLowerCase()) ? ` · ${esc(i.state)}` : ''} · ${esc(i.category)}</span>
            <span class="sr-sum">${esc(summary)}</span>
            <span class="sr-link">Read the full record on the tracker →</span>
          </a>`;
}

export function story() {
  const s = storyStats();
  const inc = s.incidents;
  const pct = (n) => Math.round((n / s.total) * 100);
  const view = (v) => esc(JSON.stringify(v));
  const may = s.byMonth['2026-05'] || 0;
  const jun = s.byMonth['2026-06'] || 0;
  const catRow = ([name, n]) =>
    `<li><span>${esc(name)}</span><span class="bar"><i style="--w:${Math.round((n / Math.max(1, s.byCat[0][1])) * 100)}%; background:${CATEGORY_COLORS[name.toLowerCase()] || CATEGORY_COLORS.other}"></i></span><span class="n">${n}</span></li>`;
  const weeks = Object.entries(s.byWeek).sort();
  const weekMax = Math.max(1, ...weeks.map(([, n]) => n));
  const weekRow = ([wk, n]) =>
    `<li><span>Week of ${esc(wk)}</span><span class="bar"><i style="--w:${Math.round((n / weekMax) * 100)}%"></i></span><span class="n">${n}</span></li>`;
  const stateRow = ([st, n]) =>
    `<li><span>${esc(st)}</span><span class="bar"><i style="--w:${Math.round((n / Math.max(1, s.topStates[0][1])) * 100)}%"></i></span><span class="n">${n}</span></li>`;
  const legend = Object.entries(CATEGORY_COLORS)
    .filter(([k]) => s.byCat.some(([c]) => c.toLowerCase() === k))
    .map(([k, c]) => `<span><i style="--dot:${c}"></i>${esc(k.charAt(0).toUpperCase() + k.slice(1))}</span>`).join('\n      ');

  return `
<link rel="stylesheet" href="assets/css/story.css">
<link rel="stylesheet" href="tracker/assets/vendor/maplibre-gl.css">

<section class="story-hero">
  <div class="container">
    <p class="kicker on-dark">From the record</p>
    <h1>Two months in the record: May–June 2026</h1>
    <p class="lead">Between ${s.first} and ${s.last}, JEM entered ${s.total} incidents into the hate incident tracker. This page reads that record — where documentation concentrated, what kinds of incidents it holds, and what is known about the legal response. Every figure is computed from the published dataset.</p>
    <div class="tricolour-rule"></div>
    <p class="story-meta">${s.total} records · ${s.first} – ${s.last} · Source: JEM Hate Incident Tracker${s.generated ? ` · dataset of ${s.generated}` : ''}</p>
  </div>
</section>

<div class="scrolly">
  <div class="scrolly-map" aria-hidden="true" data-story-map data-incidents="tracker/data/incidents.json">
    <div id="story-map"></div>
    <div class="map-fallback" data-map-fallback>
      <div>
        <img src="assets/logos/jem-mark.png" alt="" width="56" height="56">
        <h2>The map accompanies the text</h2>
        <div class="tricolour-rule"></div>
        <p>When this page is served over the web, a live map of the ${s.geolocated} geolocated records moves alongside each section. Every figure and every cited record is in the text itself — nothing here is available only by map.</p>
      </div>
    </div>
    <div class="map-legend">
      ${legend}
    </div>
  </div>

  <div class="scrolly-steps">

    <article class="story-step is-active" data-view="${view({ center: [80, 23.2], zoom: 3.9 })}">
      <div class="step-card">
        <p class="kicker">01 · The record</p>
        <h2>${s.total} incidents, entered and sourced</h2>
        <p>The JEM hate incident tracker is a register of documented hate incidents against religious minorities in India. Each entry carries a date, a place, a category, the legal status as reported, and its sources. Over May and June 2026 the register took in <strong>${s.total} records</strong> across <strong>${s.statesCount} states and union territories</strong>, with ${s.online} recorded as online incidents.</p>
        <p>One caution before any figure: this is a record, not a census. It contains what could be documented and verified — an undercount by construction. Where a detail could not be corroborated, the entry says so.</p>
        <p class="step-source">Source: JEM Hate Incident Tracker dataset (CC BY 4.0), ${s.total} records, ${s.first} – ${s.last}.</p>
      </div>
    </article>

    <article class="story-step" data-view="${view({ center: [80, 23.2], zoom: 3.9 })}">
      <div class="step-card">
        <p class="kicker">02 · The shape of the period</p>
        <h2>Documentation arrived in two waves</h2>
        <p>Of the ${s.total} records, ${s.dated} carry a full incident date: <strong>${may} in May</strong> and <strong>${jun} in the first half of June</strong>; ${s.undated} are held with the period but without a confirmed day. By calendar week, the dated records fall as follows:</p>
        <ul class="bar-list" aria-label="Dated records per calendar week">
          ${weeks.map(weekRow).join('\n          ')}
        </ul>
        <p>The heaviest single day in the record is <strong>${s.busiest ? s.busiest[0] : '—'}</strong>, with ${s.busiest ? s.busiest[1] : '—'} incidents entered. Documentation concentrated where JEM's reporting network is densest:</p>
        <ul class="bar-list" aria-label="Records by state, top six">
          ${s.topStates.slice(0, 6).map(stateRow).join('\n          ')}
        </ul>
      </div>
    </article>

    <article class="story-step" data-view="${view({ center: [79.6, 26.8], zoom: 5.4, cats: ['attacks on religious spaces'], highlight: ['r291eef94', 're8e7f856'] })}">
      <div class="step-card">
        <p class="kicker">03 · Religious spaces</p>
        <h2>${s.rs.length} attacks on religious spaces — many by official order</h2>
        <p>The record holds <strong>${s.rs.length} attacks on religious spaces</strong> in these two months, ${s.rsUP} of them in Uttar Pradesh. A distinct pattern runs through the June entries: demolition and sealing drives against mosques and madrasas, carried out by local administrations citing land, regulatory or road-widening grounds. <strong>${s.rsPeak} of the dated entries in this category fall between 2026-06-09 and ${s.last}</strong>.</p>
        ${storyCite(inc, 'r291eef94', 'A mosque reported to be nearly 200 years old was demolished in a late-night operation under heavy security; authorities stated the structure stood on railway land.')}
        ${storyCite(inc, 're8e7f856', 'A development authority team, with police deployment, used bulldozers in a demolition drive against a madrasa near the National Highway.')}
      </div>
    </article>

    <article class="story-step" data-view="${view({ center: [80.9, 27.4], zoom: 6, states: ['Uttar Pradesh'], highlight: ['re57311c5', 'ra133a826'] })}">
      <div class="step-card">
        <p class="kicker">04 · The largest concentration</p>
        <h2>Uttar Pradesh: ${s.up.length} records, ${pct(s.up.length)}% of the register</h2>
        <p>No state appears in the record as often as Uttar Pradesh — <strong>${s.up.length} of the ${s.total} incidents</strong>, more than the next three states combined. The entries span every category in the register: acts of hate (${s.up.filter((i) => String(i.category).toLowerCase() === 'act of hate').length}), acts of violence (${s.up.filter((i) => String(i.category).toLowerCase() === 'act of violence').length}), attacks on religious spaces (${s.rsUP}), and cases of discrimination and exclusion (${s.up.filter((i) => String(i.category).toLowerCase() === 'discrimination, exclusion & prejudice').length}).</p>
        ${storyCite(inc, 're57311c5', 'A group reportedly entered a Muslim family’s house during a procession day, vandalised the property and vehicles and assaulted family members; no FIR or police action is confirmed in the record.')}
        ${storyCite(inc, 'ra133a826', 'An elderly resident returning home from a walk was reportedly stopped, abused on account of his faith and beaten; an FIR was reportedly registered.')}
      </div>
    </article>

    <article class="story-step" data-view="${view({ center: [77.5, 25.5], zoom: 4.6, cats: ['police atrocity'], highlight: ['rc166ff76', 'rf4766cfe'] })}">
      <div class="step-card">
        <p class="kicker">05 · Police atrocity</p>
        <h2>${s.pa.length} records where the police are the reported actor</h2>
        <p>In <strong>${s.pa.length} entries across ${s.paStates} states</strong>, the reported harm came from the police themselves — custodial assault, or arrest and action directed at members of a minority where no offence by them is clearly on record. These cases sit apart in the register because the institution a victim would ordinarily turn to is the one named in the report.</p>
        ${storyCite(inc, 'rc166ff76', 'A Muslim man taken into custody on allegations related to cow slaughter was reportedly assaulted by police personnel, with footage of the incident circulating.')}
        ${storyCite(inc, 'rf4766cfe', 'A food blogger was arrested after objections to a promotional video whose opening frames showed a city landmark; police cited complaints of hurting religious sentiments, with the exact legal provisions unspecified.')}
      </div>
    </article>

    <article class="story-step" data-view="${view({ center: [79.5, 21.8], zoom: 4.4, cats: ['state-sponsored discriminatory practice'], highlight: ['rf9891d21', 'r1d7f1459'] })}">
      <div class="step-card">
        <p class="kicker">06 · State action</p>
        <h2>${s.ssd.length} records of state-sponsored discriminatory practice</h2>
        <p>A further <strong>${s.ssd.length} entries</strong> record administrative action reported to single out a minority community — demolition and eviction notices, cancelled permissions, restrictions on worship. Several cluster in the days before Eid al-Adha in early June. Together with the demolitions filed under attacks on religious spaces, they form the register's clearest through-line: harm arriving on official letterhead.</p>
        ${storyCite(inc, 'rf9891d21', 'Residents of a Kolkata neighbourhood received civic notices declaring their buildings unauthorised and giving 48 hours to vacate, days before Eid al-Adha.')}
        ${storyCite(inc, 'r1d7f1459', 'A municipal corporation conducted an early-morning anti-encroachment drive with significant police deployment, reportedly targeting structures linked to an elected minority representative.')}
      </div>
    </article>

    <article class="story-step" data-view="${view({ center: [80, 23.2], zoom: 3.9 })}">
      <div class="step-card">
        <p class="kicker">07 · The accountability picture</p>
        <h2>What the record says about legal response</h2>
        <div class="step-figs">
          <div class="fig"><div class="v">${s.fir}</div><div class="l">records mention an FIR</div></div>
          <div class="fig"><div class="v plain">${s.noConfirmed}</div><div class="l">no confirmed official action</div></div>
          <div class="fig"><div class="v plain">${s.multiSource}</div><div class="l">carry 2+ source links</div></div>
        </div>
        <p>Only <strong>${s.fir} of the ${s.total} records</strong> mention a First Information Report in their reported legal status, and in <strong>${s.noConfirmed} records</strong> the legal-status field notes that no confirmed official action — no statement, arrest or proceeding — had been reported at the time of entry. The field records what is reported, not an adjudication.</p>
        <p>On sourcing: <strong>${s.multiSource} records</strong> carry two or more source links, and ${s.geolocated} of the ${s.total} are geolocated to locality precision — pins mark localities, never addresses.</p>
        <p class="step-source">Computed from the legal_status and sources fields of the dataset. Accused persons are presumed innocent unless convicted by a court.</p>
      </div>
    </article>

  </div>
</div>

<section class="story-close">
  <div class="container">
    <p class="kicker on-dark">08 · What the record is for</p>
    <h2>A record exists to be cited</h2>
    <p>These ${s.total} entries are published to be used: cited in reporting and research, reused under CC BY 4.0 with attribution, and corrected on the record when an error is found. The tracker carries every entry behind this page — with its sources, its legal status and its reference.</p>
    <div class="actions">
      <a class="btn btn-accent" href="tracker/index.html">Open the tracker</a>
      <a class="btn btn-outline" href="methodology.html">How this record is made</a>
      <a class="btn btn-outline" href="report-a-hate-crime.html">Report a hate crime</a>
    </div>
    <p class="step-source" style="margin-top:26px">Suggested citation: Justice and Empowerment of Minorities (JEM). Hate Incident Tracker. Jamiat Ulama-i-Hind, New Delhi. https://jem.org.in/tracker/.</p>
  </div>
</section>

<script src="tracker/assets/vendor/maplibre-gl.js" defer></script>
<script src="assets/js/story.js" defer></script>
`;
}

// ------------------------------------------------------------------ 404
export function notFound() {
  return `
<section class="page-hero">
  <div class="container">
    <p class="kicker on-dark">Not found</p>
    <h1>This page is not in the record</h1>
    <p class="lead">The address may have changed, or the page may have been removed. Everything JEM publishes remains reachable from here.</p>
  </div>
</section>
${helplineStrip()}
<section class="section">
  <div class="container">
    <div class="card-grid">
      <div class="doc-card"><div class="doc-body" style="padding-top:22px">
        <span class="badge">Tracker</span>
        <p style="margin-top:10px">The live, source-linked map of documented hate incidents.</p>
        <a class="btn btn-outline btn-sm" href="tracker/index.html">Open the tracker →</a>
      </div></div>
      <div class="doc-card"><div class="doc-body" style="padding-top:22px">
        <span class="badge saffron">Report</span>
        <p style="margin-top:10px">Report a hate crime by phone, WhatsApp or a written report.</p>
        <a class="btn btn-outline btn-sm" href="report-a-hate-crime.html">Report a hate crime →</a>
      </div></div>
      <div class="doc-card"><div class="doc-body" style="padding-top:22px">
        <span class="badge green">Publications</span>
        <p style="margin-top:10px">Annual and quarterly reviews, newsletters and reports.</p>
        <a class="btn btn-outline btn-sm" href="publications.html">Browse publications →</a>
      </div></div>
    </div>
  </div>
</section>
`;
}
