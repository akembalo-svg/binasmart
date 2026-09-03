/* BinaSmart Driver app. One state machine, one timer, one map.
   Everything the app knows comes from POST /api/drive/ping, which carries the position up and the
   offers plus the current trip down. Auth is Telegram initData from @binasmartdriverbot, so the app
   only works inside that bot. */
(function () {
  'use strict';

  var PING_MS = 4000, OFFER_WINDOW_S = 25, RING = 119.4;
  var $ = function (id) { return document.getElementById(id); };
  // TG.initData is a function in the shim, and it returns null outside Telegram.
  var initData = (window.TG && window.TG.initData && window.TG.initData()) || '';
  // The shim paints the rider app's green; the cockpit is night-dark.
  try { window.Telegram.WebApp.setHeaderColor('#0b1220'); window.Telegram.WebApp.setBackgroundColor('#0b1220'); } catch (e) {}
  var st = {
    driver: null, job: null, offer: null, offerEndsAt: 0,
    pos: null, gpsOk: false, lastPingOk: 0, busy: false, lock: null, routeFor: '',
  };
  var carMk = null, map = null;

  // ---------- plumbing ----------
  function post(path, body) {
    return fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ initData: initData }, body || {})),
    }).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
  }
  function banner(text, ok) {
    var b = $('banner');
    if (!text) { b.classList.add('hidden'); return; }
    b.textContent = text; b.className = 'dbanner' + (ok ? ' ok' : '');
    if (ok) setTimeout(function () { b.classList.add('hidden'); }, 2600);
  }
  function show(which) {
    ['offer', 'trip', 'idle', 'gate'].forEach(function (id) { $(id).classList.toggle('hidden', id !== which); });
  }
  function km(m) { return m == null ? '—' : (Math.round(m / 100) / 10) + ' km'; }
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

  // Ask the server for road geometry once per leg, not on every ping.
  function drawLeg() {
    if (!st.job || !st.pos) return;
    var leg = st.job.status === 'ontrip' ? 'dropoff' : 'pickup';
    var key = st.job.id + ':' + leg;
    if (st.routeFor === key) return;
    st.routeFor = key;
    post('/api/drive/route', { lat: st.pos.lat, lng: st.pos.lng, to: leg }).then(function (j) {
      if (!j.ok) return;
      var target = leg === 'dropoff' ? st.job.dropoff : st.job.pickup;
      window.BinaMap.setDrop(target);
      if (j.geometry && j.geometry.length > 1) window.BinaMap.drawRoute(j.geometry, 380);
    }).catch(function () { st.routeFor = ''; });
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
    assigned: { pill: 'Go to pickup', btn: "I'm on my way", next: 'arriving' },
    arriving: { pill: 'On the way', btn: 'I have arrived', next: 'arrived' },
    arrived: { pill: 'At pickup', btn: 'Start the trip', next: 'ontrip' },
    ontrip: { pill: 'On trip', btn: 'Complete the trip', next: 'completed' },
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
    $('tetaP').textContent = j.status === 'ontrip' ? 'Drop the passenger here' : 'Collect the passenger here';
    $('tnav').href = 'https://www.google.com/maps/dir/?api=1&destination=' + target.lat + ',' + target.lng + '&travelmode=driving';
    if (j.bookedBy && j.bookedBy.name) {
      $('tbooked').textContent = '📞 Booked by ' + j.bookedBy.name + (j.bookedBy.phone ? ' · ' + j.bookedBy.phone : '') + ' (not the passenger)';
      $('tbooked').classList.remove('hidden');
    } else { $('tbooked').classList.add('hidden'); }
    show('trip');
    drawLeg();
  }
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
    tickRing();
  }
  function tickRing() {
    var left = Math.max(0, Math.round((st.offerEndsAt - Date.now()) / 1000));
    $('ocount').textContent = left;
    $('oarc').style.strokeDashoffset = String(RING * (1 - left / OFFER_WINDOW_S));
    if (!st.offer) return;
    if (left <= 0) { st.offer = null; render(); return; }
    setTimeout(tickRing, 400);
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
    window.BinaMap.clearRoute(); window.BinaMap.setDrop(null); st.routeFor = '';
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
      st.offerEndsAt = Date.now() + (next.expiresInS != null ? next.expiresInS : OFFER_WINDOW_S) * 1000;
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
        if (j.ok) { haptic('success'); st.offer = null; absorb(j); return; }
        haptic('error');
        banner(j.error === 'taken' ? '😔 Another driver got that one.' : j.error === 'no_offer' ? '⌛ That offer expired.' : '⚠️ ' + j.error);
        st.offer = null; render();
      });
    });
  });
  $('oskip').addEventListener('click', function () {
    var id = this.dataset.ride, self = this;
    act(self, function () {
      return post('/api/drive/offer/' + id + '/decline').then(function () { st.offer = null; render(); });
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
          st.job = null; st.driver = j.driver;
          banner('✅ Trip complete · ' + (j.driver.earningsTodayEtb || 0) + ' ETB today', true);
          render();
        } else { st.job = j.job; st.driver = j.driver; render(); }
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
  $('recenter').addEventListener('click', function () { follow(st.pos); });
  $('tcancel').addEventListener('click', function () { window.open('https://t.me/binasmartdriverbot', '_blank'); });

  // ---------- boot ----------
  function boot() {
    // The city map goes up first in every state. A blank black rectangle reads as a broken app.
    ensureMap();
    if (!initData) {
      return gate('Open this in Telegram', 'The driver app runs inside @binasmartdriverbot so we know it is really you. Open the bot and tap the button.\nመተግበሪያው በቴሌግራም ውስጥ ይሰራል።', 'Open @binasmartdriverbot', 'https://t.me/binasmartdriverbot');
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
