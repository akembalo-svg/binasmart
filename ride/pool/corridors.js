'use strict';
// BinaPool corridors — the work commute into Bole and Kazanchis in the morning, out again in the
// evening. A corridor is an ordered list of stops; riders walk to a stop, the car follows the line.
// Stop coordinates are kerb-side approximations; move them from /ride-ops once drivers report better spots.
const STOPS = {
  megenagna:  { id: 'megenagna',  label: 'Megenagna',        labelAm: 'መገናኛ',        lat: 9.0206, lng: 38.8010 },
  imperial:   { id: 'imperial',   label: 'Imperial',         labelAm: 'ኢምፔሪያል',      lat: 9.0118, lng: 38.7975 },
  gerji:      { id: 'gerji',      label: 'Gerji',            labelAm: 'ገርጂ',          lat: 9.0080, lng: 38.8010 },
  bole:       { id: 'bole',       label: 'Bole Medhanialem', labelAm: 'ቦሌ መድኃኒዓለም',  lat: 8.9975, lng: 38.7876 },
  cmc:        { id: 'cmc',        label: 'CMC',              labelAm: 'ሲኤምሲ',        lat: 9.0186, lng: 38.8461 },
  summit:     { id: 'summit',     label: 'Summit',           labelAm: 'ሰሚት',          lat: 9.0083, lng: 38.8465 },
  mazoria22:  { id: 'mazoria22',  label: '22 Mazoria',       labelAm: '22 ማዞሪያ',      lat: 9.0165, lng: 38.7830 },
  urael:      { id: 'urael',      label: 'Urael',            labelAm: 'ኡራኤል',        lat: 9.0148, lng: 38.7735 },
  kazanchis:  { id: 'kazanchis',  label: 'Kazanchis',        labelAm: 'ካዛንችስ',       lat: 9.0176, lng: 38.7635 },
  piassa:     { id: 'piassa',     label: 'Piassa',           labelAm: 'ፒያሳ',          lat: 9.0349, lng: 38.7514 },
  aratkilo:   { id: 'aratkilo',   label: 'Arat Kilo',        labelAm: 'አራት ኪሎ',       lat: 9.0339, lng: 38.7625 },
  mexico:     { id: 'mexico',     label: 'Mexico',           labelAm: 'ሜክሲኮ',        lat: 9.0107, lng: 38.7440 },
  stadium:    { id: 'stadium',    label: 'Stadium',          labelAm: 'ስታዲየም',       lat: 9.0135, lng: 38.7565 },
};

// Listed in the MORNING (inbound) direction; the evening run is the same line reversed.
const LINES = [
  { id: 'megenagna-bole',      name: 'Megenagna → Bole',      nameAm: 'መገናኛ → ቦሌ',      stops: ['megenagna', 'imperial', 'gerji', 'bole'] },
  { id: 'cmc-bole',            name: 'CMC → Bole',            nameAm: 'ሲኤምሲ → ቦሌ',      stops: ['cmc', 'summit', 'gerji', 'bole'] },
  { id: 'megenagna-kazanchis', name: 'Megenagna → Kazanchis', nameAm: 'መገናኛ → ካዛንችስ',   stops: ['megenagna', 'mazoria22', 'urael', 'kazanchis'] },
  { id: 'piassa-kazanchis',    name: 'Piassa → Kazanchis',    nameAm: 'ፒያሳ → ካዛንችስ',    stops: ['piassa', 'aratkilo', 'kazanchis'] },
  { id: 'mexico-kazanchis',    name: 'Mexico → Kazanchis',    nameAm: 'ሜክሲኮ → ካዛንችስ',   stops: ['mexico', 'stadium', 'kazanchis'] },
];

const TIER = 'comfort';
const ADDIS_OFFSET_MS = 3 * 3600 * 1000; // UTC+3, no DST
// Peak windows in Addis local minutes. Pools run all day; outside peak the app says so.
const PEAK = { in: [6 * 60, 10 * 60], out: [16 * 60, 20 * 60] };

function addisMinutes(ms) { const d = new Date((ms == null ? Date.now() : ms) + ADDIS_OFFSET_MS); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
// Morning and midday go IN (towards Bole / Kazanchis); from 13:00 the line runs OUT.
function directionNow(ms) { return addisMinutes(ms) < 13 * 60 ? 'in' : 'out'; }
function isPeak(ms) { const m = addisMinutes(ms), d = directionNow(ms); return m >= PEAK[d][0] && m < PEAK[d][1]; }

function haversineM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function build(line, dir) {
  const ids = dir === 'out' ? line.stops.slice().reverse() : line.stops;
  const stops = ids.map(id => ({ ...STOPS[id] }));
  const first = stops[0], last = stops[stops.length - 1];
  const arrow = (a, b) => a.label + ' → ' + b.label, arrowAm = (a, b) => a.labelAm + ' → ' + b.labelAm;
  return { key: line.id + ':' + dir, lineId: line.id, dir, tier: TIER, stops,
    name: arrow(first, last), nameAm: arrowAm(first, last), from: first, to: last };
}

// Every corridor in today's direction. `dir` may be forced (tests, ops).
function activeCorridors(ms, dir) {
  const d = dir || directionNow(ms);
  return LINES.map(l => build(l, d));
}
function byKey(key) {
  const [lineId, dir] = String(key || '').split(':');
  const line = LINES.find(l => l.id === lineId);
  if (!line || (dir !== 'in' && dir !== 'out')) return null;
  return build(line, dir);
}
// The stop a rider should walk to: nearest boarding stop (never the terminus — you cannot board at the end).
function nearestStop(corridor, lat, lng) {
  const boardable = corridor.stops.slice(0, -1);
  let best = null;
  for (const s of boardable) {
    const m = haversineM({ lat, lng }, s);
    if (!best || m < best.distM) best = { stop: s, distM: Math.round(m) };
  }
  return best;
}
function stopIndex(corridor, stopId) { return corridor.stops.findIndex(s => s.id === stopId); }

module.exports = { STOPS, LINES, TIER, PEAK, addisMinutes, directionNow, isPeak, activeCorridors, byKey, nearestStop, stopIndex, haversineM };
