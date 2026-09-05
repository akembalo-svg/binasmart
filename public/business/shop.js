/* The public page of one shop or office: photos, catalogue, offers, hours, and an order that the
   shop confirms by phone. Everything shown comes from the owner's own dashboard. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TZ = 'Africa/Addis_Ababa';
  var T = { not_found: 'ይህ ገጽ አልተገኘም · Page not found', name: 'ስም ያስፈልጋል · Name required', phone: 'የኢትዮጵያ ስልክ (09…) ያስፈልጋል · Ethiopian phone required',
    no_items: 'ምንም አልመረጡም · Nothing selected', too_many_requests: 'ትንሽ ቆይተው ይሞክሩ · Please wait a moment', net: 'ግንኙነት የለም · No connection' };
  var DAYS = [['mon', 'ሰኞ · Mon'], ['tue', 'ማክሰኞ · Tue'], ['wed', 'ረቡዕ · Wed'], ['thu', 'ሐሙስ · Thu'], ['fri', 'ዓርብ · Fri'], ['sat', 'ቅዳሜ · Sat'], ['sun', 'እሁድ · Sun']];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function birr(n) { return Number(n || 0).toLocaleString('en-US') + ' ብር'; }
  var tt; function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('on'); }, 2800); }
  function api(p, body) {
    return fetch(p, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'net' }; }); })
      .catch(function () { return { ok: false, error: 'net' }; });
  }
  var slug = (location.pathname.match(/^\/shop\/([a-z0-9-]+)/) || [])[1] || '';
  var S = null, cart = {};

  function todayKey() { return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(new Date().toLocaleString('en-US', { timeZone: TZ })).getDay()]; }

  function render(j) {
    S = j.shop;
    var s = S, p = j.products, offers = j.offers;
    var where = s.building ? (s.building.nameAm || s.building.name) + (s.unit ? ' · ' + s.unit : '') : (s.address || 'አዲስ አበባ');
    var maps = s.mapUrl || (s.building && s.building.lat ? 'https://www.google.com/maps/search/?api=1&query=' + s.building.lat + ',' + s.building.lng : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((s.name || '') + ', Addis Ababa'));
    var open = s.open;
    var html = '<div class="card"><div class="hero"><div class="logo-img">' + (s.logoUrl ? '<img src="' + esc(s.logoUrl) + '" alt="">' : '🏪') + '</div><div style="flex:1;min-width:0">'
      + '<h1>' + esc(s.nameAm || s.name) + (s.nameAm && s.name !== s.nameAm ? '<span class="en">' + esc(s.name) + '</span>' : '') + '</h1>'
      + '<div class="sub" style="margin-top:4px">' + esc(s.categoryAm || s.category) + ' · 📍 ' + esc(where) + '</div>'
      + (open === true ? '<span class="pill ok" style="margin-top:6px">🟢 አሁን ክፍት · open now</span>' : open === false ? '<span class="pill mute" style="margin-top:6px">🔴 አሁን ዝግ · closed now</span>' : '')
      + '</div></div>'
      + ((s.photos || []).length ? '<div class="gal">' + s.photos.map(function (u) { return '<img src="' + esc(u) + '" alt="' + esc(s.nameAm || s.name) + '" loading="lazy">'; }).join('') + '</div>' : '')
      + ((s.aboutAm || s.about || s.descriptionAm || s.description) ? '<p class="sub" style="margin-top:12px;color:var(--ink)">' + esc(s.aboutAm || s.about || s.descriptionAm || s.description).replace(/\n/g, '<br>') + '</p>' : '')
      + '<div class="acts">'
      + '<a href="tel:' + esc(s.phone) + '">📞 ደውሉ · Call</a>'
      + (s.telegram && !/^\d+$/.test(s.telegram) ? '<a href="https://t.me/' + esc(String(s.telegram).replace(/^@/, '')) + '" target="_blank" rel="noopener">✈️ ቴሌግራም</a>' : '')
      + '<a href="' + esc(maps) + '" target="_blank" rel="noopener">🗺️ ካርታ · Map</a>'
      + (s.socialLink ? '<a href="' + esc(s.socialLink) + '" target="_blank" rel="noopener nofollow">🌐 ድረ-ገጽ</a>' : '')
      + '<a href="#" id="shareBtn">🔗 አጋራ · Share</a>'
      + '</div></div>';

    offers.forEach(function (o) {
      html += '<div class="offer"><b>🏷️ ' + esc(o.titleAm || o.title) + '</b>' + (o.description ? '<div class="sub">' + esc(o.description) + '</div>' : '')
        + '<div class="sub" style="font-size:12px">እስከ · until ' + new Date(o.endsAt).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }) + '</div></div>';
    });

    if (p.length) {
      var groups = {}, order = [];
      p.forEach(function (x) { var k = x.category || ''; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(x); });
      html += '<div class="card" style="margin-top:12px"><h2 style="margin:0">ምርቶች · Menu <span class="sub" style="font-weight:600">' + p.length + '</span></h2><div class="menu">';
      order.forEach(function (k) {
        if (k) html += '<div class="grp">' + esc(k) + '</div>';
        groups[k].forEach(function (x) {
          html += '<div class="prod"><div class="ph">' + (x.photoUrl ? '<img src="' + esc(x.photoUrl) + '" alt="' + esc(x.nameAm || x.name) + '" loading="lazy">' : '🛍️') + '</div>'
            + '<div class="b"><b>' + esc(x.nameAm || x.name) + '</b>' + (x.nameAm && x.name !== x.nameAm ? '<small>' + esc(x.name) + '</small>' : '') + (x.description ? '<small>' + esc(x.description) + '</small>' : '') + '</div>'
            + '<span class="price">' + birr(x.price) + '</span>'
            + '<div class="qtybox"><button data-m="' + x.id + '" disabled>−</button><b data-q="' + x.id + '">0</b><button data-p="' + x.id + '">+</button></div></div>';
        });
      });
      html += '</div></div>';
    } else {
      html += '<div class="card" style="margin-top:12px"><div class="sub">ገና ምርት አልተጨመረም። ለማዘዝ ይደውሉ። · No products listed yet — please call.</div></div>';
    }

    if (s.openingHours) {
      var tk = todayKey();
      html += '<div class="card" style="margin-top:12px"><h2 style="margin:0 0 8px">የስራ ሰዓት · Opening hours</h2><table class="hours-t">'
        + DAYS.map(function (d) { var r = (s.openingHours || {})[d[0]] || {}; return '<tr' + (d[0] === tk ? ' class="today"' : '') + '><td>' + d[1] + '</td><td>' + (r.closed || !r.open ? 'ዝግ · closed' : esc(r.open) + ' – ' + esc(r.close)) + '</td></tr>'; }).join('')
        + '</table></div>';
    }
    if (s.building) html += '<p class="sub" style="margin-top:12px">🏢 <a href="/b/' + esc(s.building.slug) + '">' + esc(s.building.nameAm || s.building.name) + '</a> ውስጥ ካሉ ሌሎች ሱቆች ጋር ይመልከቱ · see the other shops in this building</p>';
    $('view').innerHTML = html;
    $('foot').innerHTML = 'ይህ ገጽ በ' + esc(s.nameAm || s.name) + ' ራሱ ይተዳደራል · This page is managed by the business itself on BinaSmart. · <a href="/for-business">ሱቅ አለዎት? ገጽዎን ይያዙ →</a>';
    var sb = $('shareBtn');
    if (sb) sb.addEventListener('click', function (e) {
      e.preventDefault();
      var data = { title: s.nameAm || s.name, text: (s.nameAm || s.name) + ' · BinaSmart', url: location.href };
      if (navigator.share) navigator.share(data).catch(function () {});
      else navigator.clipboard.writeText(location.href).then(function () { toast('ሊንኩ ተቀድቷል · link copied'); });
    });
    paintBar();
  }

  function items() { return Object.keys(cart).filter(function (k) { return cart[k].qty > 0; }).map(function (k) { return cart[k]; }); }
  function total() { return items().reduce(function (n, i) { return n + i.price * i.qty; }, 0); }
  function paintBar() {
    var list = items();
    $('bar').hidden = !list.length;
    if (!list.length) return;
    $('barItems').textContent = list.map(function (i) { return i.name + ' ×' + i.qty; }).join(', ');
    $('barTotal').textContent = birr(total()) + ' · ' + list.reduce(function (n, i) { return n + i.qty; }, 0) + ' ዕቃ';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.qtybox button'); if (!b) return;
    var id = b.dataset.p || b.dataset.m; if (!id) return;
    var row = b.closest('.prod');
    var name = row.querySelector('.b b').textContent, price = Number((row.querySelector('.price').textContent || '').replace(/[^\d]/g, '')) || 0;
    cart[id] = cart[id] || { productId: id, name: name, price: price, qty: 0 };
    cart[id].qty = Math.max(0, Math.min(20, cart[id].qty + (b.dataset.p ? 1 : -1)));
    row.querySelector('[data-q="' + id + '"]').textContent = cart[id].qty;
    row.querySelector('button[data-m="' + id + '"]').disabled = cart[id].qty === 0;
    paintBar();
  });

  $('barGo').addEventListener('click', function () {
    $('shItems').textContent = items().map(function (i) { return i.name + ' ×' + i.qty; }).join(', ');
    $('shTotal').textContent = birr(total());
    $('shErr').textContent = '';
    $('sheet').classList.add('on');
  });
  $('shBack').addEventListener('click', function () { $('sheet').classList.remove('on'); });
  $('shGo').addEventListener('click', function () {
    var btn = $('shGo'); btn.disabled = true; btn.textContent = '…';
    api('/api/shops/' + slug + '/order', { name: $('fName').value.trim(), phone: $('fPhone').value.trim(), note: $('fNote').value.trim(), items: items().map(function (i) { return { productId: i.productId, qty: i.qty }; }) })
      .then(function (j) {
        btn.disabled = false; btn.textContent = '📞 ትዕዛዝ ላክ · Send order';
        if (!j.ok) { $('shErr').textContent = T[j.error] || j.error || T.net; return; }
        $('sheet').classList.remove('on');
        cart = {}; paintBar();
        $('view').insertAdjacentHTML('afterbegin', '<div class="card" style="background:#ecfdf5;border-color:#a7f3d0;margin-bottom:12px"><b>✅ ትዕዛዝዎ ደርሷል · Order received</b><div class="sub">' + esc(S.nameAm || S.name) + ' በስልክ ያረጋግጣል። · The shop will call you to confirm.</div></div>');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
  });

  api('/api/shops/' + slug).then(function (j) {
    if (!j.ok) { $('view').innerHTML = '<div class="card">' + T.not_found + ' <a href="/">← BinaSmart</a></div>'; return; }
    render(j);
  });
})();
