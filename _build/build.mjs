// Generates the flat, dependency-free HTML pages for jem.org.in from
// layout.mjs + pages.mjs. Run with `node _build/build.mjs` after editing
// either file. The output needs no server and no build step to run —
// this script only exists to keep the shared header/footer DRY while
// authoring; it is not part of the shipped site.
//
// Besides the pages it also emits: assets/css/styles.css (the flattened
// stylesheet every page links), sitemap.xml, robots.txt, feed.xml (Atom),
// site.webmanifest and 404.html — and finishes with a scan of every
// generated page for src/href references that point at missing local
// files, so a broken asset can never ship silently.
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { layout, SITE_URL } from './layout.mjs';
import * as pages from './pages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------ Pages
const SITE = [
  {
    file: 'index.html', active: 'home', title: 'Home',
    titleFull: 'Justice and Empowerment of Minorities (JEM) — documenting hate crimes against religious minorities in India',
    description: 'JEM documents hate crimes against religious minorities in India — a live, source-linked incident tracker, verified reports and a helpline for victims.',
    dataset: true, body: pages.home(),
  },
  {
    file: 'about.html', active: 'about', title: 'About us',
    description: "JEM's mission and background — a Jamiat Ulama-i-Hind initiative documenting hate crimes and providing legal assistance to victims across India.",
    body: pages.about(),
  },
  {
    file: 'our-work.html', active: 'our-work', title: 'Our work',
    description: "JEM's vision, mission, goal and eight core objectives — documentation, legal assistance, advocacy and community dialogue against hate crimes in India.",
    body: pages.ourWork(),
  },
  {
    file: 'publications.html', active: 'publications', title: 'Publications',
    description: 'Annual reviews, quarterly reviews and monthly newsletters from JEM in English and Urdu — downloadable as PDF, every figure sourced and dated.',
    body: pages.publications(),
  },
  {
    file: 'reports.html', active: 'reports', title: 'Reports',
    description: 'JEM reports on hate crime incidents, hate speech patterns and judicial outcomes in India — sourced, dated and built to be cited.',
    body: pages.reports(),
  },
  {
    file: 'story.html', active: 'reports', title: 'Two months in the record',
    titleFull: 'Two months in the record: May–June 2026 · Justice and Empowerment of Minorities',
    description: 'A guided reading of the JEM hate incident tracker, May–June 2026 — where documentation concentrated, what the record holds, and what is known about the legal response. Every figure computed from the published dataset.',
    dataset: true, bodyClass: 'story-dark', body: pages.story(),
  },
  {
    file: 'report-a-hate-crime.html', active: 'report', title: 'Report a hate crime',
    description: 'Report a hate crime to JEM by phone, WhatsApp or a structured written report. Helplines in English, Hindi and Urdu; every report is reviewed.',
    bodyClass: 'has-actionbar', body: pages.reportHateCrime(),
  },
  {
    file: 'gallery.html', active: 'gallery', title: 'Photo gallery',
    description: 'Photographs from JEM workshops, training and community outreach — capacity building against Islamophobia and hate crimes across India.',
    body: pages.gallery(),
  },
  {
    file: 'video.html', active: 'video', title: 'Video gallery',
    description: "Films from JEM — the introduction film, the overview film and the helpline film, documenting JEM's work against hate crimes in India.",
    body: pages.video(),
  },
  {
    file: 'contact.html', active: 'contact', title: 'Contact',
    description: 'Contact JEM — office at 1, Bahadur Shah Zafar Marg, New Delhi; email contact@jem.org.in; helpline numbers and social channels.',
    body: pages.contact(),
  },
  {
    file: 'volunteer.html', active: 'contact', title: 'Volunteer',
    description: 'Volunteer with JEM to document hate crimes in your city — citizens, lawyers, doctors, journalists and activists are welcome across India.',
    body: pages.volunteer(),
  },
  {
    file: 'methodology.html', active: 'methodology', title: 'Methodology & data — how we document',
    description: 'How JEM documents hate crimes — what is recorded, sourcing and verification, location precision, subject safety, corrections and open data reuse.',
    dataset: true, body: pages.methodology(),
  },
  {
    file: 'press.html', active: 'press', title: 'Press & media',
    description: 'Press resources from JEM — boilerplate, press contact, logo pack, suggested citation, key statistics and how to embed the hate incident tracker.',
    body: pages.press(),
  },
  {
    file: 'accessibility.html', active: 'accessibility', title: 'Accessibility statement',
    description: "JEM's accessibility statement — WCAG 2.2 AA target, the incident list as the map's equivalent view, known gaps and how to report barriers.",
    body: pages.accessibility(),
  },
  {
    file: '404.html', active: '', title: 'Page not found',
    description: 'The page you were looking for is not in the record. Find the tracker, reports, publications and the JEM helpline from here.',
    body: pages.notFound(), skipSitemap: true,
  },
];

// ------------------------------------------------- Flattened stylesheet
// One file, one request; the source token files stay authoritative for
// authoring. Order matters: fonts → tokens → base → site chrome.
const CSS_ORDER = ['fonts.css', 'tokens-colors.css', 'tokens-typography.css', 'tokens-spacing.css', 'tokens-base.css', 'site.css'];
const flattened = ['/* Generated by _build/build.mjs — do not hand-edit. Edit the source files\n   (' + CSS_ORDER.join(', ') + ') and rebuild. */']
  .concat(CSS_ORDER.map((f) => readFileSync(join(ROOT, 'assets', 'css', f), 'utf8')))
  .join('\n\n');
writeFileSync(join(ROOT, 'assets', 'css', 'styles.css'), flattened);
console.log('wrote assets/css/styles.css');

