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
  assert.deepEqual(landlines('+251 900 000 004 (bookings +251 110 000005)'), [], 'a mobile anywhere in the part drops it');
  assert.deepEqual(landlines('00251900000006'), [], 'the 00251 form is a mobile too');
});

test('a place the map draws as a building counts when its name says it is somewhere to stay', () => {
  const extra = { bySub: { node20: 'Yeka', node21: 'Yeka' }, elements: [
    { type: 'node', id: 20, lat: 9.02, lon: 38.80, tags: { building: 'yes', name: 'Sample Pension' } },
    { type: 'node', id: 21, lat: 9.02, lon: 38.81, tags: { amenity: 'restaurant', name: 'Sample Kitfo and Hotel' } },
    { type: 'node', id: 22, lat: 9.02, lon: 38.82, tags: { amenity: 'restaurant', name: 'Sample Guest House' } },
    { type: 'node', id: 23, lat: 9.02, lon: 38.83, tags: { highway: 'bus_stop', name: 'Sample Hotel' } },
    { type: 'node', id: 24, lat: 9.02, lon: 38.84, tags: { building: 'yes', name: 'Sample Hotel Training Institute' } },
    { type: 'node', id: 25, lat: 9.03, lon: 38.75, tags: { tourism: 'hotel', name: 'Other Hotel' } },
    { type: 'node', id: 26, lat: 9.0301, lon: 38.7501, tags: { building: 'yes', name: 'Other Hotel ሌላ ሆቴል' } },
    { type: 'node', id: 27, lat: 9.04, lon: 38.70, tags: { name: 'Sample Airport', 'name:am': 'ናሙና አውሮፕላን ማረፊያ' } },
    { type: 'node', id: 28, lat: 9.04, lon: 38.71, tags: { amenity: 'internet_cafe', name: '100000 Sample Hotel' } },
    { type: 'node', id: 29, lat: 9.05, lon: 38.72, tags: { tourism: 'hotel', name: 'Elilly Sample Hotel' } },
    { type: 'way', id: 30, center: { lat: 9.0503, lon: 38.7202 }, tags: { building: 'yes', name: 'Elily Sample Hotel' } },
  ] };
  const d = buildDirectory(extra);
  assert.deepEqual(d.map(p => p.name).sort(), ['Elilly Sample Hotel', 'Other Hotel', 'Sample Guest House', 'Sample Pension']);
  const pen = d.find(p => p.name === 'Sample Pension');
  assert.equal(pen.kind, 'guest_house'); assert.equal(pen.unsure, true); assert.equal(pen.sub, 'Yeka');
  assert.equal(d.find(p => p.name === 'Other Hotel').unsure, false);
});

test('a Wikidata hotel gets a listing only when the map has no such name nearby', () => {
  const map = { bySub: { node30: 'Kirkos' }, elements: [{ type: 'node', id: 30, lat: 9.01, lon: 38.76, tags: { tourism: 'hotel', name: 'Sample Grand Hotel' } }] };
  const d = buildDirectory(map, [
    { qid: 'Q1', name: 'Sample Grand Hotel Addis Ababa', lat: 9.011, lng: 38.761 },
    { qid: 'Q2', name: 'Namuna Inn', nameAm: 'ናሙና', lat: 9.012, lng: 38.762 },
    { qid: 'Q3', name: 'Sample Grand Hotel - Cazanchis', lat: 9.0101, lng: 38.7601 },
  ]);
  assert.deepEqual(d.map(p => p.name), ['Namuna Inn', 'Sample Grand Hotel']);
  const w = d[0];
  assert.equal(w.ref, 'wikidata/Q2'); assert.equal(w.slug, 'namuna-inn-q2'); assert.equal(w.sub, 'Kirkos', 'sub-city from the nearest mapped place');
});
