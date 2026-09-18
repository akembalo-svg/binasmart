/* Government widget frame: make sure the chat has a device id for the per-visitor limit. The id is random,
   lives only in this frame's own storage (partitioned per embedding site by the browser), and is hashed with
   a salt before the server counts it (gov/meter.js). */
(function () {
  'use strict';
  try {
    var s = window.localStorage;
    if (!s.getItem('bina_uid')) {
      var a = new Uint8Array(12); window.crypto.getRandomValues(a);
      var id = 'w_'; for (var i = 0; i < a.length; i++) id += ('0' + a[i].toString(16)).slice(-2);
      s.setItem('bina_uid', id);
    }
  } catch (e) { /* no storage: the network limit still applies */ }
})();
