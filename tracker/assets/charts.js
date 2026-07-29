/* ============================================================
   JEM Incident Tracker — charts
   Hand-rolled SVG: the Trends view (hero figure, incidents over
   time, category / state / community breakdowns) and the map's
   timeline brush. No chart library — deterministic, file://-safe.

   Mark rules (from the JEM data-viz standard): thin marks with a
   4px rounded data-end and a square baseline, hairline solid
   gridlines, direct labels on every bar plus per-mark tooltips,
   text in ink tokens never in series colour.
   ============================================================ */

window.JEMCharts = (() => {
'use strict';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const DAY = 86400000;
const utc = (iso) => new Date(iso + 'T00:00:00Z').getTime();
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/* ------------------------------------------------------------------
   Tooltip singleton (#chart-tip) — follows the pointer, also shown
   on keyboard focus of a mark's hit target.
   ------------------------------------------------------------------ */

const tip = () => document.getElementById('chart-tip');

function showTip(html, x, y) {
  const el = tip();
  if (!el) return;
  el.innerHTML = html;
  el.hidden = false;
  const r = el.getBoundingClientRect();
  const px = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
  const py = Math.min(Math.max(8, y - r.height - 10), window.innerHeight - r.height - 8);
  el.style.left = px + 'px';
  el.style.top = (y - r.height - 10 < 8 ? y + 16 : py) + 'px';
}
function hideTip() { const el = tip(); if (el) el.hidden = true; }

function wireTips(root) {
  root.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('pointermove', (e) => showTip(el.dataset.tip, e.clientX, e.clientY));
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('focus', () => {
      const r = el.getBoundingClientRect();
      showTip(el.dataset.tip, r.left + r.width / 2, r.top);
    });
    el.addEventListener('blur', hideTip);
  });
}

/* ------------------------------------------------------------------
   Geometry helpers
   ------------------------------------------------------------------ */

/* Horizontal bar with a rounded far end and a square baseline. */
function hBar(x, y, w, h, color, cls = '') {
  const r = Math.min(4, w / 2, h / 2);
  if (w <= 0) return '';
  return `<path class="${cls}" d="M${x},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-(w - r)} z" fill="${color}"/>`;
}

/* Vertical column with a rounded top and a square baseline. */
function vBar(x, y, w, h, color, cls = '') {
  const r = Math.min(4, w / 2, h / 2);
  if (h <= 0) return '';
  return `<path class="${cls}" d="M${x},${y + h} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z" fill="${color}"/>`;
}

const niceTicks = (max) => {
  if (max <= 0) return [0, 1];
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]
    .find((s) => max / s <= 4) || Math.ceil(max / 4);
  const out = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
};

/* ------------------------------------------------------------------
   Time binning — day / week / month depending on the visible span
   ------------------------------------------------------------------ */

