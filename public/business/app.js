/* BinaSmart Business dashboard. Deliberately small: the building owner keeps /owner for property
   management; a shop or venue owner only needs their page, catalogue, offers and orders. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var TZ = 'Africa/Addis_Ababa';
  var T = {
    sign_in: 'እባክዎ እንደገና ይግቡ · Please sign in again', phone: 'የኢትዮጵያ ስልክ (09…) ያስፈልጋል · Ethiopian phone required',
    no_match: 'በዚህ ስልክ የተመዘገበ ሱቅ የለም · No shop is registered with that phone', bad_code: 'ኮዱ ትክክል አይደለም · Wrong code',
    expired: 'ጊዜው አልፏል፤ እንደገና ይጀምሩ · Expired, start again', too_many: 'ብዙ ሙከራ · Too many attempts',
    too_many_requests: 'ትንሽ ቆይተው ይሞክሩ · Please wait a moment', name: 'ስም ያስፈልጋል · Name required', price: 'ዋጋ ያስፈልጋል · Price required',
    title: 'ርዕስ ያስፈልጋል · Title required', dates: 'ቀኖቹን ያስተካክሉ · Check the dates', times: 'ሰዓት ያስፈልጋል · Showtimes required',
    link: 'ሊንኩ https:// መሆን አለበት · Links must start with https://', image: 'ፎቶው አልተነበበም · Could not read that image',
    too_big: 'ፎቶው ትልቅ ነው (5MB) · Photo too large', net: 'ግንኙነት የለም · No connection', bad_status: 'ይህ ቅደም ተከተል አይፈቀድም · Not allowed from here'
  };
  var DAYS = [['mon', 'ሰኞ'], ['tue', 'ማክሰኞ'], ['wed', 'ረቡዕ'], ['thu', 'ሐሙስ'], ['fri', 'ዓርብ'], ['sat', 'ቅዳሜ'], ['sun', 'እሁድ']];
  var tok = null; try { tok = localStorage.getItem('bs_owner') || null; } catch (e) {}
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function birr(n) { return Number(n || 0).toLocaleString('en-US') + ' ብር'; }
  function when(d) { return new Date(d).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  var tt; function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('on'); }, 2600); }
  function api(path, body, method) {
    var h = { 'content-type': 'application/json' };
    if (tok) h['x-owner-token'] = tok;
    return fetch(path, { method: method || (body ? 'POST' : 'GET'), headers: h, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'net' }; }); })
      .catch(function () { return { ok: false, error: 'net' }; });
  }
  function err(el, j) { $(el).textContent = T[j.error] || j.error || T.net; }

  // ---------------- sign in ----------------
  var claimId = null;
  $('siGo').addEventListener('click', function () {
    $('siErr').textContent = '';
    api('/api/business/claim', { phone: $('inPhone').value.trim() }).then(function (j) {
      if (!j.ok) { err('siErr', j); if (j.error === 'no_match') $('siErr').innerHTML += ' — <a href="/for-business">ይመዝገቡ →</a>'; return; }
      claimId = j.claimId;
      if (j.sent) { $('codeBox').hidden = false; $('inCode').focus(); toast('ኮድ በቴሌግራም ተልኳል · code sent in Telegram'); }
      else { $('waitBox').hidden = false; $('codeBox').hidden = true; }
    });
  });
  $('siVerify').addEventListener('click', function () {
    api('/api/business/verify', { claimId: claimId, code: $('inCode').value.trim() }).then(function (j) {
      if (!j.ok) { err('siErr', j); return; }
      tok = j.token; try { localStorage.setItem('bs_owner', tok); } catch (e) {}
      load();
    });
  });

  // ---------------- shell ----------------
  var ME = null;
  function tabs() {
    var isVenue = ME.kind === 'venue';
    var list = isVenue ? [['page', 'ገጼ'], ['prog', 'ፕሮግራም'], ['qr', 'QR']]
      : [['page', 'ገጼ'], ['products', 'ምርቶች'], ['offers', 'ቅናሽ'], ['orders', 'ትዕዛዞች' + (ME.counts && ME.counts.newOrders ? '<span class="n">' + ME.counts.newOrders + '</span>' : '')], ['qr', 'QR']];
    $('tabs').innerHTML = list.map(function (t, i) { return '<button data-t="' + t[0] + '"' + (i === 0 ? ' class="on"' : '') + '>' + t[1] + '</button>'; }).join('');
    ['page', 'products', 'offers', 'orders', 'prog', 'qr'].forEach(function (t) { var el = $('t-' + t); if (el) el.hidden = t !== 'page'; });
  }
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call($('tabs').children, function (x) { x.classList.toggle('on', x === b); });
    ['page', 'products', 'offers', 'orders', 'prog', 'qr'].forEach(function (t) { var el = $('t-' + t); if (el) el.hidden = t !== b.dataset.t; });
    if (b.dataset.t === 'products') loadProducts();
    if (b.dataset.t === 'offers') loadOffers();
    if (b.dataset.t === 'orders') loadOrders();
    if (b.dataset.t === 'prog') loadProgramme();
  });

  function load() {
    api('/api/business/me').then(function (j) {
      if (!j.ok) { $('signin').hidden = false; $('app').hidden = true; if (tok) { tok = null; try { localStorage.removeItem('bs_owner'); } catch (e) {} } return; }
      ME = j; $('signin').hidden = true; $('app').hidden = false;
      var t = j.kind === 'venue' ? j.venue : j.shop;
      $('who').textContent = (t.nameAm || t.name);
      // Several units under one phone: a switcher, so a tenant moves between their pages.
      $('switcher').innerHTML = (j.pages && j.pages.length > 1)
        ? '<div class="card" style="margin-bottom:10px"><label style="margin:0">የእኔ ገጾች · My pages</label><select id="pgSel">' + j.pages.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.current ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div>' : '';
      var sel = $('pgSel'); if (sel) sel.addEventListener('change', function () { api('/api/business/switch', { id: sel.value }).then(function (r) { if (r.ok) load(); else toast(T[r.error] || r.error); }); });
      tabs();
      if (j.kind === 'shop') fillProfile(j.shop, j.categories); else fillVenue(j.venue);
      var url = j.url || (location.origin + '/shop/' + (j.shop && j.shop.slug));
      $('myUrl').textContent = url.replace(/^https?:\/\//, '');
      $('openPage').href = url;
      $('qrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=' + encodeURIComponent(url);
      $('copyUrl').onclick = function () { navigator.clipboard.writeText(url).then(function () { toast('ተቀድቷል · copied'); }); };
    });
  }
  $('signOut').addEventListener('click', function () { api('/api/business/logout', {}).then(function () { tok = null; try { localStorage.removeItem('bs_owner'); } catch (e) {} location.reload(); }); });

  // ---------------- my page ----------------
  function fillProfile(s, cats) {
    $('fNameAm').value = s.nameAm || ''; $('fName').value = s.name || '';
    $('fCat').innerHTML = (cats || []).map(function (c) { return '<option value="' + c.value + '"' + (c.value === s.category ? ' selected' : '') + '>' + esc(c.am) + ' · ' + c.value + '</option>'; }).join('');
    $('fAboutAm').value = s.aboutAm || s.descriptionAm || ''; $('fAbout').value = s.about || s.description || '';
    $('fPhone').value = s.phone || ''; $('fTg').value = s.telegram || ''; $('fAddr').value = s.address || ''; $('fMap').value = s.mapUrl || ''; $('fSocial').value = s.socialLink || '';
    var h = s.openingHours || {};
    $('hours').innerHTML = DAYS.map(function (d) {
      var r = h[d[0]] || {};
      return '<span style="font-weight:800">' + d[1] + '</span><input type="time" data-h="' + d[0] + '" data-k="open" value="' + esc(r.open || '') + '"><input type="time" data-h="' + d[0] + '" data-k="close" value="' + esc(r.close || '') + '"><label style="margin:0;font-size:11px"><input type="checkbox" data-h="' + d[0] + '" data-k="closed" style="width:auto"' + (r.closed ? ' checked' : '') + '> ዝግ</label>';
    }).join('');
    paintPhotos(s);
  }
  function fillVenue(v) {
    $('fNameAm').value = v.nameAm || ''; $('fName').value = v.name || ''; $('fPhone').value = v.phone || ''; $('fAddr').value = v.address || '';
    ['fCat', 'fAboutAm', 'fAbout', 'fTg', 'fMap', 'fSocial'].forEach(function (id) { var el = $(id); if (el) el.closest('div') && (el.closest('label') || el).setAttribute('disabled', ''); });
    $('pfSave').textContent = 'ለለውጥ ያግኙን · contact us to change';
    $('pfSave').disabled = true;
  }
  $('pfSave').addEventListener('click', function () {
    $('pfErr').textContent = '';
    api('/api/business/profile', { nameAm: $('fNameAm').value, name: $('fName').value, category: $('fCat').value, aboutAm: $('fAboutAm').value, about: $('fAbout').value,
      phone: $('fPhone').value, telegram: $('fTg').value, address: $('fAddr').value, mapUrl: $('fMap').value, socialLink: $('fSocial').value })
      .then(function (j) { if (!j.ok) return err('pfErr', j); toast('ተቀምጧል · saved'); ME.shop = j.shop; });
  });
  $('hSave').addEventListener('click', function () {
    var h = {};
    Array.prototype.forEach.call($('hours').querySelectorAll('[data-h]'), function (el) {
      var d = el.dataset.h, k = el.dataset.k; h[d] = h[d] || {};
      h[d][k] = k === 'closed' ? el.checked : el.value;
    });
    api('/api/business/profile', { openingHours: h }).then(function (j) { toast(j.ok ? 'ተቀምጧል · saved' : (T[j.error] || j.error)); });
  });

  function paintPhotos(s) {
    var all = (s.logoUrl ? [s.logoUrl] : []).concat(s.photos || []);
    $('photos').innerHTML = all.length ? all.map(function (u) { return '<div class="p"><img src="' + esc(u) + '" alt=""><button data-rm="' + esc(u) + '">✕</button></div>'; }).join('') : '<div class="empty">ገና ፎቶ የለም · no photos yet</div>';
  }
  $('photos').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-rm]'); if (!b) return;
    api('/api/business/photos/remove', { url: b.dataset.rm }).then(function (j) { if (j.ok) { ME.shop = j.shop; paintPhotos(j.shop); } });
  });
  var wantLogo = false;
  $('addPhoto').addEventListener('click', function () { wantLogo = false; $('fileIn').click(); });
  $('addLogo').addEventListener('click', function () { wantLogo = true; $('fileIn').click(); });
  // Shrink in the browser: a phone photo is 3–8 MB and the server caps at 5.
  function toDataUrl(file, maxSide, cb) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var sc = Math.min(1, maxSide / Math.max(img.width, img.height));
      var c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      cb(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }
  $('fileIn').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    toast('ፎቶ በመስቀል ላይ…');
    toDataUrl(f, wantLogo ? 400 : 1400, function (d) {
      if (!d) return toast(T.image);
      api('/api/business/photos', { dataUrl: d, logo: wantLogo }).then(function (j) { if (!j.ok) return toast(T[j.error] || j.error); ME.shop = j.shop; paintPhotos(j.shop); toast('ተጨምሯል · added'); });
    });
  });

  // ---------------- products ----------------
  function loadProducts() {
    api('/api/business/products').then(function (j) {
      if (!j.ok) return;
      $('prCount').textContent = j.products.length + ' / ' + j.max;
      $('prList').innerHTML = j.products.length ? j.products.map(function (p) {
        return '<div class="item"><div class="ph">' + (p.photoUrl ? '<img src="' + esc(p.photoUrl) + '" alt="">' : '🛍️') + '</div><div class="b"><b>' + esc(p.nameAm || p.name) + '</b><small>' + esc([p.category, p.description].filter(Boolean).join(' · ')) + (p.visible ? '' : ' · <b>ተደብቋል</b>') + '</small></div>'
          + '<span class="price">' + birr(p.price) + '</span>'
          + '<button class="btn sm ghost" data-vis="' + p.id + '" data-on="' + (p.visible ? '1' : '0') + '">' + (p.visible ? '🙈' : '👁️') + '</button>'
          + '<button class="btn sm ghost" data-del="' + p.id + '">🗑️</button></div>';
      }).join('') : '<div class="empty">ገና ምርት የለም። ከላይ ይጨምሩ። · No products yet — add one above.</div>';
    });
  }
  $('prList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.vis) api('/api/business/products/' + b.dataset.vis, { visible: b.dataset.on !== '1' }).then(loadProducts);
    if (b.dataset.del && confirm('ይህን ምርት ይሰረዝ? · Delete this product?')) api('/api/business/products/' + b.dataset.del + '/delete', {}).then(function (j) { toast(j.hidden ? 'ተደብቋል (ትዕዛዝ አለው) · hidden' : 'ተሰርዟል · deleted'); loadProducts(); });
  });
  $('prGo').addEventListener('click', function () {
    $('prErr').textContent = '';
    var send = function (photoUrl) {
      api('/api/business/products', { name: $('prName').value || $('prNameAm').value, nameAm: $('prNameAm').value, price: $('prPrice').value, category: $('prCat').value, description: $('prDesc').value, photoUrl: photoUrl })
        .then(function (j) {
          if (!j.ok) return err('prErr', j);
          ['prName', 'prNameAm', 'prPrice', 'prCat', 'prDesc'].forEach(function (id) { $(id).value = ''; });
          $('prFile').value = ''; toast('ተጨምሯል · added'); loadProducts();
        });
    };
    var f = $('prFile').files && $('prFile').files[0];
    if (!f) return send(null);
    toDataUrl(f, 900, function (d) {
      if (!d) return send(null);
      api('/api/business/photos', { dataUrl: d }).then(function (j) { send(j.ok ? j.url : null); });
    });
  });

  // ---------------- offers ----------------
  function loadOffers() {
    api('/api/business/offers').then(function (j) {
      if (!j.ok) return;
      var live = j.offers.filter(function (o) { return o.active; });
      $('ofList').innerHTML = live.length ? live.map(function (o) {
        return '<div class="item"><div class="b"><b>' + esc(o.titleAm || o.title) + '</b><small>' + esc(o.description || '') + ' · ' + new Date(o.startsAt).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }) + ' – ' + new Date(o.endsAt).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }) + '</small></div><button class="btn sm ghost" data-del="' + o.id + '">🗑️</button></div>';
      }).join('') : '<div class="empty">ገና ቅናሽ የለም · no offers yet</div>';
    });
  }
  $('ofList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-del]'); if (!b) return;
    api('/api/business/offers/' + b.dataset.del + '/delete', {}).then(loadOffers);
  });
  $('ofGo').addEventListener('click', function () {
    $('ofErr').textContent = '';
    api('/api/business/offers', { title: $('ofTitle').value, description: $('ofDesc').value, startsAt: $('ofFrom').value, endsAt: $('ofTo').value })
      .then(function (j) { if (!j.ok) return err('ofErr', j); $('ofTitle').value = ''; $('ofDesc').value = ''; toast('ተጨምሯል'); loadOffers(); });
  });

  // ---------------- orders ----------------
  var NEXT = { NEW: [['ACCEPTED', '✅ ተቀበልኩ'], ['REJECTED', '✕ አልችልም']], ACCEPTED: [['IN_PROGRESS', '👨‍🍳 እያዘጋጀሁ'], ['CANCELLED', '✕ ተሰረዘ']], IN_PROGRESS: [['DELIVERED', '📦 ደረሰ'], ['CANCELLED', '✕ ተሰረዘ']], DELIVERED: [['COMPLETED', '🎉 ተጠናቀቀ']] };
  function loadOrders() {
    api('/api/business/orders').then(function (j) {
      if (!j.ok) return;
      $('orList').innerHTML = j.orders.length ? j.orders.map(function (o) {
        return '<div class="item" style="align-items:flex-start"><div class="b"><b>' + esc(o.customerName) + ' <span class="st ' + o.status + '">' + o.status + '</span></b>'
          + '<small><a href="tel:' + esc(o.customerPhone) + '">' + esc(o.customerPhone) + '</a> · ' + when(o.createdAt) + '</small>'
          + '<small>' + o.items.map(function (i) { return esc(i.name) + ' ×' + i.qty; }).join(', ') + (o.note ? ' · «' + esc(o.note) + '»' : '') + '</small>'
          + '<div style="margin-top:6px">' + (NEXT[o.status] || []).map(function (n) { return '<button class="btn sm ghost" data-o="' + o.id + '" data-s="' + n[0] + '">' + n[1] + '</button>'; }).join(' ') + '</div></div>'
          + '<span class="price">' + birr(o.total) + '</span></div>';
      }).join('') : '<div class="empty">ገና ትዕዛዝ የለም። ደንበኞች ከገጽዎ ሲያዙ እዚህ ይታያል። · No orders yet.</div>';
    });
  }
  $('orList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-o]'); if (!b) return;
    api('/api/business/orders/' + b.dataset.o + '/status', { status: b.dataset.s }).then(function (j) { if (!j.ok) toast(T[j.error] || j.error); loadOrders(); load(); });
  });

  // ---------------- venue programme ----------------
  function loadProgramme() {
    api('/api/business/programme').then(function (j) {
      if (!j.ok) return;
      $('pgList').innerHTML = j.programme.length ? j.programme.map(function (p) {
        return '<div class="item"><div class="b"><b>' + esc(p.titleAm || p.title) + '</b><small>' + (p.times || []).join(' · ') + ' · ' + new Date(p.dateFrom).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }) + ' – ' + new Date(p.dateTo).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }) + (p.hallName ? ' · ' + esc(p.hallName) : '') + '</small></div><button class="btn sm ghost" data-del="' + p.id + '">🗑️</button></div>';
      }).join('') : '<div class="empty">ገና ፕሮግራም የለም · nothing listed yet</div>';
    });
  }
  $('pgList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-del]'); if (!b) return;
    api('/api/business/programme/' + b.dataset.del + '/delete', {}).then(loadProgramme);
  });
  $('pgGo').addEventListener('click', function () {
    $('pgErr').textContent = '';
    api('/api/business/programme', { title: $('pgTitle').value || $('pgTitleAm').value, titleAm: $('pgTitleAm').value, hallName: $('pgHall').value, priceText: $('pgPrice').value, times: $('pgTimes').value, dateFrom: $('pgFrom').value, dateTo: $('pgTo').value })
      .then(function (j) { if (!j.ok) return err('pgErr', j); ['pgTitle', 'pgTitleAm', 'pgTimes'].forEach(function (id) { $(id).value = ''; }); toast('ተጨምሯል'); loadProgramme(); });
  });

  load();
})();
