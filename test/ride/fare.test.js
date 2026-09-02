'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { quoteFare, quoteAll, roundTo5, TIERS } = require('../../ride/fare');

const S = { commissionPct: 15, tiers: {
  moto:    { base: 40,  perKm: 12, perMin: 1.5, min: 60 },
  bajaj:   { base: 50,  perKm: 15, perMin: 2,   min: 80 },
  economy: { base: 80,  perKm: 28, perMin: 3,   min: 150 },
  comfort: { base: 120, perKm: 40, perMin: 4,   min: 230 },
  xl:      { base: 180, perKm: 55, perMin: 5,   min: 350 } } };

test('rounds to nearest 5', () => {
  assert.equal(roundTo5(152), 150); assert.equal(roundTo5(153), 155); assert.equal(roundTo5(0), 0);
});

test('economy 5 km / 12 min = 80 + 140 + 36 = 256 -> 255', () => {
  const q = quoteFare(S, 'economy', 5000, 720);
  assert.equal(q.fareEtb, 255);
  assert.equal(q.driverTakeEtb, Math.round(255 * 0.85));
  assert.equal(q.km, 5); assert.equal(q.min, 12);
});

test('short trip floors at tier minimum', () => {
  assert.equal(quoteFare(S, 'moto', 300, 60).fareEtb, 60);
  assert.equal(quoteFare(S, 'xl', 300, 60).fareEtb, 350);
});

test('unknown tier throws', () => {
  assert.throws(() => quoteFare(S, 'rocket', 1000, 60), /unknown_tier/);
});

test('quoteAll returns all five tiers in order', () => {
  const all = quoteAll(S, 3000, 400);
  assert.deepEqual(all.map(q => q.tier), TIERS);
  assert.ok(all.every(q => q.fareEtb >= S.tiers[q.tier].min));
});
