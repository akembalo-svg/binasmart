/* BinaSmart Ride — MapLibre wrapper: init, 3D with auto-degrade, markers, route line. */
window.BinaMap = (function () {
  var map = null, pickupMk = null, dropMk = null;

  function weakDevice() {
    try { return (navigator.deviceMemory && navigator.deviceMemory < 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2); }
    catch (e) { return false; }
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function wants3D() { var s = lsGet('bina_map_3d'); return s == null ? !weakDevice() : s === '1'; }

  function init(container, onLoad) {
    var protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    var three = wants3D();
    map = new maplibregl.Map({
      container: container, style: '/static/ride/style.json',
      center: [38.7578, 9.0108], zoom: 14.5, pitch: three ? 55 : 0, bearing: three ? -17 : 0, maxPitch: 70,
      attributionControl: false
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');
    map.on('load', function () {
      if (!three) map.setLayoutProperty('buildings-3d', 'visibility', 'none');
      if (onLoad) onLoad();
    });
    return map;
  }

  function set3D(on) {
    if (!map) return;
    lsSet('bina_map_3d', on ? '1' : '0');
    map.setLayoutProperty('buildings-3d', 'visibility', on ? 'visible' : 'none');
    map.easeTo({ pitch: on ? 55 : 0, bearing: on ? -17 : 0, duration: 600 });
  }
  function is3D() { return wants3D(); }

  function mk(kind, lngLat) {
    var el = document.createElement('div');
    el.className = 'bm-mk bm-' + kind;
    el.innerHTML = kind === 'pickup' ? '<span class="bm-pulse"></span><span class="bm-dot"></span>' : '<span class="bm-pin">📍</span>';
    return new maplibregl.Marker({ element: el, anchor: kind === 'pickup' ? 'center' : 'bottom' }).setLngLat(lngLat).addTo(map);
  }
  function setPickup(p) { if (pickupMk) pickupMk.setLngLat([p.lng, p.lat]); else pickupMk = mk('pickup', [p.lng, p.lat]); }
  function setDrop(p) {
    if (!p) { if (dropMk) { dropMk.remove(); dropMk = null; } return; }
    if (dropMk) dropMk.setLngLat([p.lng, p.lat]); else dropMk = mk('drop', [p.lng, p.lat]);
  }

  function drawRoute(coords, bottomPad) {
    if (!map || !coords || coords.length < 2) return;
    var gj = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
    if (map.getSource('route')) map.getSource('route').setData(gj);
    else {
      map.addSource('route', { type: 'geojson', data: gj });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#064e3b', 'line-width': 9, 'line-opacity': 0.35 } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#059669', 'line-width': 5 } });
    }
    // bottomPad < 0 means "just update the line, leave my camera alone" — used while driving.
    if (bottomPad < 0) return;
    var b = coords.reduce(function (bb, c) { return bb.extend(c); }, new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(b, { padding: { top: 90, bottom: bottomPad || 340, left: 40, right: 40 }, pitch: map.getPitch(), duration: 900 });
  }
  // Remove EVERY layer drawn on the route source, not just the two this file created. The driver app
  // adds a glow and a flowing line on the same source, and MapLibre refuses to drop a source that any
  // layer still uses — which silently left the old route painted after a trip ended.
  function clearRoute() {
    if (!map || !map.getSource('route')) return;
    var style = map.getStyle();
    var layers = (style && style.layers) || [];
    for (var i = layers.length - 1; i >= 0; i--) {
      if (layers[i].source === 'route' && map.getLayer(layers[i].id)) map.removeLayer(layers[i].id);
    }
    if (map.getSource('route')) map.removeSource('route');
  }
  function flyTo(p, zoom) { if (!map) return; map.flyTo({ center: [p.lng, p.lat], zoom: zoom || 15.5, duration: 900 }); }
  function onClick(fn) { if (!map) return; map.on('click', function (e) { fn({ lat: e.lngLat.lat, lng: e.lngLat.lng }); }); }

  return { init: init, set3D: set3D, is3D: is3D, setPickup: setPickup, setDrop: setDrop, drawRoute: drawRoute, clearRoute: clearRoute, flyTo: flyTo, onClick: onClick, get map() { return map; } };
})();
