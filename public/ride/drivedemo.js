/* BinaSmart Driver — demo mode (/drive?demo=1).
 *
 * Why it exists: the Addis geofence rejects any GPS fix from outside the city, by design. That makes
 * the driving view impossible to review from abroad. Demo mode replays a REAL baked Addis route
 * through the REAL app code so the whole experience can be judged from anywhere.
 *
 * What it must never do: reach the server, touch a live ride, or store a fake position. It answers
 * every /api/drive/* call locally, and it needs no Telegram sign-in. The only network request is the
 * static demo-route.json.
 */
window.DDemo = (function () {
  'use strict';

  var q = location.search || '';
  var active = /[?&]demo=1/.test(q);
  function param(name, dflt) {
    var m = new RegExp('[?&]' + name + '=([^&]+)').exec(q);
    return m ? decodeURIComponent(m[1]) : dflt;
  }
  // A real car photo makes the marker demonstrate the actual feature. Override with ?car=<file>,
  // or ?car=none for the plain icon.
  var carFile = param('car', 'cmtlow3pl0001jokfakbtjctm.jpg');
  var MPS = Math.max(3, Math.min(30, Number(param('speed', 14)) || 14)); // metres per second

  var PICKUP = { lat: 9.0135, lng: 38.7625, label: 'Bole Medhanealem' };
  var DROP = { lat: 9.0356, lng: 38.7468, label: 'Piassa' };

  var driver = {
    id: 'demo', name: param('name', 'Demo Driver'), phone: '+251900000000',
    tier: 'moto', plate: 'DEMO 001', status: 'approved', online: true, away: false,
    rating: 5, ridesCount: 7, earningsTodayEtb: 640, onRideId: null,
    carPhoto: carFile === 'none' ? null : '/api/ride/car/' + carFile,
  };
  var job = null;
  var offer = {
    rideId: 'demo-ride', etaS: 70, distanceM: 220, round: 1, windowS: 25, expiresInS: 25,
    tier: 'moto', pickup: PICKUP, dropoff: DROP, fareEtb: 140, driverTakeEtb: 140,
    tripDistanceM: 4400, tripDurationS: 320,
  };
  var offerAt = 0, baked = null, pos = null, bearing = 0, timer = 0, path = [], idx = 0, frac = 0;

  function metres(a, b) {
    var R = 6371000, p = Math.PI / 180;
    var dLat = (b.lat - a.lat) * p, dLng = (b.lng - a.lng) * p;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearingOf(a, b) {
    var p = Math.PI / 180;
    var y = Math.sin((b.lng - a.lng) * p) * Math.cos(b.lat * p);
    var x = Math.cos(a.lat * p) * Math.sin(b.lat * p) - Math.sin(a.lat * p) * Math.cos(b.lat * p) * Math.cos((b.lng - a.lng) * p);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  var pt = c => ({ lat: c[1], lng: c[0] });

  function loadRoute() {
    if (baked) return Promise.resolve(baked);
    return fetch('/static/ride/demo-route.json').then(function (r) { return r.json(); }).then(function (j) {
      baked = j;
      offer.tripDistanceM = j.distanceM; offer.tripDurationS = j.durationS;
      return j;
    });
  }

  // Start 300 m short of the pickup along the reversed opening of the route, so "go to the passenger"
  // is a real leg with a real distance rather than a zero-length formality.
  function approachPath(g) {
    var head = g.slice(0, 8).map(pt).reverse();
    return head.concat([{ lat: PICKUP.lat, lng: PICKUP.lng }]);
  }

  function setPath(points) {
    path = points || []; idx = 0; frac = 0;
    if (path.length) { pos = { lat: path[0].lat, lng: path[0].lng }; bearing = path.length > 1 ? bearingOf(path[0], path[1]) : 0; }
  }

  // Advances the virtual car and hands the fix to the app exactly as watchPosition would.
  function driveAlong(onFix) {
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (path.length > 1 && idx < path.length - 1) {
        var a = path[idx], b = path[idx + 1];
        var seg = Math.max(1, metres(a, b));
        frac += MPS / seg;
        while (frac >= 1 && idx < path.length - 1) { frac -= 1; idx++; a = path[idx]; b = path[Math.min(idx + 1, path.length - 1)]; seg = Math.max(1, metres(a, b)); }
        b = path[Math.min(idx + 1, path.length - 1)];
        pos = { lat: a.lat + (b.lat - a.lat) * frac, lng: a.lng + (b.lng - a.lng) * frac };
        bearing = bearingOf(a, b);
      }
      if (pos) onFix({ coords: { latitude: pos.lat, longitude: pos.lng, heading: bearing, speed: MPS, accuracy: 6 } });
    }, 1000);
    if (pos) onFix({ coords: { latitude: pos.lat, longitude: pos.lng, heading: bearing, speed: MPS, accuracy: 6 } });
  }
  function stop() { if (timer) { clearInterval(timer); timer = 0; } }

  var reply = v => Promise.resolve(Object.assign({ _status: 200 }, v));

  // The canned API. Same shapes the real endpoints return, so no app code is bypassed.
  function post(pathname, body) {
    if (/\/api\/drive\/session$/.test(pathname)) {
      return loadRoute().then(function (g) {
        setPath(approachPath(g.geometry));
        offerAt = Date.now() + 2500; // give the map a moment, then ring
        return reply({ ok: true, driver: driver, job: job, offers: [] });
      });
    }
    if (/\/api\/drive\/online$/.test(pathname)) {
      driver.online = (body || {}).online !== false;
      return reply({ ok: true, driver: driver });
    }
    if (/\/api\/drive\/ping$/.test(pathname)) {
      var offers = [];
      if (!job && offerAt && Date.now() >= offerAt) {
        var left = Math.max(0, Math.round((offerAt + offer.windowS * 1000 - Date.now()) / 1000));
        if (left > 0) offers = [Object.assign({}, offer, { expiresInS: left })];
        else offerAt = Date.now() + 4000; // in a demo the offer comes back rather than dead-ending
      }
      return reply({ ok: true, fix: 'stored', driver: driver, job: job, offers: offers, serverTime: Date.now() });
    }
    if (/\/accept$/.test(pathname)) {
      job = {
        id: offer.rideId, status: 'assigned', tier: offer.tier, pickup: PICKUP, dropoff: DROP,
        distanceM: offer.tripDistanceM, durationS: offer.tripDurationS,
        fareEtb: offer.fareEtb, driverTakeEtb: offer.driverTakeEtb, paymentMethod: 'cash',
        riderName: 'Sara Tesfaye', riderPhone: '+251911223344', bookedBy: null,
        requestedAt: new Date().toISOString(), assignedAt: new Date().toISOString(),
        next: ['arriving', 'arrived'],
      };
      driver.onRideId = job.id; offerAt = 0;
      return reply({ ok: true, job: job, driver: driver });
    }
    if (/\/decline$/.test(pathname)) { offerAt = Date.now() + 5000; return reply({ ok: true, offers: [] }); }
    if (/\/status$/.test(pathname)) {
      var want = (body || {}).status;
      if (!job) return reply({ ok: false, error: 'no_job' });
      job.status = want;
      if (want === 'ontrip' && baked) setPath(baked.geometry.map(pt)); // now the real 12-turn route
      if (want === 'completed') {
        driver.onRideId = null; driver.ridesCount++; driver.earningsTodayEtb += job.driverTakeEtb;
        var done = job; job = null; stop();
        offerAt = Date.now() + 6000;
        loadRoute().then(function (g) { setPath(approachPath(g.geometry)); driveAlong(window.DDemo._onFix); });
        return reply({ ok: true, job: done, driver: driver });
      }
      return reply({ ok: true, job: job, driver: driver });
    }
    if (/\/api\/drive\/route$/.test(pathname)) {
      return loadRoute().then(function (g) {
        var to = (body || {}).to;
        if (to === 'dropoff') return reply({ ok: true, geometry: g.geometry, instructions: g.instructions, distanceM: g.distanceM, durationS: g.durationS, estimate: false });
        // The short hop to the passenger: a real two-point leg, honestly described.
        var from = pos || pt(g.geometry[0]);
        var d = Math.round(metres(from, PICKUP));
        return reply({ ok: true,
          geometry: [[from.lng, from.lat], [PICKUP.lng, PICKUP.lat]],
          instructions: [
            { sign: 0, distanceM: d, durationS: Math.round(d / MPS), street: '', text: 'Continue', interval: [0, 1] },
            { sign: 4, distanceM: 0, durationS: 0, street: '', text: 'Arrive', interval: [1, 1] },
          ], distanceM: d, durationS: Math.round(d / MPS), estimate: false });
      });
    }
    return reply({ ok: false, error: 'demo_unhandled' });
  }

  function badge() {
    var b = document.createElement('div');
    b.className = 'demoBadge';
    b.textContent = 'DEMO · ' + Math.round(MPS * 3.6) + ' km/h';
    b.title = 'Replaying a real Addis route. Nothing is sent to the server.';
    document.body.appendChild(b);
  }

  return { active: active, post: post, driveAlong: driveAlong, stop: stop, badge: badge,
    loadRoute: loadRoute, driver: driver, _onFix: null,
    get position() { return pos; } };
})();
