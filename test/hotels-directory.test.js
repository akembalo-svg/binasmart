'use strict';
// hotels/directory.js: which map entries become listings, and what a listing may show. Invented places and numbers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDirectory, landlines } = require('../hotels/directory');

const osm = {
  bySub: { node1: 'Bole', node2: 'Bole', way3: 'Arada' },
  elements: [
    { type: 'node', id: 1, lat: 9.0, lon: 38.8, tags: { tourism: 'hotel', name: 'Test Palace Hotel', 'name:am': 'ቴስት ፓላስ ሆቴል', stars: '4', phone: '+251110000001;+251900000001', website: 'testpalace.example' } },
    { type: 'node', id: 2, lat: 9.0001, lon: 38.8001, tags: { tourism: 'hotel', name: 'Test Palace Hotel' } },
    { type: 'way', id: 3, center: { lat: 9.03, lon: 38.75 }, tags: { tourism: 'guest_house', name: 'Sample Pension' } },
    { type: 'node', id: 4, lat: 9.01, lon: 38.76, tags: { tourism: 'apartment', name: 'Sample Apartments' } },
    { type: 'way', id: 7, center: { lat: 9.05, lon: 38.74 }, tags: { tourism: 'hotel', name: 'ናሙና ሆቴል', 'name:en': 'Namuna Hotel' } },
    { type: 'node', id: 5, lat: 9.01, lon: 38.76, tags: { tourism: 'museum', name: 'Not A Hotel' } },
    { type: 'node', id: 6, lat: 9.01, lon: 38.76, tags: { tourism: 'hotel' } },
  ],
};

test('every kind of place to stay, once, with its sub-city', () => {
  const d = buildDirectory(osm);
  assert.deepEqual(d.map(p => p.name), ['Test Palace Hotel', 'Namuna Hotel', 'Sample Apartments', 'Sample Pension']);
  assert.equal(d[1].nameAm, 'ናሙና ሆቴል', 'an Amharic-only name moves under the English one');
  assert.equal(d[1].slug, 'namuna-hotel-w7');
  const h = d[0];
  assert.equal(h.ref, 'node/1', 'the richer duplicate within 300 m is kept');
  assert.equal(h.slug, 'test-palace-hotel-n1');
  assert.equal(h.sub, 'Bole'); assert.equal(h.subAm, 'ቦሌ');
  assert.equal(h.stars, 4);
  assert.equal(h.website, 'https://testpalace.example');
  assert.equal(d[3].sub, 'Arada', 'a building uses its centre');
});

test('a listing shows landlines, never a mobile', () => {
  assert.deepEqual(buildDirectory(osm)[0].phones, ['+251110000001']);
  assert.deepEqual(landlines('0900000001, 0700000002, +251 900 000 003'), []);
  assert.deepEqual(landlines('+251110000001/02, 0110000003'), ['+251110000001/02', '0110000003']);
});
