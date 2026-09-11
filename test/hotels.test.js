'use strict';
// The hotel rules that fail quietly.
const test = require('node:test');
const assert = require('node:assert');
const { isDemo, addisDay } = require('../hotels/rules');

// ---- the day the hotel is in -------------------------------------------------------------------
// This was live, not hypothetical: at 22:56 UTC the server called it 11 September and accepted a
// check-in of 11 September, while the guest looking at the page in Addis Ababa was three hours into
// the 12th.
test('between midnight and 3am in Addis, UTC still says yesterday', () => {
  const lateNightInAddis = new Date('2026-09-11T22:56:00Z');   // = 01:56 on the 12th, Addis
  assert.equal(lateNightInAddis.toISOString().slice(0, 10), '2026-09-11', 'this is what the bug used');
  assert.equal(addisDay(lateNightInAddis), '2026-09-12', 'and this is the day the hotel is having');
});

test('the rest of the day the two agree, which is why it survived', () => {
  const midMorning = new Date('2026-09-12T09:00:00Z');
  assert.equal(midMorning.toISOString().slice(0, 10), addisDay(midMorning));
});

test('the boundary is 21:00 UTC exactly', () => {
  assert.equal(addisDay(new Date('2026-09-11T20:59:59Z')), '2026-09-11');
  assert.equal(addisDay(new Date('2026-09-11T21:00:00Z')), '2026-09-12');
});

test('Ethiopia does not observe daylight saving, so the offset holds in January too', () => {
  assert.equal(addisDay(new Date('2027-01-15T21:30:00Z')), '2027-01-16');
});

// ---- is it a real hotel ------------------------------------------------------------------------
test('the demo hotel as it is actually stored', () => {
  assert.equal(isDemo({ name: 'Bina Grand Hotel', subCity: 'Demo hotel — sample data' }), true);
});

test('a real hotel is not flagged', () => {
  assert.equal(isDemo({ name: 'Skylight Hotel', subCity: 'Bole' }), false);
  assert.equal(isDemo({ name: 'Sheraton Addis', subCity: 'Kirkos' }), false);
});

test('missing fields do not throw, and do not flag', () => {
  assert.equal(isDemo({}), false);
  assert.equal(isDemo(null), false);
  assert.equal(isDemo({ name: null, subCity: undefined }), false);
});

// The known weakness, written down rather than left to be discovered. The warning on both the listing
// and the booking page hangs entirely on this string. If someone tidies the demo hotel's sub-city to
// a real one, every disclosure vanishes in the same commit and nothing fails.
test('⚠️ the disclosure depends on a free-text field nobody is guarding', () => {
  assert.equal(isDemo({ name: 'Bina Grand Hotel', subCity: 'Bole' }), false,
    'renaming the sub-city silently turns the demo warning off — this is why a demo column would be better');
});
