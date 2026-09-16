'use strict';
// A sign-in code is a password that lives five minutes. These tests pin the two things that decide
// whether it is a real one: it is unguessable, and what we keep is not it.
const test = require('node:test');
const assert = require('node:assert/strict');
const pc = require('../../auth/phone-code');

const PEPPER = 'test-pepper-0000000000000000000000000000';   // 40 characters, obviously fake
const PHONE = '+251900000001';

test('a code is six digits and comes from the randomness we are given', () => {
  const seq = [4, 8, 3, 9, 2, 0];
  let i = 0;
  const code = pc.newCode((lo, hi) => { assert.equal(lo, 0); assert.equal(hi, 10); return seq[i++]; });
  assert.equal(code, '483920');
  assert.equal(code.length, pc.CODE_LEN);
  assert.match(pc.newCode(), /^\d{6}$/);
});

test('the same code, phone and pepper always hash to the same 64 hex characters', () => {
  const a = pc.hashCode('483920', PHONE, PEPPER);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, pc.hashCode('483920', PHONE, PEPPER));
});

test('a different code, a different phone or a different pepper is a different hash', () => {
  const a = pc.hashCode('483920', PHONE, PEPPER);
  assert.notEqual(a, pc.hashCode('483921', PHONE, PEPPER));
  assert.notEqual(a, pc.hashCode('483920', '+251900000002', PEPPER));
  assert.notEqual(a, pc.hashCode('483920', PHONE, PEPPER + 'x'));
});

test('the phone and the code cannot be run together into the same hash', () => {
  // Without a separator, ('+25190000000', '1483920') and ('+251900000001', '483920') would collide,
  // and a code issued for one number would open another.
  assert.notEqual(pc.hashCode('1483920', '+25190000000', PEPPER), pc.hashCode('483920', PHONE, PEPPER));
});

test('a pepper shorter than 32 characters is refused, loudly, before anything is written', () => {
  assert.throws(() => pc.hashCode('483920', PHONE, 'short'), /AUTH_PHONE_CODE_PEPPER/);
  assert.throws(() => pc.hashCode('483920', PHONE, ''), /AUTH_PHONE_CODE_PEPPER/);
  assert.throws(() => pc.hashCode('483920', PHONE, null), /AUTH_PHONE_CODE_PEPPER/);
  assert.equal(pc.MIN_PEPPER, 32);
});

test('two equal hashes match and two different ones do not, whatever their length', () => {
  const h = pc.hashCode('483920', PHONE, PEPPER);
  assert.equal(pc.sameHash(h, h), true);
  assert.equal(pc.sameHash(h, pc.hashCode('483921', PHONE, PEPPER)), false);
  assert.equal(pc.sameHash(h, h.slice(0, 10)), false);
  assert.equal(pc.sameHash('', ''), true);
});

test('the stored value is a hash and an attempt count, and reads back the same', () => {
  const h = pc.hashCode('483920', PHONE, PEPPER);
  assert.equal(pc.packValue(h, 0), h + ':0');
  assert.deepEqual(pc.unpackValue(h + ':3'), { hash: h, attempts: 3 });
  assert.deepEqual(pc.unpackValue(h), { hash: h, attempts: 0 });
  assert.deepEqual(pc.unpackValue(h + ':nonsense'), { hash: h, attempts: 0 });
  assert.deepEqual(pc.unpackValue(null), { hash: '', attempts: 0 });
  assert.equal(pc.packValue(h, -2), h + ':0');
});

test('the identifier is namespaced, so a code row can never be mistaken for another verification', () => {
  assert.equal(pc.identifierFor(PHONE), 'phonecode:+251900000001');
  assert.equal(pc.identifierFor(null), 'phonecode:');
});
