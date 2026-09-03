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
