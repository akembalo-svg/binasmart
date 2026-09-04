/* BinaSmart Cinema — listing (/cinema) and live seat map + checkout (/cinema/<showId>).
   The server owns seats and prices; this file only draws what /api/cinema says and asks politely. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var view = $('view'), bar = $('bar'), sheet = $('sheet'), toastEl = $('toast');
  var TZ = 'Africa/Addis_Ababa';
  var T = {
    taken: 'ይቅርታ፣ ይህ ወንበር አሁን ተያዘ · Sorry, that seat was just taken',
    sold: 'ይህ ወንበር ተሽጧል · That seat is sold',
    hold_expired: 'ጊዜው አልፏል፤ ወንበሮቹ ተለቀዋል፣ እንደገና ይምረጡ · Your hold expired — pick again',
    too_many: 'በአንድ ትዕዛዝ ከሚፈቀደው በላይ · Too many for one order',
    sold_out: 'ተሽጦ አልቋል · Sold out — {n} ቀርተዋል · left',
    show_closed: 'ይህ ትርዒት ተዘግቷል · This show is closed',
    no_show: 'ትርዒቱ አልተገኘም · Show not found',
    phone: 'የኢትዮጵያ ስልክ (09…) ያስፈልጋል · An Ethiopian phone (09…) is required',
    name: 'ስም ያስፈልጋል · Name is required',
    no_seats: 'ወንበር ይምረጡ · Pick at least one seat',
    too_many_requests: 'ትንሽ ቆይተው ይሞክሩ · Please wait a moment and try again',
    slow_down: 'ትንሽ ቆይተው ይሞክሩ · Please wait a moment',
    tg_expired: 'ከቴሌግራም እንደገና ይክፈቱ · Please reopen from the Telegram bot',
    net: 'ግንኙነት የለም · No connection'
  };
  var holder = (function () {
    try { var k = localStorage.getItem('bina_holder'); if (k && /^[A-Za-z0-9_-]{8,64}$/.test(k)) return k; } catch (e) {}
    var a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = 'h-';
    var arr = new Uint8Array(22); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(arr) : arr.forEach(function (_, i) { arr[i] = Math.random() * 256; });
    for (var i = 0; i < 22; i++) s += a[arr[i] % a.length];
    try { localStorage.setItem('bina_holder', s); } catch (e) {}
    return s;
  })();
  function api(path, opts) {
    opts = opts || {};
    var h = { 'x-holder': holder };
    if (opts.body) h['content-type'] = 'application/json';
    return fetch(path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'bad_json' }; }).then(function (j) { j._status = r.status; return j; }); })
      .catch(function () { return { ok: false, error: 'net' }; });
  }
  var toastT; function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 2600); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDay(d) { return new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtTime(d) { return new Date(d).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); }
  function birr(n) { return Number(n).toLocaleString('en-US') + ' ብር'; }
  var KIND = { FILM: '🎬 ፊልም · Film', CONCERT: '🎤 ኮንሰርት · Concert', THEATER: '🎭 ቲያትር · Theatre', MEETUP: '🤝 ስብሰባ · Meetup', OTHER: '🎟️ ዝግጅት · Event' };

  // ---------------- listing ----------------
  function renderList() {
    bar.hidden = true;
    api('/api/cinema/shows').then(function (j) {
      if (!j.ok) { view.innerHTML = '<div class="card">' + esc(T[j.error] || T.net) + '</div>'; return; }
      var groups = {}, order = [];
      j.shows.forEach(function (s) { var k = s.event.id; if (!groups[k]) { groups[k] = { ev: s.event, venue: s.venue, shows: [] }; order.push(k); } groups[k].shows.push(s); });
      var html = '<h1>ሲኒማ እና ዝግጅቶች</h1><p class="sub">ወንበርዎን በካርታው ላይ ይምረጡ፣ QR ትኬት ያግኙ · Pick your exact seat, get a QR ticket.' + (j.chapa && j.chapa.enabled && j.chapa.mode !== 'live' ? ' <span class="pill warn">🧪 Chapa TEST</span>' : '') + '</p>';
      if (!order.length) html += '<div class="card" style="margin-top:14px"><b>በቅርቡ · Coming soon.</b><div class="sub" style="margin-top:6px">ገና ትርዒት አልተለቀቀም። ሲኒማ ቤት ወይም የዝግጅት አዘጋጅ ነዎት? <a href="https://t.me/bina_smart_bot">@bina_smart_bot</a> ያነጋግሩን። · No shows on sale yet. Run a cinema or events? Talk to us.</div></div>';
      var cardFor = function (k) {
        var g = groups[k], e = g.ev, isFilm = e.kind === 'FILM';
        return '<div class="card ev"><div class="poster">' + (e.posterUrl ? '<img src="' + esc(e.posterUrl) + '" alt="" loading="lazy">' : esc(e.emoji || (isFilm ? '🎬' : '🎟️'))) + '</div><div>'
          + '<div class="t">' + esc(e.titleAm || e.title) + (e.titleAm && e.title !== e.titleAm ? '<small>' + esc(e.title) + '</small>' : '') + '</div>'
          + '<div class="meta">' + (KIND[e.kind] || KIND.OTHER) + (e.runtimeMin ? ' · ' + e.runtimeMin + ' ደቂቃ' : '') + (e.rating ? ' · ' + esc(e.rating) : '') + (e.language ? ' · ' + esc(e.language) : '') + '</div>'
          + '<div class="meta">📍 ' + esc(g.venue.nameAm || g.venue.name) + '</div>'
          + '<div class="times">' + g.shows.map(function (s) { var few = s.seatsLeft <= (s.ga ? 20 : 10); return '<a href="/cinema/' + esc(s.id) + '"' + (few ? ' class="few"' : '') + '>' + fmtDay(s.startsAt) + ' ' + fmtTime(s.startsAt) + '<b>ከ ' + birr(s.from) + (few ? ' · ' + s.seatsLeft + ' ቀርተዋል' : '') + '</b></a>'; }).join('') + '</div>'
          + '</div></div>';
      };
      var films = order.filter(function (k) { return groups[k].ev.kind === 'FILM'; }), events = order.filter(function (k) { return groups[k].ev.kind !== 'FILM'; });
      if (films.length) html += '<h2>🎬 ፊልሞች · Films</h2>' + films.map(cardFor).join('');
      if (events.length) html += '<h2>🎟️ ዝግጅቶች · Events</h2><p class="sub" style="margin:-4px 0 10px">ኮንሰርት፣ ቲያትር፣ ስብሰባ — ትኬትዎን ይምረጡ · concerts, theatre, meetings</p>' + events.map(cardFor).join('');
      view.innerHTML = html + '<div id="venues"></div>';
      renderVenues();
    });
  }
  // Directory of Addis cinemas: every active venue, with or without a show on sale.
  function renderVenues() {
    api('/api/cinema/venues').then(function (j) {
      var box = $('venues'); if (!box || !j.ok || !j.venues.length) return;
      var html = '<h2 style="margin-top:22px">ሲኒማ ቤቶች በአዲስ አበባ · Cinemas in Addis Ababa</h2><p class="sub">' + j.venues.length + ' ቦታዎች · ' + j.venues.length + ' venues. ሲኒማ ቤት ወይም አዘጋጅ ነዎት? <a href="/for-cinemas"><b>ትኬትዎን እዚህ ይሽጡ — በጅምር ወቅት ነፃ →</b></a> · Run a cinema or events? <a href="/for-cinemas">Sell tickets here, free during launch.</a></p>';
      j.venues.forEach(function (v) {
        var maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v.name + ', Addis Ababa');
        html += '<div class="card" style="margin-bottom:10px;padding:12px 14px"><div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><div style="font-weight:900;font-size:15px">' + esc(v.nameAm || v.name) + '</div>'
          + (v.nameAm ? '<div class="sub">' + esc(v.name) + '</div>' : '')
          + (v.address ? '<div class="sub" style="margin-top:4px">📍 ' + esc(v.address) + '</div>' : '')
          + (v.notes ? '<div class="sub" style="margin-top:2px;font-size:12px">' + esc(v.notes) + '</div>' : '')
          + '</div>' + (v.nextShowAt ? '<span class="pill ok">🎟️ ትኬት አለ</span>' : '<span class="pill mute">ትኬት በቅርቡ</span>') + '</div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' + (v.phone ? '<a class="btn ghost sm" href="tel:' + esc(v.phone) + '">📞 ' + esc(v.phone) + '</a>' : '') + '<a class="btn ghost sm" href="' + maps + '" target="_blank" rel="noopener">🗺️ ካርታ · Map</a>' + (v.website ? '<a class="btn ghost sm" href="' + esc(v.website) + '" target="_blank" rel="noopener nofollow">🌐 ድረ-ገጽ</a>' : '') + '</div></div>';
      });
      box.innerHTML = html;
    });
  }

  // ---------------- seat map ----------------
  var S = { show: null, layout: null, seats: [], tiers: null, mine: [], prices: {}, expiresAt: null, chapa: null, poll: null, tick: null, busy: {} };
  function sectionPrice(seat) { return S.prices[seat.section] != null ? S.prices[seat.section] : 0; }
  function seatById(id) { for (var i = 0; i < S.seats.length; i++) if (S.seats[i].id === id) return S.seats[i]; return null; }
  function total() {
    if (S.tiers) return S.tiers.reduce(function (n, t) { return n + t.mine * (t.price || 0); }, 0);
    return S.mine.reduce(function (n, id) { var s = seatById(id); return n + (s ? sectionPrice(s) : 0); }, 0);
  }
  // "VIP × 2 · Regular × 1" for general admission, "A5, C7" for seated halls.
  function mineText() {
    if (S.tiers) return S.tiers.filter(function (t) { return t.mine; }).map(function (t) { return (t.nameAm || t.name) + ' × ' + t.mine; }).join(' · ');
    return S.mine.slice().sort().join(', ');
  }
  function paint() { if (S.tiers) paintTiers(); else paintSeats(); }

  function load(showId, quiet) {
    return api('/api/cinema/shows/' + encodeURIComponent(showId)).then(function (j) {
      if (!j.ok) { if (!quiet) view.innerHTML = '<div class="card">' + esc(T[j.error] || T.net) + ' <a href="/cinema">← ሁሉም ትርዒቶች</a></div>'; return false; }
      S.show = j.show; S.layout = j.layout; S.seats = j.seats || []; S.tiers = j.tiers || null; S.mine = j.mine || []; S.prices = j.show.prices || {}; S.expiresAt = j.holdExpiresAt ? new Date(j.holdExpiresAt).getTime() : null; S.chapa = j.chapa; S.maxSeats = j.maxSeats || 8;
      if (!quiet) renderShow(); else paint();
      paintBar();
      return true;
    });
  }
  function renderShow() {
    var sh = S.show, e = sh.event, v = sh.venue;
    var secs = (S.layout.sections || []);
    var html = '<a href="/cinema" class="sub">← ሁሉም ትርዒቶች · All shows</a>'
      + '<div class="card showhead" style="margin-top:8px"><div class="poster">' + (e.posterUrl ? '<img src="' + esc(e.posterUrl) + '" alt="">' : esc(e.emoji || '🎬')) + '</div><div>'
      + '<h1 style="font-size:19px">' + esc(e.titleAm || e.title) + '</h1><div class="sub">' + (e.titleAm && e.title !== e.titleAm ? esc(e.title) + ' · ' : '') + fmtDay(sh.startsAt) + ' ' + fmtTime(sh.startsAt) + '</div>'
      + '<div class="sub">📍 ' + esc(v.nameAm || v.name) + ' · ' + esc(sh.hall.name) + '</div>'
      + (sh.status !== 'onsale' ? '<span class="pill bad">' + esc(T.show_closed) + '</span>' : '') + '</div></div>'
      + (S.tiers
        ? '<h2>ትኬት ይምረጡ · Pick your tickets</h2><div id="tiers"></div><p class="sub" style="margin-top:10px">የመረጡት ለ10 ደቂቃ ይያዝልዎታል፤ እስከ ' + S.maxSeats + ' በአንድ ትዕዛዝ። · Held for you for 10 minutes; up to ' + S.maxSeats + ' per order.</p>'
        : '<h2>ወንበር ይምረጡ · Pick your seats</h2><div class="legend">'
          + secs.map(function (s) { return '<span><i class="' + (s.name === 'VIP' ? 'vip' : '') + '"></i>' + esc(s.nameAm || s.name) + ' ' + birr(S.prices[s.name] || 0) + '</span>'; }).join('')
          + '<span><i class="mine"></i>የእርስዎ · yours</span><span><i class="held"></i>ተይዟል · held</span><span><i class="sold"></i>ተሽጧል · sold</span></div>'
          + '<div class="card" style="padding:12px 6px"><div class="screen"></div><div class="screen-l">ስክሪን · SCREEN</div><div class="mapwrap"><div class="map" id="map"></div></div></div>'
          + '<p class="sub" style="margin-top:10px">ወንበር ሲነኩ ለ10 ደቂቃ ይያዝልዎታል። · Tapping a seat holds it for you for 10 minutes.</p>');
    view.innerHTML = html;
    paint();
  }
  // General admission: one card per tier with a − / + stepper. The server decides what is left.
  function paintTiers() {
    var box = $('tiers'); if (!box || !S.tiers) return;
    var count = S.tiers.reduce(function (n, t) { return n + t.mine; }, 0);
    box.innerHTML = S.tiers.map(function (t) {
      var out = t.left === 0 && t.mine === 0;
      return '<div class="tier card' + (out ? ' out' : '') + '"><div class="ti"><div class="tn">' + esc(t.nameAm || t.name) + (t.nameAm ? ' <small>' + esc(t.name) + '</small>' : '') + '</div><div class="tp">' + birr(t.price) + '</div><div class="tl">' + (out ? 'ተሽጦ አልቋል · sold out' : t.left + ' ቀርተዋል · left') + '</div></div>'
        + '<div class="step"><button type="button" data-t="' + esc(t.name) + '" data-d="-1"' + (t.mine ? '' : ' disabled') + ' aria-label="less ' + esc(t.name) + '">−</button><b>' + t.mine + '</b><button type="button" data-t="' + esc(t.name) + '" data-d="1"' + (t.left && count < S.maxSeats ? '' : ' disabled') + ' aria-label="more ' + esc(t.name) + '">+</button></div></div>';
    }).join('');
  }
  function onTierTap(ev) {
    var b = ev.target.closest && ev.target.closest('.step button'); if (!b || b.disabled) return;
    var sec = b.getAttribute('data-t'), d = b.getAttribute('data-d'); if (S.busy[sec]) return; S.busy[sec] = true;
    var p = d === '1' ? api('/api/cinema/shows/' + S.show.id + '/hold', { body: { section: sec, qty: 1 } }) : api('/api/cinema/shows/' + S.show.id + '/release', { body: { section: sec, qty: 1 } });
    p.then(function (j) {
      if (!j.ok) toast(j.error === 'sold_out' ? T.sold_out.replace('{n}', j.left) : (T[j.error] || j.error || T.net));
      return load(S.show.id, true);
    }).then(function () { delete S.busy[sec]; });
  }
  function paintSeats() {
    var map = $('map'); if (!map) return;
    var rows = S.layout.rows, per = S.layout.seatsPerRow, aisles = S.layout.aisles || [];
    // Size seats so one full row fits the container (min 22px, max 34px); wider halls scroll.
    var avail = (map.parentElement.clientWidth || 340) - 2 * 12 - 4, aisle = per > 12 ? 8 : 14, gap = per > 12 ? 3 : 4;
    var sw = Math.max(17, Math.min(34, Math.floor((avail - aisles.length * aisle - (per - 1) * gap) / per)));
    map.style.setProperty('--gap', gap + 'px');
    map.style.setProperty('--sw', sw + 'px'); map.style.setProperty('--aisle', aisle + 'px');
    var html = '';
    rows.forEach(function (r) {
      html += '<div class="rowl"><span class="lab">' + esc(r) + '</span>';
      for (var n = 1; n <= per; n++) {
        var id = r + n, s = seatById(id); if (!s) continue;
        var st = S.mine.indexOf(id) >= 0 ? 'mine' : s.state;
        html += '<button type="button" class="seat ' + st + (s.section === 'VIP' ? ' vip' : '') + (s.wheelchair ? ' wc' : '') + (aisles.indexOf(n) >= 0 ? ' aisle' : '') + '" data-id="' + id + '"' + (st === 'held' || st === 'sold' || st === 'blocked' ? ' disabled' : '') + ' aria-label="' + id + ' ' + esc(s.section) + ' ' + st + '">' + (s.wheelchair ? '' : n) + '</button>';
      }
      html += '<span class="lab">' + esc(r) + '</span></div>';
    });
    map.innerHTML = html;
  }
  function paintBar() {
    if (!S.show) return;
    bar.hidden = false;
    var n = S.mine.length;
    $('barSeats').textContent = n ? mineText() : (S.tiers ? 'ትኬት ይምረጡ · pick tickets' : 'ወንበር ይምረጡ · pick seats');
    $('barTotal').textContent = n ? birr(total()) + ' · ' + n + (S.tiers ? ' ትኬት' : ' ወንበር') : '';
    $('barGo').disabled = !n || S.show.status !== 'onsale';
    paintCd();
  }
  function paintCd() {
    var el = $('barCd');
    if (!S.expiresAt || !S.mine.length) { el.textContent = ''; return; }
    var left = Math.max(0, Math.round((S.expiresAt - Date.now()) / 1000));
    el.textContent = '⏱ ' + Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2);
    el.className = 'cd' + (left < 60 ? ' low' : '');
    if (left === 0) { toast(T.hold_expired); S.mine = []; S.expiresAt = null; load(S.show.id, true); }
  }
  function onSeatTap(ev) {
    var b = ev.target.closest && ev.target.closest('.seat'); if (!b || b.disabled) return;
    var id = b.getAttribute('data-id'); if (S.busy[id]) return;
    S.busy[id] = true;
    var isMine = S.mine.indexOf(id) >= 0;
    var p = isMine
      ? api('/api/cinema/shows/' + S.show.id + '/release', { body: { seats: [id] } }).then(function (j) { if (j.ok) { S.mine = S.mine.filter(function (x) { return x !== id; }); if (!S.mine.length) S.expiresAt = null; } })
      : (S.mine.length >= S.maxSeats ? Promise.resolve(toast(T.too_many))
        : api('/api/cinema/shows/' + S.show.id + '/hold', { body: { seat: id } }).then(function (j) {
          if (j.ok) { S.mine.push(id); var exp = new Date(j.expiresAt).getTime(); if (!S.expiresAt || exp < S.expiresAt) S.expiresAt = S.expiresAt ? Math.min(S.expiresAt, exp) : exp; b.classList.add('mine'); }
          else { toast(T[j.error] || j.error || T.net); b.classList.add('flash'); setTimeout(function () { b.classList.remove('flash'); }, 500); if (j.error === 'taken' || j.error === 'sold') load(S.show.id, true); }
        }));
    p.then(function () { delete S.busy[id]; paintSeats(); paintBar(); });
  }

  // ---------------- checkout ----------------
  var idem = null, contactResp = null;
  function openSheet() {
    if (!S.mine.length) return;
    idem = idem || ('c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));
    $('shSeats').textContent = (S.show.event.titleAm || S.show.event.title) + ' · ' + mineText() + ' · ' + fmtDay(S.show.startsAt) + ' ' + fmtTime(S.show.startsAt);
    $('shTotal').textContent = birr(total());
    var u = window.TG && TG.user && TG.user();
    if (u && !$('fName').value) $('fName').value = [u.first_name, u.last_name].filter(Boolean).join(' ');
    var chapaOn = S.chapa && S.chapa.enabled;
    $('pay').innerHTML = '<label class="on"><input type="radio" name="pm" value="counter" checked> <span>🏪 በካውንተር ይክፈሉ · Pay at the counter<small>ከትርዒቱ ' + (S.show.counterCutoffMin || 30) + ' ደቂቃ በፊት ካልተከፈለ ወንበሩ ይለቀቃል · unpaid ' + (S.show.counterCutoffMin || 30) + ' min before showtime = released</small></span></label>'
      + (chapaOn ? '<label><input type="radio" name="pm" value="chapa"> <span>💳 Chapa · ቴሌብር፣ CBE Birr፣ ካርድ' + (S.chapa.mode !== 'live' ? ' <span class="pill warn">🧪 TEST</span>' : '') + '<small>ወዲያውኑ ይረጋገጣል · confirmed instantly</small></span></label>' : '');
    Array.prototype.forEach.call(document.querySelectorAll('#pay label'), function (l) { l.addEventListener('click', function () { Array.prototype.forEach.call(document.querySelectorAll('#pay label'), function (x) { x.classList.remove('on'); }); l.classList.add('on'); }); });
    $('shErr').textContent = '';
    sheet.classList.add('on');
    if (window.TG && TG.isTelegram && TG.isTelegram() && !$('fPhone').value) {
      TG.requestContact(function (ok) { if (ok) { contactResp = TG.contact(); var ph = contactResp && contactResp.contact && contactResp.contact.phone_number; if (ph) $('fPhone').value = ph; } });
    }
  }
  function submit() {
    var btn = $('shGo'), err = $('shErr'); err.textContent = '';
    var pm = (document.querySelector('input[name=pm]:checked') || {}).value || 'counter';
    var body = { showId: S.show.id, seats: S.mine.slice(), name: $('fName').value.trim(), phone: $('fPhone').value.trim(), payMethod: pm, idemKey: idem };
    if ($('fGuest').checked) body.guest = { name: $('gName').value.trim(), phone: $('gPhone').value.trim() };
    if (window.TG && TG.initData && TG.initData()) body.tg = { initData: TG.initData(), contact: contactResp || undefined };
    if (!body.name && !(body.guest && body.guest.name)) { err.textContent = T.name; return; }
    btn.disabled = true; btn.textContent = '…';
    api('/api/cinema/tickets', { body: body }).then(function (j) {
      btn.disabled = false; btn.textContent = '🎟️ ትኬት ይግዙ · Get ticket';
      if (!j.ok) { err.textContent = T[j.error] || j.error || T.net; if (j.error === 'hold_expired' || j.error === 'sold') { sheet.classList.remove('on'); S.mine = []; S.expiresAt = null; load(S.show.id, true); } return; }
      idem = null;
      if (j.checkoutUrl) { location.href = j.checkoutUrl; return; }
      location.href = '/ticket/' + j.ticket.code + (j.chapaError ? '?chapa=failed' : '');
    });
  }

  // ---------------- boot ----------------
  var m = location.pathname.match(/^\/cinema\/([A-Za-z0-9_-]+)\/?$/);
  if (m) {
    load(m[1]).then(function (ok) {
      if (!ok) return;
      view.addEventListener('click', onSeatTap);
      view.addEventListener('click', onTierTap);
      S.poll = setInterval(function () { if (!sheet.classList.contains('on')) load(S.show.id, true); }, 5000);
      S.tick = setInterval(paintCd, 1000);
    });
    $('barGo').addEventListener('click', openSheet);
    $('shBack').addEventListener('click', function () { sheet.classList.remove('on'); });
    $('shGo').addEventListener('click', submit);
    $('fGuest').addEventListener('change', function () { $('guestBox').hidden = !$('fGuest').checked; });
    if (window.TG && TG.back) TG.back(function () { location.href = '/cinema'; });
  } else {
    renderList();
  }
})();
