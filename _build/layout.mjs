// Shared page shell (head, header/nav, footer) for the static jem.org.in
// rebuild. Run `node _build/build.mjs` after editing this file or
// _build/pages.mjs — it emits flat, dependency-free HTML into Website/,
// so the shipped site still needs no server and no build step to run.

export const SITE_URL = 'https://jem.org.in/';
const SITE_NAME = 'Justice and Empowerment of Minorities';
const OG_IMAGE = 'assets/og/og-default.png';
const OG_ALT = 'JEM — Justice and Empowerment of Minorities. Documenting hate crimes against religious minorities in India.';

const NAV = [
  { id: 'home', label: 'Home', href: 'index.html' },
  {
    id: 'about', label: 'About us', href: 'about.html',
    dropdown: [
      { id: 'about', label: 'About JEM', href: 'about.html' },
      { id: 'methodology', label: 'Methodology & data', href: 'methodology.html' },
      { id: 'press', label: 'Press & media', href: 'press.html' },
    ],
  },
  { id: 'our-work', label: 'Our work', href: 'our-work.html' },
  { id: 'publications', label: 'Publications', href: 'publications.html' },
  { id: 'reports', label: 'Reports', href: 'reports.html' },
  { id: 'tracker', label: 'Hate incident tracker', href: 'tracker/index.html', cls: 'tracker-link' },
  { id: 'report', label: 'Report a hate crime', href: 'report-a-hate-crime.html' },
  {
    id: 'gallery', label: 'Gallery', href: 'gallery.html',
    dropdown: [
      { id: 'gallery', label: 'Photo gallery', href: 'gallery.html' },
      { id: 'video', label: 'Video gallery', href: 'video.html' },
    ],
  },
  { id: 'contact', label: 'Contact', href: 'contact.html' },
];

function navHtml(active) {
  return NAV.map((item, idx) => {
    const cls = item.cls ? ` class="${item.cls}"` : '';
    if (item.dropdown) {
      // The parent link reads as current when it, or any child, is the
      // active page; the exact child also gets aria-current.
      const parentCurrent = item.id === active || item.dropdown.some((d) => d.id === active) ? ' aria-current="page"' : '';
      const ddId = `nav-dd-${idx}`;
      return `<div class="has-dropdown">
        <a href="${item.href}"${parentCurrent}${cls}>${item.label}</a><button type="button" class="drop-toggle" aria-haspopup="true" aria-expanded="false" aria-controls="${ddId}" aria-label="${item.label} submenu"></button>
        <div class="dropdown" id="${ddId}">
          ${item.dropdown.map((d) => `<a href="${d.href}"${d.id === active ? ' aria-current="page"' : ''}>${d.label}</a>`).join('\n          ')}
        </div>
      </div>`;
    }
    const current = item.id === active ? ' aria-current="page"' : '';
    return `<a href="${item.href}"${current}${cls}>${item.label}</a>`;
  }).join('\n      ');
}

// ---------------------------------------------------------------- JSON-LD
// The organisation record travels on every page; the dataset record only on
// the pages that describe the tracker data (home, methodology).
const ORG_LD = {
  '@context': 'https://schema.org',
  '@type': 'NGO',
  name: 'Justice and Empowerment of Minorities',
  alternateName: 'JEM',
  url: SITE_URL,
  logo: SITE_URL + 'assets/logos/jem-mark.png',
  parentOrganization: { '@type': 'Organization', name: 'Jamiat Ulama-i-Hind' },
  address: {
    '@type': 'PostalAddress',
    streetAddress: '1, Bahadur Shah Zafar Marg',
    addressLocality: 'New Delhi',
    addressCountry: 'IN',
  },
  contactPoint: {
    '@type': 'ContactPoint',
    telephone: '+91-98689-52786',
    contactType: 'victim support hotline',
    availableLanguage: ['en', 'hi', 'ur'],
  },
  email: 'contact@jem.org.in',
  sameAs: [
    'https://twitter.com/JEM_Jamiat',
    'https://www.facebook.com/profile.php?id=100089126280847',
    'https://www.linkedin.com/in/jem-jamiat-a7339125b',
  ],
};

const DATASET_LD = {
  '@context': 'https://schema.org',
  '@type': 'Dataset',
  name: 'JEM Hate Incident Tracker dataset',
  description: 'Documented hate incidents against religious minorities in India — dated, geolocated to locality precision, categorised and source-linked. Maintained by Justice and Empowerment of Minorities (JEM), an initiative of the Jamiat Ulama-i-Hind.',
  url: SITE_URL + 'tracker/index.html',
  creator: { '@type': 'NGO', name: 'Justice and Empowerment of Minorities', url: SITE_URL },
  temporalCoverage: '2026-05-01/..',
  spatialCoverage: { '@type': 'Place', name: 'India' },
  license: 'https://creativecommons.org/licenses/by/4.0/',
  isAccessibleForFree: true,
  distribution: [
    {
      '@type': 'DataDownload',
      encodingFormat: 'application/json',
      contentUrl: SITE_URL + 'tracker/data/incidents.json',
    },
  ],
};

