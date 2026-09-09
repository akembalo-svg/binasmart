/* BinaSmart inside the telebirr SuperApp (Macle web-view). Detects the SuperApp, loads its JS bridge and pays in-app:
   window.BinaTelebirr.active()            -> true when running inside telebirr
   window.BinaTelebirr.pay({type, code})   -> Promise<{paid, orderId}>; in-app PIN sheet inside telebirr, web checkout elsewhere
   Detection: ?src=telebirr on any URL (remembered for the session), a telebirr/Macle user agent, or a native window.ma bridge. */
(function () {
  var KEY = 'bina_src';
  function q(name) { try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; } }
  var flagged = q('src') === 'telebirr';
  try { if (flagged) sessionStorage.setItem(KEY, 'telebirr'); } catch (e) {}
  var remembered = false; try { remembered = sessionStorage.getItem(KEY) === 'telebirr'; } catch (e) {}
  var ua = /telebirr|superapp|macle/i.test(navigator.userAgent || '');
  var active = flagged || remembered || ua || !!window.ma;
  if (active) { document.documentElement.classList.add('superapp'); }

  var sdkReady = null;
  function bridge() {
    if (window.ma && typeof window.ma.native === 'function') return Promise.resolve(window.ma);
    if (window.jssdk && typeof window.jssdk.native === 'function') { window.ma = window.jssdk; return Promise.resolve(window.ma); }
    if (sdkReady) return sdkReady;
    sdkReady = new Promise(function (resolve) {
      var s = document.createElement('script'); s.src = '/static/vendor/macle-jssdk.min.js?v=1'; s.async = true;
      s.onload = function () { if (window.jssdk && !window.ma) window.ma = window.jssdk; resolve(window.ma && typeof window.ma.native === 'function' ? window.ma : null); };
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
    });
    return sdkReady;
  }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); });
  }
  function poll(orderId, tries) {
    tries = tries || 0;
    return fetch('/api/telebirr/status/' + encodeURIComponent(orderId)).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.paid) return { paid: true, orderId: orderId };
      if (tries >= 10 || (j && /PAY_FAILED|ORDER_CLOSED/.test(j.status || ''))) return { paid: false, orderId: orderId, status: j && j.status };
      return new Promise(function (res) { setTimeout(res, 2000); }).then(function () { return poll(orderId, tries + 1); });
    });
  }
  // rawRequest + orderId already obtained (e.g. from the cinema checkout response)
  function startPay(rawRequest, orderId) {
    return bridge().then(function (ma) {
      if (!ma) throw new Error('no_bridge');
      return ma.native('startPay', { rawRequest: rawRequest, bussinessType: 'BuyGoods' }).then(function (res) {
        var ok = res && (String(res.resultCode) === '1' || res.code === 0 || res.status === 'success');
        return poll(orderId).then(function (p) { return ok || p.paid ? { paid: p.paid, orderId: orderId } : { paid: false, orderId: orderId, cancelled: true }; });
      }, function () { return poll(orderId).then(function (p) { return { paid: p.paid, orderId: orderId, cancelled: !p.paid }; }); });
    });
  }
  function pay(opts) {
    var inApp = active;
    return post('/api/telebirr/init', { type: opts.type, code: opts.code, inApp: inApp }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || 'init_failed');
      if (inApp && j.rawRequest) return startPay(j.rawRequest, j.orderId).catch(function () {
        // bridge missing after all: fall back to the web checkout in the same window
        return post('/api/telebirr/init', { type: opts.type, code: opts.code, inApp: false }).then(function (k) { if (k && k.checkoutUrl) { location.href = k.checkoutUrl; } return { paid: false, orderId: k && k.orderId, redirected: !!(k && k.checkoutUrl) }; });
      });
      if (j.checkoutUrl) { location.href = j.checkoutUrl; return { paid: false, orderId: j.orderId, redirected: true }; }
      throw new Error('no_checkout');
    });
  }
  window.BinaTelebirr = { active: function () { return active; }, pay: pay, startPay: startPay, bridge: bridge, poll: poll };
})();
