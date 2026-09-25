'use strict';
// ride/gazetteer.js and its place in the ride search. Every place below is invented, on made-up coordinates in Addis.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeGazetteer } = require('../../ride/gazetteer');
const { makeGeo } = require('../../ride/geo');

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gaz-')), 'osm.json');
fs.writeFileSync(file, JSON.stringify({ at: '2026-09-25T00:00:00Z', bySub: { node1: 'Arada', node2: 'Bole', way3: 'Kirkos', way4: 'Bole' }, elements: [
  { type: 'node', id: 1, lat: 9.031, lon: 38.764, tags: { amenity: 'place_of_worship', name: 'Sample Trinity Cathedral', 'name:am': 'ናሙና ሥላሴ ካቴድራል' } },
  { type: 'node', id: 2, lat: 8.995, lon: 38.785, tags: { amenity: 'cafe', name: 'Sample Tree Cafe' } },
  { type: 'way', id: 3, center: { lat: 9.00, lon: 38.77 }, tags: { highway: 'primary', name: 'Sample Avenue' } },
  { type: 'way', id: 4, center: { lat: 8.99, lon: 38.78 }, tags: { highway: 'primary', name: 'Sample Avenue' } },
  { type: 'node', id: 5, lat: 9.0, lon: 38.7, tags: { amenity: 'bench', name: 'Not a destination' } },
] }));

test('finds places by English or Amharic name, with kind and sub-city; one line per street name', () => {
  const g = makeGazetteer({ file });
  assert.equal(g.size(), 3, 'a bench is not a destination, and the avenue is one entry');
  const en = g.search('sample trinity');
  assert.equal(en[0].label, 'Sample Trinity Cathedral');
  assert.match(en[0].sub, /place of worship · Arada/);
  assert.equal(g.search('ናሙና ሥላሴ')[0].label, 'Sample Trinity Cathedral');
  assert.equal(g.search('Sample Avenue').length, 1);
});

test('exact beats starts-with beats contains; streets come after places of the same rank', () => {
  const g = makeGazetteer({ file });
  const r = g.search('sample');
  assert.equal(r[r.length - 1].label, 'Sample Avenue');
});

test('a missing file is not an error: the search is simply empty', () => {
  assert.deepEqual(makeGazetteer({ file: '/nonexistent/osm.json' }).search('anything'), []);
});

test('the ride search lists local places after the directory and skips Photon when there are enough', async () => {
  let photon = 0;
  const prisma = { building: { findMany: async () => [] }, shop: { findMany: async () => [] } };
  const gazetteer = { search: () => [1, 2, 3, 4].map(i => ({ kind: 'place', label: 'Sample ' + i, labelAm: '', sub: 'cafe', lat: 9 + i / 100, lng: 38.7 })) };
  const geo = makeGeo({ routerUrl: 'http://x', prisma, gazetteer, fetchFn: async () => { photon++; return { json: async () => ({ features: [] }) }; } });
  const res = await geo.searchPlaces('Sample');
  assert.equal(res[0].kind, 'place');
  assert.equal(photon, 0, 'four local answers: no outside call');
});

test('one place mapped twice under one name is one answer', () => {
  const f2 = path.join(path.dirname(file), 'twice.json');
  fs.writeFileSync(f2, JSON.stringify({ bySub: {}, elements: [
    { type: 'node', id: 1, lat: 9.0, lon: 38.79, tags: { shop: 'mall', name: 'Sample Mall' } },
    { type: 'way', id: 2, center: { lat: 9.0005, lon: 38.7902 }, tags: { shop: 'department_store', name: 'Sample Mall' } } ] }));
  assert.equal(makeGazetteer({ file: f2 }).search('Sample Mall').length, 1);
});