function binIncidents(incidents, mode) {
  const counts = new Map();
  incidents.forEach((i) => {
    if (!i.date) return;
    let key;
    if (mode === 'day') key = i.date;
    else if (mode === 'week') {
      const t = utc(i.date), d = new Date(t);
      key = iso(t - ((d.getUTCDay() + 6) % 7) * DAY); // Monday of that week
    } else key = i.date.slice(0, 7);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function binSeq(minIso, maxIso, mode) {
  const out = [];
  if (mode === 'month') {
    let [y, m] = minIso.split('-').map(Number);
    const [ey, em] = maxIso.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`);
      m++; if (m > 12) { m = 1; y++; }
    }
  } else {
    const step = mode === 'week' ? 7 * DAY : DAY;
    let t = utc(minIso);
    if (mode === 'week') t -= ((new Date(t).getUTCDay() + 6) % 7) * DAY;
    const end = utc(maxIso);
    for (; t <= end; t += step) out.push(iso(t));
  }
  return out;
}

function pickMode(minIso, maxIso) {
  const span = (utc(maxIso) - utc(minIso)) / DAY;
  return span <= 45 ? 'day' : span <= 400 ? 'week' : 'month';
}

/* Bin start/end in ISO dates, for brush → filter mapping. */
function binRange(key, mode) {
  if (mode === 'month') {
    const [y, m] = key.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [key + '-01', `${key}-${String(last).padStart(2, '0')}`];
  }
  if (mode === 'week') return [key, iso(utc(key) + 6 * DAY)];
  return [key, key];
}

/* ------------------------------------------------------------------
   Trends view
   ------------------------------------------------------------------ */

/* role="group" (not "img"): an img role makes descendants presentational,
   which would strip the focusable bar hit-targets from the a11y tree. */
function chartCard({ title, sub, body, wide, label }) {
  return `<section class="chart-card${wide ? ' wide' : ''}" role="group" aria-label="${esc(label || title)}">
    <div class="ch-head"><span class="ch-title">${esc(title)}</span>${sub ? `<span class="ch-sub">${esc(sub)}</span>` : ''}</div>
    ${body}
  </section>`;
}

function timeChart(incidents, ctx) {
  const dates = incidents.map((i) => i.date).filter(Boolean).sort();
  if (!dates.length) return '';
  const mode = pickMode(dates[0], dates[dates.length - 1]);
  const counts = binIncidents(incidents, mode);
  const keys = binSeq(dates[0], dates[dates.length - 1], mode);
  const max = Math.max(...keys.map((k) => counts.get(k) || 0), 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];

  const W = 980, H = 240, padL = 34, padR = 10, padT = 12, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / keys.length;
  const bw = Math.min(24, Math.max(3, slot * 0.66));

  const grid = ticks.map((v) => {
    const y = padT + plotH - (v / top) * plotH;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--grid-line)" stroke-width="1"/>
      <text x="${padL - 7}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--text-muted)" style="font-variant-numeric:tabular-nums">${v}</text>`;
  }).join('');

  const maxKey = keys.reduce((a, b) => ((counts.get(b) || 0) > (counts.get(a) || 0) ? b : a), keys[0]);
  let bars = '', labels = '';
  keys.forEach((k, n) => {
    const v = counts.get(k) || 0;
    const x = padL + n * slot + (slot - bw) / 2;
    const h = (v / top) * plotH;
    const y = padT + plotH - h;
    const tipHtml = `<span class="v">${v}</span> <span class="k">· ${esc(ctx.binLabel(k, mode))}</span>`;
    bars += vBar(x, y, bw, h, 'var(--series-main)');
    bars += `<rect data-tip="${esc(tipHtml)}" tabindex="0" x="${padL + n * slot}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent" class="bar-hit" aria-label="${esc(ctx.binLabel(k, mode))}: ${v}"/>`;
    if (k === maxKey && v > 0) {
      labels += `<text x="${x + bw / 2}" y="${Math.max(padT + 9, y - 5)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--text-secondary)">${v}</text>`;
    }
  });

  const every = Math.ceil(keys.length / 8);
  const axis = keys.map((k, n) => (n % every ? '' :
    `<text x="${padL + n * slot + slot / 2}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="var(--text-muted)">${esc(ctx.binLabel(k, mode, true))}</text>`)).join('');

  return chartCard({
    title: ctx.t('trendTitle'),
    sub: ctx.t(mode === 'day' ? 'perDay' : mode === 'week' ? 'perWeek' : 'perMonth'),
    wide: true,
    label: `${ctx.t('trendTitle')} — ${keys.map((k) => `${ctx.binLabel(k, mode, true)}: ${counts.get(k) || 0}`).join(', ')}`,
    body: `<svg viewBox="0 0 ${W} ${H}" style="--series-main:${ctx.seriesMain}" dir="ltr">
      ${grid}
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--text-muted)" stroke-width="1" opacity="0.5"/>
      ${bars}${labels}${axis}
    </svg>`,
  });
}

/* Ranked horizontal bars. rows: [{label, value, color?, tipExtra?, key?}] */
function rankChart(title, sub, rows, ctx, opts = {}) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => r.value), 1);
  const W = 470, rowH = 34, padT = 4;
  const H = padT + rows.length * rowH + (opts.footnote ? 18 : 6);
  const barMaxW = W - 60;

  const body = rows.map((r, n) => {
    const y = padT + n * rowH;
    const w = Math.max(2, (r.value / max) * barMaxW);
    const color = r.color || 'var(--series-main)';
    const tipHtml = `<span class="v">${r.value}</span> <span class="k">· ${esc(r.label)}${r.tipExtra ? ' · ' + esc(r.tipExtra) : ''}</span>`;
    return `<text x="0" y="${y + 11}" font-size="11" fill="var(--text-secondary)">${esc(r.label.length > 46 ? r.label.slice(0, 45) + '…' : r.label)}</text>
      <text x="${W}" y="${y + 11}" text-anchor="end" font-size="11.5" font-weight="700" fill="var(--text-strong)" style="font-variant-numeric:tabular-nums">${r.value}</text>
      ${hBar(0, y + 16, w, 9, color)}
      <rect data-tip="${esc(tipHtml)}" tabindex="0" ${r.key ? `data-key="${esc(r.key)}" data-field="${esc(opts.field || '')}" role="button" aria-pressed="${!!(ctx.isActive && ctx.isActive(opts.field, r.key))}"` : ''} x="0" y="${y}" width="${W}" height="${rowH - 4}" fill="transparent" class="bar-hit" aria-label="${esc(r.label)}: ${r.value}"/>`;
  }).join('');

  const foot = opts.footnote
    ? `<text x="0" y="${H - 4}" font-size="10" fill="var(--text-muted)">${esc(opts.footnote)}</text>` : '';

  return chartCard({
    title, sub,
    label: `${title} — ${rows.map((r) => `${r.label}: ${r.value}`).join(', ')}`,
    body: `<svg viewBox="0 0 ${W} ${H}" style="--series-main:${ctx.seriesMain}" dir="ltr">${body}${foot}</svg>`,
  });
}