function breadcrumbLd(file, title) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: title, item: SITE_URL + file },
    ],
  };
}

const ldScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

export function layout({ file = '', title, titleFull, description, active, body, bodyClass = '', dataset = false }) {
  const isHome = file === 'index.html';
  const canonical = isHome ? SITE_URL : SITE_URL + file;
  const pageTitle = titleFull || `${title} · ${SITE_NAME}`;
  const ld = [ldScript(ORG_LD)];
  if (dataset) ld.push(ldScript(DATASET_LD));
  if (!isHome && file) ld.push(ldScript(breadcrumbLd(file, title)));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#2A2360">
<link rel="icon" href="assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="assets/favicon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<meta property="og:site_name" content="${SITE_NAME} (JEM)">
<meta property="og:type" content="website">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE_URL}${OG_IMAGE}">
<meta property="og:image:alt" content="${OG_ALT}">
<meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/atom+xml" title="JEM publications" href="feed.xml">
<link rel="stylesheet" href="assets/css/styles.css">
${ld.join('\n')}
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header">
  <div class="container">
    <a href="index.html" class="brand">
      <img src="assets/logos/jem-mark.png" alt="JEM" width="46" height="46">
      <span class="brand-word">Justice and Empowerment<br>of Minorities<small>A Jamiat Ulama-i-Hind initiative</small></span>
    </a>
    <nav class="nav" id="site-nav" aria-label="Primary">
      ${navHtml(active)}
    </nav>
    <div class="header-cta">
      <a class="helpline" href="report-a-hate-crime.html">
        <span class="l">JEM helpline</span>
        <span class="v">+91-98689 52786</span>
      </a>
      <a class="helpline-mini" href="tel:+919868952786">Call</a>
      <button class="nav-toggle" aria-label="Toggle menu" aria-controls="site-nav" aria-expanded="false"><span></span></button>
    </div>
  </div>
</header>

<main id="main">
${body}
</main>

<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <div class="foot-brand">
          <img src="assets/logos/jem-mark.png" alt="" width="34" height="34">
          <span>JEM</span>
        </div>
        <p>Justice and Empowerment of Minorities is an initiative of the Jamiat Ulama-i-Hind, documenting and countering hate crimes against India's religious minorities.</p>
        <div class="tricolour-rule thin" style="margin-top:18px"></div>
      </div>
      <div>
        <p class="foot-head">Explore</p>
        <ul>
          <li><a href="about.html">About us</a></li>
          <li><a href="our-work.html">Our work</a></li>
          <li><a href="methodology.html">Methodology &amp; data</a></li>
          <li><a href="publications.html">Publications</a></li>
          <li><a href="reports.html">Reports</a></li>
          <li><a href="tracker/index.html">Hate incident tracker</a></li>
          <li><a href="press.html">Press &amp; media</a></li>
        </ul>
      </div>
      <div>
        <p class="foot-head">Get involved</p>
        <ul>
          <li><a href="report-a-hate-crime.html">Report a hate crime</a></li>
          <li><a href="volunteer.html">Volunteer with JEM</a></li>
          <li><a href="gallery.html">Photo gallery</a></li>
          <li><a href="video.html">Video gallery</a></li>
          <li><a href="contact.html">Contact</a></li>
        </ul>
      </div>
      <div>
        <p class="foot-head">Contact</p>
        <p>1, Bahadur Shah Zafar Marg,<br>New Delhi</p>
        <p><a href="mailto:contact@jem.org.in">contact@jem.org.in</a></p>
        <div class="footer-social" style="margin-top:14px">
          <a href="https://twitter.com/JEM_Jamiat" aria-label="Twitter / X" target="_blank" rel="noopener">X</a>
          <a href="https://www.facebook.com/profile.php?id=100089126280847" aria-label="Facebook" target="_blank" rel="noopener">FB</a>
          <a href="https://www.linkedin.com/in/jem-jamiat-a7339125b" aria-label="LinkedIn" target="_blank" rel="noopener">in</a>
        </div>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${new Date().getFullYear()} JEM, Justice and Empowerment of Minorities. All rights reserved. · <a href="accessibility.html">Accessibility</a></span>
      <span>An initiative of the Jamiat Ulama-i-Hind · Documented, verified and maintained independently by JEM.</span>
    </div>
  </div>
</footer>

<script src="assets/js/site.js"></script>
</body>
</html>
`;

  // Hosts serve 404.html content at whatever path was requested, so its
  // relative URLs would resolve into the missing directory — make every
  // local href/src root-absolute on that one page. Fragment links, mailto:,
  // tel: and absolute URLs pass through untouched.
  if (file === '404.html') {
    return html.replace(/(href|src)="(?!https?:|mailto:|tel:|#|\/)/g, '$1="/');
  }
  return html;
}
