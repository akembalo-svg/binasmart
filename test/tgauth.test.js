'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyInitData, verifyContact, sign } = require('../ride/tgauth');

const TOKEN = '123456:TESTTOKENabc';
const NOW = 1_800_000_000_000; // ms
const user = { id: 42, first_name: 'Abel', last_name: 'T', language_code: 'am' };

test('verifyInitData accepts a correctly signed payload and returns the user', () => {
  const initData = sign({ user, auth_date: String(Math.floor(NOW / 1000) - 60), query_id: 'q1' }, TOKEN);
  const r = verifyInitData(initData, TOKEN, { now: NOW });
  assert.equal(r.user.id, 42);
  assert.equal(r.user.first_name, 'Abel');
});

test('verifyInitData rejects a tampered hash, wrong token, expired and future data', () => {
  const good = sign({ user, auth_date: String(Math.floor(NOW / 1000) - 60) }, TOKEN);
  assert.equal(verifyInitData(good.replace(/hash=\w{4}/, 'hash=0000'), TOKEN, { now: NOW }), null);
  assert.equal(verifyInitData(good, 'other:token', { now: NOW }), null);
  const old = sign({ user, auth_date: String(Math.floor(NOW / 1000) - 90_000) }, TOKEN);
  assert.equal(verifyInitData(old, TOKEN, { now: NOW }), null, 'older than 24h');
  const future = sign({ user, auth_date: String(Math.floor(NOW / 1000) + 3600) }, TOKEN);
  assert.equal(verifyInitData(future, TOKEN, { now: NOW }), null, 'from the future');
  assert.equal(verifyInitData('', TOKEN), null);
  assert.equal(verifyInitData(undefined, TOKEN), null);
});

test('verifyContact returns the phone from a signed contact response; forged is rejected', () => {
  const contact = { phone_number: '251911244344', user_id: 42, first_name: 'Abel' };
  const resp = sign({ contact, auth_date: String(Math.floor(NOW / 1000) - 5) }, TOKEN);
  const r = verifyContact(resp, TOKEN, { now: NOW });
  assert.deepEqual(r, { phone: '251911244344', userId: 42, firstName: 'Abel' });
  const forged = sign({ contact: { ...contact, phone_number: '251900000000' }, auth_date: String(Math.floor(NOW / 1000) - 5) }, 'wrong:token');
  assert.equal(verifyContact(forged, TOKEN, { now: NOW }), null);
});
