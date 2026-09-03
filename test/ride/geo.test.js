'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeGeo, haversineM } = require('../../ride/geo');

const A = { lat: 9.0108, lng: 38.7578 }, B = { lat: 8.9806, lng: 38.7900 };

test('haversine Bole -> Meskel-ish is roughly 4.9 km', () => {
  const d = haversineM(A, B);
  assert.ok(d > 4500 && d < 5300, 'got ' + d);
});

test('route() parses GraphHopper response', async () => {
  const fetchFn = async () => ({ json: async () => ({ paths: [{ distance: 5432.1, time: 612345, points: { coordinates: [[38.7578, 9.0108], [38.79, 8.9806]] } }] }) });
  const geo = makeGeo({ routerUrl: 'http://x', fetchFn, prisma: {} });
  const r = await geo.route(A, B);
  assert.equal(r.distanceM, 5432); assert.equal(r.durationS, 612);
  assert.equal(r.estimate, false); assert.equal(r.geometry.length, 2);
});

test('route() falls back to straight-line x1.3 when the router fails', async () => {
  const geo = makeGeo({ routerUrl: 'http://x', fetchFn: async () => { throw new Error('down'); }, prisma: {} });
  const r = await geo.route(A, B);
  assert.equal(r.estimate, true);
  assert.equal(r.distanceM, Math.round(haversineM(A, B) * 1.3));
  assert.ok(r.durationS > 0);
  assert.deepEqual(r.geometry, [[A.lng, A.lat], [B.lng, B.lat]]);
});

test('searchPlaces() puts directory results first and filters OSM to Addis', async () => {
  const prisma = {
    building: { findMany: async () => [{ name: 'JJ Darule', nameAm: 'ጄጄ ዳሩሌ', qrSlug: 'darulle', lat: 9.01, lng: 38.76, city: 'Addis Ababa' }] },
    shop: { findMany: async () => [] }
  };
  const fetchFn = async () => ({ json: async () => ({ features: [
    { properties: { name: 'Edna Mall', city: 'Addis Ababa' }, geometry: { coordinates: [38.79, 9.0] } },
    { properties: { name: 'Far away' }, geometry: { coordinates: [40.0, 12.0] } } ] }) });
  const geo = makeGeo({ routerUrl: 'http://x', fetchFn, prisma });
  const res = await geo.searchPlaces('Darule');
  assert.equal(res[0].kind, 'building'); assert.equal(res[0].labelAm, 'ጄጄ ዳሩሌ');
  assert.equal(res.length, 2); assert.equal(res[1].label, 'Edna Mall');
});

test('route() leaves no pending timer when the router fails', async () => {
  const geo = makeGeo({ routerUrl: 'http://x', fetchFn: async () => { throw new Error('down'); }, prisma: {} });
  const n = () => process.getActiveResourcesInfo().filter(x => x === 'Timeout').length;
  const before = n();
  await geo.route(A, B);
  assert.equal(n(), before);
});

test('route(from, to, {instructions:true}) asks the router for turns and keeps only what a banner needs', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ paths: [{
      distance: 2329.5, time: 224206,
      points: { coordinates: [[38.758, 9.011], [38.757, 9.010], [38.756, 9.008], [38.747, 9.001]] },
      instructions: [
        { distance: 236.06, sign: 0, interval: [0, 1], text: 'Continue', time: 42492, street_name: '' },
        { distance: 19.03, sign: -2, interval: [1, 2], text: 'Turn left', time: 3425, street_name: 'Ring Road' },
        { distance: 0, sign: 4, interval: [3, 3], text: 'Arrive at destination', time: 0, street_name: '' },
      ] }] }) };
  };
  const geo = makeGeo({ routerUrl: 'http://r', fetchFn });

  const plain = await geo.route({ lat: 9.011, lng: 38.758 }, { lat: 9.001, lng: 38.747 });
  assert.match(calls[0], /instructions=false/, 'a fare quote must not pay for turn-by-turn');
  assert.equal(plain.instructions, undefined);

  const withSteps = await geo.route({ lat: 9.011, lng: 38.758 }, { lat: 9.001, lng: 38.747 }, { instructions: true });
  assert.match(calls[1], /instructions=true/);
  assert.equal(withSteps.instructions.length, 3);
  assert.deepEqual(withSteps.instructions[1], { sign: -2, distanceM: 19, durationS: 3, street: 'Ring Road', text: 'Turn left', interval: [1, 2], exitNumber: null });
  assert.equal(withSteps.instructions[2].sign, 4, 'the arrival step survives');
});

test('when the router is down there are no invented turns', async () => {
  const geo = makeGeo({ routerUrl: 'http://r', fetchFn: async () => { throw new Error('down'); } });
  const r = await geo.route({ lat: 9.011, lng: 38.758 }, { lat: 9.001, lng: 38.747 }, { instructions: true });
  assert.equal(r.estimate, true);
  assert.deepEqual(r.instructions, [], 'an empty list, never a guess');
  assert.ok(r.distanceM > 0);
});