// --------------------------------------------------------------- Pages
for (const p of SITE) {
  const html = layout({
    file: p.file, title: p.title, titleFull: p.titleFull, description: p.description,
    active: p.active, body: p.body, bodyClass: p.bodyClass || '', dataset: p.dataset || false,
  });
  writeFileSync(join(ROOT, p.file), html);
  console.log('wrote', p.file);
}

// ------------------------------------------------------------- Sitemap
const sitemapUrls = SITE.filter((p) => !p.skipSitemap)
  .map((p) => (p.file === 'index.html' ? SITE_URL : SITE_URL + p.file))
  .concat([SITE_URL + 'tracker/index.html']);
writeFileSync(join(ROOT, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  sitemapUrls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n') +
  '\n</urlset>\n');
console.log('wrote sitemap.xml');

writeFileSync(join(ROOT, 'robots.txt'),
  'User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + 'sitemap.xml\n');
console.log('wrote robots.txt');

// ------------------------------------------------------------ Atom feed
// Reports + annual and quarterly reviews. Dates are period-end markers
// (the documents cover a period; exact publication days are not on record).
const quarterEnd = { 'January – March': '-03-31', 'April – June': '-06-30', 'July – September': '-09-30', 'October – December': '-12-31' };
const feedEntries = [
  ...pages.reportItems.map((r) => ({
    title: r.title, href: `assets/downloads/${r.file}`, date: r.date, summary: r.desc,
  })),
  { title: 'Annual Review, 2023', href: 'assets/downloads/Annual-Review-2023.pdf', date: '2023-12-31', summary: "JEM's annual documentation of hate crimes against minorities in India." },
  { title: 'Annual Review, 2022', href: 'assets/downloads/Annual-Review-2022.pdf', date: '2022-12-31', summary: "JEM's annual documentation of hate crimes against minorities in India." },
  ...pages.quarterlyReviews.map((q) => {
    const [span] = q.title.split(', ');
    return {
      // Prefer the mirrored local copy (same rule the publications page
      // applies) — the old-site URL is only a fallback.
      title: `Quarterly Review, ${q.title}`,
      href: existsSync(join(ROOT, 'assets/downloads', q.file))
        ? `assets/downloads/${q.file}` : `https://jem.org.in/${q.file}`,
      date: q.year + (quarterEnd[span] || '-12-31'),
      summary: `JEM's quarterly documentation of hate crimes against minorities, ${q.title}.`,
    };
  }),
].sort((a, b) => (a.date < b.date ? 1 : -1));

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const absHref = (h) => (h.startsWith('http') ? h : SITE_URL + h);
writeFileSync(join(ROOT, 'feed.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<feed xmlns="http://www.w3.org/2005/Atom">\n' +
  `  <title>JEM — reports &amp; publications</title>\n` +
  `  <id>${SITE_URL}feed.xml</id>\n` +
  `  <link href="${SITE_URL}feed.xml" rel="self"/>\n` +
  `  <link href="${SITE_URL}publications.html"/>\n` +
  `  <updated>${today}T00:00:00Z</updated>\n` +
  `  <author><name>Justice and Empowerment of Minorities (JEM)</name></author>\n` +
  feedEntries.map((e) => '  <entry>\n' +
    `    <title>${escXml(e.title)}</title>\n` +
    `    <id>${escXml(absHref(e.href))}</id>\n` +
    `    <link href="${escXml(absHref(e.href))}"/>\n` +
    `    <updated>${e.date}T00:00:00Z</updated>\n` +
    `    <summary>${escXml(e.summary)}</summary>\n` +
    '  </entry>').join('\n') +
  '\n</feed>\n');
console.log('wrote feed.xml');

// -------------------------------------------------------- Web manifest
writeFileSync(join(ROOT, 'site.webmanifest'), JSON.stringify({
  name: 'Justice and Empowerment of Minorities (JEM)',
  short_name: 'JEM',
  icons: [
    { src: 'assets/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'assets/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
  theme_color: '#2A2360',
  background_color: '#F7F6FA',
  display: 'browser',
  start_url: 'index.html',
}, null, 2) + '\n');
console.log('wrote site.webmanifest');

// ------------------------------------------------- Missing-asset scan
// Every generated page is scanned for local src/href/url() references;
// anything that does not exist on disk is reported. The build fails
// (exit 1) if a missing reference is found, so it cannot ship unnoticed.
const REF_RE = /(?:src|href)="([^"]+)"|url\('([^']+)'\)/g;
const missing = [];
let refCount = 0;
for (const p of SITE) {
  const html = readFileSync(join(ROOT, p.file), 'utf8');
  for (const m of html.matchAll(REF_RE)) {
    const raw = m[1] || m[2];
    if (!raw || /^(https?:|mailto:|tel:|#|data:)/.test(raw)) continue;
    const local = raw.split('#')[0].split('?')[0];
    if (!local) continue;
    refCount++;
    if (!existsSync(join(ROOT, local))) missing.push(`${p.file} → ${raw}`);
  }
}
// References into tracker/ are owned by the tracker workstream (it is
// synced in wholesale); report them as warnings rather than failures.
const uniqueMissing = [...new Set(missing)];
const hard = uniqueMissing.filter((m) => !m.includes('→ tracker/'));
const trackerOwned = uniqueMissing.filter((m) => m.includes('→ tracker/'));
console.log(`\nasset scan: ${refCount} local references checked across ${SITE.length} pages`);
if (trackerOwned.length) {
  console.warn(`tracker-owned, not yet present (${trackerOwned.length}) — expected from the tracker workstream:`);
  for (const miss of trackerOwned) console.warn('  ' + miss);
}
if (hard.length) {
  console.error(`MISSING (${hard.length}):`);
  for (const miss of hard) console.error('  ' + miss);
  process.exitCode = 1;
} else {
  console.log('asset scan: no missing local references (outside tracker/)');
}
