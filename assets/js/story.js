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

  // Dark-theme category colours — the tracker's validated dark palette,
  // matching its dark basemap which this page mirrors.
  var COLORS = {
    'act of violence': '#7974C5',
    'attacks on religious spaces': '#11A68B',
    'police atrocity': '#2677B2',
    'state-sponsored discriminatory practice': '#9F5387',
    'act of hate': '#BD8130',
    'discrimination, exclusion & prejudice': '#778A2D',
    'media manipulation & distortion of facts': '#C77A41',
    'other': '#8D89A6'
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
        // The tracker's clean, self-contained basemap, dark variant:
        // world context beneath the official Government-of-India geometry.
        style: {
          version: 8,
          sources: {},
          layers: [{
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#14122B' }
          }]
        },
        center: [80, 23.2],
        zoom: 3.9,
        maxZoom: 9,
        interactive: false, // the panel is decoration; the text is the interface
        attributionControl: { compact: true, customAttribution: 'Boundaries as published by the Government of India' }
      });

      // Base geometry — fails soft: without it the dots still render.
      Promise.all([
        fetch('tracker/data/world.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        fetch('tracker/data/india-states.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      ]).then(function (geo) {
        var world = geo[0], states = geo[1];
        var addBase = function () {
          try {
            var before = map.getLayer('story-halo') ? 'story-halo' : undefined;
            if (world && !map.getSource('world')) {
              map.addSource('world', { type: 'geojson', data: world });
              map.addLayer({ id: 'world-fill', type: 'fill', source: 'world',
                paint: { 'fill-color': '#181430' } }, before);
              map.addLayer({ id: 'world-lines', type: 'line', source: 'world',
                paint: { 'line-color': 'rgba(255,255,255,0.10)', 'line-width': 0.6 } }, before);
            }
            if (states && !map.getSource('states')) {
              map.addSource('states', { type: 'geojson', data: states });
              map.addLayer({ id: 'india-fill', type: 'fill', source: 'states',
                paint: { 'fill-color': '#211C42' } }, before);
              map.addLayer({ id: 'state-lines', type: 'line', source: 'states',
                paint: { 'line-color': 'rgba(255,255,255,0.30)', 'line-width': 0.8 } }, before);
            }
          } catch (e) { /* decorative only */ }
        };
        if (map.isStyleLoaded()) setTimeout(addBase, 0);
        else map.on('style.load', function () { setTimeout(addBase, 0); });
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
