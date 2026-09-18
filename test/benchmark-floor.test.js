'use strict';
// The one-question slack on the shipped column: noise passes, a real drop does not.
const test = require('node:test');
const assert = require('node:assert/strict');
const { shippedFloor, oneQuestion } = require('./lib/benchmark-floor');

test('one question below the floor passes, two below fails, in a slice of 60', () => {
  // 54/60 = 90.0 is the floor; 53/60 = 88.3 is one question below; 52/60 = 86.7 is two
  assert.equal(shippedFloor({ n: 60, shipped: '90.0%' }, 90.0), true);
  assert.equal(shippedFloor({ n: 60, shipped: '88.3%' }, 90.0), true);
  assert.equal(shippedFloor({ n: 60, shipped: '86.7%' }, 90.0), false);
});

test('the slack is one question in any slice size, not a fixed percentage', () => {
  assert.equal(oneQuestion({ n: 16 }), 100 / 16);
  // 14/16 = 87.5 floor; 13/16 = 81.3 is one below; 12/16 = 75.0 is two below
  assert.equal(shippedFloor({ n: 16, shipped: '81.3%' }, 87.5), true);
  assert.equal(shippedFloor({ n: 16, shipped: '75.0%' }, 87.5), false);
  // a slice of 110: one question is under a point
  assert.equal(shippedFloor({ n: 110, shipped: '70.0%' }, 70.9), true);
  assert.equal(shippedFloor({ n: 110, shipped: '69.1%' }, 70.9), false);
});

test('a row with no question count is an error, not a silent pass', () => {
  assert.throws(() => shippedFloor({ shipped: '90%' }, 90), /no question count/);
});
