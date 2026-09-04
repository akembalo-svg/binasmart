/* BinaSmart Watch — grid (/watch) and player (/watch/<slug>). The video source only arrives from
   the play call, after the server has checked the film is public and (if paid) the rental is active. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var view = $('view'), sheet = $('sheet'), toastEl = $('toast');
  var TZ = 'Africa/Addis_Ababa';
  var T = { unavailable: 'ይህ ፊልም አሁን አይገኝም · This film is not available', rent: 'ለመመልከት ይከራዩ · Rent to watch', expired: 'ኪራዩ አልፏል · Your rental has expired', chapa_off: 'ኪራይ በቅርቡ · Rentals coming soon', phone: 'የኢትዮጵያ ስልክ (09…) ያስፈልጋል · Ethiopian phone required', name: 'ስም ያስፈልጋል · Name required', net: 'ግንኙነት የለም · No connection', chapa_failed: 'Chapa አልተከፈተም፤ እንደገና ይሞክሩ · Chapa did not open, try again' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function birr(n) { return Number(n).toLocaleString('en-US') + ' ብር'; }
  function when(d) { return new Date(d).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  var tt; function toast(m) { toastEl.textContent = m; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { toastEl.classList.remove('on'); }, 2800); }
  function api(p, body) { return fetch(p, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'net' }; }); }).catch(function () { return { ok: false, error: 'net' }; }); }
  var q = new URLSearchParams(location.search);

  function card(f) {
    return '<a class="film" href="/watch/' + esc(f.slug) + '"><div class="p">' + (f.posterUrl ? '<img src="' + esc(f.posterUrl) + '" alt="" loading="lazy">' : '🎞️') + '<span class="tag' + (f.free ? ' free' : '') + '">' + (f.free ? 'ነፃ · Free' : birr(f.priceEtb)) + '</span></div>'
      + '<div class="t">' + esc(f.titleAm || f.title) + '</div><div class="m">' + [f.titleAm && f.title !== f.titleAm ? f.title : null, f.year, f.runtimeMin ? f.runtimeMin + ' ደቂቃ' : null, f.genre].filter(Boolean).map(esc).join(' · ') + '</div></a>';
  }
  function renderList() {
    api('/api/watch/films').then(function (j) {
      if (!j.ok) { view.innerHTML = '<div class="card">' + T.net + '</div>'; return; }
      var html = '<h1>ይመልከቱ · Watch</h1><p class="sub">ፈቃድ ያላቸው የአማርኛ ፊልሞች — ነፃ ወይም ለ48 ሰዓት ኪራይ። · Licensed Amharic films: free, or rent for 48 hours.' + (j.chapa && j.chapa.enabled && j.chapa.mode !== 'live' ? ' <span class="pill warn">🧪 Chapa TEST</span>' : '') + '</p>';
      html += j.films.length ? '<div class="grid" style="margin-top:14px">' + j.films.map(card).join('') + '</div>' : '<div class="card" style="margin-top:14px"><b>በቅርቡ · Coming soon.</b><div class="sub" style="margin-top:6px">የመጀመሪያዎቹ ፊልሞች በፈቃድ እየተዘጋጁ ነው። ፊልም ሰሪ ነዎት? <a href="https://t.me/bina_smart_bot">@bina_smart_bot</a> · The first licensed films are on their way.</div></div>';
      view.innerHTML = html;
    });
  }

  var F = null, rentalCode = null;
  function renderFilm(slug) {
    try { rentalCode = q.get('rental') || localStorage.getItem('bw_' + slug) || null; } catch (e) { rentalCode = q.get('rental'); }
    api('/api/watch/films/' + encodeURIComponent(slug) + (rentalCode ? '?rental=' + encodeURIComponent(rentalCode) : '')).then(function (j) {
      if (!j.ok) { view.innerHTML = '<div class="card">' + T.unavailable + ' <a href="/watch">← ሁሉም ፊልሞች</a></div>'; return; }
      F = j.film; var r = j.rental; var chapaOn = j.chapa && j.chapa.enabled;
      if (r && r.status === 'ACTIVE') { try { localStorage.setItem('bw_' + slug, r.code); } catch (e) {} }
      var html = '<a href="/watch" class="sub">← ሁሉም ፊልሞች · All films</a>'
        + '<div class="player" id="player" style="margin-top:8px"><div class="cover" id="cover">' + (F.posterUrl ? '<img src="' + esc(F.posterUrl) + '" alt="">' : '') + '<div class="play">▶</div></div></div>'
        + '<h1 style="font-size:22px;margin-top:12px">' + esc(F.titleAm || F.title) + '</h1><div class="sub">' + [F.titleAm && F.title !== F.titleAm ? F.title : null, F.year, F.runtimeMin ? F.runtimeMin + ' ደቂቃ' : null, F.rating, F.genre, F.language].filter(Boolean).map(esc).join(' · ') + '</div>'
        + '<div id="rent" class="rent"></div>'
        + (F.descr ? '<div class="card" style="margin-top:12px;font-size:14px">' + esc(F.descr).replace(/\n/g, '<br>') + '</div>' : '');
      view.innerHTML = html;
      paintRent(r, chapaOn);
      $('cover').addEventListener('click', play);
      if (r && r.status === 'PENDING' && q.get('paid') === '1') verify(r.code, 0);
    });
  }
  function paintRent(r, chapaOn) {
    var box = $('rent'); if (!box) return;
    if (F.free) { box.innerHTML = '<span class="pill ok">ነፃ · Free</span>'; return; }
    if (r && r.status === 'ACTIVE') { box.innerHTML = '<span class="pill ok">✅ ተከራይተዋል · Rented</span> <span class="sub">እስከ ' + when(r.expiresAt) + ' · until ' + when(r.expiresAt) + '</span>'; return; }
    if (r && r.status === 'PENDING') { box.innerHTML = '<span class="pill warn">⏳ ክፍያ በመጠበቅ ላይ · awaiting payment</span> <button class="btn sm ghost" id="chk">🔄 አረጋግጥ · Check</button>'; $('chk').addEventListener('click', function () { verify(r.code, 0); }); return; }
    box.innerHTML = '<div class="card"><div class="price">' + birr(F.priceEtb) + ' <small style="font-size:13px;color:var(--mute)">/ ' + F.rentHours + ' ሰዓት · hours</small></div>'
      + (r && r.status === 'EXPIRED' ? '<div class="sub">' + T.expired + '</div>' : '')
      + '<button class="btn" id="rentBtn" style="margin-top:10px"' + (chapaOn ? '' : ' disabled') + '>' + (chapaOn ? '💳 ይከራዩ · Rent now' : '🔒 ኪራይ በቅርቡ · Rentals coming soon') + '</button></div>';
    if (chapaOn) $('rentBtn').addEventListener('click', openSheet);
  }
  function play() {
    api('/api/watch/films/' + encodeURIComponent(F.slug) + '/play', { rental: rentalCode || undefined }).then(function (j) {
      if (!j.ok) { toast(T[j.error] || j.error || T.net); if (j.error === 'expired') { try { localStorage.removeItem('bw_' + F.slug); } catch (e) {} renderFilm(F.slug); } return; }
      var p = $('player'), s = j.source;
      if (s.kind === 'youtube') p.innerHTML = '<iframe src="' + esc(s.url) + '&autoplay=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
      else if (s.kind === 'mp4') p.innerHTML = '<video controls autoplay playsinline controlsList="nodownload" ' + (F.posterUrl ? 'poster="' + esc(F.posterUrl) + '"' : '') + '><source src="' + esc(s.url) + '" type="video/mp4"></video>';
      else if (s.kind === 'hls') {
        p.innerHTML = '<video controls autoplay playsinline controlsList="nodownload" id="hlsv"></video>';
        var v = $('hlsv');
        if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = s.url; }
        else { var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.15/hls.min.js'; sc.onload = function () { if (window.Hls && Hls.isSupported()) { var h = new Hls(); h.loadSource(s.url); h.attachMedia(v); } else toast('ይህ ብራውዘር HLS አያጫውትም · This browser cannot play HLS'); }; document.head.appendChild(sc); }
      }
    });
  }
  function openSheet() {
    $('shHours').textContent = F.rentHours; $('shHours2').textContent = F.rentHours;
    $('shFilm').textContent = (F.titleAm || F.title); $('shPrice').textContent = birr(F.priceEtb); $('shErr').textContent = '';
    var u = window.TG && TG.user && TG.user(); if (u && !$('fName').value) $('fName').value = [u.first_name, u.last_name].filter(Boolean).join(' ');
    sheet.classList.add('on');
    if (window.TG && TG.isTelegram && TG.isTelegram() && !$('fPhone').value) TG.requestContact(function (ok) { if (ok) { var c = TG.contact(); var ph = c && c.contact && c.contact.phone_number; if (ph) $('fPhone').value = ph; } });
  }
  function submit() {
    var err = $('shErr'), btn = $('shGo'); err.textContent = ''; btn.disabled = true;
    var body = { slug: F.slug, name: $('fName').value.trim(), phone: $('fPhone').value.trim() };
    if (window.TG && TG.initData && TG.initData()) body.tg = { initData: TG.initData(), contact: TG.contact() || undefined };
    api('/api/watch/rent', body).then(function (j) {
      btn.disabled = false;
      if (!j.ok) { err.textContent = T[j.error] || j.error || T.net; return; }
      try { localStorage.setItem('bw_' + F.slug, j.rental.code); } catch (e) {}
      location.href = j.checkoutUrl;
    });
  }
  function verify(code, tries) {
    api('/api/watch/rentals/' + encodeURIComponent(code) + '/verify', {}).then(function (j) {
      if (j.status === 'ACTIVE') { rentalCode = code; try { localStorage.setItem('bw_' + F.slug, code); } catch (e) {} toast('✅ ተከራይተዋል · Rented'); renderFilm(F.slug); }
      else if (tries < 6 && q.get('paid') === '1') setTimeout(function () { verify(code, tries + 1); }, 3000);
      else toast('ክፍያው ገና አልተረጋገጠም · Payment not confirmed yet');
    });
  }
  var m = location.pathname.match(/^\/watch\/([a-z0-9-]+)\/?$/);
  if (m) { renderFilm(m[1]); $('shGo').addEventListener('click', submit); $('shBack').addEventListener('click', function () { sheet.classList.remove('on'); }); if (window.TG && TG.back) TG.back(function () { location.href = '/watch'; }); }
  else renderList();
})();
