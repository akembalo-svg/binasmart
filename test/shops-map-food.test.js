'use strict';
// search_shops falls back to the city map for food (30 Sep 2026): the directory had no live restaurant, and Bini answered
// "no restaurants near Piassa / Megenagna" over a map full of them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeExecutor } = require('../assistant/tools');

const empty = { shop: { findMany: async () => [] } };
function fakeGaz() {
  const calls = [];
  const P = [{ label: 'Train house', labelAm: 'ትሬን ሃውስ', kind: 'restaurant', sub: 'Arada', lat: 9.0343, lng: 38.7546, m: 50 },
    { label: 'Alem Buna', kind: 'cafe', sub: 'Arada', lat: 9.0335, lng: 38.7549, m: 118 }];
  return { calls, around: o => { calls.push(o); return o.words && o.words.includes('pizza') && o.lat != null ? [] : P; } };
}
const fetchImpl = async url => ({ ok: true, status: 200, json: async () => /q=Piassa/i.test(url) ? { results: [{ label: 'Piassa', lat: 9.0346, lng: 38.7549 }] } : { results: [] } });

test('no directory hit for food near a neighbourhood: map places nearest first, labelled as map data', async () => {
  const gaz = fakeGaz(), run = makeExecutor({ base: 'http://127.0.0.1:1', fetchImpl, prisma: empty, gazetteer: gaz, publicBase: 'https://bina.et' });
  const r = await run('search_shops', { q: 'cheap restaurant near Piassa', category: 'RESTAURANT' });
  assert.equal(r.mapPlaces.length, 2); assert.equal(r.mapPlaces[0].name, 'Train house'); assert.equal(r.mapPlaces[0].distanceKm, 0.1);
  assert.match(r.mapPlaces[0].ride, /^https:\/\/bina\.et\/ride\?to=Train%20house&lat=9\.0343&lng=38\.7546$/);
  assert.match(r.mapNote, /No phone, opening hours, prices/); assert.match(r.mapNote, /Nearest to Piassa/);
  assert.deepEqual(gaz.calls[0].words, []);   // "cheap" is not a dish: dropped, the map has no prices
  assert.equal(gaz.calls[0].lat, 9.0346);
});

test('a sub-city filters by sub-city; a dish with no match nearby says so; no area and no dish asks, as before', async () => {
  const gaz = fakeGaz(), run = makeExecutor({ base: 'http://127.0.0.1:1', fetchImpl, prisma: empty, gazetteer: gaz });
  await run('search_shops', { q: 'Bole', category: 'CAFE' });
  assert.equal(gaz.calls[0].sub, 'bole');   // matched case-blind against the map's "Bole" assert.deepEqual(gaz.calls[0].kinds, ['cafe']);
  const pizza = await run('search_shops', { q: 'pizza near Piassa', category: 'RESTAURANT' });
  assert.match(pizza.mapNote, /None of these names mentions "pizza"/);
  const generic = await run('search_shops', { q: 'good restaurant in Addis', category: 'RESTAURANT' });
  assert.equal(generic.mapPlaces, undefined);
  const pharmacy = await run('search_shops', { q: 'Piassa', category: 'PHARMACY' });
  assert.equal(pharmacy.mapPlaces, undefined);   // only food falls back to the map
});
