'use strict';
// Who may use Bini for owners, and through which Telegram account. Over an in-memory store, so every rule is
// exercised without a database; the last test pins the Prisma store's queries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { phoneKey } = require('../../ride/phone');
const { makeOwnerAccess, makeOwnerAccessStore } = require('../../agents/owner/access');

function memStore() {
  const s = { access: [], links: [], switches: [], seq: 0 };
  const id = p => p + (++s.seq);
  return {
    s,
    linkByTelegram: async t => s.links.find(l => l.telegramId === t) || null,
    linkById: async i => s.links.find(l => l.id === i) || null,
    activeAccessByPhone: async pk => s.access.filter(a => a.phoneKey === pk && !a.revokedAt),
    accessForEntity: async (kind, e) => s.access.filter(a => a.kind === kind && a.entityId === e && !a.revokedAt),
    enabledEntities: async (agent, kind, ids) => s.switches.filter(w => w.agent === agent && w.kind === kind && ids.includes(w.entityId) && !w.disabledAt).map(w => w.entityId),
    upsertLink: async ({ telegramId, chatId, phoneKey: pk, at }) => {
      let l = s.links.find(x => x.telegramId === telegramId);
      if (!l) { l = { id: id('L'), telegramId }; s.links.push(l); }
      return Object.assign(l, { chatId, phoneKey: pk, linkedAt: at, lastSeen: at, revokedAt: null, mode: 'owner' });
    },
    revokeLink: async (i, at) => { s.links.find(l => l.id === i).revokedAt = at; },
    touchLink: async (i, at) => { s.links.find(l => l.id === i).lastSeen = at; },
    setMode: async (i, mode) => { s.links.find(l => l.id === i).mode = mode; },
    linksForPhones: async pks => s.links.filter(l => pks.includes(l.phoneKey)),
    addAccess(entityId, phone, role = 'owner', label = null) {
      const a = { id: id('A'), kind: 'building', entityId, phoneKey: phoneKey(phone), role, label, revokedAt: null };
      s.access.push(a); return a;
    },
    enable(entityId) { s.switches.push({ agent: 'owner', kind: 'building', entityId, disabledAt: null }); },
  };
}

const T0 = new Date('2026-09-13T12:00:00Z');
function setup() {
  const store = memStore(), audits = [];
  const access = makeOwnerAccess({ store, audit: (b, action, detail) => audits.push({ b, action, detail }), now: () => T0 });
  return { store, audits, access };
}
const chat = { id: 7, type: 'private' }, from = { id: 42 };
const own = phone => ({ chat, from, contact: { phone_number: phone, user_id: 42 }, forwarded: false });

test('a number Telegram vouches for, approved and switched on, links the account', async () => {
  const { store, audits, access } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  const r = await access.linkFromContact(own('+251 900 000 001'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.scope.buildingIds, ['b1']);
  assert.equal(store.s.links[0].telegramId, '42');
  assert.equal(store.s.links[0].phoneKey, 'ph:900000001');
  assert.deepEqual(audits.map(a => [a.b, a.action]), [['b1', 'OWNER_TG_LINKED']]);
  assert.doesNotMatch(audits[0].detail, /900000001|0900/, 'the audit keeps last four digits only');
  assert.match(audits[0].detail, /0001/);
});

test('only the sender’s own contact, in a private chat, counts', async () => {
  const { store, access } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  assert.equal((await access.linkFromContact({ ...own('0900000001'), chat: { id: -5, type: 'group' } })).reason, 'not_private');
  assert.equal((await access.linkFromContact({ ...own('0900000001'), contact: { phone_number: '0900000001', user_id: 99 } })).reason, 'not_own_contact');
  assert.equal((await access.linkFromContact({ ...own('0900000001'), contact: { phone_number: '0900000001' } })).reason, 'not_own_contact');
  assert.equal((await access.linkFromContact({ ...own('0900000001'), forwarded: true })).reason, 'not_own_contact');
  assert.equal(store.s.links.length, 0);
});

test('an unapproved number, or a building that is not switched on, links nothing and says the same thing', async () => {
  const { store, access } = setup();
  assert.equal((await access.linkFromContact(own('0900000002'))).reason, 'not_registered');
  store.addAccess('b1', '0900000002');                       // approved but not switched on
  assert.equal((await access.linkFromContact(own('0900000002'))).reason, 'not_registered');
  assert.equal((await access.linkFromContact(own('not a phone'))).reason, 'not_registered');
  assert.equal(store.s.links.length, 0);
});

test('too many attempts from one account are paused', async () => {
  const { access } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await access.linkFromContact(own('090000000' + i))).reason, 'not_registered');
  assert.equal((await access.linkFromContact(own('0900000009'))).reason, 'too_many');
});

