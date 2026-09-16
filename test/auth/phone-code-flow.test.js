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

// ----- Task 6: spending a code -----
const liveRow = (code, attempts, expiresAt) => ({
  'phonecode:+251900000001': { value: pc.packValue(pc.hashCode(code, PHONE, PEPPER), attempts || 0), expiresAt: new Date(expiresAt === undefined ? NOW + pc.TTL_MS : expiresAt) }
});

test('the right code signs in the account that already holds the number, and the row is spent', async () => {
  const store = fakeStore(liveRow('483920', 0));
  store.users.push({ id: 'u9', name: 'Demo Rider', email: 'demo@example.com', phone: PHONE });
  const b = build({ store });
  const r = await b.flow.verify({ phone: '0900000001', code: '483920' });
  assert.equal(r.ok, true);
  assert.equal(r.isRegister, false, 'one account, many doors — no second account for a proven number');
  assert.equal(r.user.id, 'u9');
  assert.deepEqual(b.store.removed, ['phonecode:+251900000001']);
  assert.equal(b.store.rows['phonecode:+251900000001'], undefined);
});

test('the same code cannot be spent twice', async () => {
  const store = fakeStore(liveRow('483920', 0));
  store.users.push({ id: 'u9', name: 'Demo Rider', email: 'demo@example.com', phone: PHONE });
  const b = build({ store });
  assert.equal((await b.flow.verify({ phone: '0900000001', code: '483920' })).ok, true);
  assert.deepEqual(await b.flow.verify({ phone: '0900000001', code: '483920' }), { ok: false, error: 'bad_code' });
});

test('a number nobody has yet becomes a new account: role user, a placeholder address, a masked name', async () => {
  const b = build({ store: fakeStore(liveRow('483920', 0)) });
  const r = await b.flow.verify({ phone: '0900000001', code: '483920' });
  assert.equal(r.ok, true);
  assert.equal(r.isRegister, true);
  assert.equal(r.user.email, 'p251900000001@phone.bina.et');
  assert.equal(r.user.name, '+251 ••• 0001');
  assert.equal(r.user.role, 'user', 'never owner, never admin — those are granted by hand');
  assert.equal(r.user.phone, PHONE, 'the number is proven on the account before the session exists');
});

test('every way a code can fail is the same six words to the visitor', async () => {
  const cases = [
    ['no code was ever asked for', fakeStore(), '483920'],
    ['the code ran out', fakeStore(liveRow('483920', 0, NOW - 1)), '483920'],
    ['the wrong code', fakeStore(liveRow('483920', 0)), '000000'],
    ['locked out', fakeStore(liveRow('483920', 5, NOW + pc.LOCK_MS)), '483920'],
    ['not six digits', fakeStore(liveRow('483920', 0)), '48392'],
    ['not digits at all', fakeStore(liveRow('483920', 0)), 'abcdef'],
    ['nothing at all', fakeStore(liveRow('483920', 0)), '']
  ];
  for (const [what, store, code] of cases) {
    const b = build({ store });
    assert.deepEqual(await b.flow.verify({ phone: '0900000001', code }), { ok: false, error: 'bad_code' }, what);
  }
  const b = build({ store: fakeStore(liveRow('483920', 0)) });
  assert.deepEqual(await b.flow.verify({ phone: '0700000001', code: '483920' }), { ok: false, error: 'bad_code' }, 'a number we cannot even normalise');
});

test('a code shaped wrongly never reaches the database', async () => {
  const b = build({ store: fakeStore(liveRow('483920', 0)) });
  let reads = 0;
  const realFind = b.store.find;
  b.store.find = async id => { reads++; return realFind(id); };
  await b.flow.verify({ phone: '0900000001', code: 'abcdef' });
  await b.flow.verify({ phone: '0900000001', code: '1234567' });
  await b.flow.verify({ phone: 'nonsense', code: '483920' });
  assert.equal(reads, 0);
});

