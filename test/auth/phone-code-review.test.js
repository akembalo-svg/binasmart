'use strict';
// The app-store reviewer's door: one number, one fixed code from the environment, no SMS, no new
// accounts, and a cap on guesses. Everything outside the flow is a double, as in phone-code-flow.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePhoneCodeFlow, REVIEW_MAX } = require('../../auth/phone-code-flow');
const { normPhone } = require('../../ride/phone');

const PEPPER = 'test-pepper-0000000000000000000000000000';
const REVIEW = { phone: '0900000077', code: '246810' };
const REVIEW_E164 = '+251900000077';
let clock = 1789000000000;

function fakeStore(users) {
  const s = { rows: {}, created: [], users: users || [], madeUsers: 0 };
  s.find = async id => s.rows[id] || null;
  s.create = async v => { s.rows[v.identifier] = v; s.created.push(v); return v; };
  s.remove = async id => { delete s.rows[id]; };
  s.findUserByPhone = async phone => s.users.find(u => u.phone === phone) || null;
  s.createUser = async u => { s.madeUsers++; const row = Object.assign({ id: 'new' + s.madeUsers, phone: null }, u); s.users.push(row); return row; };
  return s;
}
function fakeSender() {
  const sent = [];
  return { sent, configured: true, supports: e => /^\+2519\d{8}$/.test(String(e)), send: async a => { sent.push(a); return { ok: true }; } };
}
function build(o = {}) {
  const store = o.store || fakeStore([{ id: 'rev', phone: REVIEW_E164 }]);
  const sender = fakeSender();
  const flow = makePhoneCodeFlow({ store, sender, normalise: normPhone, pepper: PEPPER, now: () => new Date(clock),
    newCode: () => '483920', linkPhone: async () => ({ ok: true }),
    review: o.review === undefined ? REVIEW : o.review });
  return { flow, store, sender };
}

test('the reviewer number gets the normal answer, but no SMS goes out and no code is written', async () => {
  const b = build();
  assert.deepEqual(await b.flow.send({ phone: REVIEW.phone, ip: '10.0.0.1' }), { ok: true });
  assert.equal(b.sender.sent.length, 0);
  assert.equal(b.store.created.length, 0);
});

test('the fixed code opens the account that already holds the number, and only that one', async () => {
  const b = build();
  const r = await b.flow.verify({ phone: REVIEW.phone, code: REVIEW.code });
  assert.equal(r.ok, true);
  assert.equal(r.user.id, 'rev');
  assert.equal(r.isRegister, false);
});

test('a wrong code, or the right code on another number, is the usual bad_code', async () => {
  const b = build();
  assert.deepEqual(await b.flow.verify({ phone: REVIEW.phone, code: '000000' }), { ok: false, error: 'bad_code' });
  assert.equal((await b.flow.verify({ phone: '0900000078', code: REVIEW.code })).ok, false);
});

test('the reviewer door never makes an account', async () => {
  const b = build({ store: fakeStore([]) });
  assert.deepEqual(await b.flow.verify({ phone: REVIEW.phone, code: REVIEW.code }), { ok: false, error: 'bad_code' });
  assert.equal(b.store.madeUsers, 0);
});

test('guesses are capped, and the cap also stops the right code', async () => {
  const b = build();
  for (let i = 0; i < REVIEW_MAX; i++) await b.flow.verify({ phone: REVIEW.phone, code: '111111' });
  assert.deepEqual(await b.flow.verify({ phone: REVIEW.phone, code: REVIEW.code }), { ok: false, error: 'bad_code' });
});

test('without a number, or with a code that is not six digits, there is no reviewer door', async () => {
  for (const review of [null, { phone: '', code: '246810' }, { phone: REVIEW.phone, code: '' }, { phone: REVIEW.phone, code: '12345' }, { phone: REVIEW.phone, code: 'abcdef' }]) {
    const b = build({ review });
    assert.deepEqual(await b.flow.send({ phone: REVIEW.phone, ip: '10.0.0.2' }), { ok: true });
    assert.equal(b.sender.sent.length, 1, 'an ordinary number again: the SMS goes out');
    assert.equal((await b.flow.verify({ phone: REVIEW.phone, code: '246810' })).ok, false);
  }
});
