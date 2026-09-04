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
    too_many: 'በአንድ ትዕዛዝ እስከ 8 ወንበር · Up to 8 seats per order',
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
      order.forEach(function (k) {
        var g = groups[k], e = g.ev;
        html += '<div class="card ev"><div class="poster">' + (e.posterUrl ? '<img src="' + esc(e.posterUrl) + '" alt="" loading="lazy">' : esc(e.emoji || '🎬')) + '</div><div>'
          + '<div class="t">' + esc(e.titleAm || e.title) + (e.titleAm && e.title !== e.titleAm ? '<small>' + esc(e.title) + '</small>' : '') + '</div>'
          + '<div class="meta">' + (KIND[e.kind] || KIND.OTHER) + (e.runtimeMin ? ' · ' + e.runtimeMin + ' ደቂቃ' : '') + (e.rating ? ' · ' + esc(e.rating) : '') + (e.language ? ' · ' + esc(e.language) : '') + '</div>'
          + '<div class="meta">📍 ' + esc(g.venue.nameAm || g.venue.name) + '</div>'
          + '<div class="times">' + g.shows.map(function (s) { return '<a href="/cinema/' + esc(s.id) + '"' + (s.seatsLeft <= 10 ? ' class="few"' : '') + '>' + fmtDay(s.startsAt) + ' ' + fmtTime(s.startsAt) + '<b>ከ ' + birr(s.from) + (s.seatsLeft <= 10 ? ' · ' + s.seatsLeft + ' ቀርተዋል' : '') + '</b></a>'; }).join('') + '</div>'
          + '</div></div>';
      });
      view.innerHTML = html;
    });
  }

  // ---------------- seat map ----------------
  var S = { show: null, layout: null, seats: [], mine: [], prices: {}, expiresAt: null, chapa: null, poll: null, tick: null, busy: {} };
  function sectionPrice(seat) { return S.prices[seat.section] != null ? S.prices[seat.section] : 0; }
  function seatById(id) { for (var i = 0; i < S.seats.length; i++) if (S.seats[i].id === id) return S.seats[i]; return null; }
  function total() { return S.mine.reduce(function (n, id) { var s = seatById(id); return n + (s ? sectionPrice(s) : 0); }, 0); }

  function load(showId, quiet) {
    return api('/api/cinema/shows/' + encodeURIComponent(showId)).then(function (j) {
      if (!j.ok) { if (!quiet) view.innerHTML = '<div class="card">' + esc(T[j.error] || T.net) + ' <a href="/cinema">← ሁሉም ትርዒቶች</a></div>'; return false; }
      S.show = j.show; S.layout = j.layout; S.seats = j.seats; S.mine = j.mine || []; S.prices = j.show.prices || {}; S.expiresAt = j.holdExpiresAt ? new Date(j.holdExpiresAt).getTime() : null; S.chapa = j.chapa; S.maxSeats = j.maxSeats || 8;
      if (!quiet) renderShow(); else paintSeats();
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
      + '<h2>ወንበር ይምረጡ · Pick your seats</h2><div class="legend">'
      + secs.map(function (s) { return '<span><i class="' + (s.name === 'VIP' ? 'vip' : '') + '"></i>' + esc(s.nameAm || s.name) + ' ' + birr(S.prices[s.name] || 0) + '</span>'; }).join('')
      + '<span><i class="mine"></i>የእርስዎ · yours</span><span><i class="held"></i>ተይዟል · held</span><span><i class="sold"></i>ተሽጧል · sold</span></div>'
      + '<div class="card" style="padding:12px 6px"><div class="screen"></div><div class="screen-l">ስክሪን · SCREEN</div><div class="mapwrap"><div class="map" id="map"></div></div></div>'
      + '<p class="sub" style="margin-top:10px">ወንበር ሲነኩ ለ10 ደቂቃ ይያዝልዎታል። · Tapping a seat holds it for you for 10 minutes.</p>';
    view.innerHTML = html;
    paintSeats();
  }
  function paintSeats() {
    var map = $('map'); if (!map) return;
    var rows = S.layout.rows, per = S.layout.seatsPerRow, aisles = S.layout.aisles || [];
    // Size seats so one full row fits the container (min 22px, max 34px); wider halls scroll.
    var avail = (map.parentElement.clientWidth || 340) - 2 * 20 - 8, aisle = per > 12 ? 10 : 14;
    var sw = Math.max(22, Math.min(34, Math.floor((avail - aisles.length * aisle - (per - 1) * 4) / per)));
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
    $('barSeats').textContent = n ? S.mine.slice().sort().join(', ') : 'ወንበር ይምረጡ · pick seats';
    $('barTotal').textContent = n ? birr(total()) + ' · ' + n + ' ወንበር' : '';
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
    $('shSeats').textContent = (S.show.event.titleAm || S.show.event.title) + ' · ' + S.mine.slice().sort().join(', ') + ' · ' + fmtDay(S.show.startsAt) + ' ' + fmtTime(S.show.startsAt);
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
