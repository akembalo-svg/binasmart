/* BinaSmart Ride — deferred map engine.
   The booking sheet is what a rider needs first: type a destination, see the fare, request. That is
   ~60 KB of app code. MapLibre is ~780 KB and only paints the background, so loading it in front of
   the app left every control dead for several seconds on a weak Addis connection — the page looked
   finished and answered nothing.
   This file stands in for window.BinaMap while the real engine downloads: reads are answered from
   localStorage, writes are recorded, and once map.js has replaced BinaMap the recording is replayed
   in order, so pins, routes and click handlers set during the wait all land. */
window.BinaMap = (function () {
  var q = [], satCfg = null, done = false;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function weakDevice() { try { return (navigator.deviceMemory && navigator.deviceMemory < 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2); } catch (e) { return false; } }
  function rec(name) { return function () { q.push([name, [].slice.call(arguments)]); }; }

  var stub = {
    init: rec('init'), set3D: rec('set3D'), setPickup: rec('setPickup'), setDrop: rec('setDrop'),
    drawRoute: rec('drawRoute'), clearRoute: rec('clearRoute'), flyTo: rec('flyTo'), onClick: rec('onClick'),
    setSatellite: rec('setSatellite'), whenReady: rec('whenReady'),
    setSatelliteConfig: function (cfg) { satCfg = cfg && cfg.tiles ? cfg : null; q.push(['setSatelliteConfig', [cfg]]); },
    // reads must answer now — the 3D and satellite buttons set their state at boot
    is3D: function () { var s = lsGet('bina_map_3d'); return s == null ? !weakDevice() : s === '1'; },
    hasSatellite: function () { return !!satCfg; },
    wantsSatellite: function () { return lsGet('bina_map_sat') === '1'; },
    isSatellite: function () { return false; },
    get map() { return null; },
    loading: true
  };

  function load(src, isCss) {
    return new Promise(function (res, rej) {
      var el;
      if (isCss) { el = document.createElement('link'); el.rel = 'stylesheet'; el.href = src; }
      else { el = document.createElement('script'); el.src = src; el.async = false; }
      el.onload = res; el.onerror = function () { rej(new Error(src)); };
      document.head.appendChild(el);
    });
  }

  function start() {
    if (done) return; done = true;
    load('/static/vendor/maplibre-gl.css', true).catch(function () {});
    load('/static/vendor/maplibre-gl.js')
      .then(function () { return load('/static/vendor/pmtiles.js'); })
      .then(function () { return load('/static/ride/map.js?v=9'); })
      .then(function () {
        var real = window.BinaMap;
        if (!real || real === stub || real.loading) return; // map.js did not take over — keep the no-op stub
        for (var i = 0; i < q.length; i++) { try { real[q[i][0]].apply(real, q[i][1]); } catch (e) {} }
        q = [];
        var m = document.getElementById('map'); if (m) m.classList.add('ready');
      })
      .catch(function () { /* no map: the sheet still books rides, which is the part that matters */ });
  }

  // after the app has parsed and the sheet is interactive
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
  else setTimeout(start, 0);

  return stub;
})();
