'use strict';
// Routing (GraphHopper) with a straight-line fallback, haversine, and place search:
// BinaSmart directory (buildings + shops) first, then OSM via Photon, biased to Addis.
const ADDIS = { lat: 9.02, lng: 38.75 };
const ADDIS_BOX = { minLat: 8.5, maxLat: 9.5, minLng: 38.4, maxLng: 39.2 };
const CITY_MPS = 25000 / 3600; // 25 km/h average city speed for the fallback ETA
const ROUTE_TIMEOUT_MS = 4000, PHOTON_TIMEOUT_MS = 3500, PHOTON_TTL_MS = 600000, PHOTON_CACHE_MAX = 500;

function haversineM(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function likeEscape(s) { return s.replace(/[%_\\]/g, c => '\\' + c); }

// ---- canonical Addis landmarks -------------------------------------------------------------
// Photon/OSM ranks by string similarity, not by what a rider means. Left to itself it sends
// "Bole Airport" to a mosque 2.3 km from the terminal, "Bole Medhanealem" to a bank branch, and
// "Ayat" to a person called Hayat 14 km away. These are the places people actually name in Addis,
// with coordinates taken from the search data itself (the correct hit, not the top-ranked one).
// A match here is put FIRST; the usual results still follow, so nothing is hidden.
const LANDMARKS = [
  { label: 'Bole Airport', labelAm: 'ቦሌ አየር መንገድ', lat: 8.97919, lng: 38.79658, sub: 'Addis Ababa Bole International Airport',
    alias: ['bole airport', 'addis ababa bole international airport', 'bole international airport', 'airport', 'add airport', 'ቦሌ አየር መንገድ'] },
  { label: 'Bole Medhanealem', labelAm: 'ቦሌ መድኃኔዓለም', lat: 8.99672, lng: 38.78833, sub: 'Bole, Addis Ababa',
    alias: ['bole medhanealem', 'bole medhane alem', 'bole medhanialem', 'medhanealem', 'ቦሌ መድኃኔዓለም'] },
  { label: 'Ayat', labelAm: 'አያት', lat: 9.02179, lng: 38.87702, sub: 'Ayat, Addis Ababa',
    alias: ['ayat', 'ayat square', 'ayat condominium', 'አያት'] },
  { label: 'Megenagna', labelAm: 'መገናኛ', lat: 9.01961, lng: 38.80167, sub: 'Megenagna, Addis Ababa',
    alias: ['megenagna', 'meganagna', 'መገናኛ'] },
  { label: 'Piassa', labelAm: 'ፒያሳ', lat: 9.03459, lng: 38.75494, sub: 'Piassa, Addis Ababa',
    alias: ['piassa', 'piazza', 'ፒያሳ'] },
  { label: 'Meskel Square', labelAm: 'መስቀል አደባባይ', lat: 9.01060, lng: 38.76150, sub: 'Meskel Square, Addis Ababa',
    alias: ['meskel square', 'meskel adebabay', 'መስቀል አደባባይ'] },
  { label: 'Mexico', labelAm: 'ሜክሲኮ', lat: 9.01039, lng: 38.74455, sub: 'Mexico, Addis Ababa',
    alias: ['mexico', 'mexico square', 'ሜክሲኮ'] },
  { label: 'Sarbet', labelAm: 'ሳር ቤት', lat: 8.99541, lng: 38.73771, sub: 'Sarbet, Addis Ababa',
    alias: ['sarbet', 'sar bet', 'ሳር ቤት'] },
  { label: 'Arat Kilo', labelAm: 'አራት ኪሎ', lat: 9.03295, lng: 38.76338, sub: 'Arat Kilo, Addis Ababa',
    alias: ['arat kilo', '4 kilo', 'አራት ኪሎ'] },
  { label: 'Merkato', labelAm: 'መርካቶ', lat: 9.02919, lng: 38.73926, sub: 'Merkato, Addis Ababa',
    alias: ['merkato', 'mercato', 'merkato market', 'መርካቶ'] },
  { label: 'CMC', labelAm: 'ሲኤምሲ', lat: 9.01977, lng: 38.84758, sub: 'CMC, Addis Ababa',
    alias: ['cmc', 'ሲኤምሲ'] },
  { label: 'Summit', labelAm: 'ሰሚት', lat: 9.01739, lng: 38.82530, sub: 'Summit, Addis Ababa',
    alias: ['summit', 'ሰሚት'] },
  { label: 'Gerji', labelAm: 'ገርጂ', lat: 8.99538, lng: 38.80948, sub: 'Gerji, Addis Ababa',
    alias: ['gerji', 'gerchi', 'ገርጂ'] },
  { label: 'Kality', labelAm: 'ቃሊቲ', lat: 8.93801, lng: 38.76306, sub: 'Kality, Addis Ababa',
    alias: ['kality', 'kaliti', 'ቃሊቲ'] },
  { label: 'Edna Mall', labelAm: 'እድና ሞል', lat: 8.99723, lng: 38.78668, sub: 'Bole, Addis Ababa',
    alias: ['edna mall', 'edna', 'እድና ሞል'] },
  { label: 'Lebu', labelAm: 'ለቡ', lat: 8.96114, lng: 38.72542, sub: 'Lebu, Addis Ababa',
    alias: ['lebu', 'lebu condominium', 'ለቡ'] },
  { label: 'Jemo', labelAm: 'ጀሞ', lat: 8.95996, lng: 38.71148, sub: 'Jemo, Addis Ababa',
    alias: ['jemo', 'jemo 1', 'jemo1', 'jemo one', 'ጀሞ'] },
  // The top search hit for this one sits on Chad Street near Mexico, 2.2 km from the real
  // Tor Hailoch cluster on Smuts Avenue. Pinned to the cluster.
  { label: 'Tor Hailoch', labelAm: 'ጦር ኃይሎች', lat: 9.01140, lng: 38.72291, sub: 'Tor Hailoch, Addis Ababa',
    alias: ['tor hailoch', 'torhailoch', 'tor hayloch', 'torhayloch', 'tor haylock', 'ጦር ኃይሎች'] },
  { label: 'Shiro Meda', labelAm: 'ሽሮ ሜዳ', lat: 9.05840, lng: 38.75983, sub: 'Shiro Meda, Addis Ababa',
    alias: ['shiro meda', 'shiromeda', 'shero meda', 'sheromeda', 'ሽሮ ሜዳ'] },
  { label: 'Kotebe', labelAm: 'ኮተቤ', lat: 9.03713, lng: 38.83985, sub: 'Kotebe, Addis Ababa',
    alias: ['kotebe', 'kotebbe', 'ኮተቤ'] },
  // Two candidates 2.5 km apart: the St George church and the condominium site. Riders mean the
  // condominium, so that is what is pinned.
  { label: 'Bole Bulbula', labelAm: 'ቦሌ ቡልቡላ', lat: 8.94827, lng: 38.79320, sub: 'Bole Bulbula condominium, Addis Ababa',
    alias: ['bole bulbula', 'bulbula', 'bole bulbulla', 'ቦሌ ቡልቡላ'] },
];
const normPlace = t => String(t || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const LANDMARK_BY_ALIAS = new Map();
for (const L of LANDMARKS) for (const a of L.alias) LANDMARK_BY_ALIAS.set(normPlace(a), L);
function landmarkFor(q) {
  const n = normPlace(q);
  if (!n) return null;
  const hit = LANDMARK_BY_ALIAS.get(n);
  return hit ? { label: hit.label, labelAm: hit.labelAm, lat: hit.lat, lng: hit.lng, sub: hit.sub, landmark: true } : null;
}


function makeGeo({ routerUrl, fetchFn, prisma }) {
  const f = fetchFn || fetch;
  let lastRouteWarn = 0;

  async function fetchJson(url, opts, timeoutMs) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await f(url, { ...(opts || {}), signal: ctrl.signal });
      if (r.ok === false) throw new Error('http_' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // opts.instructions asks GraphHopper for turn-by-turn. Off by default: a fare quote needs only
  // distance and time, and instructions triple the response size for nothing.
  async function route(from, to, opts) {
    const wantSteps = !!(opts && opts.instructions);
    try {
      const u = routerUrl + '/route?point=' + from.lat + ',' + from.lng + '&point=' + to.lat + ',' + to.lng +
        '&profile=car&points_encoded=false&instructions=' + (wantSteps ? 'true' : 'false');
      const d = await fetchJson(u, {}, ROUTE_TIMEOUT_MS);
      const p = d && d.paths && d.paths[0];
      if (!p) throw new Error('no_path');
      const out = { distanceM: Math.round(p.distance), durationS: Math.round(p.time / 1000),
        geometry: (p.points && p.points.coordinates) || [], estimate: false };
      if (wantSteps) {
        // Keep only what a turn banner needs. `sign` is the manoeuvre code; the app translates it,
        // so no GraphHopper locale is involved and Amharic is ours to control.
        out.instructions = (p.instructions || []).map(i => ({
          sign: i.sign, distanceM: Math.round(i.distance), durationS: Math.round(i.time / 1000),
          street: String(i.street_name || '').slice(0, 60), text: String(i.text || '').slice(0, 90),
          interval: Array.isArray(i.interval) ? i.interval : null,
          exitNumber: i.exit_number != null ? i.exit_number : null,
        })).filter(i => i.interval);
      }
      return out;
    } catch (e) {
      if (Date.now() - lastRouteWarn > 60000) { lastRouteWarn = Date.now(); console.error('[ride/geo] router fallback:', e.message); }
      const distanceM = Math.round(haversineM(from, to) * 1.3);
      const fb = { distanceM, durationS: Math.round(distanceM / CITY_MPS),
        geometry: [[from.lng, from.lat], [to.lng, to.lat]], estimate: true };
      // No router means no turns. An empty list is honest; a fabricated one would send a driver
      // down the wrong street.
      if (wantSteps) fb.instructions = [];
      return fb;
    }
  }

  const photonCache = new Map(); // key -> { t, v }
  function cacheSet(key, v) {
    if (photonCache.size >= PHOTON_CACHE_MAX) {
      const now = Date.now();
      for (const [k, e] of photonCache) if (now - e.t > PHOTON_TTL_MS) photonCache.delete(k);
      if (photonCache.size >= PHOTON_CACHE_MAX) photonCache.delete(photonCache.keys().next().value);
    }
    photonCache.set(key, { t: Date.now(), v });
  }

  async function searchPlaces(q, bias) {
    q = (q || '').trim().slice(0, 80);
    if (q.length < 2) return [];
    // A named landmark answers for itself. Everything else still follows it in the list.
    const pinned = landmarkFor(q);
    const like = likeEscape(q);
    const [bs, shops] = await Promise.all([
      prisma.building.findMany({
        where: { lat: { not: null }, lng: { not: null }, OR: [{ name: { contains: like, mode: 'insensitive' } }, { nameAm: { contains: like } }] },
        select: { name: true, nameAm: true, qrSlug: true, lat: true, lng: true, city: true }, take: 5 }),
      prisma.shop.findMany({
        where: { tenancy: { active: true, unit: { building: { lat: { not: null }, lng: { not: null } } } }, OR: [{ name: { contains: like, mode: 'insensitive' } }, { nameAm: { contains: like } }] },
        include: { tenancy: { include: { unit: { include: { building: { select: { name: true, nameAm: true, qrSlug: true, lat: true, lng: true } } } } } } }, take: 5 })
    ]);
    const dir = [
      ...bs.map(b => ({ kind: 'building', label: b.name, labelAm: b.nameAm, sub: b.city || 'Addis Ababa', lat: b.lat, lng: b.lng, slug: b.qrSlug })),
      ...shops.map(s => { const b = s.tenancy.unit.building;
        return { kind: 'shop', label: s.name, labelAm: s.nameAm, sub: b.name + ' · ' + s.tenancy.unit.number, lat: b.lat, lng: b.lng, slug: b.qrSlug }; })
    ];
    let osm = [];
    try {
      const lat = (bias && bias.lat) || ADDIS.lat, lng = (bias && bias.lng) || ADDIS.lng;
      const key = q.toLowerCase() + '|' + lat.toFixed(2) + ',' + lng.toFixed(2);
      const c = photonCache.get(key);
      if (c && Date.now() - c.t < PHOTON_TTL_MS) osm = c.v;
      else {
        const u = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=5&lat=' + lat + '&lon=' + lng + '&lang=en';
        const d = await fetchJson(u, { headers: { 'User-Agent': 'BinaSmart-Ride/1.0 (https://bina.et)' } }, PHOTON_TIMEOUT_MS);
        osm = (d.features || []).map(ft => {
          const p = ft.properties || {}, c2 = ft.geometry && ft.geometry.coordinates;
          if (!c2 || c2.length < 2) return null;
          return { kind: 'osm', label: p.name || p.street || q, labelAm: '', sub: [p.street, p.district, p.city].filter(Boolean).join(', '), lat: c2[1], lng: c2[0] };
        }).filter(x => x && x.lat > ADDIS_BOX.minLat && x.lat < ADDIS_BOX.maxLat && x.lng > ADDIS_BOX.minLng && x.lng < ADDIS_BOX.maxLng);
        cacheSet(key, osm);
      }
    } catch (e) { osm = []; }
    const rest = [...dir, ...osm];
    if (!pinned) return rest.slice(0, 10);
    const dupe = h => haversineM({ lat: pinned.lat, lng: pinned.lng }, { lat: h.lat, lng: h.lng }) < 200;
    return [pinned, ...rest.filter(h => !dupe(h))].slice(0, 10);
  }

  return { route, searchPlaces, haversineM };
}

module.exports = { makeGeo, haversineM, ADDIS, ADDIS_BOX };
