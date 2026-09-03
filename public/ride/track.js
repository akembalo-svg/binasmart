/* BinaSmart Ride — live tracking for the rider.
   The moving marker is the driver's OWN car photo in a rotating ring, so the thing gliding along the
   road on screen is the thing pulling up at the kerb. Between the 4 s server fixes the marker is
   interpolated locally, which is what makes it look like a car driving rather than a dot teleporting. */
window.BinaTrack = (function () {
  'use strict';

  var mk = null, el = null, ring = null, img = null;
  var from = null, to = null, animStart = 0, animMs = 4000, raf = 0, bearing = 0;
  var TRAIL = 'drvtrail';

  function map() { return window.BinaMap && window.BinaMap.map; }

  function build(live) {
    el = document.createElement('div');
    el.className = 'trkCar';
    el.innerHTML = '<span class="trkPulse"></span><span class="trkRing"><img alt=""></span><span class="trkNose"></span>';
    ring = el.querySelector('.trkRing');
    img = el.querySelector('img');
    if (live.driver && live.driver.carPhoto) img.src = live.driver.carPhoto;
    else { ring.classList.add('noPhoto'); ring.innerHTML = '<b>🚗</b>'; }
    mk = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([live.position.lng, live.position.lat]).addTo(map());
  }

  // The ring stays upright (a photo upside down is unreadable); only the nose points where the car goes.
  function face(deg) {
    if (deg == null || !el) return;
    bearing = deg;
    var nose = el.querySelector('.trkNose');
    if (nose) nose.style.transform = 'rotate(' + deg + 'deg)';
  }

  function step() {
    if (!mk || !from || !to) return;
    var t = Math.min(1, (Date.now() - animStart) / animMs);
    var e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out: cars accelerate and brake
    mk.setLngLat([from.lng + (to.lng - from.lng) * e, from.lat + (to.lat - from.lat) * e]);
    if (t < 1) raf = requestAnimationFrame(step);
  }

  function glideTo(p) {
    var cur = mk.getLngLat();
    from = { lat: cur.lat, lng: cur.lng };
    to = { lat: p.lat, lng: p.lng };
    var moved = Math.abs(to.lat - from.lat) + Math.abs(to.lng - from.lng);
    if (moved > 0.02) { mk.setLngLat([p.lng, p.lat]); return; } // a jump this big is a new fix, not driving
    animStart = Date.now();
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(step);
  }

  function trail(points) {
    var m = map();
    if (!m || !points || points.length < 2) return;
    var gj = { type: 'Feature', geometry: { type: 'LineString', coordinates: points.map(function (p) { return [p.lng, p.lat]; }) } };
    if (m.getSource(TRAIL)) { m.getSource(TRAIL).setData(gj); return; }
    m.addSource(TRAIL, { type: 'geojson', data: gj });
    m.addLayer({ id: TRAIL + '-l', type: 'line', source: TRAIL,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0ea5e9', 'line-width': 4, 'line-opacity': 0.55, 'line-dasharray': [1.5, 1.2] } });
  }

  // Called on every poll. Safe to call with no position: it simply keeps the last one.
  function update(ride, live) {
    if (!live) return;
    var box = document.getElementById('etaLive');
    if (!live.position) {
      if (box) {
        box.className = 'etaLive warn';
        box.textContent = live.driver
          ? '📡 ' + live.driver.name + ' is on the way. Live map starts when their phone connects.'
          : '';
        box.classList.toggle('hidden', !live.driver);
      }
      return;
    }
    if (!map()) return;
    if (!mk) build(live); else glideTo(live.position);
    face(live.position.bearing);
    if (ring) ring.classList.toggle('stale', !!live.position.stale);
    trail(live.trail);

    if (box) {
      var mins = live.etaS ? Math.max(1, Math.round(live.etaS / 60)) : null;
      var km = live.distanceM != null ? (Math.round(live.distanceM / 100) / 10) : null;
      var who = (live.driver && live.driver.name) || 'Your driver';
      var txt;
      if (live.position.stale) { txt = '📡 Waiting for ' + who + '’s signal…'; box.className = 'etaLive warn'; }
      else if (ride.status === 'ontrip') { txt = '🛣 ' + mins + ' min to your destination · ' + km + ' km'; box.className = 'etaLive'; }
      else if (ride.status === 'arrived') { txt = '🚗 ' + who + ' is here — check the plate'; box.className = 'etaLive here'; }
      else if (mins != null && mins <= 1) { txt = '🚗 ' + who + ' is arriving now'; box.className = 'etaLive here'; }
      else { txt = '🚗 ' + who + ' is ' + mins + ' min away · ' + km + ' km'; box.className = 'etaLive'; }
      box.textContent = txt;
      box.classList.remove('hidden');
    }
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (mk) { mk.remove(); mk = null; el = null; ring = null; img = null; }
    from = to = null;
    var m = map();
    if (m && m.getLayer(TRAIL + '-l')) { m.removeLayer(TRAIL + '-l'); m.removeSource(TRAIL); }
    var box = document.getElementById('etaLive');
    if (box) { box.classList.add('hidden'); box.textContent = ''; }
  }

  return { update: update, stop: stop, get marker() { return mk; } };
})();
