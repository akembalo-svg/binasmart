/* BinaWatch — home, live TV, radio, films, kids (/watch) and the film player (/watch/<slug>).
   TV and kids play the broadcaster's own YouTube channel: the live stream when it is on, otherwise
   its latest upload. Radio plays the station's own public stream. Films keep the rental flow: the
   video source only arrives from the play call, after the server has checked the film is public and
   (if paid) the rental is active. v3, 7 Sep 2026. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var view = $('view'), sheet = $('sheet'), toastEl = $('toast');
  var TZ = 'Africa/Addis_Ababa';
  var T = { unavailable: 'ይህ ፊልም አሁን አይገኝም · This film is not available', rent: 'ለመመልከት ይከራዩ · Rent to watch', expired: 'ኪራዩ አልፏል · Your rental has expired', net: 'የአውታረ መረብ ችግር · Network error', phone: 'ትክክለኛ ስልክ ያስገቡ · Enter a valid phone', name: 'ስም ያስገቡ · Enter your name', chapa_off: 'ኪራይ ገና አልተከፈተም · Rentals not open yet', slow_down: 'ትንሽ ቆይተው ይሞክሩ · Please wait a moment' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function birr(n) { return Number(n).toLocaleString('en-US') + ' ብር'; }
  function when(d) { return new Date(d).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function ago(d) { if (!d) return ''; var days = Math.round((Date.now() - new Date(d).getTime()) / 86400000); return days <= 0 ? 'ዛሬ · today' : days === 1 ? 'ትናንት · yesterday' : days < 30 ? days + ' ቀን · ' + days + 'd ago' : Math.round(days / 30) + ' ወር · ' + Math.round(days / 30) + 'mo ago'; }
  function views(n) { return n == null ? '' : (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n)) + ' እይታ'; }
  var tt; function toast(m) { toastEl.textContent = m; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { toastEl.classList.remove('on'); }, 2800); }
  function api(p, body) { return fetch(p, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json(); }); }
  function yt(id, autoplay) { return 'https://www.youtube-nocookie.com/embed/' + esc(id) + '?rel=0&modestbranding=1&playsinline=1' + (autoplay ? '&autoplay=1' : ''); }
  function initials(c) { var w = (c.name || '').replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean); if (w[0] && w[0].length <= 4 && w[0] === w[0].toUpperCase()) return esc(w[0]); return esc(w.slice(0, 2).map(function (x) { return x[0]; }).join('').toUpperCase() || '▶'); }
  function liveTitle(c) { var t = (c.liveTitle || '').trim(); return t.length > 4 && !/^(test|live|stream)$/i.test(t) ? t : (c.name + ' · ቀጥታ ስርጭት · live broadcast'); }
  var q = new URLSearchParams(location.search);
  var D = { live: null, radio: null, films: null, series: null };

  // ---------- tabs ----------
  var TABS = [['home', '🏠', 'መነሻ', 'Home'], ['tv', '📺', 'ቲቪ', 'Live TV'], ['series', '🎞️', 'ተከታታይ', 'Series'], ['films', '🎬', 'ፊልሞች', 'Films'], ['radio', '📻', 'ራዲዮ', 'Radio']];
  function paintTabs(on) {
    var el = $('tabs'); if (!el) return;
    el.innerHTML = TABS.map(function (t) { return '<a href="/watch#' + t[0] + '" class="' + (on === t[0] ? 'on' : '') + '"><i>' + t[1] + '</i>' + t[2] + '<small>' + t[3] + '</small></a>'; }).join('');
  }
  function loadLive() { return D.live ? Promise.resolve(D.live) : api('/api/watch/live').then(function (j) { D.live = j; return j; }); }
  function loadRadio() { return D.radio ? Promise.resolve(D.radio) : api('/api/watch/radio').then(function (j) { D.radio = j; return j; }); }
  function loadSeries() { return D.series ? Promise.resolve(D.series) : api('/api/watch/series').then(function (j) { D.series = j; return j; }); }
  function loadFilms() { return D.films ? Promise.resolve(D.films) : api('/api/watch/films').then(function (j) { D.films = j; return j; }); }

  // ---------- pieces ----------
  function chTile(c, big) {
    return '<a class="ch" href="/watch#tv/' + esc(c.id) + '"><div class="tile" style="background:linear-gradient(135deg,' + esc(c.color) + ',#0F172A)">' + (c.live ? '<span class="live">LIVE</span>' : '') + initials(c) + '</div><div class="n">' + esc(c.nameAm || c.name) + '</div><div class="s">' + esc(c.live ? 'ቀጥታ · live now' : (c.tag || c.name)) + '</div></a>';
  }
  function vidTile(v, c) {
    return '<a class="vid" href="/watch#tv/' + esc(c.id) + '/' + esc(v.id) + '"><div class="th"><img src="' + esc(v.thumb) + '" alt="" loading="lazy"><span class="d">' + esc(c.name) + '</span></div><div class="n">' + esc(v.title) + '</div><div class="s">' + esc([ago(v.published), views(v.views)].filter(Boolean).join(' · ')) + '</div></a>';
  }
  function srTile(sr, big) {
    return '<a class="sr' + (big ? ' big' : '') + '" href="/watch#series/' + esc(sr.id) + '"><div class="th">' + (sr.cover ? '<img src="' + esc(sr.cover) + '" alt="" loading="lazy">' : '') + '<span class="d" style="background:' + esc(sr.color) + '">' + esc(sr.channelName) + '</span>' + (sr.latest.length ? '<span class="n">' + sr.latest.length + '+ ክፍል</span>' : '') + '</div><div class="t">' + esc(sr.titleAm || sr.title) + '</div><div class="m">' + esc([sr.title !== sr.titleAm ? sr.title : null, sr.kind === 'drama' ? 'ድራማ' : sr.kind === 'show' ? 'ሾው' : 'ልጆች'].filter(Boolean).join(' · ')) + '</div></a>';
  }
  function card(f) {
    return '<a class="film" href="/watch/' + esc(f.slug) + '"><div class="p">' + (f.posterUrl ? '<img src="' + esc(f.posterUrl) + '" alt="" loading="lazy">' : '🎞️') + '<span class="tag' + (f.free ? ' free' : '') + '">' + (f.free ? 'ነፃ · Free' : birr(f.priceEtb)) + '</span></div>'
      + '<div class="t">' + esc(f.titleAm || f.title) + '</div><div class="m">' + [f.titleAm && f.title !== f.titleAm ? f.title : null, f.year, f.runtimeMin ? f.runtimeMin + ' ደቂቃ' : null, f.genre].filter(Boolean).map(esc).join(' · ') + '</div></a>';
  }
  function radioRow(r) {
    var on = R.cur && R.cur.id === r.id && !R.audio.paused;
    return '<div class="rad' + (on ? ' on' : '') + '" data-r="' + esc(r.id) + '"><div class="ic" style="background:linear-gradient(135deg,' + esc(r.color) + ',#0F172A)">' + initials(r) + '</div><div><b>' + esc(r.nameAm || r.name) + '</b><small>' + esc(r.tag || r.name) + (r.site ? ' · <a href="' + esc(r.site) + '" target="_blank" rel="noopener">' + esc(r.site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</a>' : '') + '</small></div><div class="go">' + (on ? '❚❚' : '▶') + '</div></div>';
  }

  // ---------- home ----------
  function renderHome() {
    paintTabs('home');
    view.innerHTML = '<div class="skel"></div>';
    Promise.all([loadLive(), loadFilms(), loadRadio(), loadSeries()]).then(function (a) {
      var L = a[0], F = a[1], Rd = a[2], S = (a[3].series || []);
      var tv = (L.tv || []), kids = (L.kids || []), films = (F.films || []), radio = (Rd.radio || []);
      var liveNow = tv.filter(function (c) { return c.live; });
      var html = '';
      var h = liveNow[0];
      if (h) html += '<a class="hero" href="/watch#tv/' + esc(h.id) + '"><img src="https://i.ytimg.com/vi/' + esc(h.videoId) + '/hqdefault.jpg" alt=""><div class="sh"></div><div class="tx"><span class="live">ቀጥታ · LIVE</span><div class="t">' + esc(h.nameAm || h.name) + '</div><div class="m">' + esc(liveTitle(h)) + '</div><div class="act"><span class="btn">▶ አሁን ይመልከቱ · Watch now</span></div></div></a>';
      else if (films[0]) { var f0 = films[0]; html += '<a class="hero" href="/watch/' + esc(f0.slug) + '">' + (f0.posterUrl ? '<img src="' + esc(f0.posterUrl) + '" alt="">' : '') + '<div class="sh"></div><div class="tx"><span class="k">አዲስ · New</span><div class="t">' + esc(f0.titleAm || f0.title) + '</div><div class="m">' + esc([f0.title !== f0.titleAm ? f0.title : null, f0.year, f0.genre].filter(Boolean).join(' · ')) + '</div><div class="act"><span class="btn">▶ ' + (f0.free ? 'ነፃ ይመልከቱ · Watch free' : 'ይከራዩ · Rent') + '</span></div></div></a>'; }
      html += '<h2>📺 ቀጥታ ቲቪ <small>Live TV</small><a class="more" href="/watch#tv">ሁሉም →</a></h2><div class="rowx">' + tv.slice().sort(function (a, b) { return (b.live ? 1 : 0) - (a.live ? 1 : 0); }).map(function (c) { return chTile(c); }).join('') + '</div>';
      var dramas = S.filter(function (x) { return x.kind === 'drama'; });
      if (dramas.length) html += '<h2>🎞️ ተከታታይ ድራማ <small>Series</small><a class="more" href="/watch#series">ሁሉም →</a></h2><div class="rowx">' + dramas.slice(0, 12).map(function (x) { return srTile(x); }).join('') + '</div>';
      var fresh = [].concat.apply([], tv.map(function (c) { return (c.latest || []).slice(0, 1).map(function (v) { return { v: v, c: c }; }); })).sort(function (a, b) { return (b.v.published || '').localeCompare(a.v.published || ''); }).slice(0, 10);
      if (fresh.length) html += '<h2>🆕 ዛሬ የወጡ <small>Latest programmes</small></h2><div class="rowx">' + fresh.map(function (x) { return vidTile(x.v, x.c); }).join('') + '</div>';
      if (films.length) html += '<h2>🎬 ፊልሞች <small>Films</small><a class="more" href="/watch#films">ሁሉም →</a></h2><div class="rowx frow">' + films.slice(0, 10).map(card).join('') + '</div>';
      if (kids[0] && kids[0].latest && kids[0].latest.length) html += '<h2>🧸 ለልጆች <small>Kids</small><a class="more" href="/watch#kids">ሁሉም →</a></h2><div class="rowx">' + kids[0].latest.slice(0, 6).map(function (v) { return vidTile(v, kids[0]); }).join('') + '</div>';
      if (radio.length) html += '<h2>📻 ራዲዮ <small>Radio</small><a class="more" href="/watch#radio">ሁሉም →</a></h2><div class="rowx">' + radio.map(function (r) { return '<a class="ch" href="/watch#radio/' + esc(r.id) + '"><div class="tile" style="background:linear-gradient(135deg,' + esc(r.color) + ',#0F172A)">' + initials(r) + '</div><div class="n">' + esc(r.nameAm || r.name) + '</div><div class="s">' + esc(r.tag || '') + '</div></a>'; }).join('') + '</div>';
      html += '<p class="note">ቲቪ እና ራዲዮ የሚጫወቱት ከጣቢያዎቹ የራሳቸው ይፋዊ ዥረት ነው፤ ፊልሞቹ በፈቃድ የቀረቡ ናቸው። · TV and radio play from each broadcaster\'s own official stream; films are licensed.' + (L.updatedAt ? ' <span class="sub">ቀጥታ ሁኔታ ' + when(L.updatedAt) + '</span>' : '') + '</p>';
      view.innerHTML = html;
    }).catch(function () { view.innerHTML = '<div class="card">' + T.net + '</div>'; });
  }

  // ---------- TV ----------
  function renderTV() {
    paintTabs('tv'); view.innerHTML = '<div class="skel"></div>';
    loadLive().then(function (L) {
      var tv = (L.tv || []).slice().sort(function (a, b) { return (b.live ? 1 : 0) - (a.live ? 1 : 0); });
      view.innerHTML = '<h1>ቀጥታ ቲቪ <span class="sub">· Live TV</span></h1><p class="sub">የኢትዮጵያ ጣቢያዎች — ቀጥታ ሲሆኑ ቀጥታ፣ ካልሆኑ የቅርብ ፕሮግራማቸው። · Ethiopian channels: live when they are on air, otherwise their latest programme.</p>'
        + '<div class="cgrid" style="margin-top:14px">' + tv.map(function (c) { return chTile(c, true); }).join('') + '</div>';
    });
  }
  function renderChannel(id, vidId, kind) {
    paintTabs(kind === 'kids' ? 'home' : 'tv'); view.innerHTML = '<div class="skel"></div>';
    loadLive().then(function (L) {
      var c = (L.tv || []).concat(L.kids || []).filter(function (x) { return x.id === id; })[0];
      if (!c) { view.innerHTML = '<div class="card">ጣቢያው አልተገኘም · Channel not found. <a href="/watch#tv">← ቲቪ</a></div>'; return; }
      var playing = vidId || (c.live ? c.videoId : (c.latest[0] && c.latest[0].id));
      var isLive = c.live && playing === c.videoId;
      var cur = (c.latest || []).filter(function (v) { return v.id === playing; })[0];
      var html = '<a class="back" href="/watch#' + (kind === 'kids' ? 'kids' : 'tv') + '">‹ ' + (kind === 'kids' ? 'ልጆች' : 'ሁሉም ጣቢያዎች · All channels') + '</a>'
        + '<div class="player">' + (playing ? '<iframe src="' + yt(playing, true) + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="' + esc(c.name) + '"></iframe>' : '<div class="cover"><div class="play">▶</div></div>') + '</div>'
        + '<div style="display:flex;align-items:center;gap:10px;margin-top:12px"><div class="ic" style="width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-weight:900;color:#fff;background:linear-gradient(135deg,' + esc(c.color) + ',#0F172A)">' + initials(c) + '</div><div style="min-width:0"><h1 style="font-size:19px">' + esc(c.nameAm || c.name) + ' ' + (isLive ? '<span class="live">ቀጥታ · LIVE</span>' : '<span class="pill mute">አሁን ቀጥታ አይደለም · not live now</span>') + '</h1><div class="sub">' + esc(isLive ? liveTitle(c) : (cur ? cur.title : '')) + '</div></div></div>'
        + (c.site ? '<div class="note">ይፋዊ ገጽ · Official: <a href="' + esc(c.site) + '" target="_blank" rel="noopener">' + esc(c.site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</a> · <a href="https://www.youtube.com/channel/' + esc(c.yt) + '" target="_blank" rel="noopener">YouTube</a></div>' : '')
        + '<h2>የቅርብ ፕሮግራሞች <small>Latest</small></h2><ul class="list">' + (c.latest || []).map(function (v) { return '<li class="' + (v.id === playing ? 'on' : '') + '" data-v="' + esc(v.id) + '"><div class="th"><img src="' + esc(v.thumb) + '" alt="" loading="lazy"></div><div><b>' + esc(v.title) + '</b><small>' + esc([ago(v.published), views(v.views)].filter(Boolean).join(' · ')) + '</small></div></li>'; }).join('') + '</ul>';
      view.innerHTML = html;
      view.querySelectorAll('.list li').forEach(function (li) { li.addEventListener('click', function () { location.hash = (kind === 'kids' ? '#kids/' : '#tv/') + c.id + '/' + li.dataset.v; }); });
      window.scrollTo(0, 0);
    });
  }
  function renderKids() {
    paintTabs('home'); view.innerHTML = '<div class="skel"></div>';
    Promise.all([loadLive(), loadSeries()]).then(function (a) { var L = a[0];
      var kids = L.kids || [];
      var html = '<h1>ለልጆች <span class="sub">· Kids</span></h1><p class="sub">የአማርኛ የልጆች መዝሙሮችና ተረቶች ከጣቢያዎቹ ይፋዊ ቻናል። · Amharic songs and stories from the makers\' own channels.</p>';
      (D.series && D.series.series ? D.series.series : []).filter(function (x) { return x.kind === 'kids'; }).forEach(function (sr) { html += '<h2>' + esc(sr.titleAm) + ' <small>' + esc(sr.title) + '</small><a class="more" href="/watch#series/' + esc(sr.id) + '">ሁሉም →</a></h2><div class="rowx">' + (sr.latest || []).slice(0, 8).map(function (v) { return '<a class="vid" href="/watch#series/' + esc(sr.id) + '/' + esc(v.id) + '"><div class="th"><img src="' + esc(v.thumb) + '" alt="" loading="lazy"></div><div class="n">' + esc(v.title) + '</div><div class="s">' + esc(ago(v.published)) + '</div></a>'; }).join('') + '</div>'; });
      kids.forEach(function (c) { html += '<h2>' + esc(c.nameAm || c.name) + ' <small>' + esc(c.name) + '</small><a class="more" href="/watch#kids/' + esc(c.id) + '">ሁሉም →</a></h2><div class="rowx">' + (c.latest || []).map(function (v) { return '<a class="vid" href="/watch#kids/' + esc(c.id) + '/' + esc(v.id) + '"><div class="th"><img src="' + esc(v.thumb) + '" alt="" loading="lazy"></div><div class="n">' + esc(v.title) + '</div><div class="s">' + esc(ago(v.published)) + '</div></a>'; }).join('') + '</div>'; });
      if (!kids.length) html += '<div class="card">በቅርቡ · Coming soon.</div>';
      view.innerHTML = html;
    });
  }

  // ---------- radio ----------
  var R = { audio: new Audio(), cur: null };
  R.audio.preload = 'none';
  // Android/Telegram webviews refuse audio that starts without a touch (NotAllowedError). When a deep link
  // asked for a station, show one big "tap to play" sheet; the first touch anywhere starts the stream.
  function armTapToPlay(r) {
    var s = document.getElementById('tapPlay');
    if (!s) { s = document.createElement('div'); s.id = 'tapPlay'; s.setAttribute('style', 'position:fixed;left:12px;right:12px;bottom:76px;z-index:60;background:linear-gradient(135deg,rgba(0,200,150,.96),rgba(0,150,136,.94));color:#fff;border-radius:18px;padding:16px 18px;display:flex;align-items:center;gap:14px;box-shadow:0 12px 34px rgba(0,0,0,.25);font-weight:800;font-size:17px;cursor:pointer'); document.body.appendChild(s); }
    s.innerHTML = '<span style="font-size:30px">▶️</span><span>' + esc(r.nameAm || r.name) + '<br><small style="font-weight:600;opacity:.9">ለማጫወት ይንኩ · Tap to play</small></span>';
    var go = function () { R.audio.play().catch(function () {}); s.remove(); document.removeEventListener('pointerdown', go, true); paintNow(); };
    s.onclick = go;
    document.addEventListener('pointerdown', go, true); // any first touch on the page counts
  }
  function playRadio(r) {
    if (R.cur && R.cur.id === r.id && !R.audio.paused) { R.audio.pause(); paintNow(); return; }
    R.cur = r; R.audio.src = r.stream;
    R.audio.play().catch(function (e) {
      if (e && /NotAllowed/i.test(e.name || '')) { armTapToPlay(r); return; }
      toast('መጫወት አልተቻለም — ' + (r.site ? 'በጣቢያው ገጽ ይሞክሩ' : 'እንደገና ይሞክሩ') + ' · Could not play');
    });
    paintNow();
  }
  function paintNow() {
    var n = $('now'); if (!n) return;
    if (!R.cur) { n.className = 'now'; return; }
    var on = !R.audio.paused;
    n.className = 'now on';
    n.innerHTML = '<div class="ic" style="background:linear-gradient(135deg,' + esc(R.cur.color) + ',#0F172A)">' + initials(R.cur) + '</div><div style="min-width:0"><b>' + esc(R.cur.nameAm || R.cur.name) + '</b><small>' + (on ? 'ቀጥታ · live radio' : 'ቆሟል · paused') + '</small></div>' + (on ? '<div class="bars"><i></i><i></i><i></i><i></i></div>' : '') + '<button type="button" id="nowBtn" aria-label="play/pause">' + (on ? '❚❚' : '▶') + '</button>';
    $('nowBtn').addEventListener('click', function () { if (R.audio.paused) R.audio.play().catch(function () {}); else R.audio.pause(); paintNow(); });
    view.querySelectorAll('.rad').forEach(function (el) { var isOn = el.dataset.r === R.cur.id && on; el.classList.toggle('on', isOn); el.querySelector('.go').textContent = isOn ? '❚❚' : '▶'; });
  }
  R.audio.addEventListener('play', paintNow); R.audio.addEventListener('pause', paintNow); R.audio.addEventListener('error', function () { toast('ዥረቱ አልተገኘም · Stream unavailable right now'); paintNow(); });
  function renderRadio(autoId) {
    paintTabs('radio'); view.innerHTML = '<div class="skel"></div>';
    loadRadio().then(function (j) {
      var radio = j.radio || [];
      view.innerHTML = '<h1>ራዲዮ <span class="sub">· Radio</span></h1><p class="sub">የኢትዮጵያ ኤፍኤም ጣቢያዎች — ከየጣቢያው ይፋዊ ዥረት። ስልኩን ቆልፈው ማዳመጥ ይችላሉ። · Ethiopian FM stations from their own streams. Keeps playing with the screen off.</p><div style="margin-top:12px">' + radio.map(radioRow).join('') + '</div><p class="note">ራዲዮ በደቂቃ ~1 ሜባ ይጠቀማል። · Radio uses about 1 MB per minute.</p>';
      view.querySelectorAll('.rad').forEach(function (el) { el.addEventListener('click', function (e) { if (e.target.tagName === 'A') return; var r = radio.filter(function (x) { return x.id === el.dataset.r; })[0]; if (r) playRadio(r); }); });
      if (autoId) { var r0 = radio.filter(function (x) { return x.id === autoId; })[0]; if (r0 && !(R.cur && R.cur.id === r0.id)) playRadio(r0); }
      paintNow();
    });
  }

  // ---------- series ----------
  var SR_KINDS = [['all', 'ሁሉም', 'All'], ['drama', 'ድራማ', 'Drama'], ['show', 'ሾው', 'Shows'], ['kids', 'ልጆች', 'Kids']];
  function renderSeries(kind) {
    paintTabs('series'); view.innerHTML = '<div class="skel"></div>'; kind = kind || 'all';
    loadSeries().then(function (j) {
      var all = j.series || [];
      var list = kind === 'all' ? all : all.filter(function (x) { return x.kind === kind; });
      var chips = SR_KINDS.map(function (k) { return '<a class="chip' + (k[0] === kind ? ' on' : '') + '" href="/watch#series' + (k[0] === 'all' ? '' : '/kind/' + k[0]) + '">' + k[1] + ' <small>' + k[2] + '</small></a>'; }).join('');
      view.innerHTML = '<h1>ተከታታይ <span class="sub">· Series</span></h1><p class="sub">የኢትዮጵያ ተከታታይ ድራማዎችና ሾዎች — ከጣቢያዎቹ ይፋዊ ቻናል፣ ክፍል በክፍል። · Ethiopian drama series and shows, episode by episode, from the broadcasters\' own channels.</p><div class="chips">' + chips + '</div>'
        + '<div class="sgrid">' + list.map(function (x) { return srTile(x, true); }).join('') + '</div>';
      window.scrollTo(0, 0);
    });
  }
  function renderSeriesOne(id, vidId) {
    paintTabs('series'); view.innerHTML = '<div class="skel"></div>';
    loadSeries().then(function (j) {
      var sr = (j.series || []).filter(function (x) { return x.id === id; })[0];
      if (!sr) { view.innerHTML = '<div class="card">አልተገኘም · Not found. <a href="/watch#series">← ተከታታይ</a></div>'; return; }
      var eps = sr.latest || [];
      var playing = vidId || null;
      var src = playing ? 'https://www.youtube-nocookie.com/embed/' + esc(playing) + '?list=' + esc(sr.pl) + '&rel=0&modestbranding=1&playsinline=1&autoplay=1' : 'https://www.youtube-nocookie.com/embed/videoseries?list=' + esc(sr.pl) + '&rel=0&modestbranding=1&playsinline=1';
      var html = '<a class="back" href="/watch#series/kind/' + esc(sr.kind) + '">‹ ተከታታይ · Series</a>'
        + '<div class="player"><iframe src="' + src + '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="' + esc(sr.title) + '"></iframe></div>'
        + '<h1 style="font-size:21px;margin-top:12px">' + esc(sr.titleAm || sr.title) + '</h1><div class="sub">' + esc([sr.title !== sr.titleAm ? sr.title : null, sr.channelName, sr.kind === 'drama' ? 'ተከታታይ ድራማ · drama series' : sr.kind === 'show' ? 'ሾው · show' : 'ለልጆች · kids'].filter(Boolean).join(' · ')) + '</div>'
        + '<div class="note">' + (playing ? '<a href="/watch#series/' + esc(sr.id) + '">▶ ከክፍል 1 ጀምሮ · Play from episode 1</a> · ' : 'ከመጀመሪያው ክፍል ይጫወታል፤ ቀጣዩ ራሱ ይቀጥላል። · Plays from episode 1 and continues automatically. ') + '<a href="https://www.youtube.com/playlist?list=' + esc(sr.pl) + '" target="_blank" rel="noopener">YouTube ↗</a></div>'
        + '<h2>ክፍሎች <small>Episodes · latest ' + eps.length + '</small></h2><ul class="list">' + eps.map(function (v) { return '<li class="' + (v.id === playing ? 'on' : '') + '" data-v="' + esc(v.id) + '"><div class="th"><img src="' + esc(v.thumb) + '" alt="" loading="lazy"></div><div><b>' + esc(v.title) + '</b><small>' + esc([ago(v.published), views(v.views)].filter(Boolean).join(' · ')) + '</small></div></li>'; }).join('') + '</ul>';
      view.innerHTML = html;
      view.querySelectorAll('.list li').forEach(function (li) { li.addEventListener('click', function () { location.hash = '#series/' + sr.id + '/' + li.dataset.v; }); });
      window.scrollTo(0, 0);
    });
  }

  // ---------- films (list) ----------
  function renderFilms() {
    paintTabs('films'); view.innerHTML = '<div class="skel"></div>';
    loadFilms().then(function (j) {
      if (!j.ok) { view.innerHTML = '<div class="card">' + T.net + '</div>'; return; }
      var html = '<h1>ፊልሞች <span class="sub">· Films</span></h1><p class="sub">ፈቃድ ያላቸው የአማርኛ ፊልሞች — ነፃ ወይም ለ48 ሰዓት ኪራይ። · Licensed Amharic films: free, or rented for 48 hours.</p>';
      html += j.films.length ? '<div class="grid" style="margin-top:14px">' + j.films.map(card).join('') + '</div>' : '<div class="card" style="margin-top:14px"><b>በቅርቡ · Coming soon.</b></div>';
      html += '<p class="foot">ፊልም ሰሪ ነዎት? <a href="/for-filmmakers">ፊልምዎን ያቅርቡ →</a></p>';
      view.innerHTML = html;
    });
  }

  // ---------- film page (unchanged flow) ----------
  var F = null, rentalCode = null;
  function renderFilm(slug) {
    paintTabs('films');
    try { rentalCode = q.get('rental') || localStorage.getItem('bw_' + slug) || null; } catch (e) { rentalCode = q.get('rental'); }
    api('/api/watch/films/' + encodeURIComponent(slug) + (rentalCode ? '?rental=' + encodeURIComponent(rentalCode) : '')).then(function (j) {
      if (!j.ok) { view.innerHTML = '<div class="card">' + T.unavailable + ' <a href="/watch#films">← ሁሉም ፊልሞች</a></div>'; return; }
      F = j.film; var r = j.rental; var chapaOn = j.chapa && j.chapa.enabled;
      if (r && r.status === 'ACTIVE') { try { localStorage.setItem('bw_' + slug, r.code); } catch (e) {} }
      var html = '<a href="/watch#films" class="back">‹ ሁሉም ፊልሞች · All films</a>'
        + '<div class="player" id="player"><div class="cover" id="cover">' + (F.posterUrl ? '<img src="' + esc(F.posterUrl) + '" alt="">' : '') + '<div class="play">▶</div></div></div>'
        + '<h1 style="font-size:22px;margin-top:12px">' + esc(F.titleAm || F.title) + '</h1><div class="sub">' + [F.titleAm && F.title !== F.titleAm ? F.title : null, F.year, F.runtimeMin ? F.runtimeMin + ' ደቂቃ' : null, F.genre, F.language, F.rating].filter(Boolean).map(esc).join(' · ') + '</div>'
        + '<div id="rent" class="rent"></div>'
        + (F.descr ? '<div class="card" style="margin-top:12px;font-size:14px">' + esc(F.descr).replace(/\n/g, '<br>') + '</div>' : '');
      view.innerHTML = html;
      paintRent(r, chapaOn);
      if (F.trailerEmbed) { var rb = $('rent'); rb.insertAdjacentHTML('afterend', '<button type="button" class="btn ghost sm" id="trailerBtn" style="margin-top:8px">▶ ትሬለር · Trailer</button>'); $('trailerBtn').addEventListener('click', function () { $('player').innerHTML = '<iframe src="' + esc(F.trailerEmbed) + '&autoplay=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>'; }); }
      $('cover').addEventListener('click', play);
      if (r && r.status === 'PENDING' && q.get('paid') === '1') verify(r.code, 0);
    });
  }
  function paintRent(r, chapaOn) {
    var box = $('rent'); if (!box) return;
    if (F.free) { box.innerHTML = '<span class="pill ok">ነፃ · Free</span>'; return; }
    if (r && r.status === 'ACTIVE') { box.innerHTML = '<span class="pill ok">✅ ተከራይተዋል · Rented</span> <span class="sub">እስከ ' + when(r.expiresAt) + ' · until ' + when(r.expiresAt) + '</span>'; return; }
    if (r && r.status === 'PENDING') { box.innerHTML = '<span class="pill warn">⏳ ክፍያ በመጠበቅ ላይ · awaiting payment</span> <button class="btn sm ghost" id="chk">🔄 አረጋግጥ · Check</button>'; $('chk').addEventListener('click', function () { verify(r.code, 99); }); return; }
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
        else { var sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.15/hls.min.js'; sc.onload = function () { if (window.Hls && Hls.isSupported()) { var h = new Hls(); h.loadSource(s.url); h.attachMedia(v); } }; document.head.appendChild(sc); }
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

  // ---------- router ----------
  function route() {
    var m = location.pathname.match(/^\/watch\/([a-z0-9-]+)\/?$/);
    if (m) { renderFilm(m[1]); return; }
    var h = (location.hash || '#home').slice(1).split('/');
    if (h[0] === 'tv' && h[1]) renderChannel(h[1], h[2] || null, 'tv');
    else if (h[0] === 'tv') renderTV();
    else if (h[0] === 'series' && h[1] === 'kind') renderSeries(h[2] || 'all');
    else if (h[0] === 'series' && h[1]) renderSeriesOne(h[1], h[2] || null);
    else if (h[0] === 'series') renderSeries('all');
    else if (h[0] === 'radio') renderRadio(h[1] || null);
    else if (h[0] === 'films') renderFilms();
    else if (h[0] === 'kids' && h[1]) renderChannel(h[1], h[2] || null, 'kids');
    else if (h[0] === 'kids') renderKids();
    else renderHome();
  }
  // Deep links from Bini / Telegram use ?open=radio/sheger: inside a Telegram Mini App the URL hash is replaced by
  // Telegram's own launch data, so a #radio/sheger link would land on Home. Translate the query into the hash once.
  try {
    var openParam = new URLSearchParams(location.search).get('open');
    if (openParam && /^[a-z]+(\/[a-z0-9_-]+){0,2}$/i.test(openParam)) {
      history.replaceState(null, '', location.pathname + '#' + openParam);
    }
  } catch (e) {}
  window.addEventListener('hashchange', route);
  if ($('shGo')) { $('shGo').addEventListener('click', submit); $('shBack').addEventListener('click', function () { sheet.classList.remove('on'); }); }
  if (window.TG && TG.back) TG.back(function () { if (location.pathname !== '/watch') location.href = '/watch'; else if (location.hash && location.hash !== '#home') location.hash = '#home'; });
  route();
})();
