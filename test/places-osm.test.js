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

test('an entry with a mobile number in its name or text is left out whole', () => {
  const { files, mobileLines } = build({ at: '2026-09-25T00:00:00Z', bySub: {}, elements: [
    { type: 'node', id: 3, lat: 9, lon: 38.7, tags: { amenity: 'restaurant', name: 'Sample Cafe 0900000042' } },
    { type: 'node', id: 4, lat: 9, lon: 38.7, tags: { amenity: 'restaurant', name: 'Sample Restaurant', opening_hours: 'call 0900000042' } },
    { type: 'node', id: 5, lat: 9, lon: 38.7, tags: { amenity: 'restaurant', name: 'Clean Sample Restaurant' } } ] });
  assert.equal(mobileLines, 2);
  assert.match(files['addis-restaurants-cafes.md'], /Clean Sample Restaurant/);
  assert.doesNotMatch(files['addis-restaurants-cafes.md'], /0900000042/);
});

test('every other named thing lands in a catch-all kind, labelled by its own type', () => {
  const { files } = build({ at: '2026-09-25T00:00:00Z', bySub: {}, elements: [
    { type: 'node', id: 7, lat: 9, lon: 38.7, tags: { shop: 'bakery', name: 'Sample Bakery' } },
    { type: 'node', id: 8, lat: 9, lon: 38.7, tags: { highway: 'bus_stop', public_transport: 'platform', name: 'Sample Stop' } } ] });
  assert.match(files['addis-shops-services.md'], /Sample Bakery\*\* · bakery/);
  assert.match(files['addis-stops-taxi-rail.md'], /Sample Stop/);
});
