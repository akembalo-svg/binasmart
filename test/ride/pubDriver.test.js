'use strict';
// What the ops driver list is allowed to say about a person.
const test = require('node:test');
const assert = require('node:assert');
const { pubOpsDriver, OPS_DRIVER_FIELDS, OPS_DRIVER_WITHHELD } = require('../../ride/pubDriver');

// A row with every column Driver has today, so "what leaks" is a question this test can answer.
const row = {
  id: 'd1', authUserId: 'au1', name: 'Abebe Bekele', phone: '+251911000111', photo: '/u/d1.jpg',
  telegramId: '12345', tier: 'economy', vehicleMake: 'Toyota Vitz', vehicleColour: 'white',
  plate: 'AA 12345', licenceUrl: '/api/ride/ops/driver-doc/d1', carPhotoUrl: '/api/ride/car/d1.jpg',
  registrationUrl: '/u/d1-reg.jpg', status: 'approved', online: true, lat: 9.0108, lng: 38.7578,
  lastSeenAt: new Date(), rating: 4.8, ridesCount: 312, commissionPct: 15, bearing: 91,
  speedKph: 34, away: false, onRideId: null, earningsTodayEtb: 1450, earningsDay: new Date(),
  createdAt: new Date(),
};

test('a driver is published as identity, vehicle and dispatch status', () => {
  const p = pubOpsDriver(row);
  assert.equal(p.name, 'Abebe Bekele');
  assert.equal(p.plate, 'AA 12345');
  assert.equal(p.status, 'approved');
  assert.equal(p.ridesCount, 312);
  assert.equal(p.licenceUrl, '/api/ride/ops/driver-doc/d1');
});

// The point of the whole change.
test('a driver\'s position never leaves in this list', () => {
  const p = pubOpsDriver(row);
  for (const k of ['lat', 'lng', 'bearing', 'speedKph'])
    assert.ok(!(k in p), k + ' is a live position and must not ride along with a list of names');
});

test('and neither does their money', () => {
  const p = pubOpsDriver(row);
  for (const k of ['commissionPct', 'earningsTodayEtb', 'earningsDay'])
    assert.ok(!(k in p), k + ' is the driver\'s earnings, not a dispatch field');
});

test('nor an internal join key', () => {
  assert.ok(!('authUserId' in pubOpsDriver(row)));
});

// The guard that matters over time: a column added to Driver must not publish itself. This fails the
// day someone widens the list without widening the withheld note too.
test('⚠️ every field in the fixture is either published on purpose or withheld on purpose', () => {
  const known = new Set([...OPS_DRIVER_FIELDS, ...OPS_DRIVER_WITHHELD]);
  const unaccounted = Object.keys(row).filter(k => !known.has(k));
  assert.deepEqual(unaccounted, [],
    'Driver has columns this module has not decided about: ' + unaccounted.join(', ') +
    ' — add each to OPS_DRIVER_FIELDS or to OPS_DRIVER_WITHHELD, with a reason.');
});

test('the two lists do not overlap', () => {
  const both = OPS_DRIVER_FIELDS.filter(f => OPS_DRIVER_WITHHELD.includes(f));
  assert.deepEqual(both, [], 'a field cannot be both published and withheld: ' + both.join(', '));
});

test('no driver at all is null, not a crash', () => {
  assert.equal(pubOpsDriver(null), null);
  assert.equal(pubOpsDriver(undefined), null);
});
