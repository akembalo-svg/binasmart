/* BinaSmart Driver app. One state machine, one timer, one map.
   Everything the app knows comes from POST /api/drive/ping, which carries the position up and the
   offers plus the current trip down. Auth is Telegram initData from @binasmartdriverbot, so the app
   only works inside that bot. */
(function () {
  'use strict';

  var PING_MS = 4000, OFFER_WINDOW_S = 25, RING = 119.4; // OFFER_WINDOW_S is only a fallback
  var $ = function (id) { return document.getElementById(id); };
  // TG.initData is a function in the shim, and it returns null outside Telegram.
  var initData = (window.TG && window.TG.initData && window.TG.initData()) || '';
  // Distinguish "not in Telegram at all" from "in Telegram but it gave us no identity": the second
  // is an old client or a Mini App opened from a link rather than a button, and needs a different fix.
  // The SDK defines window.Telegram.WebApp in a plain browser too, with platform 'unknown'.
  // Only a real Telegram client reports android/ios/tdesktop/weba, so platform is the honest test.
  var tgPlatform = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.platform) || 'unknown';
  var inTelegram = tgPlatform !== 'unknown';
  // The shim paints the rider app's green; the cockpit is night-dark.
  try { window.Telegram.WebApp.setHeaderColor('#0b1220'); window.Telegram.WebApp.setBackgroundColor('#0b1220'); } catch (e) {}
  var st = {
    driver: null, job: null, offer: null, offerEndsAt: 0,
    pos: null, gpsOk: false, lastPingOk: 0, busy: false, lock: null, routeFor: '', offerTotal: 0,
    routeFrom: null, routeAt: 0, fitted: '', alertTimer: 0, saidStep: -1, saidNear: '', legSpoken: '',
    nav: false, freeCam: 0,
  };
  var carMk = null, map = null, pickMk = null, dropMk = null;

  // ---------- plumbing ----------
  function post(path, body) {
    return fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ initData: initData }, body || {})),
    }).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
  }
  // Mobile browsers stay silent until the user touches the page, so the first tap opens the audio.
  document.addEventListener('click', function () { window.DNav.unlock(); }, { once: true });
  document.addEventListener('touchstart', function () { window.DNav.unlock(); }, { once: true });

  function banner(text, ok) {
    var b = $('banner');
    if (!text) { b.classList.add('hidden'); return; }
    b.textContent = text; b.className = 'dbanner' + (ok ? ' ok' : '');
    if (ok) setTimeout(function () { b.classList.add('hidden'); }, 2600);
  }
  function show(which) {
    ['offer', 'trip', 'idle', 'gate'].forEach(function (id) { $(id).classList.toggle('hidden', id !== which); });
  }
  function km(m) { return m == null ? '—' : (m < 950 ? Math.round(m / 10) * 10 + ' m' : (Math.round(m / 100) / 10) + ' km'); }
  // Straight-line metres. Good enough for "how far to the passenger"; the road route comes from the server.
  function metres(a, b) {
    if (!a || !b) return null;
    var R = 6371000, p = Math.PI / 180;
    var dLat = (b.lat - a.lat) * p, dLng = (b.lng - a.lng) * p;
    var la = a.lat * p, lb = b.lat * p;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }
  function mins(s) { return s == null ? '—' : Math.max(1, Math.round(s / 60)) + ' min'; }
  function haptic(kind) { try { window.Telegram.WebApp.HapticFeedback.notificationOccurred(kind); } catch (e) {} }

  // Keeping the screen awake is the difference between a working driver app and a dead one.
  function wakeLock(on) {
    if (!on) { if (st.lock) { try { st.lock.release(); } catch (e) {} st.lock = null; } return; }
    if (st.lock || !navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (l) {
      st.lock = l;
      l.addEventListener('release', function () { st.lock = null; });
    }).catch(function () { /* denied or unsupported — the app still works */ });
  }

  // ---------- map ----------
  function ensureMap() {
    if (map) return;
    map = window.BinaMap.init('map', function () { window.BinaMap.set3D(false); });
  }
  function drawCar(p) {
    if (!map || !p) return;
    if (!carMk) {
      var el = document.createElement('div');
      el.className = 'dcar';
      el.innerHTML = '<span class="dhalo"></span><span class="dcarico">🚗</span>';
      carMk = new maplibregl.Marker({ element: el, anchor: 'center', rotationAlignment: 'map' })
        .setLngLat([p.lng, p.lat]).addTo(map);
    } else {
      carMk.setLngLat([p.lng, p.lat]);
    }
    if (p.bearing != null) carMk.setRotation(p.bearing);
  }
  function follow(p) { if (map && p) map.easeTo({ center: [p.lng, p.lat], duration: 900 }); }

  // Navigation camera: close in, tilted, and rotated so the road ahead is up the screen. If the
  // driver drags the map we stop fighting them for ten seconds, then resume.
  function navCamera(p) {
    if (!map || !p || !st.nav) return;
    if (Date.now() - st.freeCam < 10000) return;
    map.easeTo({
      center: [p.lng, p.lat],
      bearing: p.bearing != null ? p.bearing : map.getBearing(),
      pitch: 55, zoom: 17, duration: 900, essential: true,
    });
  }
  function watchPan() {
    if (!map || map.__panWatched) return;
    map.__panWatched = true;
    map.on('dragstart', function () { st.freeCam = Date.now(); });
    map.on('rotatestart', function () { st.freeCam = Date.now(); });
  }

  // A pin alone does not tell a driver anything. These carry who and what, and the active leg glows.
  function pin(kind, point, label) {
    var el = document.createElement('div');
    el.className = 'dpin dpin-' + kind;
    el.innerHTML = '<span class="dpinDot"></span><span class="dpinLabel">' + label + '</span>';
    return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([point.lng, point.lat]).addTo(map);
  }
  function setTargets(job) {
    if (!map || !job) return;
    var who = (job.riderName || 'Passenger').split(' ')[0];
    if (pickMk) pickMk.remove();
    if (dropMk) dropMk.remove();
    pickMk = pin('pick', job.pickup, '🙋 ' + who);
    dropMk = pin('drop', job.dropoff, '🏁 ' + ((job.dropoff && job.dropoff.label) || 'Drop-off'));
    var onTrip = job.status === 'ontrip';
    pickMk.getElement().classList.toggle('active', !onTrip);
    dropMk.getElement().classList.toggle('active', onTrip);
  }
  function clearTargets() {
    if (pickMk) { pickMk.remove(); pickMk = null; }
    if (dropMk) { dropMk.remove(); dropMk = null; }
  }

  // Re-route when the leg changes, when the driver has moved 150 m, or every 25 s — a line that does
  // not follow the car is worse than no line, because the driver trusts it.
  function drawLeg() {
    if (!st.job || !st.pos) return;
    var leg = st.job.status === 'ontrip' ? 'dropoff' : 'pickup';
    var key = st.job.id + ':' + leg;
    var moved = st.routeFrom ? metres(st.routeFrom, st.pos) : 9999;
    var oldEnough = Date.now() - st.routeAt > 25000;
    if (st.routeFor === key && moved < 150 && !oldEnough) return;
    st.routeFor = key; st.routeFrom = { lat: st.pos.lat, lng: st.pos.lng }; st.routeAt = Date.now();
    setTargets(st.job);
    post('/api/drive/route', { lat: st.pos.lat, lng: st.pos.lng, to: leg }).then(function (j) {
      if (!j.ok || !j.geometry || j.geometry.length < 2) return;
      // Fit the whole leg once so the driver sees where they are going, then stop stealing the camera.
      var fitKey = st.job.id + ':' + leg;
      window.BinaMap.drawRoute(j.geometry, st.fitted === fitKey ? -1 : 400);
      st.fitted = fitKey;
      if (j.distanceM != null) { st.legRoadM = j.distanceM; st.legRoadS = j.durationS; }
      window.DNav.plan(j.instructions || [], j.geometry);
      st.saidNear = '';
      // One spoken sentence per leg, naming who or where — then silence until a turn.
      var legKey = st.job.id + ':' + leg;
      if (st.legSpoken !== legKey) {
        st.legSpoken = legKey;
        var who = (st.job.riderName || '').split(' ')[0];
        window.DNav.say(leg === 'dropoff' ? 'ወደ መድረሻው ይሂዱ' : 'ወደ ተሳፋሪው ' + who + ' ይሂዱ');
      }
      paintLegLine();
      paintNav();
    }).catch(function () { st.routeFor = ''; });
  }

  // The live "how far to the passenger" line. Recomputed on every GPS fix, so it never looks frozen.
  function paintLegLine() {
    var j = st.job; if (!j) return;
    var onTrip = j.status === 'ontrip';
    var target = onTrip ? j.dropoff : j.pickup;
    var straight = metres(st.pos, target);
    var road = st.legRoadM, secs = st.legRoadS;
    var far = road != null ? road : (straight != null ? Math.round(straight * 1.35) : null);
    var eta = secs != null ? secs : (far != null ? Math.round(far / 6.1) : null);
    var who = (j.riderName || 'the passenger').split(' ')[0];
    if (!st.pos) { $('tetaP').textContent = 'ጂፒኤስ እየተጠበቀ ነው · waiting for GPS'; return; }
    if (straight != null && straight < 80 && !onTrip) {
      $('tetaP').textContent = '📍 ተሳፋሪው ጋር ደርሰዋል — ካላዩት ይደውሉ · you are at the pickup, call ' + who;
      return;
    }
    var m = Math.max(1, Math.round((eta || 0) / 60));
    $('tetaP').textContent = (onTrip ? '🏁 ' : '🙋 ') + km(far) + ' · ' + m + ' ደቂቃ '
      + (onTrip ? 'ወደ መድረሻው' : 'ወደ ' + who) + ' · ' + m + ' min';
  }

  // ---------- GPS ----------
  function startGps() {
    if (!navigator.geolocation) { banner('This phone cannot share its location. · ስልኩ ቦታ ማጋራት አይችልም።'); return; }
    navigator.geolocation.watchPosition(function (g) {
      st.gpsOk = true;
      st.pos = {
        lat: g.coords.latitude, lng: g.coords.longitude,
        bearing: (g.coords.heading != null && !isNaN(g.coords.heading)) ? g.coords.heading : (st.pos ? st.pos.bearing : null),
        speedKph: g.coords.speed != null && !isNaN(g.coords.speed) ? Math.max(0, g.coords.speed * 3.6) : null,
        accuracy: g.coords.accuracy,
      };
      ensureMap(); drawCar(st.pos);
      if (st.job) { drawLeg(); paintLegLine(); paintNav(); paintNavHud(); navCamera(st.pos); }
      banner('');
    }, function (e) {
      st.gpsOk = false;
      banner(e.code === 1
        ? '📍 Location is blocked. Allow it in your phone settings, or you cannot receive rides.'
        : '📍 Waiting for GPS… move to open sky. · ጂፒኤስ እየተጠበቀ ነው።');
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  }

  // ---------- render ----------
  function paintStats() {
    var d = st.driver; if (!d) return;
    $('earn').textContent = d.earningsTodayEtb || 0;
    $('trips').textContent = d.ridesCount || 0;
  }
  var STAGE = {
    assigned: { pill: 'ወደ ተሳፋሪው · to pickup', btn: 'ተነሳሁ · On my way', next: 'arriving' },
    arriving: { pill: 'በመንገድ ላይ · on the way', btn: 'ደረስኩ · I have arrived', next: 'arrived' },
    arrived: { pill: 'ተሳፋሪው ጋር · at pickup', btn: 'ጉዞ ጀምር · Start the trip', next: 'ontrip' },
    ontrip: { pill: 'በጉዞ ላይ · on trip', btn: 'ጉዞ ጨርስ · Complete', next: 'completed' },
  };
  function paintTrip() {
    var j = st.job; if (!j) return;
    var s = STAGE[j.status] || STAGE.assigned;
    $('tstage').textContent = s.pill;
    $('tnext').textContent = s.btn;
    $('tnext').dataset.next = s.next;
    $('tname').textContent = j.riderName || 'Passenger';
    $('tphone').textContent = j.riderPhone || '';
    $('tav').textContent = (j.riderName || 'P').trim().charAt(0).toUpperCase();
    $('tcall').href = 'tel:' + (j.riderPhone || '');
    $('tpay').textContent = String(j.paymentMethod || 'cash').toUpperCase();
    $('tpick').textContent = (j.pickup && j.pickup.label) || '—';
    $('tdrop').textContent = (j.dropoff && j.dropoff.label) || '—';
    $('tfare').textContent = j.driverTakeEtb + ' ETB to you · ' + km(j.distanceM) + ' · ' + mins(j.durationS);
    var target = j.status === 'ontrip' ? j.dropoff : j.pickup;
    $('tnav').href = 'https://www.google.com/maps/dir/?api=1&destination=' + target.lat + ',' + target.lng + '&travelmode=driving';
    $('tgo').textContent = j.status === 'ontrip' ? '🧭 አቅጣጫ ወደ መድረሻ · Navigate' : '🧭 አቅጣጫ ወደ ተሳፋሪው · Navigate';
    paintLegLine();
    if (j.bookedBy && j.bookedBy.name) {
      $('tbooked').textContent = '📞 Booked by ' + j.bookedBy.name + (j.bookedBy.phone ? ' · ' + j.bookedBy.phone : '') + ' (not the passenger)';
      $('tbooked').classList.remove('hidden');
    } else { $('tbooked').classList.add('hidden'); }
    if (st.nav) { paintNavHud(); drawLeg(); return; } // nav mode owns the screen
    show('trip');
    drawLeg();
  }
  // A driver is not staring at the screen. Repeat the alert until the card is answered or expires.
  function startAlert() {
    stopAlert();
    window.DNav.chime('offer');
    window.DNav.buzz([220, 110, 220, 110, 340]);
    st.alertTimer = setInterval(function () {
      if (!st.offer) { stopAlert(); return; }
      window.DNav.chime('offer');
      window.DNav.buzz([200, 100, 200]);
    }, 3500);
  }
  function stopAlert() { if (st.alertTimer) { clearInterval(st.alertTimer); st.alertTimer = 0; } }

  function paintOffer(o) {
    $('otier').textContent = String(o.tier || '').toUpperCase();
    $('oaway').textContent = mins(o.etaS) + ' away · ' + km(o.distanceM);
    $('opick').textContent = (o.pickup && o.pickup.label) || '—';
    $('odrop').textContent = (o.dropoff && o.dropoff.label) || '—';
    $('oearn').textContent = o.driverTakeEtb + ' ETB';
    $('otrip').textContent = km(o.tripDistanceM) + ' · ' + mins(o.tripDurationS) + ' trip';
    $('oacc').dataset.ride = o.rideId;
    $('oskip').dataset.ride = o.rideId;
    show('offer');
    haptic('warning');
    startAlert();
    tickRing();
  }
  function tickRing() {
    var left = Math.max(0, Math.round((st.offerEndsAt - Date.now()) / 1000));
    var total = st.offerTotal || OFFER_WINDOW_S;
    $('ocount').textContent = left;
    $('oarc').style.strokeDashoffset = String(RING * (1 - Math.min(1, left / total)));
    if (!st.offer) return;
    if (left <= 0) { st.offer = null; render(); return; }
    setTimeout(tickRing, 400);
  }
  // The turn banner. Amharic is the instruction; English is the subtitle.
  function paintNav() {
    var box = $('nav');
    if (!st.job || !st.pos || !window.DNav.ready()) { box.classList.add('hidden'); return; }
    var nav = window.DNav.update(st.pos);
    if (!nav) { box.classList.add('hidden'); return; }
    if (nav.offRoute) {
      // Do not show a stale instruction: say so and let drawLeg() fetch a fresh plan.
      $('navIc').textContent = '↻';
      $('navAm').textContent = 'መንገዱን ለቀዋል — አዲስ መንገድ እየተፈለገ ነው';
      $('navEn').textContent = 'Off route (' + nav.offBy + ' m) — recalculating';
      $('navRem').textContent = '';
      box.className = 'dnav off';
      st.routeFor = '';
      return;
    }
    $('navIc').textContent = nav.icon;
    $('navAm').textContent = nav.amharic;
    $('navEn').textContent = nav.english;
    $('navRem').textContent = nav.remainingM != null ? km(nav.remainingM) : '';
    box.className = 'dnav' + (nav.metresToTurn < 40 ? ' now' : '');

    // Speak each manoeuvre twice at most: once on approach, once at the turn.
    var phase = nav.metresToTurn < 40 ? 'at' : (nav.metresToTurn < 220 ? 'near' : '');
    var key = nav.stepIndex + ':' + phase;
    if (phase && st.saidNear !== key) {
      st.saidNear = key;
      window.DNav.chime(nav.arrived ? 'arrive' : 'turn');
      window.DNav.say(nav.spokenAm || nav.amharic);
    }
  }

  // ---------- in-app navigation ----------
  function enterNav() {
    if (!st.job) return;
    st.nav = true; st.freeCam = 0;
    document.body.classList.add('navmode');
    $('navhud').classList.remove('hidden');
    window.DNav.unlock();
    watchPan();
    st.routeFor = ''; // force a fresh plan for the leg we are about to drive
    if (st.pos) { drawLeg(); navCamera(st.pos); }
    var who = (st.job.riderName || '').split(' ')[0];
    window.DNav.say(st.job.status === 'ontrip' ? 'ወደ መድረሻው ይሂዱ' : 'ወደ ተሳፋሪው ' + who + ' ይሂዱ');
    paintNavHud();
  }
  function exitNav() {
    st.nav = false;
    document.body.classList.remove('navmode');
    $('navhud').classList.add('hidden');
    if (map) map.easeTo({ pitch: 0, bearing: 0, zoom: 15, duration: 700 });
    render();
  }
  function paintNavHud() {
    if (!st.nav || !st.job) return;
    var s = STAGE[st.job.status] || STAGE.assigned;
    $('nhAct').textContent = s.btn;
    $('nhAct').dataset.next = s.next;
    var nav = (st.pos && window.DNav.ready()) ? window.DNav.update(st.pos) : null;
    var onTrip = st.job.status === 'ontrip';
    var target = onTrip ? st.job.dropoff : st.job.pickup;
    var rem = (nav && !nav.offRoute) ? nav.remainingM
      : (st.pos ? Math.round(metres(st.pos, target) * 1.35) : null);
    var secs = rem != null ? Math.round(rem / 6.1) : null;
    $('nhRem').textContent = rem != null ? km(rem) : '—';
    $('nhEta').textContent = (secs != null ? Math.max(1, Math.round(secs / 60)) + ' ደቂቃ · min' : 'ጂፒኤስ · GPS')
      + ' → ' + (onTrip ? 'መድረሻ' : (st.job.riderName || 'ተሳፋሪ').split(' ')[0]);
  }

  function paintIdle() {
    var d = st.driver;
    $('iname').textContent = d.name;
    $('ivehicle').textContent = String(d.tier || '').toUpperCase() + ' · ' + d.plate;
    var on = d.online && !d.away;
    $('idle').classList.toggle('online', on);
    $('istate').textContent = on
      ? '🟢 Online. Keep this screen open — offers arrive here and in Telegram.'
      : (d.away ? '⚪ You went quiet, so offers stopped. Tap GO to come back.' : '⚪ You are offline.');
    $('igo').textContent = on ? 'GO OFFLINE · አቁም' : 'GO ONLINE · ስራ ጀምር';
    $('igo').className = 'dbtn big ' + (on ? 'ghost' : 'go');
    show('idle');
  }
  function gate(title, body, ctaText, ctaHref) {
    $('gtitle').textContent = title;
    $('gbody').textContent = body;
    $('gcta').textContent = ctaText;
    $('gcta').href = ctaHref;
    $('gcta').classList.toggle('hidden', !ctaText);
    show('gate');
  }
  function render() {
    if (!st.driver) return;
    paintStats();
    if (st.job) return paintTrip();
    if (st.offer) return paintOffer(st.offer);
    stopAlert(); $('nav').classList.add('hidden');
    if (st.nav) { st.nav = false; document.body.classList.remove('navmode'); $('navhud').classList.add('hidden'); }
    window.BinaMap.clearRoute(); window.BinaMap.setDrop(null); clearTargets();
    st.routeFor = ''; st.routeFrom = null; st.fitted = ''; st.legRoadM = null; st.legRoadS = null;
    paintIdle();
  }

  // ---------- server sync ----------
  function absorb(j) {
    if (j.driver) st.driver = j.driver;
    var wasJob = st.job && st.job.id, wasStatus = st.job && st.job.status;
    st.job = j.job || null;
    if (st.job && (st.job.id !== wasJob || st.job.status !== wasStatus)) st.routeFor = '';
    var next = (j.offers && j.offers.length) ? j.offers[0] : null;
    if (next && (!st.offer || st.offer.rideId !== next.rideId)) {
      st.offer = next;
      // The server owns both the window and how much of it is left.
      st.offerTotal = next.windowS || OFFER_WINDOW_S;
      st.offerEndsAt = Date.now() + (next.expiresInS != null ? next.expiresInS : st.offerTotal) * 1000;
    } else if (!next) { st.offer = null; }
    render();
  }
  function ping() {
    if (!st.driver || st.driver.status !== 'approved' || !st.driver.online) return;
    var body = st.pos ? { lat: st.pos.lat, lng: st.pos.lng, bearing: st.pos.bearing, speedKph: st.pos.speedKph, accuracy: st.pos.accuracy } : {};
    post('/api/drive/ping', body).then(function (j) {
      if (j._status === 403) return boot();
      if (!j.ok) return;
      st.lastPingOk = Date.now();
      absorb(j);
    }).catch(function () {
      if (Date.now() - st.lastPingOk > 20000) banner('📡 No connection. Trying again… · ኢንተርኔት አልተገኘም።');
    });
  }

  // ---------- actions ----------
  function act(el, fn) {
    if (st.busy) return;
    st.busy = true; el.disabled = true;
    fn().then(function () {}).catch(function () {}).then(function () { st.busy = false; el.disabled = false; });
  }
  $('oacc').addEventListener('click', function () {
    var id = this.dataset.ride, self = this;
    act(self, function () {
      return post('/api/drive/offer/' + id + '/accept').then(function (j) {
        if (j.ok) { haptic('success'); stopAlert(); window.DNav.chime('accepted'); st.offer = null; st.legSpoken = ''; absorb(j); return; }
        haptic('error');
        stopAlert(); window.DNav.chime('warn');
        banner(j.error === 'taken' ? '😔 Another driver got that one.' : j.error === 'no_offer' ? '⌛ That offer expired.' : '⚠️ ' + j.error);
        st.offer = null; render();
      });
    });
  });
  $('oskip').addEventListener('click', function () {
    var id = this.dataset.ride, self = this;
    act(self, function () {
      return post('/api/drive/offer/' + id + '/decline').then(function () { stopAlert(); st.offer = null; render(); });
    });
  });
  $('tnext').addEventListener('click', function () {
    var self = this, next = self.dataset.next, id = st.job && st.job.id;
    if (!id || !next) return;
    if (next === 'completed') {
      // Telegram's own dialog on a phone, the browser's when testing outside it.
      return window.TG.confirm('Complete this trip and collect ' + st.job.fareEtb + ' ETB in ' + String(st.job.paymentMethod || 'cash') + '?', function (yes) { if (yes) send(self, id, next); });
    }
    send(self, id, next);
  });
  function send(self, id, next) {
    act(self, function () {
      return post('/api/drive/ride/' + id + '/status', { status: next }).then(function (j) {
        if (!j.ok) { banner('⚠️ ' + (j.error || 'could not update')); return ping(); }
        haptic('success');
        if (next === 'completed') {
          window.DNav.chime('done');
          window.DNav.say('ጉዞው ተጠናቋል። አመሰግናለን።');
          st.job = null; st.driver = j.driver; st.legSpoken = '';
          banner('✅ Trip complete · ' + (j.driver.earningsTodayEtb || 0) + ' ETB today', true);
          render();
        } else { st.job = j.job; st.driver = j.driver; st.routeFor = ''; st.legSpoken = ''; render(); paintNavHud(); }
      });
    });
  }
  $('igo').addEventListener('click', function () {
    var self = this, want = !(st.driver.online && !st.driver.away);
    act(self, function () {
      return post('/api/drive/online', { online: want }).then(function (j) {
        if (!j.ok) { banner('⚠️ ' + (j.error === 'finish_your_ride_first' ? 'Finish your current trip first.' : j.error)); return; }
        st.driver = j.driver;
        wakeLock(want);
        if (want) { startGps(); banner('🟢 You are online. Offers will appear here.', true); ping(); }
        else { wakeLock(false); banner('⚪ Offline. Have a good rest.', true); }
        render();
      });
    });
  });
  function paintMute() {
    var m = window.DNav.isMuted();
    $('mute').textContent = m ? '🔇' : '🔔';
    $('mute').classList.toggle('off', m);
  }
  $('mute').addEventListener('click', function () {
    window.DNav.unlock();
    var m = window.DNav.setMuted(!window.DNav.isMuted());
    paintMute();
    if (!m) { window.DNav.chime('turn'); banner('🔔 ድምጽ በርቷል · sound on', true); }
    else banner('🔇 ድምጽ ጠፍቷል · sound off', true);
  });
  paintMute();
  $('tgo').addEventListener('click', enterNav);
  $('nhExit').addEventListener('click', exitNav);
  // The ladder button is duplicated in the HUD so a driver never leaves navigation to advance a trip.
  $('nhAct').addEventListener('click', function () {
    var self = this, next = self.dataset.next, id = st.job && st.job.id;
    if (!id || !next) return;
    if (next === 'completed') {
      return window.TG.confirm('ጉዞውን ጨርሰው ' + st.job.fareEtb + ' ብር ይሰብስቡ? · Complete and collect ' + st.job.fareEtb + ' ETB?',
        function (yes) { if (yes) send(self, id, next); });
    }
    send(self, id, next);
  });
  $('recenter').addEventListener('click', function () {
    st.freeCam = 0;
    if (st.nav) navCamera(st.pos); else follow(st.pos);
  });
  $('tcancel').addEventListener('click', function () { window.open('https://t.me/binasmartdriverbot', '_blank'); });

  // ---------- boot ----------
  function boot() {
    // The city map goes up first in every state. A blank black rectangle reads as a broken app.
    ensureMap();
    if (!initData) {
      return inTelegram
        ? gate('Reopen from the bot', 'Telegram opened this page without signing you in. Go back to @binasmartdriverbot and tap the "Open the driver app" button in a message rather than a plain link.\nከቦቱ ውስጥ ያለውን አዝራር ተጭነው ይክፈቱ።', 'Open @binasmartdriverbot', 'https://t.me/binasmartdriverbot')
        : gate('Open this in Telegram', 'The driver app runs inside @binasmartdriverbot so we know it is really you. Open the bot and tap the button.\nመተግበሪያው በቴሌግራም ውስጥ ይሰራል።', 'Open @binasmartdriverbot', 'https://t.me/binasmartdriverbot');
    }
    post('/api/drive/session').then(function (j) {
      if (j._status === 404) {
        return gate('Register first · ይመዝገቡ', 'You are not a BinaSmart driver yet. Registration takes two minutes, is free, and commission is 0% during our launch.\nምዝገባው ነጻ ነው።', 'Register in Telegram', 'https://t.me/binasmartdriverbot');
      }
      if (j._status === 401) {
        return gate('Please reopen the app', 'Your Telegram session expired. Close this window and open the driver app again from the bot.', 'Open @binasmartdriverbot', 'https://t.me/binasmartdriverbot');
      }
      if (!j.ok && !j.driver) return gate('Something went wrong', 'Please close and reopen the app. If it keeps happening, message us in the bot.', 'Open @binasmartdriverbot', 'https://t.me/binasmartdriverbot');
      st.driver = j.driver || (j.ok ? j.driver : null);
      if (st.driver && st.driver.status !== 'approved') {
        paintStats();
        return gate(
          st.driver.status === 'suspended' ? 'Account paused' : 'Waiting for approval · በመጠባበቅ ላይ',
          st.driver.status === 'suspended'
            ? 'Your driver account is paused. Message us in the bot and we will sort it out.'
            : 'Thank you for registering, ' + st.driver.name + '. We are checking your licence and car photo. We will message you in Telegram the moment you are approved — usually within 24 hours.\nፈቃድዎን እያረጋገጥን ነው። ሲጸድቅ በቴሌግራም እናሳውቅዎታለን።',
          'Open @binasmartdriverbot', 'https://t.me/binasmartdriverbot');
      }
      ensureMap();
      absorb(j);
      if (st.driver.online) { startGps(); wakeLock(true); }
    }).catch(function () {
      gate('No connection', 'We could not reach BinaSmart. Check your internet and reopen the app.', 'Retry', location.href);
    });
  }

  setInterval(ping, PING_MS);
  // A backgrounded Mini App stops timers; catch up the moment it comes back.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ping(); });
  boot();
})();
