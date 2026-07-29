/* story.html — "Two months in the record" scrollytelling runtime.
   Vanilla JS, no dependencies beyond the self-hosted MapLibre bundle the
   tracker already ships. Everything is guarded: the narrative is complete
   without JS or the map (all figures live in the text; the map panel is
   aria-hidden decoration), so any failure here simply leaves the static
   fallback card in place. Data is fetched from the tracker dataset at
   runtime; over file:// the fetch cannot run and the fallback stays. */
(function () {
  'use strict';

  var panel = document.querySelector('[data-story-map]');
  var steps = Array.prototype.slice.call(document.querySelectorAll('.scrolly .story-step'));
  if (!steps.length) return;

  // Light-theme category colours — the same map _build/pages.mjs and the
  // tracker use (dots sit on the light Positron basemap).
  var COLORS = {
    'act of violence': '#5E5A9A',
    'attacks on religious spaces': '#11A68B',
    'police atrocity': '#1096E9',
    'state-sponsored discriminatory practice': '#BC549E',
    'act of hate': '#DD9533',
    'discrimination, exclusion & prejudice': '#87984F',
    'media manipulation & distortion of facts': '#7F4413',
    'other': '#848096'
  };

  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* leave false */ }

  function parseView(el) {
    try { return JSON.parse(el.getAttribute('data-view') || '{}'); } catch (e) { return {}; }
  }

  var map = null;
  var mapReady = false;
  var pendingView = null;

  function applyView(view) {
    if (!view) return;
    if (!map || !mapReady) { pendingView = view; return; }
    try {
      var conds = [];
      if (view.cats && view.cats.length) conds.push(['in', ['get', 'cat'], ['literal', view.cats]]);
      if (view.states && view.states.length) conds.push(['in', ['get', 'state'], ['literal', view.states]]);
      map.setFilter('story-dots', conds.length ? ['all'].concat(conds) : null);
      map.setFilter('story-halo', conds.length ? ['all'].concat(conds) : null);
      map.setFilter('story-hl', ['in', ['get', 'id'], ['literal', (view.highlight || [])]]);
      var camera = { center: view.center || [80, 23.2], zoom: view.zoom || 3.9 };
      if (reducedMotion) {
        map.jumpTo(camera);
      } else {
        camera.duration = 1600;
        camera.essential = false;
        map.flyTo(camera);
      }
    } catch (e) { /* map gone mid-flight — the text carries the page */ }
  }

  // --- Step activation (runs with or without a live map) ---------------
  var activeStep = steps[0];
  function activate(step) {
    if (step === activeStep) return;
    activeStep = step;
    for (var i = 0; i < steps.length; i++) {
      steps[i].classList.toggle('is-active', steps[i] === step);
    }
    applyView(parseView(step));
  }

  // Scroll-position driven, not IntersectionObserver: the active step is
  // simply the one nearest the viewport middle. Plain geometry fires
  // reliably in every environment (embedded panes, unusual viewports,
  // zoomed pages) where observer callbacks have proven flaky.
  function currentStep() {
    if (!window.innerHeight) return null;
    var mid = window.innerHeight * 0.5;
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < steps.length; i++) {
      var r = steps[i].getBoundingClientRect();
      var d = (mid >= r.top && mid <= r.bottom)
        ? 0
        : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
      if (d < bestD) { bestD = d; best = steps[i]; }
    }
    return best;
  }

  var scrollPending = false;
  function onScroll() {
    if (scrollPending) return;
    scrollPending = true;
    setTimeout(function () {
      scrollPending = false;
      var s = currentStep();
      if (s) activate(s);
    }, 80);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true }); // inner scrollers too
  onScroll();

  // --- Map ---------------------------------------------------------------
  function initMap() {
    if (!panel || typeof maplibregl === 'undefined') return;
    if (location.protocol === 'file:') return; // fetch + tiles unavailable; keep the fallback

    var url = panel.getAttribute('data-incidents') || 'tracker/data/incidents.json';
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('data ' + r.status);
      return r.json();
    }).then(function (data) {
      var incidents = (data && data.incidents) || [];
      var features = [];
      for (var i = 0; i < incidents.length; i++) {
        var inc = incidents[i];
        if (inc.lat == null || inc.lon == null) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [inc.lon, inc.lat] },
          properties: {
            id: inc.id,
            cat: String(inc.category || 'other').toLowerCase(),
            state: inc.state || ''
          }
        });
      }
      if (!features.length) return;

      map = new maplibregl.Map({
        container: 'story-map',
        style: 'https://tiles.openfreemap.org/styles/positron',
        center: [80, 23.2],
        zoom: 3.9,
        interactive: false, // the panel is decoration; the text is the interface
        attributionControl: { compact: true }
      });

      var colorExpr = ['match', ['get', 'cat']];
      for (var key in COLORS) {
        if (key !== 'other') { colorExpr.push(key); colorExpr.push(COLORS[key]); }
      }
      colorExpr.push(COLORS.other);

      // 'style.load' + a tick: a GeoJSON source added synchronously in the
      // handler is never processed by MapLibre 4.7's worker (same deferral
      // the tracker uses).
      map.on('style.load', function () {
        setTimeout(function () {
          try {
            if (map.getSource('incidents')) return;
            map.addSource('incidents', {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: features }
            });
            map.addLayer({
              id: 'story-halo',
              type: 'circle',
              source: 'incidents',
              paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 7, 11],
                'circle-color': colorExpr,
                'circle-opacity': 0.18
              }
            });
            map.addLayer({
              id: 'story-dots',
              type: 'circle',
              source: 'incidents',
              paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3.2, 7, 6],
                'circle-color': colorExpr,
                'circle-opacity': 0.9,
                'circle-stroke-color': '#FFFFFF',
                'circle-stroke-width': 0.8
              }
            });
            map.addLayer({
              id: 'story-hl',
              type: 'circle',
              source: 'incidents',
              filter: ['in', ['get', 'id'], ['literal', []]],
              paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 7, 7, 12],
                'circle-color': 'rgba(0,0,0,0)',
                'circle-stroke-color': '#DD9533',
                'circle-stroke-width': 2.5
              }
            });
            mapReady = true;
            panel.classList.add('is-live');
            var fb = panel.querySelector('[data-map-fallback]');
            if (fb) fb.hidden = true;
            applyView(pendingView || parseView(activeStep));
          } catch (e) { /* fallback card stays */ }
        }, 0);
      });

      map.on('error', function (e) {
        // Basemap/tile failures are non-fatal for the page — log and move on.
        if (e && e.error) { try { console.warn('Story map:', e.error.message); } catch (x) {} }
      });
    }).catch(function () { /* fetch failed — fallback card stays */ });
  }

  try { initMap(); } catch (e) { /* the page reads without it */ }
})();
