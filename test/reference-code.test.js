'use strict';
// A bare reference/ID number gets the "cannot look this up" guard (1 Oct 2026 real-user review).
const test = require('node:test');
const assert = require('node:assert');
const { isReferenceCode, REF_GUARD } = require('../assistant/force');

test('pasted reference and ID numbers are codes', () => {
  for (const s of ['EF12345678', 'EFLGD49967', 'essc/2084/261001/3', 'ETH-2026-004512', 'AB12-345'])
    assert.strictEqual(isReferenceCode(s), true, s);
});

test('ride ids, phones, words, sentences and links are not', () => {
  for (const s of ['cm1abcdefghijklmnopqrstu', '0900000000', '+251900000000', 'Stopjob', 'Labor id', 'hello', '450,000',
    'my id is EF12345678', 'https://bina.et/ride', 'bina.et/jobs', 'iPhone18', 'Physiotheraphy', ''])
    assert.strictEqual(isReferenceCode(s), false, s);
});

test('the guard never lets Bini pretend to check, and names only real places', () => {
  assert.match(REF_GUARD, /cannot look up/);
  assert.match(REF_GUARD, /do not call ride_status/);
  assert.match(REF_GUARD, /bina\.et\/lmis-labor-id-ethiopia/);
});
