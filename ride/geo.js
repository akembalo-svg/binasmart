'use strict';
// Routing (GraphHopper) with a straight-line fallback, haversine, and place search:
// BinaSmart directory (buildings + shops) first, then OSM via Photon, biased to Addis.
const ADDIS = { lat: 9.02, lng: 38.75 };
const ADDIS_BOX = { minLat: 8.5, maxLat: 9.5, minLng: 38.4, maxLng: 39.2 };
const CITY_MPS = 25000 / 3600; // 25 km/h average city speed for the fallback ETA

function haversineM(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function makeGeo({ routerUrl, fetchFn, prisma }) {
  const f = fetchFn || fetch;

  async function route(from, to) {
    try {
      const u = routerUrl + '/route?point=' + from.lat + ',' + from.lng + '&point=' + to.lat + ',' + to.lng +
        '&profile=car&points_encoded=false&instructions=false';
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await f(u, { signal: ctrl.signal }); clearTimeout(t);
      const d = await r.json(); const p = d && d.paths && d.paths[0];
      if (!p) throw new Error('no_path');
      return { distanceM: Math.round(p.distance), durationS: Math.round(p.time / 1000),
        geometry: (p.points && p.points.coordinates) || [], estimate: false };
    } catch (e) {
      const distanceM = Math.round(haversineM(from, to) * 1.3);
      return { distanceM, durationS: Math.round(distanceM / CITY_MPS),
        geometry: [[from.lng, from.lat], [to.lng, to.lat]], estimate: true };
    }
  }

  const photonCache = new Map(); // q -> { t, v }
  async function searchPlaces(q, bias) {
    q = (q || '').trim();
    if (q.length < 2) return [];
    const [bs, shops] = await Promise.all([
      prisma.building.findMany({
        where: { lat: { not: null }, OR: [{ name: { contains: q, mode: 'insensitive' } }, { nameAm: { contains: q } }] },
        select: { name: true, nameAm: true, qrSlug: true, lat: true, lng: true, city: true }, take: 5 }),
      prisma.shop.findMany({
        where: { tenancy: { active: true }, OR: [{ name: { contains: q, mode: 'insensitive' } }, { nameAm: { contains: q } }] },
        include: { tenancy: { include: { unit: { include: { building: { select: { name: true, nameAm: true, qrSlug: true, lat: true, lng: true } } } } } } }, take: 5 })
    ]);
    const dir = [
      ...bs.map(b => ({ kind: 'building', label: b.name, labelAm: b.nameAm, sub: b.city || 'Addis Ababa', lat: b.lat, lng: b.lng, slug: b.qrSlug })),
      ...shops.filter(s => s.tenancy.unit.building.lat != null).map(s => {
        const b = s.tenancy.unit.building;
        return { kind: 'shop', label: s.name, labelAm: s.nameAm, sub: b.name + ' · ' + s.tenancy.unit.number, lat: b.lat, lng: b.lng, slug: b.qrSlug };
      })
    ];
    let osm = [];
    try {
      const key = q.toLowerCase(); const c = photonCache.get(key);
      if (c && Date.now() - c.t < 600000) osm = c.v;
      else {
        const lat = (bias && bias.lat) || ADDIS.lat, lng = (bias && bias.lng) || ADDIS.lng;
        const u = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=5&lat=' + lat + '&lon=' + lng + '&lang=en';
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 3500);
        const r = await f(u, { signal: ctrl.signal, headers: { 'User-Agent': 'BinaSmart-Ride/1.0 (https://bina.et)' } }); clearTimeout(t);
        const d = await r.json();
        osm = (d.features || []).map(ft => {
          const p = ft.properties || {}, c2 = ft.geometry.coordinates;
          return { kind: 'osm', label: p.name || p.street || q, labelAm: '', sub: [p.street, p.district, p.city].filter(Boolean).join(', '), lat: c2[1], lng: c2[0] };
        }).filter(x => x.lat > ADDIS_BOX.minLat && x.lat < ADDIS_BOX.maxLat && x.lng > ADDIS_BOX.minLng && x.lng < ADDIS_BOX.maxLng);
        photonCache.set(key, { t: Date.now(), v: osm });
      }
    } catch (e) { osm = []; }
    return [...dir, ...osm].slice(0, 10);
  }

  return { route, searchPlaces, haversineM };
}

module.exports = { makeGeo, haversineM, ADDIS, ADDIS_BOX };
