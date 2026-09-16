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

test('a row with nothing in it is no code at all, and never reaches a compare', () => {
  // sameHash of two empty strings is true, so an empty stored value must be named before the compare
  // rather than by it. Nothing writes such a row today; this is the guard that keeps it that way.
  const r = pc.checkCode({ row: { value: '', expiresAt: new Date(NOW + 60000) }, code: '483920', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_code');
  assert.equal(r.clear, true, 'a row that holds no hash is junk, and junk is thrown away');
  assert.equal(r.next, null);
  const colon = pc.checkCode({ row: row('', 0, NOW + 60000), code: '483920', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(colon.reason, 'no_code');
  assert.equal(pc.sameHash('', ''), true, 'the reason the guard above has to exist');
});

// ----- Task 3: the SMS text, the mask, the placeholder address and the limiter -----
const { labelled, smsParts, SMS_MAX_CHARS } = require('../../messaging/sms');

test('the whole SMS, label and all, is ONE part — a second part would be paid for on every sign-in', () => {
  const body = labelled(pc.SMS_LABEL, pc.codeText('483920'));
  assert.equal(pc.SMS_LABEL, 'BinaSmart');
  assert.ok(body.startsWith('BinaSmart፦ '), 'every SMS starts with its label: ' + body);
  // The label carries Ethiopic, so the operator counts the whole message as UCS-2: 70 characters is
  // one part. Anything longer is two SMS for every code, on every retry, forever.
  assert.ok(body.length <= 70, 'the message is ' + body.length + ' characters, which is more than one UCS-2 part');
  assert.equal(smsParts(body), 1);
  assert.ok(body.length < SMS_MAX_CHARS);
});

test('the text says the code, how long it lasts and not to share it, in both languages', () => {
  const t = pc.codeText('483920');
  assert.ok(t.includes('483920'), 'the code is in the text');
  assert.ok(t.includes('code'), 'English: ' + t);
  assert.ok(t.includes('min'), 'English: ' + t);
  assert.ok(t.includes('የመግቢያ ኮድ'), 'Amharic: sign-in code');
  assert.ok(t.includes('ደቂቃ'), 'Amharic: minutes');
  assert.ok(t.includes('ለማንም አይንገሩ'), 'Amharic: tell no one');
  assert.ok(!/http|bina\.et|\?|=/.test(t), 'a code never travels in a link: ' + t);
});

test('a phone is shown by its last four digits and nothing else', () => {
  assert.equal(pc.maskPhone('+251900000001'), '+251 ••• 0001');
  assert.equal(pc.maskPhone('+251911111234'), '+251 ••• 1234');
  assert.equal(pc.maskPhone(''), '');
  assert.equal(pc.maskPhone(null), '');
  assert.ok(!pc.maskPhone('+251900000001').includes('90000000'), 'the middle of the number never appears');
});

test('a phone-only account gets a placeholder address on a domain we own, and it is recognisable', () => {
  assert.equal(pc.phonePlaceholderEmail('+251900000001'), 'p251900000001@phone.bina.et');
  assert.equal(pc.isPhonePlaceholderEmail('p251900000001@phone.bina.et'), true);
  assert.equal(pc.isPhonePlaceholderEmail('ibrahim@example.com'), false);
  assert.equal(pc.isPhonePlaceholderEmail('tg123@telegram.bina.et'), false);
  assert.equal(pc.isPhonePlaceholderEmail(''), false);
  assert.equal(pc.isPhonePlaceholderEmail(null), false);
});

test('the limiter lets max through in a window and refuses the rest, on its own clock', () => {
  let at = NOW;
  const limit = pc.makeCodeLimiter({ windowMs: 1000, max: 2, now: () => at });
  assert.equal(limit('a'), true);
  assert.equal(limit('a'), true);
  assert.equal(limit('a'), false, 'the third inside the window is refused');
  assert.equal(limit('b'), true, 'another key has its own budget');
  at += 1001;
  assert.equal(limit('a'), true, 'the window has moved on');
});

test('the two windows are the ones the design asked for, and an empty key is never one bucket for everyone', () => {
  assert.equal(pc.PHONE_MAX, 3);
  assert.equal(pc.PHONE_WINDOW_MS, 15 * 60 * 1000);
  assert.equal(pc.IP_MAX, 20);
  assert.equal(pc.IP_WINDOW_MS, 60 * 60 * 1000);
  const limit = pc.makeCodeLimiter({ windowMs: 1000, max: 1, now: () => NOW });
  assert.equal(limit(''), true);
  assert.equal(limit(''), true, 'an unknown caller is not limited together with every other unknown caller');
  assert.equal(limit(null), true);
});
