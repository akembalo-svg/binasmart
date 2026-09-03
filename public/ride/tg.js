/* Telegram Mini App shim. Exposes window.TG; every method is a safe no-op outside Telegram. */
(function () {
  var W = window.Telegram && window.Telegram.WebApp;
  var inTg = !!(W && W.initData);
  var contactResp = null, onMain = null;
  if (inTg) {
    try { W.ready(); W.expand(); W.setHeaderColor('#064e3b'); W.setBackgroundColor('#faf8f4'); } catch (e) {}
    try { W.onEvent('contactRequested', function (ev) { if (ev && ev.status === 'sent' && ev.response) contactResp = ev.response; }); } catch (e) {}
    try { W.MainButton.setParams({ color: '#059669', text_color: '#ffffff' }); } catch (e) {}
    try { W.MainButton.onClick(function () { if (onMain) onMain(); }); } catch (e) {}
  }
  window.TG = {
    isTelegram: function () { return inTg; },
    initData: function () { return inTg ? W.initData : null; },
    user: function () { return inTg && W.initDataUnsafe ? (W.initDataUnsafe.user || null) : null; },
    contact: function () { return contactResp; },
    requestContact: function (cb) {
      if (!inTg || typeof W.requestContact !== 'function') return cb(false);
      try { W.requestContact(function (ok) { setTimeout(function () { cb(!!ok && !!contactResp); }, 80); }); } catch (e) { cb(false); }
    },
    main: function (text, fn) { if (!inTg) return; onMain = fn; try { W.MainButton.setText(text); W.MainButton.show(); } catch (e) {} },
    mainHide: function () { if (inTg) try { W.MainButton.hide(); } catch (e) {} },
    back: function (fn) { if (!inTg) return; try { if (W.BackButton.offClick) W.BackButton.offClick(); W.BackButton.onClick(fn); W.BackButton.show(); } catch (e) {} },
    backHide: function () { if (inTg) try { W.BackButton.hide(); } catch (e) {} },
    confirm: function (msg, cb) { if (inTg && typeof W.showConfirm === 'function') { try { return W.showConfirm(msg, cb); } catch (e) {} } cb(window.confirm(msg)); },
    haptic: function () { try { W.HapticFeedback.impactOccurred('light'); } catch (e) {} }
  };
})();
