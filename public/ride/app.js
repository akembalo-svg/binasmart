/* BinaSmart Ride — rider app. Screens: home → search → quote → (who) → finding → assigned → done. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = { pickup: null, dropoff: null, quote: null, tier: 'economy', ride: null, poll: null, searchTarget: 'dropoff', pinMode: false };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  var ME = null; try { ME = JSON.parse(lsGet('bina_ride_me') || 'null'); } catch (e) { ME = null; }

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

  function locate() {
    if (!navigator.geolocation) return setPickup({ lat: 9.0108, lng: 38.7578, label: 'Bole, Addis Ababa' });
    navigator.geolocation.getCurrentPosition(function (pos) {
      var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'የእርስዎ ቦታ · Your location' };
      if (p.lat < 8.5 || p.lat > 9.5 || p.lng < 38.4 || p.lng > 39.2) { toast('BinaSmart Ride is Addis Ababa only for now'); p = { lat: 9.0108, lng: 38.7578, label: 'Bole, Addis Ababa' }; }
      setPickup(p); BinaMap.flyTo(p, 15.5);
    }, function () { setPickup({ lat: 9.0108, lng: 38.7578, label: 'Bole, Addis Ababa (tap Change)' }); }, { enableHighAccuracy: true, timeout: 8000 });
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
    if (!S.pickup || !S.dropoff) return;
    show('s-quote'); $('qFrom').textContent = label(S.pickup); $('qTo').textContent = label(S.dropoff); $('tiers').innerHTML = '<div class="small">ዋጋ እያሰላን ነው… · Calculating…</div>';
    api('/api/ride/quote', { pickup: S.pickup, dropoff: S.dropoff }).then(function (d) {
      if (!d.ok) { toast(d.error || 'Could not quote'); return show('s-home'); }
      S.quote = d; BinaMap.drawRoute(d.geometry, 360);
      $('qMeta').textContent = (d.distanceM / 1000).toFixed(1) + ' km · ~' + Math.round(d.durationS / 60) + ' min' + (d.estimate ? ' · estimate' : '');
      $('tiers').innerHTML = d.quotes.map(function (q) {
        return '<div class="tier' + (q.tier === S.tier ? ' sel' : '') + '" data-t="' + q.tier + '"><div class="ic">' + q.icon + '</div><div><b>' + esc(q.label) + ' · ' + esc(q.labelAm) + '</b><div class="sub">' + q.seats + ' seats · ~' + q.etaMin + ' min</div></div><div class="price">' + q.fareEtb + ' ETB</div></div>';
      }).join('');
      $('tiers').querySelectorAll('.tier').forEach(function (el) { el.addEventListener('click', function () { S.tier = el.dataset.t; $('tiers').querySelectorAll('.tier').forEach(function (x) { x.classList.toggle('sel', x === el); }); setCta(); }); });
      setCta();
    });
  }
  function selQuote() { return (S.quote && S.quote.quotes.find(function (q) { return q.tier === S.tier; })) || null; }
  function setCta() { var q = selQuote(); $('ctaFare').textContent = q ? '· ' + q.fareEtb + ' ETB' : ''; }
  $('cancelQuote').addEventListener('click', function () { S.dropoff = null; BinaMap.setDrop(null); BinaMap.clearRoute(); show('s-home'); });

  // ---- identity + request ----
  $('request').addEventListener('click', function () { if (!ME) return show('s-who'); request(); });
  $('whoGo').addEventListener('click', function () {
    var name = $('whoName').value.trim(), phone = $('whoPhone').value.trim();
    if (name.length < 2 || !/^(\+?251|0)9\d{8}$/.test(phone.replace(/\s/g, ''))) return toast('ስም እና ትክክለኛ ስልክ ያስገቡ · Enter your name and a valid phone');
    ME = { name: name, phone: phone }; lsSet('bina_ride_me', JSON.stringify(ME)); request();
  });
  function request() {
    var q = selQuote(); if (!q) return;
    var pay = (document.querySelector('input[name=pay]:checked') || {}).value || 'cash';
    $('request').disabled = true;
    api('/api/ride/request', { idemKey: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), tier: S.tier, pickup: S.pickup, dropoff: S.dropoff, paymentMethod: pay, riderName: ME.name, riderPhone: ME.phone })
      .then(function (d) {
        $('request').disabled = false;
        if (!d.ok) return toast(d.error || 'Could not request');
        S.ride = d.ride; lsSet('bina_ride_active', d.ride.id); show('s-finding'); startPoll();
      }).catch(function () { $('request').disabled = false; toast('Network error — try again'); });
  }

  // ---- live status (poll every 4 s) ----
  function startPoll() { stopPoll(); tick(); S.poll = setInterval(tick, 4000); }
  function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = null; }
  function tick() {
    if (!S.ride) return;
    api('/api/ride/' + S.ride.id + '?phone=' + encodeURIComponent(ME.phone)).then(function (d) { if (d.ok) render(d.ride); }).catch(function () {});
  }
  function render(r) {
    S.ride = r;
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
      .then(function (d) { if (d.ok && d.checkout_url) location.href = d.checkout_url; else toast(d.error || 'Payment unavailable — pay cash'); });
  }

  // ---- cancel / rate / again ----
  function cancel() { if (!S.ride) return; if (!confirm('ጉዞውን ይሰርዙ? · Cancel this ride?')) return; api('/api/ride/' + S.ride.id + '/cancel', { phone: ME.phone }).then(function (d) { if (d.ok) render(d.ride); else toast(d.error || 'Cannot cancel now'); }); }
  $('cancelFinding').addEventListener('click', cancel); $('cancelAssigned').addEventListener('click', cancel);
  function markStars(n) { $('stars').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', +b.dataset.s <= n); }); }
  $('stars').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { var n = +b.dataset.s; markStars(n); api('/api/ride/' + S.ride.id + '/rate', { phone: ME.phone, stars: n }).then(function () { $('rateMsg').textContent = 'አመሰግናለሁ! · Thank you!'; }); }); });
  function reset(swap) {
    var a = S.pickup, b = S.dropoff; S.ride = null; S.quote = null; BinaMap.clearRoute();
    if (swap && a && b) { setPickup({ lat: b.lat, lng: b.lng, label: b.label }); S.dropoff = { lat: a.lat, lng: a.lng, label: a.label }; BinaMap.setDrop(S.dropoff); return quote(); }
    S.dropoff = null; BinaMap.setDrop(null); show('s-home');
  }
  $('again').addEventListener('click', function () { reset(false); }); $('againC').addEventListener('click', function () { reset(false); });
  $('returnTrip').addEventListener('click', function () { reset(true); });

  // ---- resume an active ride after reload ----
  var active = lsGet('bina_ride_active');
  if (active && ME) { S.ride = { id: active }; startPoll(); }
})();