// ---- landmark resolution -------------------------------------------------------------------
// Photon ranks by string similarity, which sent "Bole Airport" to a mosque 2.3 km from the
// terminal and "Ayat" to a person named Hayat 14 km away. These pin the places people name.
function geoWithOsm(osmHits) {
  const prisma = { building: { findMany: async () => [] }, shop: { findMany: async () => [] } };
  const fetchFn = async () => ({ ok: true, json: async () => ({ features: (osmHits || []).map(h => ({
    properties: { name: h.label, street: h.sub || '' },
    geometry: { coordinates: [h.lng, h.lat] } })) }) });
  return makeGeo({ routerUrl: 'http://r', fetchFn, prisma });
}

test('a named landmark answers first, whatever the search engine ranks highest', async () => {
  // The real failure: the top OSM hit for "Bole Airport" is a mosque on Ring Road.
  const geo = geoWithOsm([{ label: 'Bole Airport Mosque', lat: 8.97846, lng: 38.77592, sub: 'Ring Road' }]);
  const r = await geo.searchPlaces('Bole Airport');
  assert.equal(r[0].label, 'Bole Airport', 'the terminal, not the mosque');
  assert.equal(r[0].landmark, true);
  assert.ok(Math.abs(r[0].lat - 8.97919) < 0.001 && Math.abs(r[0].lng - 38.79658) < 0.001);
  assert.ok(haversineM(r[0], { lat: 8.97846, lng: 38.77592 }) > 2000, 'the mosque was 2 km+ away');
  assert.equal(r.some(h => h.label === 'Bole Airport Mosque'), true, 'the other hits are still offered');
});

test('"Ayat" resolves to the Ayat area, not to a person with a similar name', async () => {
  const geo = geoWithOsm([{ label: 'Hayat Mohammed Abdurahman', lat: 8.95, lng: 38.70, sub: '' }]);
  const r = await geo.searchPlaces('Ayat');
  assert.equal(r[0].label, 'Ayat');
  assert.ok(haversineM(r[0], { lat: 9.02179, lng: 38.87702 }) < 100);
});

test('"Bole Medhanealem" resolves to the area, not to a bank branch named after it', async () => {
  const geo = geoWithOsm([{ label: 'Zemen Bank Bole MedhaneAlem Branch', lat: 8.99441, lng: 38.79021, sub: 'Cameroon Street' }]);
  const r = await geo.searchPlaces('bole medhane alem');
  assert.equal(r[0].label, 'Bole Medhanealem', 'an alias spelling still resolves');
  assert.equal(r[0].labelAm, 'ቦሌ መድኃኔዓለም');
});

test('a hit within 200 m of the landmark is dropped: for a pickup they are the same place', async () => {
  const geo = geoWithOsm([
    { label: 'Piassa (piazza)', lat: 9.03370, lng: 38.75475, sub: '' },   // ~100 m — same place
    { label: 'Piassa Atekelet Tera', lat: 9.03442, lng: 38.74753, sub: '' }, // ~800 m — a real alternative
  ]);
  const r = await geo.searchPlaces('Piassa');
  assert.equal(r[0].label, 'Piassa');
  assert.equal(r.some(h => h.label === 'Piassa (piazza)'), false, 'the near-duplicate is collapsed');
  assert.equal(r.some(h => h.label === 'Piassa Atekelet Tera'), true, 'the genuinely different one survives');
});

test('Amharic names and loose spellings hit the same landmark; unknown places are untouched', async () => {
  const geo = geoWithOsm([{ label: 'Some Cafe', lat: 9.01, lng: 38.76, sub: '' }]);
  for (const q of ['መገናኛ', 'megenagna', '  Megenagna  ', 'MEGENAGNA']) {
    const r = await geo.searchPlaces(q);
    assert.equal(r[0].label, 'Megenagna', 'failed for ' + JSON.stringify(q));
  }
  const other = await geo.searchPlaces('Some Cafe');
  assert.equal(other[0].label, 'Some Cafe', 'a normal search is not hijacked');
  assert.equal(other[0].landmark, undefined);
});

test('the second batch of neighbourhood names resolves, including the one search got wrong', async () => {
  // Tor Hailoch is the real failure here: the top hit is on Chad Street near Mexico.
  const geo = geoWithOsm([{ label: 'Torhailoch, Abenet', lat: 9.01069, lng: 38.74262, sub: 'Chad Street, Mexico' }]);
  const tor = await geo.searchPlaces('Torhailoch');
  assert.equal(tor[0].label, 'Tor Hailoch');
  assert.ok(haversineM(tor[0], { lat: 9.01069, lng: 38.74262 }) > 2000, 'the Mexico hit was 2 km+ away');

  const plain = geoWithOsm([]);
  const expect = {
    'Lebu': [8.96114, 38.72542], 'ለቡ': [8.96114, 38.72542],
    'Jemo': [8.95996, 38.71148], 'jemo 1': [8.95996, 38.71148],
    'Shiro Meda': [9.05840, 38.75983], 'sheromeda': [9.05840, 38.75983],
    'Kotebe': [9.03713, 38.83985], 'ኮተቤ': [9.03713, 38.83985],
    'tor hayloch': [9.01140, 38.72291],
  };
  for (const [q, [lat, lng]] of Object.entries(expect)) {
    const r = await plain.searchPlaces(q);
    assert.ok(r.length, 'no result for ' + q);
    assert.equal(r[0].landmark, true, q + ' should be a pinned landmark');
    assert.ok(haversineM(r[0], { lat, lng }) < 50, q + ' resolved to the wrong point');
  }
});
