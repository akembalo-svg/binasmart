/* BinaSmart PWA glue — one script on every product page.
   1. registers /sw.js (app shell + offline data)
   2. offline banner (Amharic/English) + "back online" toast
   3. "Add to your phone" install bar (Android Chrome; hidden inside Telegram and once installed)
   4. window.BinaOffline: tiny queue so pages can save an action and send it when the network returns */
(function () {
  var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };
  var inTg = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  // ---- 1. service worker
  if ('serviceWorker' in navigator) {
    addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        // a new version waiting → activate it on the next navigation, no reload storms
        reg.addEventListener('updatefound', function () { var w = reg.installing; if (!w) return; w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) w.postMessage('SKIP_WAITING'); }); });
      }).catch(function () {});
    });
  }

  // ---- 2. offline banner
  var css = '#bina-off{position:fixed;left:0;right:0;top:0;z-index:99990;background:#0f172a;color:#fff;font:600 13px/1.3 system-ui,"Noto Sans Ethiopic",sans-serif;padding:8px 14px;text-align:center;transform:translateY(-110%);transition:transform .25s}' +
    '#bina-off.on{transform:none}' +
    '#bina-inst{position:fixed;left:12px;right:12px;bottom:14px;z-index:99990;background:#fff;color:#081120;border:1px solid rgba(8,17,32,.1);border-radius:16px;box-shadow:0 10px 30px rgba(8,17,32,.18);padding:12px 14px;display:none;align-items:center;gap:10px;font:500 14px/1.3 system-ui,"Noto Sans Ethiopic",sans-serif}' +
    '#bina-inst.on{display:flex}#bina-inst img{width:40px;height:40px;border-radius:10px;flex:none}#bina-inst .t{flex:1}#bina-inst .t small{display:block;color:#64748B;font-weight:400}' +
    '#bina-inst button{border:0;border-radius:10px;padding:9px 14px;font:700 14px system-ui,sans-serif;background:#00C896;color:#062}#bina-inst .x{background:transparent;color:#64748B;font-size:20px;padding:4px 8px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var off = document.createElement('div'); off.id = 'bina-off'; off.textContent = '📴 ከመስመር ውጭ ነዎት · የተቀመጠ መረጃ ይታያል — You are offline, showing saved data';
  document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(off); if (navigator.onLine === false) off.classList.add('on'); });
  var wasOff = navigator.onLine === false;
  addEventListener('offline', function () { wasOff = true; off.classList.add('on'); });
  addEventListener('online', function () {
    off.classList.remove('on');
    if (wasOff) { wasOff = false; off.textContent = '✅ ተመልሷል · Back online'; off.style.background = '#047857'; off.classList.add('on'); setTimeout(function () { off.classList.remove('on'); off.style.background = ''; off.textContent = '📴 ከመስመር ውጭ ነዎት · የተቀመጠ መረጃ ይታያል — You are offline, showing saved data'; }, 2500); }
    flush();
  });

  // ---- 3. install bar
  var deferred = null;
  addEventListener('beforeinstallprompt', function (e) {
    if (inTg || standalone || document.getElementById('installBtn')) return; // home has its own install button
    e.preventDefault(); deferred = e;
    var until = Number(lsGet('bina_inst_snooze') || 0); if (Date.now() < until) return;
    var visits = Number(lsGet('bina_visits') || 0); if (visits < 2) return; // second visit onwards
    var bar = document.createElement('div'); bar.id = 'bina-inst';
    bar.innerHTML = '<img src="/icon-192.png" alt=""><div class="t">BinaSmart ወደ ስልክዎ ይጨምሩ<small>Add BinaSmart to your phone · opens instantly, works offline</small></div><button id="bina-inst-go">ጨምር · Add</button><button class="x" id="bina-inst-x" aria-label="close">×</button>';
    (document.body || document.documentElement).appendChild(bar); setTimeout(function () { bar.classList.add('on'); }, 1200);
    bar.querySelector('#bina-inst-go').onclick = function () { bar.classList.remove('on'); if (!deferred) return; deferred.prompt(); deferred.userChoice.then(function () { deferred = null; }); };
    bar.querySelector('#bina-inst-x').onclick = function () { bar.classList.remove('on'); lsSet('bina_inst_snooze', String(Date.now() + 14 * 86400000)); };
  });
  addEventListener('appinstalled', function () { lsSet('bina_inst_snooze', String(Date.now() + 365 * 86400000)); var b = document.getElementById('bina-inst'); if (b) b.classList.remove('on'); });
  lsSet('bina_visits', String(Number(lsGet('bina_visits') || 0) + 1));

  // ---- 4. offline queue: BinaOffline.add({url, body, kind}) → sent when online; page listens for 'bina:sent'
  var KEY = 'bina_offline_queue', sending = false;
  function read() { try { return JSON.parse(lsGet(KEY) || '[]'); } catch (e) { return []; } }
  function write(q) { lsSet(KEY, JSON.stringify(q)); }
  function flush() {
    if (sending || navigator.onLine === false) return;
    var q = read(); if (!q.length) return;
    sending = true;
    var item = q[0];
    fetch(item.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item.body) })
      .then(function (r) { return r.json(); })
      .then(function (d) { write(read().slice(1)); sending = false; dispatchEvent(new CustomEvent('bina:sent', { detail: { item: item, result: d } })); flush(); })
      .catch(function () { sending = false; });
  }
  window.BinaOffline = {
    add: function (item) { var q = read(); q.push(item); write(q); return q.length; },
    pending: function (kind) { return read().filter(function (i) { return !kind || i.kind === kind; }); },
    clear: function (kind) { write(kind ? read().filter(function (i) { return i.kind !== kind; }) : []); },
    flush: flush,
    isOffline: function () { return navigator.onLine === false; }
  };
  addEventListener('load', function () { setTimeout(flush, 800); });
})();
