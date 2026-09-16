'use strict';
// Asking for a code. Every outside thing is a double here — no database, no network, no better-auth —
// so what is being tested is the decisions, which is where a sign-in door goes wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePhoneCodeFlow } = require('../../auth/phone-code-flow');
const pc = require('../../auth/phone-code');
const { normPhone } = require('../../ride/phone');

const PEPPER = 'test-pepper-0000000000000000000000000000';
const PHONE = '+251900000001';
const NOW = 1789000000000;

function fakeStore(rows) {
  const s = { rows: Object.assign({}, rows), created: [], removed: [], users: [], next: 1 };
  s.find = async id => s.rows[id] || null;
  s.create = async v => { s.rows[v.identifier] = { value: v.value, expiresAt: v.expiresAt }; s.created.push(v); return v; };
  s.remove = async id => { delete s.rows[id]; s.removed.push(id); };
  s.findUserByPhone = async phone => s.users.find(u => u.phone === phone) || null;
  s.createUser = async u => { const row = Object.assign({ id: 'u' + s.next++, phone: null }, u); s.users.push(row); return row; };
  return s;
}
function fakeSender(result) {
  const sent = [];
  return { sent, configured: true, mode: 'live', supports: e => /^\+2519\d{8}$/.test(String(e)),
    send: async a => { sent.push(a); return result || { ok: true, status: 'sent', errorKind: null }; } };
}
// A flow with a fixed clock, a fixed code and a linkPhone that always agrees.
function build(over) {
  const o = over || {};
  const store = o.store || fakeStore();
  const sender = o.sender || fakeSender();
  const logs = [];
  const flow = makePhoneCodeFlow({
    store, sender, normalise: normPhone, pepper: o.pepper === undefined ? PEPPER : o.pepper,
    now: () => new Date(o.now || NOW), newCode: () => o.code || '483920',
    linkPhone: async (id, phone) => { store.users.forEach(u => { if (u.id === id) u.phone = phone; }); return { ok: true, phone, linked: {} }; },
    log: m => logs.push(m)
  });
  return { flow, store, sender, logs };
}

test('with no pepper, or no sender, or SMS switched off, there is no door at all', async () => {
  assert.equal((await build({ pepper: '' }).flow.send({ phone: '0900000001' })).error, 'not_configured');
  assert.equal((await build({ pepper: 'short' }).flow.send({ phone: '0900000001' })).error, 'not_configured');
  const off = fakeSender(); off.configured = false;
  assert.equal((await build({ sender: off }).flow.send({ phone: '0900000001' })).error, 'not_configured');
  assert.equal(build().flow.ready(), true);
  assert.equal(build({ pepper: '' }).flow.ready(), false);
});

test('a number the provider cannot reach is refused, and nothing is written for it', async () => {
  const b = build();
  assert.deepEqual(await b.flow.send({ phone: '0700000001' }), { ok: false, error: 'not_reachable' });   // Safaricom
  assert.deepEqual(await b.flow.send({ phone: '+971500000000' }), { ok: false, error: 'not_reachable' }); // not Ethiopian
  assert.deepEqual(await b.flow.send({ phone: 'nonsense' }), { ok: false, error: 'not_reachable' });
  assert.deepEqual(await b.flow.send({ phone: '' }), { ok: false, error: 'not_reachable' });
  assert.equal(b.store.created.length, 0);
  assert.equal(b.sender.sent.length, 0);
});

test('the code is hashed on the way in — the store never sees it, the phone does', async () => {
  const b = build();
  assert.deepEqual(await b.flow.send({ phone: '0900000001', ip: '10.0.0.1' }), { ok: true });
  assert.equal(b.sender.sent.length, 1);
  assert.deepEqual(b.sender.sent[0], { phone: PHONE, code: '483920' });
  assert.equal(b.store.created.length, 1);
  const wrote = b.store.created[0];
  assert.equal(wrote.identifier, 'phonecode:+251900000001');
  assert.equal(wrote.value, pc.packValue(pc.hashCode('483920', PHONE, PEPPER), 0));
  assert.equal(wrote.value.includes('483920'), false, 'the code itself is never written down');
  assert.equal(wrote.expiresAt.getTime(), NOW + pc.TTL_MS, 'five minutes');
});

