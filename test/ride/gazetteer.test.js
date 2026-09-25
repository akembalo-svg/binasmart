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

test('a shop, an office and a bus stop are destinations, named by their own type', () => {
  const f3 = path.join(path.dirname(file), 'rest.json');
  fs.writeFileSync(f3, JSON.stringify({ bySub: {}, elements: [
    { type: 'node', id: 1, lat: 9.0, lon: 38.75, tags: { shop: 'bakery', name: 'Sample Bakery' } },
    { type: 'node', id: 2, lat: 9.01, lon: 38.76, tags: { office: 'ngo', name: 'Sample Aid' } },
    { type: 'node', id: 3, lat: 9.02, lon: 38.77, tags: { highway: 'bus_stop', public_transport: 'platform', name: 'Sample Stop' } } ] }));
  const g = makeGazetteer({ file: f3 });
  assert.match(g.search('Sample Bakery')[0].sub, /^bakery/);
  assert.match(g.search('Sample Aid')[0].sub, /^ngo/);
  assert.match(g.search('Sample Stop')[0].sub, /^stop/);
});

test('spacing and word order do not hide a place; one missing short word does not either', () => {
  const f4 = path.join(path.dirname(file), 'words.json');
  fs.writeFileSync(f4, JSON.stringify({ bySub: {}, elements: [
    { type: 'node', id: 1, lat: 9.0, lon: 38.75, tags: { tourism: 'hotel', name: 'Di Sample Hotel' } },
    { type: 'node', id: 2, lat: 9.01, lon: 38.76, tags: { building: 'yes', name: 'Sample Union Conference Center' } } ] }));
  const g = makeGazetteer({ file: f4 });
  assert.equal(g.search('Disample')[0].label, 'Di Sample Hotel');
  assert.equal(g.search('SU Conference Center')[0].label, 'Sample Union Conference Center');
  assert.equal(g.search('center conference')[0].label, 'Sample Union Conference Center');
});
