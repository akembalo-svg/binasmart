/* Menu board for a tablet inside the restaurant. Reads the same catalogue the owner edits, so a
   price change on the phone reaches the wall within a minute. Nothing here is clickable: it is a
   board, not an app. ?dark=1 ?cols=2|3|4 ?table=5 ?speed=20 (seconds per page, 0 = no paging). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  var slug = (location.pathname.match(/^\/menu\/([a-z0-9-]+)/) || [])[1] || '';
  var TZ = 'Africa/Addis_Ababa';
  var speed = Math.max(0, Number(q.get('speed') == null ? 22 : q.get('speed')));
  if (q.get('dark') === '1') document.documentElement.setAttribute('data-dark', '');
  document.documentElement.style.setProperty('--cols', Math.max(1, Math.min(5, Number(q.get('cols')) || 3)));
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function birr(n) { return Number(n || 0).toLocaleString('en-US'); }

  function clock() {
    var d = new Date();
    $('clock').textContent = d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  }
  setInterval(clock, 10000); clock();

  // Keep the tablet awake if the browser allows it.
  var lock = null;
  function keepAwake() { if (navigator.wakeLock && !lock) navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }).catch(function () {}); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) keepAwake(); });
  document.addEventListener('click', keepAwake, { once: true });
  keepAwake();

  var pages = [], page = 0, timer = null;
  function paint(j) {
    var s = j.shop, list = j.products.filter(function (p) { return p.visible !== false; });
    $('name').textContent = s.nameAm || s.name;
    $('where').textContent = [s.categoryAm || s.category, s.unit ? 'ክፍል ' + s.unit : null, q.get('table') ? 'ጠረጴዛ ' + q.get('table') : null].filter(Boolean).join(' · ');
    $('logo').innerHTML = s.logoUrl ? '<img src="' + esc(s.logoUrl) + '" alt="">' : (s.photos && s.photos[0] ? '<img src="' + esc(s.photos[0]) + '" alt="">' : '🍽️');
    $('openState').textContent = s.open === true ? '🟢 ክፍት' : s.open === false ? '🔴 ዝግ' : '';
    $('phone').innerHTML = s.phone ? '📞 ' + esc(s.phone) : '';
    var url = location.origin + '/shop/' + slug + (q.get('table') ? '?table=' + encodeURIComponent(q.get('table')) : '');
    $('url').textContent = url.replace(/^https?:\/\//, '');
    $('qr').src = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=6&data=' + encodeURIComponent(url);

    if (!list.length) { $('main').innerHTML = '<div class="msg">ሜኑ ገና አልተጨመረም።<br>The menu has not been added yet.</div>'; return; }

    var groups = {}, order = [];
    list.forEach(function (p) { var k = p.category || ''; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(p); });
    var offers = (j.offers || []).map(function (o) { return '<div class="off">🏷️ ' + esc(o.titleAm || o.title) + (o.description ? ' — ' + esc(o.description) : '') + '</div>'; }).join('');
    var blocks = order.map(function (k) {
      return '<div class="grp">' + (k ? '<h2>' + esc(k) + '</h2>' : '') + groups[k].map(function (p) {
        return '<div class="it"><div class="n">' + esc(p.nameAm || p.name) + (p.nameAm && p.name !== p.nameAm ? '<small>' + esc(p.name) + '</small>' : '') + '</div><div class="dots"></div><div class="p">' + birr(p.price) + '</div></div>';
      }).join('') + '</div>';
    });

    // Split into pages that fit the screen, then cycle so a long menu still reads at a glance.
    $('main').innerHTML = '<div class="cols" id="cols">' + offers + blocks.join('') + '</div>';
    var cols = $('cols');
    if (speed && cols.scrollHeight > cols.clientHeight + 4) {
      pages = []; var cur = [], probe = document.createElement('div');
      probe.className = 'cols'; probe.style.cssText = 'position:absolute;visibility:hidden;width:' + cols.clientWidth + 'px;height:' + cols.clientHeight + 'px';
      document.body.appendChild(probe);
      blocks.forEach(function (b) {
        probe.innerHTML = (cur.concat([b])).join('');
        if (probe.scrollHeight > probe.clientHeight + 4 && cur.length) { pages.push(cur.join('')); cur = [b]; }
        else cur.push(b);
      });
      if (cur.length) pages.push(cur.join(''));
      probe.remove();
      if (pages.length > 1) {
        page = 0;
        var show = function () { cols.innerHTML = (page === 0 ? offers : '') + pages[page]; $('pager').textContent = (page + 1) + ' / ' + pages.length; page = (page + 1) % pages.length; };
        show(); clearInterval(timer); timer = setInterval(show, speed * 1000);
        return;
      }
    }
    $('pager').textContent = '';
  }

  function load() {
    fetch('/api/shops/' + slug).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { $('main').innerHTML = '<div class="msg">ገጹ አልተገኘም · page not found</div>'; return; }
      paint(j);
    }).catch(function () { /* keep the last good board on the screen */ });
  }
  load();
  setInterval(load, 60000);   // a price edited on the owner's phone shows here within a minute
})();
