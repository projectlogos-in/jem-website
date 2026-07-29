// JEM site chrome — vanilla JS, no dependencies. Everything here fails
// silently over file:// or offline: the pages are generated with static
// fallback content, and this script only upgrades it where it can.

(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  // ------------------------------------------------------------ Header nav
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.nav-toggle');
  if (toggle && header) {
    toggle.addEventListener('click', function () {
      header.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', header.classList.contains('nav-open'));
    });
  }

  // Dropdown submenus: keyboard/touch-openable via the arrow button; hover
  // and focus-within still work via CSS. Escape or an outside click closes.
  document.querySelectorAll('.nav .drop-toggle').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var dd = btn.closest('.has-dropdown');
      var open = dd.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
    });
  });
  document.addEventListener('click', function (e) {
    document.querySelectorAll('.nav .has-dropdown.open').forEach(function (dd) {
      if (!dd.contains(e.target)) {
        dd.classList.remove('open');
        var b = dd.querySelector('.drop-toggle');
        if (b) b.setAttribute('aria-expanded', 'false');
      }
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.nav .has-dropdown.open').forEach(function (dd) {
      dd.classList.remove('open');
      var b = dd.querySelector('.drop-toggle');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  });

  // ------------------------------------------------------------ Quick exit
  // location.replace() swaps this page out of the current history entry,
  // so it does not appear in the back button.
  document.querySelectorAll('[data-quick-exit]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      window.location.replace('https://www.google.com');
    });
  });

  // -------------------------------------------------- Tracker live refresh
  // The build snapshots the tracker data into the page; this refreshes the
  // stat counters, the "recently documented" cards, the sparkline and the
  // last-updated line from the live dataset when fetch() is available.
  // Category colours mirror _build/pages.mjs CATEGORY_COLORS.
  var CATEGORY_COLORS = {
    'act of violence': '#5E5A9A',
    'attacks on religious spaces': '#11A68B',
    'police atrocity': '#1096E9',
    'state-sponsored discriminatory practice': '#BC549E',
    'act of hate': '#DD9533',
    'discrimination, exclusion & prejudice': '#87984F',
    'media manipulation & distortion of facts': '#7F4413',
    'other': '#848096'
  };

  function catBadge(category) {
    var key = String(category || 'other').toLowerCase();
    var color = CATEGORY_COLORS[key] || CATEGORY_COLORS.other;
    return '<span class="cat-badge" style="--cat:' + color + '">' + esc(category || 'Other') + '</span>';
  }

  function recordCard(incident) {
    var firstLine = String(incident.description || '').split('\n')[0];
    // Append the state only when the place string doesn't already carry it.
    var place = String(incident.place || '');
    var state = incident.state && place.toLowerCase().indexOf(String(incident.state).toLowerCase()) === -1
      ? ' · ' + esc(incident.state) : '';
    return '<a class="record-card" href="tracker/index.html#sel=' + encodeURIComponent(incident.id) + '">' +
      '<span class="rc-meta"><span class="rc-date">' + esc(incident.date) + '</span> ' + catBadge(incident.category) + '</span>' +
      '<span class="rc-place">' + esc(place) + state + '</span>' +
      '<span class="rc-desc">' + esc(firstLine) + '</span></a>';
  }

  // Mirrors sparklineSvg() in _build/pages.mjs — keep the two in step.
  function sparklineSvg(counts) {
    var W = 260, H = 56, P = 6;
    var max = Math.max.apply(null, [1].concat(counts));
    var step = (W - P * 2) / (counts.length - 1);
    var pts = counts.map(function (c, i) {
      return [P + i * step, H - P - (c / max) * (H - P * 2)];
    });
    var line = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var end = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Documented incidents per week, last 12 weeks">' +
      '<polyline points="' + line + '" fill="none" stroke="var(--jem-indigo)" stroke-width="2"/>' +
      '<circle cx="' + end[0].toFixed(1) + '" cy="' + end[1].toFixed(1) + '" r="3.5" fill="var(--jem-saffron)"/></svg>';
  }

  function weeklyCounts(incidents, weeks) {
    weeks = weeks || 12;
    var dates = incidents.map(function (i) { return i.date; }).filter(Boolean).sort();
    if (!dates.length) return null;
    var end = new Date(dates[dates.length - 1] + 'T00:00:00Z');
    var counts = [];
    for (var k = 0; k < weeks; k++) counts.push(0);
    dates.forEach(function (d) {
      var diff = Math.floor((end - new Date(d + 'T00:00:00Z')) / 86400000);
      var bucket = weeks - 1 - Math.floor(diff / 7);
      if (bucket >= 0 && bucket < weeks) counts[bucket]++;
    });
    return counts;
  }

  (function () {
    var root = document.querySelector('[data-tracker-stats]');
    if (!root || typeof fetch !== 'function') return;
    var base = root.getAttribute('data-tracker-stats');
    fetch(base + 'data/incidents.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var incidents = data.incidents || [];
        var states = {};
        incidents.forEach(function (i) { if (i.state) states[i.state] = 1; });
        var dates = incidents.map(function (i) { return i.date; }).filter(Boolean).sort();
        var period = dates.length ? (dates[0].slice(0, 7) + ' – ' + dates[dates.length - 1].slice(0, 7)) : '—';

        setStat('total', data.count != null ? data.count : incidents.length);
        setStat('states', Object.keys(states).length);
        setStat('period', period);

        // Recently documented — the 3 most recent records.
        var recentEl = document.querySelector('[data-recent-records]');
        if (recentEl && incidents.length) {
          var recent = incidents.filter(function (i) { return i.date; })
            .sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 3);
          recentEl.innerHTML = recent.map(recordCard).join('');
        }

        // 12-week sparkline.
        var sparkEl = document.querySelector('[data-sparkline]');
        if (sparkEl && incidents.length) {
          var counts = weeklyCounts(incidents);
          if (counts) {
            sparkEl.innerHTML = sparklineSvg(counts) +
              '<span class="spark-cap">Documented incidents per week</span>';
          }
        }

        var updatedEl = document.querySelector('[data-record-updated]');
        if (updatedEl && data.generated) {
          updatedEl.textContent = 'Record last updated: ' + String(data.generated).slice(0, 10);
        }
      })
      .catch(function () { /* keep the build-time snapshot */ });

    function setStat(key, value) {
      var el = root.querySelector('[data-stat="' + key + '"]');
      if (el) el.textContent = value;
    }
  })();

  // ------------------------------------------- Tracker click-to-load facade
  // The homepage ships a static branded panel; the iframe (and the map
  // tiles behind it) load only when the visitor asks.
  document.querySelectorAll('[data-tracker-embed]').forEach(function (wrap) {
    var btn = wrap.querySelector('.tf-open');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var iframe = document.createElement('iframe');
      iframe.src = wrap.getAttribute('data-tracker-embed');
      iframe.title = 'JEM hate incident tracker';
      wrap.innerHTML = '';
      wrap.appendChild(iframe);
      iframe.focus();
    });
  });

  // ---------------------------------------------- Collapsible pub archives
  document.querySelectorAll('.pub-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var group = btn.closest('.pub-group');
      group.classList.toggle('open');
      var open = group.classList.contains('open');
      btn.textContent = (open ? 'Hide ' : 'Show all ') + btn.getAttribute('data-count');
      btn.setAttribute('aria-expanded', open);
    });
  });

  // ------------------------------------------------ Publications filter bar
  (function () {
    var bar = document.querySelector('[data-pub-filter]');
    if (!bar) return;
    var typeSel = document.getElementById('pf-type');
    var yearSel = document.getElementById('pf-year');
    var search = document.getElementById('pf-search');
    var count = bar.querySelector('[data-pf-count]');
    var empty = document.querySelector('[data-pub-empty]');
    var cards = Array.prototype.slice.call(document.querySelectorAll('.pub-card'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('.pub-group'));

    bar.addEventListener('submit', function (e) { e.preventDefault(); });

    function apply() {
      var type = typeSel.value;
      var year = yearSel.value;
      var q = search.value.trim().toLowerCase();
      var active = !!(type || year || q);
      var shown = 0;

      cards.forEach(function (card) {
        var ok = (!type || card.getAttribute('data-type') === type) &&
                 (!year || card.getAttribute('data-year') === year) &&
                 (!q || card.getAttribute('data-title').indexOf(q) !== -1);
        card.classList.toggle('pf-hidden', !ok);
        if (ok) shown++;
      });

      groups.forEach(function (group) {
        var any = group.querySelector('.pub-card:not(.pf-hidden)');
        group.classList.toggle('pf-hidden', !any);
        // Collapsed newsletter archives open automatically while a filter
        // is active, so matches are never hidden behind the toggle.
        if (group.classList.contains('collapsible')) {
          group.classList.toggle('open', active && !!any);
          var t = group.querySelector('.pub-toggle');
          if (t) {
            t.setAttribute('aria-expanded', group.classList.contains('open'));
            t.style.display = active ? 'none' : '';
          }
        }
      });

      if (count) count.textContent = active ? shown + ' of ' + cards.length + ' shown' : '';
      if (empty) empty.style.display = shown === 0 ? 'block' : 'none';
    }

    typeSel.addEventListener('change', apply);
    yearSel.addEventListener('change', apply);
    search.addEventListener('input', apply);
  })();

  // ---------------------------------------------------- Video poster cards
  document.querySelectorAll('.video-card .video-poster').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = btn.closest('.video-card');
      var video = card.querySelector('video');
      card.classList.add('playing');
      video.play().catch(function () { /* controls remain visible */ });
    });
  });

  // ----------------------------------------------------- Copy-text buttons
  // Fills the "Accessed <date>" span (client-side, ISO) and wires each
  // copy button to the [data-citation] block that shares its parent.
  // Local calendar date — toISOString would shift IST dates back a day.
  function localISODate() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var today = localISODate();
  document.querySelectorAll('[data-accessed-date]').forEach(function (el) {
    el.textContent = today;
  });

  function copyText(text, btn) {
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = 'Copied';
      btn.classList.add('copied');
      setTimeout(function () {
        btn.textContent = prev;
        btn.classList.remove('copied');
      }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* leave text visible for manual copy */ }
      document.body.removeChild(ta);
    }
  }

  document.querySelectorAll('.copy-btn[data-copy-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var block = btn.parentElement.querySelector('[data-citation]');
      if (block) copyText(block.textContent.replace(/\s+\n/g, '\n').trim(), btn);
    });
  });

  // ------------------------------------------------- Report builder (intake)
  // The form transmits nothing by itself. Submit assembles a structured
  // plain-text report and offers three guaranteed paths: WhatsApp deep
  // link, prefilled mailto, and copy-to-clipboard.
  (function () {
    var form = document.querySelector('[data-report-form]');
    if (!form) return;
    var output = document.querySelector('[data-report-output]');
    var textEl = document.querySelector('[data-report-text]');
    var waLink = document.querySelector('[data-report-wa]');
    var mailLink = document.querySelector('[data-report-mail]');
    var copyBtn = document.querySelector('[data-report-copy]');

    function val(id) {
      var el = form.querySelector('#' + id);
      return el ? el.value.trim() : '';
    }

    function buildReport() {
      var name = (val('fname') + ' ' + val('lname')).trim();
      var lines = [
        'JEM hate crime report',
        'Prepared: ' + localISODate(),
        '',
        'Name: ' + (name || 'Not provided'),
        'Phone: ' + (val('phone') || 'Not provided'),
        'Email: ' + (val('email') || 'Not provided'),
        'Date of incident: ' + (val('idate') || 'Not known'),
        'State / UT: ' + val('istate'),
        'District / locality: ' + (val('idistrict') || 'Not provided'),
        'Category: ' + val('icategory'),
        '',
        'What happened:',
        val('message'),
        '',
        'Consent: the reporter consents to JEM storing and reviewing this report.'
      ];
      return lines.join('\n');
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var report = buildReport();
      textEl.value = report;
      var encoded = encodeURIComponent(report);
      var subject = encodeURIComponent('Hate crime report — ' + (val('istate') || 'India'));
      // Long reports get silently truncated by URL handlers — past ~1,500
      // encoded characters, steer the reporter to copy-and-paste instead of
      // pre-filling a link that would drop the end of their account.
      var tooLong = encoded.length > 1500;
      var note = document.querySelector('[data-report-long-note]');
      if (tooLong) {
        var stub = encodeURIComponent('My report is longer than a link can carry — pasting the full text here:\n\n');
        waLink.href = 'https://wa.me/919868952786?text=' + stub;
        mailLink.href = 'mailto:contact@jem.org.in?subject=' + subject + '&body=' + stub;
        if (!note) {
          note = document.createElement('p');
          note.setAttribute('data-report-long-note', '');
          note.className = 'form-note';
          note.textContent = 'Your report is too long for a pre-filled link. Tap "Copy report text" first, then paste it into WhatsApp or the email.';
          textEl.parentNode.insertBefore(note, textEl);
        }
        note.hidden = false;
      } else {
        waLink.href = 'https://wa.me/919868952786?text=' + encoded;
        mailLink.href = 'mailto:contact@jem.org.in?subject=' + subject + '&body=' + encoded;
        if (note) note.hidden = true;
      }
      output.hidden = false;
      output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyText(textEl.value, copyBtn);
      });
    }
  })();

  // -------------------------------------------------- Contact form (mailto)
  // A plain <form action="mailto:"> silently fails on most systems; this
  // composes a prefilled mailto: URL instead, which reliably opens the
  // visitor's mail app.
  document.querySelectorAll('[data-mailto-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var get = function (name) {
        var el = form.querySelector('[name="' + name + '"]');
        return el ? el.value.trim() : '';
      };
      var name = (get('fname') + ' ' + get('lname')).trim();
      var body = [
        'Name: ' + name,
        'Phone: ' + (get('phone') || 'Not provided'),
        'Email: ' + get('email'),
        'City: ' + (get('city') || 'Not provided'),
        '',
        get('message')
      ].join('\n');
      window.location.href = 'mailto:' + form.getAttribute('data-mailto') +
        '?subject=' + encodeURIComponent(get('subject') || 'Website enquiry') +
        '&body=' + encodeURIComponent(body);
    });
  });
})();