function renderTrends(container, incidents, ctx) {
  const t = ctx.t;
  const total = incidents.length;

  const dates = incidents.map((i) => i.date).filter(Boolean).sort();
  const period = dates.length
    ? (dates[0] === dates[dates.length - 1] ? ctx.fmtDate(dates[0])
       : `${ctx.fmtDate(dates[0])} – ${ctx.fmtDate(dates[dates.length - 1])}`)
    : '';

  const hero = `<div class="hero-stat">
    <div class="n">${total}</div>
    <div class="l">${esc(t('heroLabel'))}${period ? ` · ${esc(period)}` : ''}${ctx.filtered ? ` · ${esc(t('filtered'))}` : ''}</div>
    <div class="rule"></div>
  </div>`;

  const count = (field, keyFn) => {
    const m = new Map();
    incidents.forEach((i) => {
      const k = keyFn ? keyFn(i) : (i[field] || '').trim();
      if (!k) return;
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const cats = count(null, (i) => ctx.categoryKey(i.category)).map(([k, v]) => ({
    label: ctx.catLabel(k), value: v, color: ctx.catColor(k), key: k,
  }));

  const states = count('state').filter(([k]) => k && k !== '—');
  const stateRows = states.slice(0, 8).map(([k, v]) => ({ label: k, value: v, key: k }));
  const moreStates = states.length - 8;

  const commRows = count('minority').slice(0, 6).map(([k, v]) => ({ label: k, value: v, key: k }));

  container.innerHTML = hero
    + '<div class="chart-grid">'
    + timeChart(incidents, ctx)
    + rankChart(t('byCategory'), '', cats, ctx, { field: 'category' })
    + rankChart(t('byState'), '', stateRows, ctx, {
        field: 'state',
        footnote: moreStates > 0 ? t('moreStates')(moreStates) : '',
      })
    + rankChart(t('byCommunity'), '', commRows, ctx, { field: 'minority' })
    + '</div>';

  wireTips(container);

  // Clicking a bar toggles that value as a filter — same contract as chips.
  container.querySelectorAll('.bar-hit[data-key]').forEach((el) => {
    el.addEventListener('click', () => ctx.onBarClick && ctx.onBarClick(el.dataset.field, el.dataset.key));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ctx.onBarClick && ctx.onBarClick(el.dataset.field, el.dataset.key);
      }
    });
  });
}

/* ------------------------------------------------------------------
   Timeline brush (map view) — counts over the FULL record, with the
   active date filter shown as the brushed range.
   ------------------------------------------------------------------ */