test('a second code inside a minute sends nothing, and the visitor is told exactly what a first code is told', async () => {
  const store = fakeStore({ 'phonecode:+251900000001': { value: pc.packValue(pc.hashCode('111111', PHONE, PEPPER), 0), expiresAt: new Date(NOW + pc.TTL_MS) } });
  const b = build({ store });
  assert.deepEqual(await b.flow.send({ phone: '0900000001' }), { ok: true }, 'the same answer as a real send');
  assert.equal(b.sender.sent.length, 0, 'no SMS, no money spent');
  assert.equal(b.store.created.length, 0, 'the code they already have is left alone');
});

test('a locked number is told the same thing as everyone else, and gets no new code', async () => {
  const store = fakeStore({ 'phonecode:+251900000001': { value: pc.packValue(pc.hashCode('111111', PHONE, PEPPER), 5), expiresAt: new Date(NOW + pc.LOCK_MS) } });
  const b = build({ store });
  assert.deepEqual(await b.flow.send({ phone: '0900000001' }), { ok: true });
  assert.equal(b.sender.sent.length, 0);
  assert.equal(b.store.created.length, 0, 'asking again cannot clear a lock');
});

test('an old code is thrown away before a new one is written, so one number has one live code', async () => {
  const store = fakeStore({ 'phonecode:+251900000001': { value: pc.packValue(pc.hashCode('111111', PHONE, PEPPER), 2), expiresAt: new Date(NOW - 1) } });
  const b = build({ store });
  assert.deepEqual(await b.flow.send({ phone: '0900000001' }), { ok: true });
  assert.deepEqual(b.store.removed, ['phonecode:+251900000001']);
  assert.equal(b.store.created.length, 1);
  assert.deepEqual(pc.unpackValue(b.store.created[0].value).attempts, 0, 'a new code starts with no wrong guesses against it');
});

test('three codes to one number in fifteen minutes, and the fourth is refused', async () => {
  const b = build();
  for (let i = 0; i < 3; i++) {
    b.store.rows = {};                                       // the code was used or expired in between
    assert.deepEqual(await b.flow.send({ phone: '0900000001', ip: '10.0.0.' + i }), { ok: true }, 'code ' + (i + 1));
  }
  b.store.rows = {};
  assert.deepEqual(await b.flow.send({ phone: '0900000001', ip: '10.0.0.9' }), { ok: false, error: 'rate_limited' });
  assert.equal(b.sender.sent.length, 3);
  // A different number is not caught by another number's limit.
  assert.deepEqual(await b.flow.send({ phone: '0900000002', ip: '10.0.0.9' }), { ok: true });
});

test('twenty codes an hour from one address, and the address is checked before anything is read', async () => {
  const b = build();
  for (let i = 0; i < 20; i++) {
    b.store.rows = {};
    assert.deepEqual(await b.flow.send({ phone: '09000000' + String(10 + i), ip: '10.0.0.7' }), { ok: true }, 'code ' + (i + 1));
  }
  b.store.rows = {};
  const before = b.store.created.length;
  assert.deepEqual(await b.flow.send({ phone: '0900000099', ip: '10.0.0.7' }), { ok: false, error: 'rate_limited' });
  assert.equal(b.store.created.length, before, 'a refused caller never reaches the database');
  assert.deepEqual(await b.flow.send({ phone: '0900000099', ip: '10.0.0.8' }), { ok: true }, 'another address is not punished');
});

test('an SMS that did not go is logged by its kind alone, and the visitor is still told the same thing', async () => {
  const b = build({ sender: fakeSender({ ok: false, status: 'failed', errorKind: 'sms_refused' }) });
  assert.deepEqual(await b.flow.send({ phone: '0900000001' }), { ok: true }, 'whether a number exists, or an SMS went, is never visible from outside');
  assert.deepEqual(b.logs, ['[phone-code] send sms_refused']);
  assert.equal(b.logs[0].includes('251900000001'), false);
  assert.equal(b.logs[0].includes('483920'), false);
});
