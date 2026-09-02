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