function renderTimeline(container, incidents, range, ctx) {
  const host = container.querySelector('#tl-chart');
  const dates = incidents.map((i) => i.date).filter(Boolean).sort();
  if (dates.length < 2) { container.hidden = true; return; }
  container.hidden = false;

  const span = (utc(dates[dates.length - 1]) - utc(dates[0])) / DAY;
  const mode = span <= 120 ? 'day' : 'week';
  const counts = binIncidents(incidents, mode);
  const keys = binSeq(dates[0], dates[dates.length - 1], mode);
  const max = Math.max(...keys.map((k) => counts.get(k) || 0), 1);

  const W = Math.max(280, host.clientWidth || container.clientWidth - 24);
  const H = 46, padB = 12, plotH = H - padB - 2;
  const slot = W / keys.length;
  const bw = Math.max(2, Math.min(16, slot * 0.72));

  const inRange = (k) => {
    const [a, b] = binRange(k, mode);
    return (!range.from || b >= range.from) && (!range.to || a <= range.to);
  };
  const active = range.from || range.to;

  let bars = '';
  keys.forEach((k, n) => {
    const v = counts.get(k) || 0;
    const h = Math.max(v ? 2 : 0, (v / max) * plotH);
    const x = n * slot + (slot - bw) / 2;
    bars += `<rect class="tl-bar${!active || inRange(k) ? ' in-range' : ''}" x="${x.toFixed(1)}" y="${(2 + plotH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1"/>`;
  });

  // Brush rectangle over the active range
  let brush = '';
  if (active) {
    const idx = (isoDate, end) => {
      let lo = 0, hi = keys.length - 1;
      keys.forEach((k, n) => {
        const [a, b] = binRange(k, mode);
        if (!end && a <= isoDate && isoDate <= b) lo = n;
        if (end && a <= isoDate && isoDate <= b) hi = n;
      });
      return end ? hi : lo;
    };
    const i0 = range.from ? idx(range.from, false) : 0;
    const i1 = range.to ? idx(range.to, true) : keys.length - 1;
    brush = `<rect class="tl-brush" x="${(i0 * slot).toFixed(1)}" y="1" width="${((i1 - i0 + 1) * slot).toFixed(1)}" height="${plotH + 2}" rx="2"/>`;
  }

  const first = keys[0], last = keys[keys.length - 1];
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="${esc(ctx.t('timelineLabel'))}">
    ${bars}${brush}
    <text class="tl-axis" x="1" y="${H - 2}">${esc(ctx.binLabel(first, mode, true))}</text>
    <text class="tl-axis" x="${W - 1}" y="${H - 2}" text-anchor="end">${esc(ctx.binLabel(last, mode, true))}</text>
  </svg>`;

  const svg = host.querySelector('svg');
  const idxAt = (clientX) => {
    const r = svg.getBoundingClientRect();
    return Math.min(keys.length - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * keys.length)));
  };

  /* During a drag the preview brush is drawn in place — the SVG is never
     re-rendered mid-gesture (that would drop the pointer capture). The
     filter itself only applies on pointerup. */
  const SVGNS = 'http://www.w3.org/2000/svg';
  let preview = null;
  const drawPreview = (i0, i1) => {
    if (!preview) {
      preview = document.createElementNS(SVGNS, 'rect');
      preview.setAttribute('class', 'tl-brush');
      preview.setAttribute('y', '1');
      preview.setAttribute('height', String(plotH + 2));
      preview.setAttribute('rx', '2');
      svg.appendChild(preview);
    }
    preview.setAttribute('x', (Math.min(i0, i1) * slot).toFixed(1));
    preview.setAttribute('width', ((Math.abs(i1 - i0) + 1) * slot).toFixed(1));
  };

  let dragIdx = null;
  svg.addEventListener('pointerdown', (e) => {
    dragIdx = idxAt(e.clientX);
    svg.setPointerCapture(e.pointerId);
    drawPreview(dragIdx, dragIdx);
    hideTip();
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (dragIdx === null) {
      const k = keys[idxAt(e.clientX)];
      const v = counts.get(k) || 0;
      showTip(`<span class="v">${v}</span> <span class="k">· ${esc(ctx.binLabel(k, mode))}</span>`, e.clientX, e.clientY);
      return;
    }
    drawPreview(dragIdx, idxAt(e.clientX));
  });
  svg.addEventListener('pointerup', (e) => {
    if (dragIdx === null) return;
    const i1 = idxAt(e.clientX);
    const [a] = binRange(keys[Math.min(dragIdx, i1)], mode);
    const [, b] = binRange(keys[Math.max(dragIdx, i1)], mode);
    dragIdx = null;
    ctx.onBrush(a, b); // a single click selects one bin
  });
  svg.addEventListener('pointerleave', () => { if (dragIdx === null) hideTip(); });
}

return { renderTrends, renderTimeline, showTip, hideTip };
})();
