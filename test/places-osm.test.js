'use strict';
// ops/places/osm-addis.js: only landlines and short codes survive; mobiles never. Numbers are invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const { phonesOf, build } = require('../ops/places/osm-addis');

test('mobile numbers are dropped, landlines normalised, short codes kept', () => {
  assert.deepEqual(phonesOf({ phone: '0900000042' }), []);
  assert.deepEqual(phonesOf({ phone: '+251 90 000 0042' }), []);
  assert.deepEqual(phonesOf({ phone: '+251700000042' }), []);
  assert.deepEqual(phonesOf({ phone: '011 000 0042' }), ['+251 11 000 0042']);
  assert.deepEqual(phonesOf({ phone: '+251-11-000-0042; 0900000042' }), ['+251 11 000 0042']);
  assert.deepEqual(phonesOf({ 'contact:phone': '8335' }), ['8335']);
});

test('a built document names its source and licence, and never carries a mobile', () => {
  const { files } = build({ at: '2026-09-24T00:00:00Z', bySub: { node1: 'Bole' }, elements: [
    { type: 'node', id: 1, lat: 9, lon: 38.7, tags: { amenity: 'hospital', name: 'Sample Hospital', phone: '0900000042;011 000 0042' } },
    { type: 'node', id: 2, lat: 9, lon: 38.7, tags: { amenity: 'hospital' } } ] });
  const t = files['addis-hospitals.md'];
  assert.match(t, /OpenStreetMap contributors, ODbL/);
  assert.match(t, /Sample Hospital/);
  assert.match(t, /\+251 11 000 0042/);
  assert.doesNotMatch(t, /0900000042/);
  assert.match(t, /Lemi Kura/, 'Bole carries the Lemi Kura caveat');
});