test('a wrong code is counted against the same row, and the fifth locks the number', async () => {
  const b = build({ store: fakeStore(liveRow('483920', 0)) });
  for (let i = 1; i <= 4; i++) {
    assert.deepEqual(await b.flow.verify({ phone: '0900000001', code: '000000' }), { ok: false, error: 'bad_code' }, 'guess ' + i);
    assert.equal(pc.unpackValue(b.store.rows['phonecode:+251900000001'].value).attempts, i);
  }
  assert.deepEqual(await b.flow.verify({ phone: '0900000001', code: '000000' }), { ok: false, error: 'bad_code' }, 'the fifth');
  const locked = b.store.rows['phonecode:+251900000001'];
  assert.equal(pc.unpackValue(locked.value).attempts, 5);
  assert.equal(locked.expiresAt.getTime(), NOW + pc.LOCK_MS);
  assert.deepEqual(await b.flow.verify({ phone: '0900000001', code: '483920' }), { ok: false, error: 'bad_code' }, 'the right code, too late');
});

test('a code issued for one number does not open another', async () => {
  const rows = liveRow('483920', 0);
  rows['phonecode:+251900000002'] = { value: pc.packValue(pc.hashCode('483920', '+251900000002', PEPPER), 0), expiresAt: new Date(NOW + pc.TTL_MS) };
  const b = build({ store: fakeStore(rows) });
  // The hash is over (pepper, phone, code), so the same six digits are a different secret per number.
  assert.notEqual(pc.hashCode('483920', PHONE, PEPPER), pc.hashCode('483920', '+251900000002', PEPPER));
  assert.equal((await b.flow.verify({ phone: '0900000001', code: '483920' })).ok, true);
  assert.equal(b.store.rows['phonecode:+251900000002'] !== undefined, true, 'the other number is untouched');
});

test('if the number cannot be proven on the account, nobody is signed in', async () => {
  const store = fakeStore(liveRow('483920', 0));
  store.users.push({ id: 'u9', name: 'Demo Rider', email: 'demo@example.com', phone: PHONE });
  const logs = [];
  const flow = makePhoneCodeFlow({
    store, sender: fakeSender(), normalise: normPhone, pepper: PEPPER, now: () => new Date(NOW), newCode: () => '483920',
    linkPhone: async () => ({ ok: false, error: 'phone_taken' }), log: m => logs.push(m)
  });
  assert.deepEqual(await flow.verify({ phone: '0900000001', code: '483920' }), { ok: false, error: 'bad_code' });
  assert.deepEqual(logs, ['[phone-code] link phone_taken']);
});

// The account is reached only once the code is proven. A number that was merely typed must never be
// looked up, never make an account, and above all never be linked — linkPhone is what writes
// phoneVerifiedAt, and a number nobody answered an SMS on carrying a verified date would be a lie.
test('a number that was only typed is never looked up, never makes an account and is never linked', async () => {
  const cases = [
    ['no code was ever asked for', fakeStore(), '0900000001', '483920'],
    ['the code ran out', fakeStore(liveRow('483920', 0, NOW - 1)), '0900000001', '483920'],
    ['the wrong code', fakeStore(liveRow('483920', 0)), '0900000001', '000000'],
    ['locked out', fakeStore(liveRow('483920', 5, NOW + pc.LOCK_MS)), '0900000001', '483920'],
    ['not six digits', fakeStore(liveRow('483920', 0)), '0900000001', '48392'],
    ['a number we cannot normalise', fakeStore(liveRow('483920', 0)), '0700000001', '483920']
  ];
  for (const [what, store, phone, code] of cases) {
    const touched = [];
    store.findUserByPhone = async () => { touched.push('lookup'); return null; };
    store.createUser = async () => { touched.push('create'); return { id: 'u0', phone: null }; };
    const linked = [];
    const flow = makePhoneCodeFlow({
      store, sender: fakeSender(), normalise: normPhone, pepper: PEPPER,
      now: () => new Date(NOW), newCode: () => '483920',
      linkPhone: async () => { linked.push('link'); return { ok: true, phone, linked: {} }; }, log: () => {}
    });
    assert.deepEqual(await flow.verify({ phone, code }), { ok: false, error: 'bad_code' }, what);
    assert.deepEqual(touched, [], what + ': no account row was read or written');
    assert.deepEqual(linked, [], what + ': nothing was proven on an account');
  }
});

// ----- Plan D final review, fix 3: no orphan account -----
// createUser ran before linkPhone. If the link then refused - or the database threw underneath it -
// the account stayed: a row with a placeholder address, no phone and nobody who can reach it. And
// because that address is derived from the number and the e-mail column is unique, the orphan is
// exactly what the NEXT attempt on the same number collides with, so the number is locked out of
// the site for good. The account this call created is now taken back before the refusal is returned.

