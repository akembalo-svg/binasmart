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
  BinaMap.init('map', function () { $('btn3d').classList.toggle('off', !BinaMap.is3D()); });
  $('btn3d').classList.toggle('off', !BinaMap.is3D());
  locate();
  $('btn3d').addEventListener('click', function () { var on = !BinaMap.is3D(); BinaMap.set3D(on); $('btn3d').classList.toggle('off', !on); });

  // ---- satellite (MapTiler imagery) — the button appears only when the server has a key ----
  api('/api/ride/map-config').then(function (d) {
    if (!d || !d.satellite || !$('btnSat')) return;
    BinaMap.setSatelliteConfig(d.satellite);
    var b = $('btnSat'); b.classList.remove('hidden');
    function apply(on) { BinaMap.setSatellite(on); b.classList.toggle('off', !on); }
    BinaMap.whenReady(function (m) { if (m.loaded()) apply(BinaMap.wantsSatellite()); else m.once('load', function () { apply(BinaMap.wantsSatellite()); }); });
    b.addEventListener('click', function () { apply(!BinaMap.isSatellite()); });
  }).catch(function () {});

  // A rider who denies the location prompt (or never answers it) must still be able to book:
  // some browsers call NEITHER callback in that case, so a hard timer guarantees a pickup exists.
  var DEFAULT_PICKUP = { lat: 9.0108, lng: 38.7578, label: 'Bole, Addis Ababa (tap Change)' };
  function locate() {
    var settled = false;
    function settle(p) { if (settled) return; settled = true; if (S.pickupLocked) return; setPickup(p); }
    if (!navigator.geolocation) return settle(DEFAULT_PICKUP);
    setTimeout(function () { settle(DEFAULT_PICKUP); }, 9000);
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (settled) return;
      var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'የእርስዎ ቦታ · Your location' };
      if (p.lat < 8.5 || p.lat > 9.5 || p.lng < 38.4 || p.lng > 39.2) { toast('BinaSmart Ride is Addis Ababa only for now'); p = DEFAULT_PICKUP; }
      settle(p); BinaMap.flyTo(p, 15.5);
    }, function () { settle(DEFAULT_PICKUP); }, { enableHighAccuracy: true, timeout: 8000 });
  }
  function setPickup(p) {
    S.pickup = p; BinaMap.setPickup(p); $('fromLabel').textContent = p.label;
    // The Pool screen may already be open while the phone was still locating: refresh "near you" now.
    if (!S.pool && $('s-pool') && !$('s-pool').classList.contains('hidden') && typeof loadNear === 'function') loadNear();
  }

  BinaMap.onClick(function (p) {
    if (!S.pinMode) return;
    p.label = p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
    choose(p);
  });

  // ---- search ----
  $('openSearch').addEventListener('click', function () { S.searchTarget = 'dropoff'; openSearch(); });
  $('editFrom').addEventListener('click', function () { S.searchTarget = 'pickup'; openSearch(); });
  $('closeSearch').addEventListener('click', function () { S.pinMode = false; show(S.searchTarget === 'pooldest' || S.searchTarget === 'groupdest' ? 's-pool' : 's-home'); });
  $('pinMode').addEventListener('click', function () { S.pinMode = true; toast(S.searchTarget === 'pickup' ? 'Tap the map to set pickup' : 'Tap the map to set destination'); });
  function openSearch() {
    $('searchMode').firstChild.textContent = (S.searchTarget === 'pickup' ? 'Searching pickup' : (S.searchTarget === 'pooldest' || S.searchTarget === 'groupdest' ? 'የቡድኑ መድረሻ · Where is the group going?' : 'Searching destination')) + ' · ';
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
    if (S.searchTarget === 'pooldest') { S.searchTarget = 'dropoff'; return joinPool({ create: true, dropoff: { lat: p.lat, lng: p.lng, label: p.label }, mode: 'wait' }); }
    if (S.searchTarget === 'groupdest') { S.searchTarget = 'dropoff'; return createGroup({ lat: p.lat, lng: p.lng, label: p.label }); }
    if (S.searchTarget === 'pickup') { setPickup({ lat: p.lat, lng: p.lng, label: p.label }); if (S.dropoff) return quote(); show('s-home'); return; }
    S.dropoff = { lat: p.lat, lng: p.lng, label: p.label }; BinaMap.setDrop(S.dropoff); remember(S.dropoff); quote();
  }

  // ---- quick destinations: the airport, then the last two places this rider went ----
  var AIRPORT = { lat: 8.9779, lng: 38.7993, label: 'Bole International Airport · ቦሌ አየር ማረፊያ' };
  function recents() { try { return JSON.parse(lsGet('bina_ride_recent') || '[]'); } catch (e) { return []; } }
  function remember(p) {
    if (!p || !p.label || p.label === AIRPORT.label) return;
    var r = recents().filter(function (x) { return x.label !== p.label; });
    r.unshift({ lat: p.lat, lng: p.lng, label: p.label }); lsSet('bina_ride_recent', JSON.stringify(r.slice(0, 3))); renderQuick();
  }
  function renderQuick() {
    var q = $('quick'); if (!q) return;
    var items = [{ ic: '✈️', am: 'ኤርፖርት', en: 'Bole Airport', p: AIRPORT }].concat(recents().slice(0, 2).map(function (p) {
      return { ic: '🕘', am: p.label.split(' · ')[0], en: 'ቅርብ · recent', p: p };
    }));
    q.innerHTML = items.map(function (it, i) { return '<button type="button" data-i="' + i + '"><span class="ic">' + it.ic + '</span><span><b>' + esc(it.am) + '</b><small>' + esc(it.en) + '</small></span></button>'; }).join('');
    q.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { S.searchTarget = 'dropoff'; choose(items[+b.dataset.i].p); }); });
  }
  renderQuick();

  // ---- hand-off from /airport and deep links: ?airport=1 puts the pickup at Bole T2; ?to=&lat=&lng= presets
  //      the drop-off; ?tier= picks the car. The normal quote path then shows the fixed price. ----
  (function () {
    var P = new URLSearchParams(location.search); if (!P.get('airport') && !P.get('to')) return;
    var tier = P.get('tier'); if (/^(moto|bajaj|economy|comfort|xl)$/.test(tier || '')) S.tier = tier;
    if (P.get('airport') === '1') { S.pickupLocked = true; setPickup({ lat: AIRPORT.lat, lng: AIRPORT.lng, label: 'Bole Airport · Terminal 2 · ቦሌ አየር ማረፊያ' }); }
    var lat = parseFloat(P.get('lat')), lng = parseFloat(P.get('lng')), to = (P.get('to') || '').slice(0, 80);
    if (to && isFinite(lat) && isFinite(lng) && lat > 8.5 && lat < 9.5 && lng > 38.4 && lng < 39.2) { S.searchTarget = 'dropoff'; choose({ lat: lat, lng: lng, label: to }); }
    else if (P.get('airport') === '1') { S.searchTarget = 'dropoff'; openSearch(); }
  })();

  // ---- Ask Bini: typed or spoken sentence -> destination + options -> the normal quote path ----
  var TIER_AM = { moto: 'ሞተር', bajaj: 'ባጃጅ', economy: 'መደበኛ', comfort: 'ምቾት', xl: 'XL' };
  function biniSay(am, en, tone) { var el = $('biniSay'); if (!el) return; el.className = 'biniSay' + (tone ? ' ' + tone : ''); el.innerHTML = '<b>' + esc(am) + '</b>' + (en ? '<small>' + esc(en) + '</small>' : ''); }
  function askBini(text) {
    text = String(text || '').trim(); if (!text) return;
    var go = $('biniGo'); go.disabled = true; biniSay('ቢኒ እያሰበ ነው…', 'Bini is thinking…', 'busy');
    api('/api/ride/intent', { text: text, near: S.pickup || undefined }).then(function (d) {
      go.disabled = false;
      if (!d || !d.ok) { biniSay('ይቅርታ፣ አልገባኝም። መድረሻዎን ይጻፉ ወይም ካርታውን ይንኩ።', 'Sorry, I did not catch that. Type the destination or tap the map.', 'warn'); return; }
      if (d.tier) { S.tier = d.tier; }
      if (d.payment) { var r = document.querySelector('input[name="pay"][value="' + d.payment + '"]'); if (r && !r.closest('label').classList.contains('hidden')) r.checked = true; }
      if (d.forOther && $('forOther')) { $('forOther').checked = true; $('passenger').classList.remove('hidden'); }
      if (d.pickup && !d.pickup.unresolved) setPickup({ lat: d.pickup.lat, lng: d.pickup.lng, label: d.pickup.label });
      var note = (d.reply && d.reply.am) || '', noteEn = (d.reply && d.reply.en) || '';
      if (d.tier) { note += ' · ' + TIER_AM[d.tier]; }
      if (d.destination && !d.destination.unresolved) {
        biniSay(note || ('እሺ፣ ወደ ' + d.destination.label), noteEn, 'ok');
        S.searchTarget = 'dropoff'; choose({ lat: d.destination.lat, lng: d.destination.lng, label: d.destination.label });
      } else if (d.destination && d.destination.unresolved) {
        biniSay('"' + d.destination.said + '" አላገኘሁትም። ከዝርዝሩ ይምረጡ።', 'I could not find "' + d.destination.said + '" — pick it from the list.', 'warn');
        S.searchTarget = 'dropoff'; openSearch(); $('q').value = d.destination.said; $('q').dispatchEvent(new Event('input'));
      } else {
        biniSay(note || 'ወዴት እንሂድ? መድረሻዎን ይንገሩኝ።', noteEn || 'Where to? Tell me the destination.', 'warn');
      }
    }).catch(function () { go.disabled = false; biniSay('የአውታረ መረብ ችግር — እንደገና ይሞክሩ።', 'Network error — try again.', 'warn'); });
  }
  if ($('biniForm')) {
    $('biniForm').addEventListener('submit', function (e) { e.preventDefault(); askBini($('biniQ').value); });
    // Voice: the browser's own recognizer (Chrome/Android and iOS Safari), Amharic first. No key, no
    // upload from us: the phone does the listening. Hidden where the browser has no recognizer.
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      var mic = $('biniMic'); mic.classList.remove('hidden'); var rec = null, listening = false;
      function startRec(lang) {
        rec = new SR(); rec.lang = lang; rec.interimResults = true; rec.maxAlternatives = 1; listening = true; mic.classList.add('on');
        $('biniQ').value = ''; $('biniQ').placeholder = 'እያዳመጥኩ ነው… · listening…';
        rec.onresult = function (ev) { var t = ''; for (var i = ev.resultIndex; i < ev.results.length; i++) t += ev.results[i][0].transcript; $('biniQ').value = t; if (ev.results[ev.results.length - 1].isFinal) { stopRec(); askBini(t); } };
        rec.onerror = function (ev) { stopRec(); if (ev.error === 'language-not-supported' && lang !== 'en-US') return startRec('en-US'); if (ev.error === 'not-allowed') biniSay('ማይክሮፎን አልተፈቀደም — ይጻፉ።', 'Microphone not allowed — type instead.', 'warn'); };
        rec.onend = function () { stopRec(); };
        try { rec.start(); } catch (e) { stopRec(); }
      }
      function stopRec() { listening = false; mic.classList.remove('on'); $('biniQ').placeholder = 'ቢኒን ይጠይቁ… ወደ ቦሌ ውሰደኝ'; try { rec && rec.stop && rec.stop(); } catch (e) {} }
      mic.addEventListener('click', function () { if (listening) return stopRec(); startRec('am-ET'); });
    }
  }

  // ---- About Bina Ride: the sparkle opens it; the chips ask the site's Bini ----
  if ($('aboutBtn')) {
    $('aboutBtn').addEventListener('click', function () { show('s-about'); });
    $('closeAbout').addEventListener('click', function () { show('s-home'); });
    document.querySelectorAll('#s-about .chipq').forEach(function (c) {
      c.addEventListener('click', function () {
        var ans = $('aboutAns'); ans.className = 'biniSay busy'; ans.innerHTML = '<b>ቢኒ እያሰበ ነው…</b><small>Bini is thinking…</small>';
        api('/api/assistant', { message: 'About BinaSmart Ride (bina.et/ride), answer in Amharic first then one English line, max 4 sentences, never invent a price: ' + c.dataset.q })
          .then(function (d) { ans.className = 'biniSay ok'; ans.innerHTML = '<b>' + esc((d && d.reply) || '') .replace(/\n/g, '<br>') + '</b>'; })
          .catch(function () { ans.className = 'biniSay warn'; ans.innerHTML = '<b>የአውታረ መረብ ችግር — እንደገና ይሞክሩ።</b><small>Network error — try again.</small>'; });
      });
    });
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
    ME = { name: name, phone: phone }; lsSet('bina_ride_me', JSON.stringify(ME));
    if (S.pendingPool) { var pp = S.pendingPool; S.pendingPool = null; return joinPool(pp); }
    if (S.pendingGroup) { var pg = S.pendingGroup; S.pendingGroup = null; return createGroup(pg); }
    if (S.pendingGroupJoin) { var pj = S.pendingGroupJoin; S.pendingGroupJoin = null; return joinGroup(pj); }
    request(passengerBody() || null);
  });
  function request(pb) {
    var q = selQuote(); if (!q) return;
    var pay = (document.querySelector('input[name=pay]:checked') || {}).value || 'cash';
    $('request').disabled = true; if (IN_TG) TG.main('…', function () {});
    var body = { idemKey: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), tier: S.tier, pickup: S.pickup, dropoff: S.dropoff, paymentMethod: pay, riderName: ME.name, riderPhone: ME.phone || undefined };
    if (pb) body.passenger = pb;
    if (IN_TG) body.tg = { initData: TG.initData(), contact: TG.contact() || undefined };
    sendRide(body);
  }
  function offline() { return window.BinaOffline && BinaOffline.isOffline(); }
  // No network: keep the request on the phone and send it the moment the connection returns (same idemKey → no duplicates).
  function queueOffline(kind, url, body, msg) { if (!window.BinaOffline) return false; BinaOffline.clear(kind); BinaOffline.add({ kind: kind, url: url, body: body }); toast(msg); $('request').disabled = false; if (IN_TG) setCta(); return true; }
  addEventListener('bina:sent', function (e) {
    var it = e.detail.item, d = e.detail.result;
    if (it.kind === 'ride') onRideResult(d); else if (it.kind === 'pool') onJoinResult(d, it.body);
  });
  function sendRide(body) {
    if (offline()) return queueOffline('ride', '/api/ride/request', body, '📴 ከመስመር ውጭ — ኢንተርኔት ሲመለስ ጥያቄዎ ይላካል · Offline — your request will be sent when the network returns');
    api('/api/ride/request', body)
      .then(onRideResult)
      .catch(function () { if (offline()) return queueOffline('ride', '/api/ride/request', body, '📴 ከመስመር ውጭ — ኢንተርኔት ሲመለስ ጥያቄዎ ይላካል · Offline — your request will be sent when the network returns'); $('request').disabled = false; if (IN_TG) setCta(); toast('Network error — try again'); });
  }
  function onRideResult(d) {
    (function () {
        $('request').disabled = false;
        if (!d.ok) { if (IN_TG) setCta(); return toast(d.error || 'Could not request'); }
        if (d.phone) { ME.phone = d.phone; lsSet('bina_ride_me', JSON.stringify(ME)); }
        S.ride = d.ride; lsSet('bina_ride_active', d.ride.id); show('s-finding'); startPoll();
        if (IN_TG) { TG.backHide(); TG.main('ሰርዝ · Cancel ride', cancel); TG.haptic(); }
      })();
  }

  // ---- live status (poll every 4 s) ----
  function startPoll() { stopPoll(); tick(); S.poll = setInterval(tick, 4000); }
  function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = null; }
  document.addEventListener('visibilitychange', function () { if (!S.ride) return; if (document.hidden) stopPoll(); else if (!['completed', 'cancelled'].includes(S.ride.status)) startPoll(); });
  var LIVE = ['assigned', 'arriving', 'arrived', 'ontrip'];
  function tick() {
    if (S.pool) return poolTick();
    if (!S.ride) return;
    var id = S.ride.id, ph = encodeURIComponent(ME.phone);
    api('/api/ride/' + id + '?phone=' + ph).then(function (d) { if (d.ok) render(d.ride); }).catch(function () {});
    // The live position is a separate, cheaper endpoint so the driver's map data never waits on
    // fare and payment fields the rider already has.
    if (LIVE.indexOf(S.ride.status) >= 0) {
      api('/api/ride/' + id + '/track?phone=' + ph)
        .then(function (d) { if (d.ok && S.ride) window.BinaTrack.update(S.ride, d.live); })
        .catch(function () {});
    }
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
      // Once a driver is on the way the map belongs to the car, not the quoted route.
      window.BinaMap.clearRoute();
    } else if (r.status === 'completed') {
      stopPoll(); window.BinaTrack.stop(); lsDel('bina_ride_active'); show('s-done');
      $('doneFare').textContent = r.fareEtb + ' ETB';
      $('payBox').innerHTML = r.paymentStatus === 'paid' ? '<div class="small">✅ ተከፍሏል · Paid</div>'
        : ('<div class="small">💵 ለሹፌሩ በጥሬ ገንዘብ ይክፈሉ · Pay the driver in cash — ወይም · or</div>'
          + '<button class="cta" id="payTelebirr">📱 ' + r.fareEtb + ' ETB በቴሌብር ይክፈሉ · Pay with telebirr</button>'
          + (r.paymentMethod === 'chapa' ? '<button class="cta ghost" id="payNow">💳 Chapa</button>' : ''));
      var pn = $('payNow'); if (pn) pn.addEventListener('click', payNow);
      var pt = $('payTelebirr'); if (pt) pt.addEventListener('click', payTelebirr);
      if (r.driverRating) markStars(r.driverRating);
    } else if (r.status === 'cancelled') { stopPoll(); window.BinaTrack.stop(); lsDel('bina_ride_active'); show('s-cancelled'); }
  }
  // telebirr: in the SuperApp this opens the PIN sheet; on the web it goes to telebirr's checkout and comes back to /ride?id=…&paid=1
  function payTelebirrSeat(seat) {
    if (!seat || !window.BinaTelebirr) return toast('telebirr unavailable — pay cash');
    var b = $('payTelebirrSeat'); if (b) { b.disabled = true; b.textContent = '📱 …'; }
    BinaTelebirr.pay({ type: 'poolseat', code: seat.id }).then(function (p) {
      if (p.paid) { toast('✅ ተከፍሏል · Seat paid with telebirr'); $('payBox').innerHTML = '<div class="small">✅ መቀመጫዎ ተከፍሏል · Seat paid with telebirr</div>'; lsDel('bina_pool_active'); S.pool = null; }
      else if (!p.redirected) { toast('ክፍያው አልተጠናቀቀም · Payment not completed'); if (b) { b.disabled = false; b.textContent = '📱 ' + seat.fareEtb + ' ETB በቴሌብር ይክፈሉ · Pay with telebirr'; } }
    }).catch(function () { toast('telebirr unavailable — pay cash'); if (b) { b.disabled = false; b.textContent = '📱 ' + seat.fareEtb + ' ETB በቴሌብር ይክፈሉ · Pay with telebirr'; } });
  }
  // Back from telebirr's web checkout for a seat: ?pool=<id>&seat=<seatId>&paid=1 → confirm, then the normal pool resume takes over.
  (function () {
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var sid = q.get('seat'); if (!sid || q.get('paid') !== '1' || !q.get('pool')) return;
    api('/api/telebirr/confirm', { type: 'poolseat', code: sid }).catch(function () {});
  })();
  function payTelebirr() {
    if (!S.ride || !window.BinaTelebirr) return toast('telebirr unavailable — pay cash');
    var b = $('payTelebirr'); if (b) { b.disabled = true; b.textContent = '📱 …'; }
    BinaTelebirr.pay({ type: 'ride', code: S.ride.id }).then(function (p) {
      if (p.paid) { toast('✅ ተከፍሏል · Paid with telebirr'); tick(); }
      else if (!p.redirected) { toast('ክፍያው አልተጠናቀቀም · Payment not completed'); if (b) { b.disabled = false; b.textContent = '📱 ' + S.ride.fareEtb + ' ETB በቴሌብር ይክፈሉ · Pay with telebirr'; } }
    }).catch(function () { toast('telebirr unavailable — pay cash'); if (b) { b.disabled = false; b.textContent = '📱 ' + S.ride.fareEtb + ' ETB በቴሌብር ይክፈሉ · Pay with telebirr'; } });
  }
  // Back from telebirr's web checkout: ?id=<ride>&paid=1 → confirm the payment, then show the ride as usual.
  (function () {
    var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
    var id = q.get('id'); if (!id || q.get('paid') !== '1') return;
    S.ride = { id: id, status: 'completed' }; S.pool = null; lsSet('bina_ride_active', id);
    api('/api/telebirr/confirm', { type: 'ride', code: id }).catch(function () {}).then(function () { if (ME && ME.phone) startPoll(); else show('s-done'); });
    try { history.replaceState(null, '', '/ride'); } catch (e) {}
  })();
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
    var a = S.pickup, b = S.dropoff; S.ride = null; S.quote = null; S.pool = null; lsDel('bina_pool_active'); BinaMap.clearRoute();
    if (swap && a && b) { setPickup({ lat: b.lat, lng: b.lng, label: b.label }); S.dropoff = { lat: a.lat, lng: a.lng, label: a.label }; BinaMap.setDrop(S.dropoff); return quote(); }
    S.dropoff = null; BinaMap.setDrop(null); show('s-home');
  }
  $('again').addEventListener('click', function () { reset(false); }); $('againC').addEventListener('click', function () { reset(false); });
  $('returnTrip').addEventListener('click', function () { reset(true); });

  // ---- BinaPool: share the car on a commute corridor, pay per seat ----
  // Screens: s-pool (corridors + ladder + Go now / Wait) -> s-poolwait (seats filling) -> the normal
  // finding / assigned / done screens, driven by the pool view instead of /api/ride/:id.
  var modeEl = $('mode');
  function setMode(m) {
    modeEl.querySelectorAll('button').forEach(function (b) { var on = b.dataset.m === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    if (m === 'pool') openPool(); else show('s-home');
  }
  modeEl.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.m); }); });
  $('closePool').addEventListener('click', function () { setMode('solo'); });
  function fmtLeft(s) { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  var POOL = { corridors: [], pick: {} }; // pick[key] = stopId
  // The map's load event normally triggers locate(); if the map is slow (3G, no WebGL) the Pool
  // screen must not hang on "Locating you": ask the phone directly, then fall back to Bole.
  function ensurePickup() {
    if (S.pickup || S.pickupLocked) return;
    var done = false, settle = function (p) { if (done || S.pickup) return; done = true; setPickup(p); };
    setTimeout(function () { settle(DEFAULT_PICKUP); }, 6000);
    if (!navigator.geolocation) return settle(DEFAULT_PICKUP);
    navigator.geolocation.getCurrentPosition(function (pos) {
      var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'የእርስዎ ቦታ · Your location' };
      if (p.lat < 8.5 || p.lat > 9.5 || p.lng < 38.4 || p.lng > 39.2) p = DEFAULT_PICKUP;
      settle(p);
    }, function () { settle(DEFAULT_PICKUP); }, { enableHighAccuracy: true, timeout: 5500 });
  }
  function openPool() {
    show('s-pool'); $('poolPeak').textContent = 'የመንገዶች ዝርዝር እየጫንን ነው… · Loading corridors…';
    loadBoard(); ensurePickup();
  }
  // ONE request builds the whole screen (slow networks): groups near me + corridors together.
  function loadBoard() {
    var q = S.pickup ? '?lat=' + S.pickup.lat + '&lng=' + S.pickup.lng : '';
    api('/api/pool/board' + q).then(function (d) {
      if (!d.ok) { $('poolPeak').textContent = 'አልተሳካም · Could not load'; return; }
      POOL.corridors = d.corridors; POOL.waitS = d.waitS; POOL.groups = d.groups || []; POOL.located = !!d.located;
      $('poolPeak').innerHTML = (d.dir === 'in' ? '🌅 ጠዋት · ወደ ቦሌ / ካዛንችስ' : '🌇 ማታ · ከቦሌ / ካዛንችስ') + (d.peak ? ' · <b>peak · ብዙ ተጓዥ</b>' : ' · off-peak: 6–10 &amp; 16–20 busiest') + ' · ' + Math.round(d.waitS / 60) + ' ደቂቃ ጠብቆ ያንሳል';
      renderNear(); renderCorridors(); loadGroups();
    }).catch(function () { $('poolPeak').textContent = 'የአውታረ መረብ ችግር · Network error — try again'; });
  }
  // ---- daily groups (contract commute) ----
  var DAYS = [['ሰ', 'Mon', 1], ['ማ', 'Tue', 2], ['ረ', 'Wed', 4], ['ሐ', 'Thu', 8], ['ዓ', 'Fri', 16], ['ቅ', 'Sat', 32], ['እ', 'Sun', 64]];
  var GF = { days: 31 };
  function groupLine(g) { return '<b>' + esc(g.name) + '</b><small>' + esc(g.daysLabel) + ' · ' + esc(g.time) + ' · ' + g.members + '/' + g.seats + ' · ' + esc(g.names.join(', ')) + (g.womenOnly ? ' · 👩' : '') + (g.nextInMin != null ? ' · next in ' + (g.nextInMin >= 60 ? Math.floor(g.nextInMin / 60) + ' h ' + (g.nextInMin % 60) + ' min' : g.nextInMin + ' min') : '') + '</small><span class="gsub">' + esc(g.from.label) + ' → ' + esc(g.to.label) + '</span>'; }
  function loadGroups() {
    var box = $('dailyGroups'); if (!box) return;
    var head = '<div class="nearhd" style="margin-top:12px">🔁 ቋሚ ቡድኖች <small>Daily groups · same car, same time, pay per seat</small></div>';
    var done = function (gs) {
      box.innerHTML = head + '<div id="ginvite"></div>' + (gs || []).map(function (g, i) {
        return '<div class="grp gd" data-i="' + i + '">' + groupLine(g) + '<div class="shrow"><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent('🔁 ' + g.name + ' · ' + g.daysLabel + ' ' + g.time + ' · ' + g.from.label + ' → ' + g.to.label + ' · join: ' + g.share) + '">💬 Invite</a><a class="btn sm" target="_blank" rel="noopener" href="https://t.me/share/url?url=' + encodeURIComponent(g.share) + '&text=' + encodeURIComponent('🔁 ' + g.name + ' · ' + g.daysLabel + ' ' + g.time) + '">✈️ Invite</a><button type="button" class="btn sm gleave">' + (g.organizerIsMe ? 'ዝጋ · Close' : 'ውጣ · Leave') + '</button></div></div>';
      }).join('') + '<button type="button" class="cta wait gnew" id="newDaily">🔁 ቋሚ ቡድን ፍጠር <small>Create a daily group · for your office or school run</small></button>';
      box.querySelectorAll('.gd').forEach(function (el) { var g = gs[+el.dataset.i]; el.querySelector('.gleave').addEventListener('click', function () {
        var q = g.organizerIsMe ? 'ቡድኑን ይዝጉ? ሁሉም ይወጣሉ · Close this group for everyone?' : 'ከቡድኑ ይውጡ? · Leave this group?';
        var go = function (yes) { if (!yes) return; api('/api/pool/groups/' + g.id + '/leave', { phone: ME.phone }).then(function (d) { if (d.ok) loadGroups(); else toast(d.error || 'failed'); }); };
        if (IN_TG) TG.confirm(q, go); else go(confirm(q));
      }); });
      $('newDaily').addEventListener('click', function () { $('gform').classList.remove('hidden'); $('newDaily').classList.add('hidden'); renderDays(); $('gFrom').textContent = '📍 ከ · from: ' + (S.pickup ? S.pickup.label : 'your current position'); });
      if (S.inviteGroup) showGroupInvite();
    };
    if (!ME || !ME.phone) return done([]);
    api('/api/pool/groups/mine?phone=' + encodeURIComponent(ME.phone)).then(function (d) { done(d.ok ? d.groups : []); }).catch(function () { done([]); });
  }
  function renderDays() {
    $('gDays').innerHTML = DAYS.map(function (d) { return '<button type="button" data-b="' + d[2] + '"' + ((GF.days & d[2]) ? ' class="on"' : '') + '>' + d[0] + '<small>' + d[1] + '</small></button>'; }).join('');
    $('gDays').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { GF.days ^= +b.dataset.b; b.classList.toggle('on', !!(GF.days & +b.dataset.b)); }); });
  }
  $('gCancel').addEventListener('click', function () { $('gform').classList.add('hidden'); var nb = $('newDaily'); if (nb) nb.classList.remove('hidden'); });
  $('gDest').addEventListener('click', function () {
    var t = $('gTime').value; if (!/^\d\d:\d\d$/.test(t)) return toast('ሰዓት ይምረጡ · Pick a time');
    if (!GF.days) return toast('ቀናት ይምረጡ · Pick the days');
    S.searchTarget = 'groupdest'; openSearch();
  });
  function createGroup(dest) {
    if (!ME) { S.pendingGroup = dest; show('s-who'); return; }
    var t = $('gTime').value.split(':');
    var body = { name: $('gName').value.trim(), pickup: S.pickup || DEFAULT_PICKUP, dropoff: dest, days: GF.days, timeMin: (+t[0]) * 60 + (+t[1]), womenOnly: $('gWomen').checked, riderName: ME.name, riderPhone: ME.phone || undefined };
    if (IN_TG) body.tg = { initData: TG.initData(), contact: TG.contact() || undefined };
    show('s-pool');
    api('/api/pool/groups', body).then(function (d) {
      if (!d.ok) return toast({ too_close: 'መድረሻው በጣም ቅርብ ነው · Destination too close', too_many_groups: 'ከ3 ቡድን በላይ · You already organise 3 groups', pick_days: 'ቀናት ይምረጡ · Pick the days' }[d.error] || d.error || 'failed');
      if (d.phone) { ME.phone = d.phone; lsSet('bina_ride_me', JSON.stringify(ME)); }
      $('gform').classList.add('hidden'); $('gName').value = '';
      toast('ቡድኑ ተፈጥሯል · Group created — invite your colleagues');
      loadGroups();
      var link = d.share, text = '🔁 ' + d.group.name + ' · ' + d.group.daysLabel + ' ' + d.group.time + ' · ' + d.group.from.label + ' → ' + d.group.to.label + ' · join: ' + link;
      if (navigator.share) navigator.share({ title: 'BinaPool', text: text, url: link }).catch(function () {});
    }).catch(function () { toast('Network error — try again'); });
  }
  function showGroupInvite() {
    var id = S.inviteGroup; if (!id) return;
    api('/api/pool/groups/' + id + '/public').then(function (d) {
      var box = $('ginvite'); if (!box) return;
      if (!d.ok || !d.group || d.group.status !== 'active') { box.innerHTML = '<div class="small">ይህ ቡድን አልተገኘም · That daily group was not found or is closed.</div>'; return; }
      var g = d.group;
      box.innerHTML = '<div class="grp inv gd"><div class="gtag">👋 ተጋብዘዋል · You were invited to a daily group</div>' + groupLine(g) + '<div class="gact"><span class="gprice">' + (g.full ? 'ሞልቷል · full' : (g.seats - g.members) + ' seats left') + '<small>pay per seat, cash to the driver</small></span>' + (g.full ? '' : '<button type="button" class="cta" id="gjoinBtn">ተቀላቀል · Join</button>') + '</div></div>';
      var b = $('gjoinBtn'); if (b) b.addEventListener('click', function () { joinGroup(g); });
    }).catch(function () {});
  }
  function joinGroup(g) {
    if (!ME) { S.pendingGroupJoin = g; show('s-who'); return; }
    var go = function (female) {
      var body = { riderName: ME.name, riderPhone: ME.phone || undefined, female: !!female };
      if (IN_TG) body.tg = { initData: TG.initData(), contact: TG.contact() || undefined };
      api('/api/pool/groups/' + g.id + '/join', body).then(function (d) {
        if (!d.ok) return toast({ group_full: 'ቡድኑ ሞልቷል · Group is full', women_only: 'ይህ ቡድን ለሴቶች ብቻ ነው · Women only' }[d.error] || d.error || 'failed');
        if (d.phone) { ME.phone = d.phone; lsSet('bina_ride_me', JSON.stringify(ME)); }
        S.inviteGroup = null; toast('ተቀላቅለዋል · You are in — your seat is held every ' + g.daysLabel + ' at ' + g.time); loadGroups();
      }).catch(function () { toast('Network error'); });
    };
    if (g.womenOnly) { var q = 'ይህ ቡድን ለሴቶች ብቻ ነው። ሴት ነዎት? · Women only. Are you a woman?'; if (IN_TG) TG.confirm(q, function (y) { if (y) go(true); }); else if (confirm(q)) go(true); return; }
    go(false);
  }
  function loadNear() { loadBoard(); }
  function shareText(p) {
    var full = p.ladder ? p.ladder[p.ladder.length - 1].seatEtb : '';
    return '👥 ጋራ ጉዞ · ' + p.corridor.nameAm + ' · ' + p.filled + '/' + p.seats + ' በመኪናው · ' + (full ? full + ' ETB each when full · ' : '') + 'መኪናው በ ' + Math.ceil((p.leavesInS || 0) / 60) + ' ደቂቃ ይነሳል · ተቀላቀሉ / join: https://bina.et/pool/' + p.id;
  }
  function renderShare(p) {
    var el = $('pwShare'); if (!el) return;
    var link = 'https://bina.et/pool/' + p.id, text = shareText(p);
    el.innerHTML = '<div class="small">📣 ሌሎችን ይጋብዙ · Invite others — the car fills faster and your seat gets cheaper</div><div class="shrow">'
      + '<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text) + '">💬 WhatsApp</a>'
      + '<a class="btn sm" target="_blank" rel="noopener" href="https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text) + '">✈️ Telegram</a>'
      + '<button type="button" class="btn sm" id="shCopy">🔗 ' + (navigator.share ? 'Share' : 'Copy') + '</button></div>';
    $('shCopy').addEventListener('click', function () {
      if (navigator.share) { navigator.share({ title: 'BinaPool', text: text, url: link }).catch(function () {}); return; }
      try { navigator.clipboard.writeText(link).then(function () { toast('ሊንኩ ተቀድቷል · Link copied'); }); } catch (e) { prompt('Copy this link', link); }
    });
  }
  function groupCard(g, i, invited) {
    var dist = g.distM == null ? '' : (g.distM < 950 ? g.distM + ' m' : (g.distM / 1000).toFixed(1) + ' km') + ' ከእርስዎ · ';
    return '<div class="grp' + (invited ? ' inv' : '') + (g.womenOnly ? ' women' : '') + '" data-i="' + i + '">' + (invited ? '<div class="gtag">👋 ተጋብዘዋል · You were invited</div>' : '')
      + '<div class="gtop"><b>' + esc(g.nameAm) + '</b><span class="gseats">' + g.filled + '/' + g.seats + '</span></div>'
      + '<div class="gsub">' + (g.womenOnly ? '👩 ሴቶች ብቻ · women only · ' : '') + (g.driverWaiting ? '🚗 ሹፌር እየጠበቀ ነው · driver waiting · ' : '') + esc(g.riders.join(', ')) + ' · ' + (g.kind === 'custom' ? 'ከ ' + esc(g.board.label) : 'ማቆሚያ ' + esc(g.board.labelAm)) + ' · ' + dist + 'leaves in ' + fmtLeft(g.leavesInS) + '</div>'
      + '<div class="gact"><span class="gprice">' + g.seatIfJoinEtb + ' ETB<small>ከተቀላቀሉ · if you join · ' + g.seatIfFullEtb + ' when full</small></span><button type="button" class="cta gjoin">ተቀላቀል · Join</button></div></div>';
  }
  function renderNear() {
    var box = $('nearGroups'); if (!box) return;
    var gs = POOL.groups || [];
    var wo = POOL.womenOnly == null ? (lsGet('bina_pool_women') === '1') : POOL.womenOnly; POOL.womenOnly = wo;
    box.innerHTML = '<div class="nearhd">👥 በአቅራቢያዎ ያሉ ቡድኖች <small>Groups near you · ' + (!POOL.located ? 'ቦታዎን እየፈለግን ነው · locating you…' : (gs.length ? gs.length + ' filling now' : 'none yet — start one')) + '</small></div>'
      + '<div id="inviteBox"></div>'
      + gs.map(function (g, i) { return groupCard(g, i, false); }).join('')
      + '<label class="wo"><input type="checkbox" id="womenOnly"' + (wo ? ' checked' : '') + '> 👩 ሴቶች ብቻ · Women only <small>ለሚጀምሩት ቡድን · for the group you start</small></label>'
      + '<button type="button" class="cta wait gnew" id="newGroup">➕ አዲስ ቡድን እዚህ ጀምር <small>Start a group from here · others nearby can join · ' + (POOL.waitS ? Math.round(POOL.waitS / 60) : 8) + ' min</small></button>';
    box.querySelectorAll('.grp').forEach(function (el) {
      var g = gs[+el.dataset.i]; if (!g) return;
      el.querySelector('.gjoin').addEventListener('click', function () { joinPool({ poolId: g.id, stopId: g.board.id, mode: 'wait', womenOnly: g.womenOnly }); });
    });
    $('womenOnly').addEventListener('change', function () { POOL.womenOnly = this.checked; lsSet('bina_pool_women', this.checked ? '1' : '0'); });
    $('newGroup').addEventListener('click', function () { S.searchTarget = 'pooldest'; openSearch(); });
    if (S.invite) {
      api('/api/pool/' + S.invite + '/public').then(function (d) {
        if (!d.ok || !d.group) { $('inviteBox').innerHTML = '<div class="small">ይህ ቡድን አልተገኘም · That group was not found.</div>'; return; }
        var g = d.group;
        if (!g.open) { $('inviteBox').innerHTML = '<div class="small">🚘 የተጋበዙበት መኪና ተነስቷል · The car you were invited to has left — pick another group below.</div>'; return; }
        if (S.pickup) g.distM = Math.round(distM(S.pickup, g.board));
        $('inviteBox').innerHTML = groupCard(g, 'inv', true);
        $('inviteBox').querySelector('.gjoin').addEventListener('click', function () { joinPool({ poolId: g.id, stopId: g.board.id, mode: 'wait', womenOnly: g.womenOnly }); });
      }).catch(function () {});
    }
  }
  function distM(a, b) { var r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r, x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2); return 2 * 6371000 * Math.asin(Math.sqrt(x)); }
  function renderCorridors() {
    $('corridors').innerHTML = POOL.corridors.map(function (c, i) {
      var pick = POOL.pick[c.key] || (c.nearest && c.nearest.stop.id) || c.stops[0].id;
      var full = c.ladder[c.ladder.length - 1], cur = c.ladder[Math.max(0, Math.min(c.ladder.length - 1, c.waiting))];
      var near = c.nearest ? (c.nearest.distM < 950 ? c.nearest.distM + ' m' : (c.nearest.distM / 1000).toFixed(1) + ' km') : '';
      return '<div class="cc" data-i="' + i + '"><h3><span>' + esc(c.nameAm) + '</span><small>' + (c.distanceM / 1000).toFixed(1) + ' km · ~' + Math.round(c.durationS / 60) + ' min</small></h3><span class="am">' + esc(c.name) + (near ? ' · ቅርብ ማቆሚያ ' + near : '') + '</span>'
        + '<div class="stops">' + c.stops.slice(0, -1).map(function (s) { return '<button type="button" data-s="' + s.id + '"' + (s.id === pick ? ' class="on"' : '') + '>' + esc(s.labelAm) + '<small>' + esc(s.label) + '</small></button>'; }).join('') + '<button type="button" disabled>🏁 ' + esc(c.to.labelAm) + '<small>' + esc(c.to.label) + '</small></button></div>'
        + '<div class="ladder">' + c.ladder.map(function (r) { return '<span' + (r.n === Math.max(1, c.waiting + 1) ? ' class="hot"' : '') + '>' + r.seatEtb + '<small>' + r.n + ' ' + (r.n === 1 ? 'ሰው' : 'ሰዎች') + '</small></span>'; }).join('') + '</div>'
        + '<div class="wait">' + (c.waiting ? '👥 ' + c.waiting + ' ተጓዥ እየጠበቁ ነው · ' + c.waiting + ' waiting · leaves in ' + fmtLeft(c.leavesInS) : '🙋 የመጀመሪያው ይሁኑ · be the first — others join as you wait') + '</div>'
        + '<div class="go2"><button type="button" class="cta wait" data-m="wait">ጠብቅ · Wait<small>ከ ' + full.seatEtb + ' ETB · up to ' + Math.round((POOL.waitS || 480) / 60) + ' min</small></button>'
        + '<button type="button" class="cta" data-m="now">አሁን ሂድ · Go now<small>' + cur.seatEtb + ' ETB ' + (c.waiting ? '· with ' + c.waiting + ' others' : '· alone') + '</small></button></div></div>';
    }).join('') || '<div class="small">አሁን ምንም መንገድ የለም · No corridors right now.</div>';
    $('corridors').querySelectorAll('.cc').forEach(function (card) {
      var c = POOL.corridors[+card.dataset.i];
      card.querySelectorAll('.stops button[data-s]').forEach(function (b) { b.addEventListener('click', function () { POOL.pick[c.key] = b.dataset.s; card.querySelectorAll('.stops button').forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
      card.querySelectorAll('.go2 button').forEach(function (b) { b.addEventListener('click', function () {
        var stopId = POOL.pick[c.key] || (c.nearest && c.nearest.stop.id) || c.stops[0].id;
        joinPool({ corridorKey: c.key, stopId: stopId, mode: b.dataset.m });
      }); });
    });
  }
  function joinPool(p) {
    if (!ME) {
      S.pendingPool = p;
      if (IN_TG) { TG.requestContact(function (ok) { var u = TG.user() || {}; var nm = [u.first_name, u.last_name].filter(Boolean).join(' '); if (ok) { ME = { name: nm || 'Telegram user', phone: null, tg: true }; lsSet('bina_ride_me', JSON.stringify(ME)); S.pendingPool = null; joinPool(p); } else { if (nm) $('whoName').value = nm; show('s-who'); } }); return; }
      show('s-who'); return;
    }
    if (p.womenOnly && !p.female) {
      var ask = function (yes) { if (yes) joinPool(Object.assign({}, p, { female: true })); };
      if (IN_TG) return TG.confirm('ይህ ቡድን ለሴቶች ብቻ ነው። ሴት ነዎት? · This group is women only. Are you a woman?', ask);
      return ask(confirm('ይህ ቡድን ለሴቶች ብቻ ነው። ሴት ነዎት? · This group is women only. Are you a woman?'));
    }
    var body = { corridorKey: p.corridorKey, stopId: p.stopId, mode: p.mode, riderName: ME.name, riderPhone: ME.phone || undefined, paymentMethod: 'cash' };
    var url = '/api/pool/join';
    if (p.poolId) { url = '/api/pool/' + p.poolId + '/join'; if (S.pickup) { body.lat = S.pickup.lat; body.lng = S.pickup.lng; } if (p.female) body.female = true; }
    else if (p.create) { url = '/api/pool/create'; body.pickup = S.pickup || DEFAULT_PICKUP; body.dropoff = p.dropoff; body.womenOnly = !!POOL.womenOnly; show('s-pool'); }
    if (IN_TG) body.tg = { initData: TG.initData(), contact: TG.contact() || undefined };
    $('corridors').querySelectorAll('.go2 button').forEach(function (b) { b.disabled = true; });
    if (offline()) { $('corridors').querySelectorAll('.go2 button').forEach(function (b) { b.disabled = false; }); if (window.BinaOffline) { BinaOffline.clear('pool'); BinaOffline.add({ kind: 'pool', url: url, body: body }); } return toast('📴 ከመስመር ውጭ — ኢንተርኔት ሲመለስ ይቀላቀላሉ · Offline — you will join when the network returns'); }
    api(url, body).then(function (d) { onJoinResult(d, body); }).catch(function () { $('corridors').querySelectorAll('.go2 button').forEach(function (b) { b.disabled = false; }); if (offline() && window.BinaOffline) { BinaOffline.clear('pool'); BinaOffline.add({ kind: 'pool', url: url, body: body }); return toast('📴 ከመስመር ውጭ — ኢንተርኔት ሲመለስ ይቀላቀላሉ · Offline — you will join when the network returns'); } toast('Network error — try again'); });
  }
  function onJoinResult(d, body) {
    (function () {
      $('corridors').querySelectorAll('.go2 button').forEach(function (b) { b.disabled = false; });
      if (!d.ok && d.error === 'too_far_from_group') return toast('ከቡድኑ በጣም ርቀዋል · You are too far from that group');
      if (!d.ok && d.error === 'car_already_leaving') { toast('መኪናው ተነስቷል · That car already left'); return loadNear(); }
      if (!d.ok && d.error === 'car_full') { toast('መኪናው ሞልቷል · That car is full'); return loadNear(); }
      if (!d.ok && d.error === 'too_close') return toast('መድረሻው በጣም ቅርብ ነው · That destination is too close');
      if (!d.ok && d.error === 'women_only') return toast('ይህ ቡድን ለሴቶች ብቻ ነው · This group is women only');
      if (!d.ok && d.error === 'go_now_only') return toast('ሁለት ጊዜ ሳይመጡ ቀርተዋል — አሁን "አሁን ሂድ" ብቻ · After two no-shows this month you can only Go now');
      S.invite = null;
      if (!d.ok) return toast(d.error || 'Could not join');
      if (d.phone) { ME.phone = d.phone; lsSet('bina_ride_me', JSON.stringify(ME)); }
      S.pool = { id: d.pool.id }; S.ride = null; lsSet('bina_pool_active', d.pool.id); lsDel('bina_ride_active');
      renderPool(d); startPoll(); if (IN_TG) TG.haptic();
    })();
  }
  function poolTick() {
    if (!S.pool) return;
    api('/api/pool/' + S.pool.id + '?phone=' + encodeURIComponent(ME.phone)).then(function (d) { if (d.ok) renderPool(d); else if (d.error === 'not_found') { stopPoll(); reset(false); } }).catch(function () {});
    if (S.ride && LIVE.indexOf(S.ride.status) >= 0) {
      api('/api/ride/' + S.ride.id + '/track?phone=' + encodeURIComponent(ME.phone)).then(function (d) { if (d.ok && S.ride) window.BinaTrack.update(S.ride, d.live); }).catch(function () {});
    }
  }
  var pwTimer = null;
  function renderPool(d) {
    var p = d.pool, seat = d.seat, r = d.ride;
    S.pool = { id: p.id, status: p.status, seat: seat };
    if (seat && seat.stop) { setPickup({ lat: seat.stop.lat, lng: seat.stop.lng, label: 'ማቆሚያ · ' + seat.stop.labelAm + ' · ' + seat.stop.label }); S.dropoff = { lat: p.corridor.to.lat, lng: p.corridor.to.lng, label: p.corridor.to.label }; BinaMap.setDrop(S.dropoff); }
    if (p.status === 'filling') {
      show('s-poolwait');
      $('pwSeats').innerHTML = p.riders.map(function (x) { return '<i class="on' + (x.me ? ' me' : '') + '" title="' + esc(x.name) + '">' + esc(x.name.charAt(0).toUpperCase()) + '</i>'; }).join('') + new Array(Math.max(0, p.seats - p.filled) + 1).join('<i>💺</i>');
      $('pwFare').textContent = seat.fareEtb + ' ETB'; $('pwCount').textContent = '· ' + p.filled + '/' + p.seats + ' · ' + (p.filled < p.seats ? 'ሌላ ሲገባ ያንሳል · drops as riders join' : 'full');
      $('pwTitle').innerHTML = (p.womenOnly ? '👩 ' : '') + 'መኪናውን እየሞላን ነው… <small>' + (p.womenOnly ? 'Women-only car · ' : '') + 'Filling the car…</small>';
      if (!$('pwShare').dataset.for || $('pwShare').dataset.for !== p.id + ':' + p.filled) { $('pwShare').dataset.for = p.id + ':' + p.filled; renderShare(p); }
      $('pwStop').textContent = (p.kind === 'custom' ? '📍 ከ ' + seat.stop.label + ' → ' + p.corridor.to.label + ' · በአቅራቢያዎ ያሉ ሰዎች ይህን ቡድን ያዩታል · people nearby see this group under "near you"' : '📍 ' + seat.stop.labelAm + ' · ' + seat.stop.label + ' → ' + p.corridor.to.labelAm + ' · ' + p.corridor.to.label);
      clearInterval(pwTimer); var left = p.leavesInS;
      var paint = function () { $('pwSub').textContent = 'መኪናው በ ' + fmtLeft(left) + ' ውስጥ ወይም ሲሞላ ይነሳል · Car leaves in ' + fmtLeft(left) + ' or when full'; left--; };
      paint(); pwTimer = setInterval(function () { if (left < 0) { clearInterval(pwTimer); return; } paint(); }, 1000);
      if (IN_TG) { TG.backHide(); TG.main('ውጣ · Leave the pool', leavePool); }
      return;
    }
    clearInterval(pwTimer);
    if (!r) { if (p.status === 'cancelled') { stopPoll(); reset(false); show('s-cancelled'); } return; }
    // From here the normal ride screens take over; the rider's own seat price replaces the car fare.
    var mine = Object.assign({}, r, { fareEtb: seat.fareEtb, pickup: S.pickup || r.pickup });
    S.ride = mine;
    if (r.status === 'dispatching' || r.status === 'requested') {
      show('s-finding');
      $('findTitle').innerHTML = 'መኪናው ተነስቷል · ሹፌር እየፈለግን ነው <small>Car is leaving with ' + p.filled + ' riders · finding your driver…</small>';
      $('findSub').textContent = 'ወደ ' + seat.stop.labelAm + ' ማቆሚያ ይሂዱ · Walk to ' + seat.stop.label + ' · your seat ' + seat.fareEtb + ' ETB';
      $('cancelFinding').classList.add('hidden');
      if (IN_TG) TG.mainHide();
      return;
    }
    $('cancelFinding').classList.remove('hidden');
    render(mine);
    if (['assigned', 'arriving', 'arrived', 'ontrip'].indexOf(r.status) >= 0) { $('cancelAssigned').classList.add('hidden'); $('aFare').textContent = seat.fareEtb + ' ETB'; $('aPay').textContent = '· your seat · ' + p.filled + ' riders · cash'; if (IN_TG) TG.mainHide(); }
    if (r.status === 'completed') { $('doneFare').textContent = seat.fareEtb + ' ETB'; $('payBox').innerHTML = seat.paid ? '<div class="small">✅ መቀመጫዎ ተከፍሏል · Seat paid with telebirr</div>' : ('<div class="small">💵 የመቀመጫዎን ' + seat.fareEtb + ' ETB ለሹፌሩ ይክፈሉ · Pay your seat to the driver in cash — ወይም · or</div><button class="cta" id="payTelebirrSeat">📱 ' + seat.fareEtb + ' ETB በቴሌብር ይክፈሉ · Pay with telebirr</button>'); var ps = $('payTelebirrSeat'); if (ps) ps.addEventListener('click', function () { payTelebirrSeat(seat); }); if (seat.paid || !S.pool) { lsDel('bina_pool_active'); S.pool = null; } }
    if (r.status === 'cancelled') { lsDel('bina_pool_active'); S.pool = null; }
  }
  function leavePool() {
    if (!S.pool) return;
    var go = function (yes) { if (!yes) return; api('/api/pool/' + S.pool.id + '/leave', { phone: ME.phone }).then(function (d) { if (d.ok) { stopPoll(); clearInterval(pwTimer); reset(false); setMode('solo'); toast('ወጥተዋል · You left the pool'); } else toast(d.error === 'car_already_leaving' ? 'መኪናው ተነስቷል · The car is already leaving — call the driver' : (d.error || 'Cannot leave now')); }).catch(function () { toast('Network error'); }); };
    if (IN_TG) TG.confirm('ከጋራ ጉዞው ይውጡ? · Leave the pool?', go); else go(confirm('ከጋራ ጉዞው ይውጡ? · Leave the pool?'));
  }
  $('pwLeave').addEventListener('click', leavePool);

  // ---- resume an active ride or pool after reload ----
  var active = lsGet('bina_ride_active'), activePool = lsGet('bina_pool_active');
  var P0 = new URLSearchParams(location.search);
  var urlId = P0.get('id'), urlPool = P0.get('pool');
  S.invite = (P0.get('join') || '').replace(/[^a-z0-9]/gi, '').slice(0, 40) || null;
  S.inviteGroup = (P0.get('group') || '').replace(/[^a-z0-9]/gi, '').slice(0, 40) || null;
  if (S.invite || S.inviteGroup) urlPool = urlPool || '1';
  if (IN_TG) {
    api('/api/pool/mine?initData=' + encodeURIComponent(TG.initData())).then(function (d) {
      if (d.ok && d.pool) {
        ME = ME || { name: (TG.user() || {}).first_name || 'Telegram user', tg: true }; ME.phone = d.phone; lsSet('bina_ride_me', JSON.stringify(ME));
        S.pool = { id: d.pool.id }; lsSet('bina_pool_active', d.pool.id); renderPool(d); startPoll(); return;
      }
      return api('/api/ride/mine?initData=' + encodeURIComponent(TG.initData())).then(function (d) {
        if (d.ok && d.ride) {
          ME = ME || { name: (TG.user() || {}).first_name || 'Telegram user', tg: true }; ME.phone = d.phone; lsSet('bina_ride_me', JSON.stringify(ME));
          S.ride = { id: d.ride.id }; lsSet('bina_ride_active', d.ride.id); render(d.ride); startPoll();
        } else if (urlPool === '1') setMode('pool');
      });
    }).catch(function () {});
  } else if (urlPool && urlPool !== '1' && ME) { S.pool = { id: urlPool }; startPoll(); }
  else if (activePool && ME) { S.pool = { id: activePool }; startPoll(); }
  else if ((urlId || active) && ME) { S.ride = { id: urlId || active }; startPoll(); }
  else if (urlPool === '1') setMode('pool');
})();
