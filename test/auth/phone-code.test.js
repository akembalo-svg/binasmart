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

// ----- Task 2: expiry, wrong attempts and the lock -----
const NOW = 1789000000000;                     // a fixed clock; nothing here reads the real one
const row = (hash, attempts, expiresAt) => ({ value: pc.packValue(hash, attempts), expiresAt: new Date(expiresAt) });
const good = () => pc.hashCode('483920', PHONE, PEPPER);

test('the right code is accepted once and the row is thrown away', () => {
  const r = pc.checkCode({ row: row(good(), 0, NOW + 60000), code: '483920', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'ok');
  assert.equal(r.clear, true, 'a spent code is deleted, so it cannot be spent twice');
  assert.equal(r.next, null);
});

test('no code was ever asked for', () => {
  const r = pc.checkCode({ row: null, code: '483920', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_code');
  assert.equal(r.clear, false);
  assert.equal(r.next, null);
});

test('a code past its five minutes is gone, even if it is the right one', () => {
  const r = pc.checkCode({ row: row(good(), 0, NOW - 1), code: '483920', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
  assert.equal(r.clear, true);
  assert.equal(pc.TTL_MS, 300000);
});

test('a wrong code counts up and keeps the same expiry, so guessing does not buy time', () => {
  const h = good();
  const r = pc.checkCode({ row: row(h, 1, NOW + 60000), code: '000000', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'wrong');
  assert.equal(r.clear, false);
  assert.deepEqual(pc.unpackValue(r.next.value), { hash: h, attempts: 2 });
  assert.equal(r.next.expiresAt.getTime(), NOW + 60000);
});

test('the fifth wrong code locks the number for fifteen minutes', () => {
  const h = good();
  const r = pc.checkCode({ row: row(h, 4, NOW + 60000), code: '000000', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'locked');
  assert.deepEqual(pc.unpackValue(r.next.value), { hash: h, attempts: 5 });
  assert.equal(r.next.expiresAt.getTime(), NOW + pc.LOCK_MS);
  assert.equal(pc.MAX_ATTEMPTS, 5);
  assert.equal(pc.LOCK_MS, 900000);
});

test('while it is locked even the right code is refused, and the lock is not extended', () => {
  const locked = row(good(), 5, NOW + pc.LOCK_MS);
  const r = pc.checkCode({ row: locked, code: '483920', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'locked');
  assert.equal(r.clear, false);
  assert.equal(r.next, null, 'a locked row is left exactly as it is');
  assert.equal(pc.isLocked(locked, NOW), true);
  assert.equal(pc.isLocked(locked, NOW + pc.LOCK_MS + 1), false, 'the lock ends when the row expires');
  assert.equal(pc.isLocked(null, NOW), false);
});

test('a second code is refused inside a minute, and refused for the whole lock', () => {
  const fresh = row(good(), 0, NOW + pc.TTL_MS);                 // issued this instant
  assert.equal(pc.tooSoon(fresh, NOW), true);
  assert.equal(pc.tooSoon(fresh, NOW + pc.RESEND_MS), false, 'after sixty seconds a new code may be sent');
  assert.equal(pc.tooSoon(row(good(), 0, NOW - 1), NOW), false, 'an expired code is not a recent one');
  assert.equal(pc.tooSoon(row(good(), 5, NOW + pc.LOCK_MS), NOW), true, 'a lock cannot be escaped by asking again');
  assert.equal(pc.tooSoon(null, NOW), false);
  assert.equal(pc.RESEND_MS, 60000);
});

// Folded in from the Task 1 review: a code is six characters, not a number, so a run of zeros keeps
// its leading zeros. '000000' is as valid a code as any other and must survive the round trip.
test('a code of nothing but zeros keeps its leading zeros', () => {
  assert.equal(pc.newCode(() => 0), '000000');
});
