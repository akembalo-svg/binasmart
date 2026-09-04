'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seatsFor, validateLayout, sectionOf, priceOf, capacityOf, isSeat } = require('../../cinema/seatmap');

const LAYOUT = { rows: ['A', 'B', 'C'], seatsPerRow: 6, aisles: [3], blocked: ['A1'], wheelchair: ['C6'],
  sections: [{ name: 'VIP', nameAm: 'ቪአይፒ', rows: ['A'] }, { name: 'Regular', nameAm: 'መደበኛ', rows: ['B', 'C'] }] };

test('seatsFor expands the template into concrete seats with section and flags', () => {
  const s = seatsFor(LAYOUT);
  assert.equal(s.length, 18);
  assert.deepEqual(s[0], { id: 'A1', row: 'A', n: 1, section: 'VIP', blocked: true, wheelchair: false, aisleAfter: false });
  assert.equal(s.find(x => x.id === 'A3').aisleAfter, true, 'gap after seat 3');
  assert.equal(s.find(x => x.id === 'C6').wheelchair, true);
  assert.equal(s.find(x => x.id === 'B2').section, 'Regular');
});
test('capacity excludes blocked seats', () => { assert.equal(capacityOf(LAYOUT), 17); });
test('sectionOf and priceOf come from the layout and the show, never the client', () => {
  assert.equal(sectionOf(LAYOUT, 'B4'), 'Regular');
  assert.equal(priceOf(LAYOUT, { VIP: 500, Regular: 300 }, 'A2'), 500);
  assert.equal(priceOf(LAYOUT, { VIP: 500, Regular: 300 }, 'C1'), 300);
  assert.throws(() => priceOf(LAYOUT, { VIP: 500 }, 'C1'), /no price for section Regular/);
});
test('validateLayout rejects what the ops form must not accept', () => {
  assert.equal(validateLayout(LAYOUT).ok, true);
  assert.match(validateLayout({ ...LAYOUT, rows: [] }).error, /rows/);
  assert.match(validateLayout({ ...LAYOUT, seatsPerRow: 0 }).error, /seatsPerRow/);
  assert.match(validateLayout({ ...LAYOUT, rows: ['A', 'A', 'B'] }).error, /duplicate/);
  assert.match(validateLayout({ ...LAYOUT, sections: [{ name: 'VIP', rows: ['Z'] }] }).error, /unknown row Z/);
  assert.match(validateLayout({ ...LAYOUT, sections: [{ name: 'VIP', rows: ['A'] }] }).error, /row B has no section/);
  assert.match(validateLayout({ ...LAYOUT, sections: [{ name: 'VIP', rows: ['A', 'B', 'C'] }, { name: 'X', rows: ['A'] }] }).error, /two sections/);
  const many = Array.from({ length: 27 }, (_, i) => 'R' + i);
  assert.match(validateLayout({ ...LAYOUT, rows: many, sections: [{ name: 'S', rows: many }] }).error, /26 rows/);
  assert.match(validateLayout({ ...LAYOUT, blocked: 'A1' }).error, /blocked must be a list/);
  assert.match(validateLayout(null).error, /object/);
});
test('isSeat only accepts ids the template actually contains', () => {
  assert.equal(isSeat(LAYOUT, 'B4'), true);
  assert.equal(isSeat(LAYOUT, 'A1'), false, 'blocked is not bookable');
  assert.equal(isSeat(LAYOUT, 'D1'), false);
  assert.equal(isSeat(LAYOUT, 'B0'), false);
  assert.equal(isSeat(LAYOUT, 'B7'), false);
  assert.equal(isSeat(LAYOUT, 42), false);
  assert.equal(isSeat(LAYOUT, 'b4'), false, 'case matters: ids are canonical');
});