test('the scope is read again on every message: removing the number or switching off ends it at once', async () => {
  const { store, access } = setup();
  const a = store.addAccess('b1', '0900000001'); store.addAccess('b2', '0900000001', 'staff', 'accountant');
  store.enable('b1'); store.enable('b2');
  await access.linkFromContact(own('0900000001'));
  assert.deepEqual((await access.scopeFor(42)).buildingIds, ['b1', 'b2']);
  store.s.switches.find(w => w.entityId === 'b2').disabledAt = T0;
  assert.deepEqual((await access.scopeFor(42)).buildingIds, ['b1']);
  a.revokedAt = T0;
  assert.equal(await access.scopeFor(42), null);
  assert.equal(await access.scopeFor(777), null, 'an account that never linked has no scope');
});

test('modes, logout, and a revoked link', async () => {
  const { store, audits, access } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  await access.linkFromContact(own('0900000001'));
  assert.equal((await access.scopeFor(42)).mode, 'owner');
  assert.equal(await access.setMode(42, 'bini'), true);
  assert.equal((await access.scopeFor(42)).mode, 'bini');
  assert.equal(await access.unlink(42), true);
  assert.equal(await access.scopeFor(42), null);
  assert.equal(await access.unlink(42), false);
  assert.equal(await access.setMode(42, 'owner'), false);
  assert.ok(audits.some(a => a.action === 'OWNER_TG_UNLINKED' && a.b === 'b1'));
});

test('the dashboard lists and removes only its own building’s links', async () => {
  const { store, audits, access } = setup();
  store.addAccess('b1', '0900000001', 'owner'); store.addAccess('b2', '0900000003', 'owner');
  store.enable('b1'); store.enable('b2');
  await access.linkFromContact(own('0900000001'));
  await access.linkFromContact({ ...own('0900000003'), from: { id: 43 }, contact: { phone_number: '0900000003', user_id: 43 } });
  const list = await access.linksForBuilding('b1');
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'label', 'lastSeen', 'linkedAt', 'mode', 'phoneLast4', 'role']);
  assert.equal(list[0].phoneLast4, '0001');
  const other = store.s.links.find(l => l.telegramId === '43');
  assert.equal(await access.revokeForBuilding('b1', other.id), false, 'building 1 cannot sign out building 2’s owner');
  assert.equal(other.revokedAt, null);
  assert.equal(await access.revokeForBuilding('b1', list[0].id), true);
  assert.equal(await access.scopeFor(42), null);
  assert.equal((await access.linksForBuilding('b1')).length, 0);
  assert.ok(audits.some(a => a.b === 'b1' && a.action === 'OWNER_TG_UNLINKED' && /dashboard/.test(a.detail)));
});

test('the Prisma store asks exactly the right questions', async () => {
  const calls = [];
  const model = name => new Proxy({}, { get: (_, op) => async args => { calls.push({ name, op, args }); return op === 'findMany' ? [] : null; } });
  const store = makeOwnerAccessStore({ ownerAccess: model('ownerAccess'), ownerTgLink: model('ownerTgLink'), agentSwitch: model('agentSwitch') });
  await store.activeAccessByPhone('ph:900000001');
  await store.enabledEntities('owner', 'building', ['b1']);
  await store.upsertLink({ telegramId: '42', chatId: '7', phoneKey: 'ph:900000001', at: T0 });
  await store.accessForEntity('building', 'b1');
  const by = (name, op) => calls.find(c => c.name === name && c.op === op).args;
  assert.deepEqual(by('ownerAccess', 'findMany').where, { phoneKey: 'ph:900000001', revokedAt: null });
  assert.deepEqual(by('agentSwitch', 'findMany').where, { agent: 'owner', kind: 'building', entityId: { in: ['b1'] }, disabledAt: null });
  const up = by('ownerTgLink', 'upsert');
  assert.deepEqual(up.where, { telegramId: '42' });
  assert.equal(up.update.revokedAt, null, 'linking again reopens a revoked link');
  assert.equal(up.update.mode, 'owner');
  assert.deepEqual(calls.filter(c => c.name === 'ownerAccess')[1].args.where, { kind: 'building', entityId: 'b1', revokedAt: null });
});