// A store whose createUser refuses a duplicate address, which is what the database does.
function storeWithUniqueEmail(rows) {
  const s = fakeStore(rows);
  const create = s.createUser;
  s.createUser = async u => {
    if (s.users.some(x => x.email === u.email)) throw new Error('unique constraint failed on the fields: (email)');
    return create(u);
  };
  s.deleted = [];
  s.deleteUser = async id => { s.deleted.push(id); s.users = s.users.filter(u => u.id !== id); };
  return s;
}

test('a link that throws leaves no account behind', async () => {
  const store = storeWithUniqueEmail(liveRow('483920', 0));
  const logs = [];
  const flow = makePhoneCodeFlow({
    store, sender: fakeSender(), normalise: normPhone, pepper: PEPPER,
    now: () => new Date(NOW), newCode: () => '483920',
    linkPhone: async () => { throw new Error('the database went away mid-link'); }, log: m => logs.push(m)
  });
  assert.deepEqual(await flow.verify({ phone: '0900000001', code: '483920' }), { ok: false, error: 'bad_code' });
  assert.equal(store.users.length, 0, 'no orphan with a placeholder address is left behind');
  assert.equal(store.deleted.length, 1, 'the account made a moment ago was taken back');
  assert.deepEqual(logs, ['[phone-code] link threw'], 'a throw is one word, like every other refusal');
});

test('a refused link leaves nothing behind, so the same number can try again', async () => {
  const store = storeWithUniqueEmail(liveRow('483920', 0));
  const make = link => makePhoneCodeFlow({
    store, sender: fakeSender(), normalise: normPhone, pepper: PEPPER,
    now: () => new Date(NOW), newCode: () => '483920', linkPhone: link, log: () => {}
  });
  const refuses = make(async () => ({ ok: false, error: 'phone_taken' }));
  assert.deepEqual(await refuses.verify({ phone: '0900000001', code: '483920' }), { ok: false, error: 'bad_code' });
  assert.equal(store.users.length, 0, 'nothing persists from a sign-in that did not happen');

  // The same person, a fresh code, and this time the link agrees. Before the fix this second attempt
  // died on the unique e-mail column, and the number could never sign in again.
  store.rows = liveRow('483920', 0);
  const agrees = make(async (id, phone) => { store.users.forEach(u => { if (u.id === id) u.phone = phone; }); return { ok: true, phone, linked: {} }; });
  const r = await agrees.verify({ phone: '0900000001', code: '483920' });
  assert.equal(r.ok, true, 'the second attempt is not blocked by the first');
  assert.equal(r.isRegister, true);
  assert.equal(r.user.email, 'p251900000001@phone.bina.et');
});

test('only the account this call created is ever taken back', async () => {
  // An account that already held the number: nothing was created, so nothing may be removed, even
  // though the link refused.
  const store = storeWithUniqueEmail(liveRow('483920', 0));
  store.users.push({ id: 'u9', name: 'Demo Rider', email: 'demo@example.com', phone: PHONE });
  const flow = makePhoneCodeFlow({
    store, sender: fakeSender(), normalise: normPhone, pepper: PEPPER,
    now: () => new Date(NOW), newCode: () => '483920',
    linkPhone: async () => ({ ok: false, error: 'phone_taken' }), log: () => {}
  });
  assert.deepEqual(await flow.verify({ phone: '0900000001', code: '483920' }), { ok: false, error: 'bad_code' });
  assert.deepEqual(store.deleted, [], 'an account that was already there is never deleted by a sign-in');
  assert.equal(store.users.length, 1);
});

test('a store with no deleteUser still refuses cleanly rather than throwing at the visitor', async () => {
  const store = fakeStore(liveRow('483920', 0));      // no deleteUser on it at all
  const flow = makePhoneCodeFlow({
    store, sender: fakeSender(), normalise: normPhone, pepper: PEPPER,
    now: () => new Date(NOW), newCode: () => '483920',
    linkPhone: async () => ({ ok: false, error: 'phone_taken' }), log: () => {}
  });
  assert.deepEqual(await flow.verify({ phone: '0900000001', code: '483920' }), { ok: false, error: 'bad_code' });
});
