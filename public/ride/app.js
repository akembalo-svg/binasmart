/* BinaSmart Ride — rider app. Screens: home → search → quote → (who) → finding → assigned → done. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = { pickup: null, dropoff: null, quote: null, tier: 'economy', ride: null, poll: null, searchTarget: 'dropoff', pinMode: false };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  var ME = null; try { ME = JSON.parse(lsGet('bina_ride_me') || 'null'); } catch (e) { ME = null; }
  // Telegram Mini App mode (window.TG from tg.js). Outside Telegram every TG call is a no-op.
  var TG = window.TG || null, IN_TG = !!(TG && TG.isTelegram());
  if (IN_TG) document.body.classList.add('tg');
  $('forOther').addEventListener('change', function () { $('passenger').classList.toggle('hidden', !this.checked); });
  function passengerBody() {
    if (!$('forOther').checked) return null;
    var n = $('pName').value.trim(), p = $('pPhone').value.replace(/\s/g, '');
    if (n.length < 2 || !/^(\+?251|0)9\d{8}$/.test(p)) { toast('የተሳፋሪ ስም እና ስልክ ያስገቡ · Enter the passenger name and Ethiopian phone'); return false; }
    return { name: n, phone: p };
  }

  function show(id) { document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); }); $(id).classList.remove('hidden'); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.add('hidden'); }, 2600); }
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then(function (r) { return r.json(); });
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function label(p) { return p ? p.label : ''; }

  // ---- map + location ----
  BinaMap.init('map', function () {
    $('btn3d').classList.toggle('off', !BinaMap.is3D());
    locate();
  });
  $('btn3d').addEventListener('click', function () { var on = !BinaMap.is3D(); BinaMap.set3D(on); $('btn3d').classList.toggle('off', !on); });

  // A rider who denies the location prompt (or never answers it) must still be able to book:
  // some browsers call NEITHER callback in that case, so a hard timer guarantees a pickup exists.
  var DEFAULT_PICKUP = { lat: 9.0108, lng: 38.7578, label: 'Bole, Addis Ababa (tap Change)' };
  function locate() {
    var settled = false;
    function settle(p) { if (settled) return; settled = true; setPickup(p); }
    if (!navigator.geolocation) return settle(DEFAULT_PICKUP);
    setTimeout(function () { settle(DEFAULT_PICKUP); }, 9000);
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (settled) return;
      var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'የእርስዎ ቦታ · Your location' };
      if (p.lat < 8.5 || p.lat > 9.5 || p.lng < 38.4 || p.lng > 39.2) { toast('BinaSmart Ride is Addis Ababa only for now'); p = DEFAULT_PICKUP; }
      settle(p); BinaMap.flyTo(p, 15.5);
    }, function () { settle(DEFAULT_PICKUP); }, { enableHighAccuracy: true, timeout: 8000 });
  }
  function setPickup(p) { S.pickup = p; BinaMap.setPickup(p); $('fromLabel').textContent = p.label; }

  BinaMap.onClick(function (p) {
    if (!S.pinMode) return;
    p.label = p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
    choose(p);
  });

  // ---- search ----
  $('openSearch').addEventListener('click', function () { S.searchTarget = 'dropoff'; openSearch(); });
  $('editFrom').addEventListener('click', function () { S.searchTarget = 'pickup'; openSearch(); });
  $('closeSearch').addEventListener('click', function () { S.pinMode = false; show('s-home'); });
  $('pinMode').addEventListener('click', function () { S.pinMode = true; toast(S.searchTarget === 'pickup' ? 'Tap the map to set pickup' : 'Tap the map to set destination'); });
  function openSearch() {
    $('searchMode').firstChild.textContent = (S.searchTarget === 'pickup' ? 'Searching pickup' : 'Searching destination') + ' · ';
    $('q').value = ''; $('results').innerHTML = ''; show('s-search'); setTimeout(function () { $('q').focus(); }, 60);
  }
  var st;
  $('q').addEventListener('input', function () {
    clearTimeout(st); var q = $('q').value.trim(); if (q.length < 2) { $('results').innerHTML = ''; return; }
    st = setTimeout(function () {
      var b = S.pickup ? '&lat=' + S.pickup.lat + '&lng=' + S.pickup.lng : '';
      api('/api/ride/search?q=' + encodeURIComponent(q) + b).then(function (d) {
        var icons = { building: '🏢', shop: '🛍️', osm: '📍' };
        $('results').innerHTML = (d.results || []).map(function (r, i) {
          return '<li data-i="' + i + '"><div class="ic">' + icons[r.kind] + '</div><div><b>' + esc(r.label) + (r.labelAm ? '<span class="am">' + esc(r.labelAm) + '</span>' : '') + '</b><span>' + esc(r.sub) + '</span></div></li>';
        }).join('') || '<li><span>ምንም አልተገኘም · Nothing found — try another name or tap the map</span></li>';
        $('results').querySelectorAll('li[data-i]').forEach(function (li) { li.addEventListener('click', function () { choose(d.results[+li.dataset.i]); }); });
      });
    }, 220);
  });
  function choose(p) {
    S.pinMode = false;
    if (S.searchTarget === 'pickup') { setPickup({ lat: p.lat, lng: p.lng, label: p.label }); if (S.dropoff) return quote(); show('s-home'); return; }
    S.dropoff = { lat: p.lat, lng: p.lng, label: p.label }; BinaMap.setDrop(S.dropoff); quote();
  }

  // ---- quote ----
  function quote() {
    if (!S.dropoff) return;
    if (!S.pickup) { setPickup(DEFAULT_PICKUP); toast('የመነሻ ቦታ ተቀምጧል · Pickup set to Bole — tap Change to move it'); }
    var seq = (S.qSeq = (S.qSeq || 0) + 1);
    show('s-quote'); $('qFrom').textContent = label(S.pickup); $('qTo').textContent = label(S.dropoff); $('tiers').innerHTML = '<div class="small">ዋጋ እያሰላን ነው… · Calculating…</div>';
    api('/api/ride/quote', { pickup: S.pickup, dropoff: S.dropoff }).then(function (d) {
      if (seq !== S.qSeq) return;
      if (!d.ok) { toast(d.error || 'Could not quote'); return show('s-home'); }
      S.quote = d;
      $('qMeta').textContent = (d.distanceM / 1000).toFixed(1) + ' km · ~' + Math.round(d.durationS / 60) + ' min' + (d.estimate ? ' · estimate' : '');
      $('tiers').innerHTML = d.quotes.map(function (q) {
        return '<div class="tier' + (q.tier === S.tier ? ' sel' : '') + '" data-t="' + q.tier + '"><div class="ic">' + esc(q.icon) + '</div><div><b>' + esc(q.label) + ' · ' + esc(q.labelAm) + '</b><div class="sub">' + q.seats + ' seats · ~' + q.etaMin + ' min</div></div><div class="price">' + q.fareEtb + ' ETB</div></div>';
      }).join('');
      $('tiers').querySelectorAll('.tier').forEach(function (el) { el.addEventListener('click', function () { S.tier = el.dataset.t; $('tiers').querySelectorAll('.tier').forEach(function (x) { x.classList.toggle('sel', x === el); }); setCta(); }); });
      setCta();
      if (IN_TG) TG.back(function () { $('cancelQuote').click(); });
      // Pitched fitBounds ignores most of the bottom padding anyway (liftAboveSheet does the real work),
      // so keep the pad modest — an oversized pad only buys a zoomed-out smudge of a route.
      // Guard the geometry: without a polyline drawRoute is meaningless AND liftAboveSheet's pass-0
      // once('moveend') would stay attached and fire on the user's next pan.
      if (d.geometry && d.geometry.length > 1) {
        // Clamp the pad so top+bottom can never swallow the canvas: MapLibre silently skips the fit
        // when padding leaves no room (seen on short/landscape viewports), stranding the route off-screen.
        var pad = Math.min($('sheet').offsetHeight, Math.round(innerHeight * 0.58), Math.max(60, innerHeight - 90 - 120));
        BinaMap.drawRoute(d.geometry, pad);
        liftAboveSheet();
      }
    }).catch(function () { if (seq !== S.qSeq) return; toast('Network error — try again'); show('s-home'); });
  }
  // MapLibre resolves fitBounds padding in the FLAT projection and applies pitch afterwards, so on a
  // pitched camera the fitted content still settles lower than asked and slides behind the sheet
  // (measured: -49px at pitch 55 vs +59px at pitch 0, same zoom and padding). Correct it by measuring
  // where the markers actually landed once the fit settles, then panning up by the shortfall.
  // A pitched panBy under-corrects (screen pixels compress toward the horizon), so re-measure and
  // repeat, bounded to 5 passes so it always terminates (still well under 2 s).
  function liftAboveSheet(pass) {
    var m = BinaMap.map; if (!m) return;
    m.once('moveend', function () {
      var limit = $('sheet').getBoundingClientRect().top - 28, low = -Infinity;
      document.querySelectorAll('.bm-mk').forEach(function (el) { low = Math.max(low, el.getBoundingClientRect().bottom); });
      if (low <= limit) return;
      if ((pass || 0) < 4) liftAboveSheet((pass || 0) + 1);   // register before panning, to catch its moveend
      m.panBy([0, low - limit], { duration: 300 });
    });
  }
  function selQuote() { return (S.quote && S.quote.quotes.find(function (q) { return q.tier === S.tier; })) || null; }
  function setCta() { var q = selQuote(); $('ctaFare').textContent = q ? '· ' + q.fareEtb + ' ETB' : ''; if (IN_TG) TG.main('ጉዞ ይጠይቁ · Confirm ride' + (q ? ' · ' + q.fareEtb + ' ETB' : ''), function () { $('request').click(); }); }
  $('cancelQuote').addEventListener('click', function () { S.dropoff = null; BinaMap.setDrop(null); BinaMap.clearRoute(); if (IN_TG) { TG.mainHide(); TG.backHide(); } show('s-home'); });

  // ---- identity + request ----
  $('request').addEventListener('click', function () {
    var pb = passengerBody(); if (pb === false) return;
    if (ME) return request(pb);
    if (IN_TG) {
      TG.requestContact(function (ok) {
        var u = TG.user() || {};
        var nm = [u.first_name, u.last_name].filter(Boolean).join(' ');
        if (ok) { ME = { name: nm || 'Telegram user', phone: null, tg: true }; lsSet('bina_ride_me', JSON.stringify(ME)); request(pb); }
        else { if (nm) $('whoName').value = nm; show('s-who'); }
      });
      return;
    }
    show('s-who');
  });
  $('whoGo').addEventListener('click', function () {
    var name = $('whoName').value.trim(), phone = $('whoPhone').value.trim();
    if (name.length < 2 || !/^(\+?251|0)9\d{8}$/.test(phone.replace(/\s/g, ''))) return toast('ስም እና ትክክለኛ ስልክ ያስገቡ · Enter your name and a valid phone');
    ME = { name: name, phone: phone }; lsSet('bina_ride_me', JSON.stringify(ME)); request(passengerBody() || null);
  });
  function request(pb) {
    var q = selQuote(); if (!q) return;
    var pay = (document.querySelector('input[name=pay]:checked') || {}).value || 'cash';
    $('request').disabled = true; if (IN_TG) TG.main('…', function () {});
    var body = { idemKey: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), tier: S.tier, pickup: S.pickup, dropoff: S.dropoff, paymentMethod: pay, riderName: ME.name, riderPhone: ME.phone || undefined };
    if (pb) body.passenger = pb;
    if (IN_TG) body.tg = { initData: TG.initData(), contact: TG.contact() || undefined };
    api('/api/ride/request', body)
      .then(function (d) {
        $('request').disabled = false;
        if (!d.ok) { if (IN_TG) setCta(); return toast(d.error || 'Could not request'); }
        if (d.phone) { ME.phone = d.phone; lsSet('bina_ride_me', JSON.stringify(ME)); }
        S.ride = d.ride; lsSet('bina_ride_active', d.ride.id); show('s-finding'); startPoll();
        if (IN_TG) { TG.backHide(); TG.main('ሰርዝ · Cancel ride', cancel); TG.haptic(); }
      }).catch(function () { $('request').disabled = false; if (IN_TG) setCta(); toast('Network error — try again'); });
  }

  // ---- live status (poll every 4 s) ----
  function startPoll() { stopPoll(); tick(); S.poll = setInterval(tick, 4000); }
  function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = null; }
  document.addEventListener('visibilitychange', function () { if (!S.ride) return; if (document.hidden) stopPoll(); else if (!['completed', 'cancelled'].includes(S.ride.status)) startPoll(); });
  function tick() {
    if (!S.ride) return;
    api('/api/ride/' + S.ride.id + '?phone=' + encodeURIComponent(ME.phone)).then(function (d) { if (d.ok) render(d.ride); }).catch(function () {});
  }
  function render(r) {
    S.ride = r;
    if (IN_TG) { if (['requested', 'dispatching', 'assigned', 'arriving', 'arrived'].indexOf(r.status) >= 0) TG.main('ሰርዝ · Cancel ride', cancel); else TG.mainHide(); }
    if (r.status === 'dispatching' || r.status === 'requested') {
      show('s-finding');
      $('findTitle').innerHTML = r.concierge ? 'ሹፌር እየመደብንልዎ ነው <small>A dispatcher is assigning your driver</small>' : 'ሹፌር እየፈለግን ነው… <small>Finding your driver…</small>';
      $('findSub').textContent = r.concierge ? 'እባክዎ ይጠብቁ — ወዲያውኑ እናሳውቅዎታለን · Please hold, we\'ll confirm shortly.' : 'Usually under a minute.';
    } else if (['assigned', 'arriving', 'arrived', 'ontrip'].includes(r.status)) {
      show('s-assigned');
      var d = r.driver || {};
      $('aStatus').textContent = { assigned: 'ሹፌር ተመድቧል · Driver assigned', arriving: 'ሹፌርዎ እየመጣ ነው · Driver on the way', arrived: 'ሹፌርዎ ደርሷል · Driver has arrived', ontrip: 'በጉዞ ላይ · On trip' }[r.status];
      $('dName').textContent = d.name || ''; $('dCar').textContent = [d.vehicle, r.tier].filter(Boolean).join(' · '); $('dRating').textContent = d.rating ? '★ ' + Number(d.rating).toFixed(1) : '';
      $('dPlate').textContent = d.plate || ''; $('dPhoto').innerHTML = d.photo ? '<img src="' + esc(d.photo) + '" alt="">' : '🚗';
      var cc = $('carCard');
      if (d.carPhoto) {
        if ($('carImg').getAttribute('src') !== d.carPhoto) $('carImg').src = d.carPhoto;
        $('carPlate').textContent = d.plate || '';
        $('carMeta').textContent = [d.vehicle, d.name].filter(Boolean).join(' · ');
        cc.classList.remove('hidden');
      } else { cc.classList.add('hidden'); }
      $('dCall').href = d.phone ? 'tel:' + d.phone : '#'; $('dWa').href = d.phone ? 'https://wa.me/' + String(d.phone).replace(/\D/g, '') : '#';
      $('aFare').textContent = r.fareEtb + ' ETB'; $('aPay').textContent = '· ' + (r.paymentMethod === 'cash' ? 'cash' : 'telebirr/Chapa');
      $('cancelAssigned').classList.toggle('hidden', r.status === 'ontrip');
    } else if (r.status === 'completed') {
      stopPoll(); lsDel('bina_ride_active'); show('s-done');
      $('doneFare').textContent = r.fareEtb + ' ETB';
      $('payBox').innerHTML = r.paymentStatus === 'paid' ? '<div class="small">✅ ተከፍሏል · Paid</div>'
        : (r.paymentMethod === 'cash' ? '<div class="small">💵 ለሹፌሩ በጥሬ ገንዘብ ይክፈሉ · Pay the driver in cash</div>'
        : '<button class="cta" id="payNow">📱 Pay ' + r.fareEtb + ' ETB · telebirr / Chapa</button>');
      var pn = $('payNow'); if (pn) pn.addEventListener('click', payNow);
      if (r.driverRating) markStars(r.driverRating);
    } else if (r.status === 'cancelled') { stopPoll(); lsDel('bina_ride_active'); show('s-cancelled'); }
  }
  function payNow() {
    api('/api/pay/init', { amount: S.ride.fareEtb, name: ME.name, phone: ME.phone, purpose: 'BinaSmart Ride ' + S.ride.id, bt: 'ride', bc: S.ride.id })
      .then(function (d) { if (d.ok && d.checkout_url) location.href = d.checkout_url; else toast(d.error || 'Payment unavailable — pay cash'); })
      .catch(function () { toast('Payment unavailable — pay cash'); });
  }

  // ---- cancel / rate / again ----
  function cancel() { if (!S.ride) return; var go = function (yes) { if (!yes) return; api('/api/ride/' + S.ride.id + '/cancel', { phone: ME.phone }).then(function (d) { if (d.ok) render(d.ride); else toast(d.error || 'Cannot cancel now'); }).catch(function () { toast('Network error'); }); }; if (IN_TG) TG.confirm('ጉዞውን ይሰርዙ? · Cancel this ride?', go); else go(confirm('ጉዞውን ይሰርዙ? · Cancel this ride?')); }
  $('cancelFinding').addEventListener('click', cancel); $('cancelAssigned').addEventListener('click', cancel);
  function markStars(n) { $('stars').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', +b.dataset.s <= n); }); }
  $('stars').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { var n = +b.dataset.s; markStars(n); api('/api/ride/' + S.ride.id + '/rate', { phone: ME.phone, stars: n }).then(function () { $('rateMsg').textContent = 'አመሰግናለሁ! · Thank you!'; }).catch(function () { toast('Network error'); }); }); });
  function reset(swap) {
    if (IN_TG) { TG.mainHide(); TG.backHide(); }
    $('forOther').checked = false; $('passenger').classList.add('hidden');
    var a = S.pickup, b = S.dropoff; S.ride = null; S.quote = null; BinaMap.clearRoute();
    if (swap && a && b) { setPickup({ lat: b.lat, lng: b.lng, label: b.label }); S.dropoff = { lat: a.lat, lng: a.lng, label: a.label }; BinaMap.setDrop(S.dropoff); return quote(); }
    S.dropoff = null; BinaMap.setDrop(null); show('s-home');
  }
  $('again').addEventListener('click', function () { reset(false); }); $('againC').addEventListener('click', function () { reset(false); });
  $('returnTrip').addEventListener('click', function () { reset(true); });

  // ---- resume an active ride after reload ----
  var active = lsGet('bina_ride_active');
  var urlId = new URLSearchParams(location.search).get('id');
  if (IN_TG) {
    api('/api/ride/mine?initData=' + encodeURIComponent(TG.initData())).then(function (d) {
      if (d.ok && d.ride) {
        ME = ME || { name: (TG.user() || {}).first_name || 'Telegram user', tg: true }; ME.phone = d.phone; lsSet('bina_ride_me', JSON.stringify(ME));
        S.ride = { id: d.ride.id }; lsSet('bina_ride_active', d.ride.id); render(d.ride); startPoll();
      }
    }).catch(function () {});
  } else if ((urlId || active) && ME) { S.ride = { id: urlId || active }; startPoll(); }
})();
