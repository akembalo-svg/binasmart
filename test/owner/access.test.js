'use strict';
// Who may use Bini for owners, and through which Telegram account. Over an in-memory store, so every rule is
// exercised without a database; the last test pins the Prisma store's queries. Numbers are fake (0900…, +1 202 555 01xx).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeOwnerAccess, makeOwnerAccessStore, toE164 } = require('../../agents/owner/access');

const T0 = new Date('2026-09-13T12:00:00Z');
const DAY = 86400000;

function memStore() {
  const s = { access: [], links: [], switches: [], seq: 0 };
  const id = p => p + (++s.seq);
  return {
    s,
    linkByTelegram: async t => s.links.find(l => l.telegramId === t) || null,
    linkById: async i => s.links.find(l => l.id === i) || null,
    activeAccessByPhone: async e => s.access.filter(a => a.phoneE164 === e && !a.revokedAt),
    accessForEntity: async (kind, e) => s.access.filter(a => a.kind === kind && a.entityId === e && !a.revokedAt),
    accessById: async i => s.access.find(a => a.id === i) || null,
    revokeAccess: async (i, at) => { s.access.find(a => a.id === i).revokedAt = at; },
    enabledEntities: async (agent, kind, ids) => s.switches.filter(w => w.agent === agent && w.kind === kind && ids.includes(w.entityId) && !w.disabledAt).map(w => w.entityId),
    upsertLink: async ({ telegramId, chatId, phoneKey: pk, phoneE164, at }) => {
      let l = s.links.find(x => x.telegramId === telegramId);
      if (!l) { l = { id: id('L'), telegramId }; s.links.push(l); }
      return Object.assign(l, { chatId, phoneKey: pk, phoneE164, linkedAt: at, lastSeen: at, revokedAt: null, revokedReason: null, mode: 'owner' });
    },
    revokeLink: async (i, at, reason) => Object.assign(s.links.find(l => l.id === i), { revokedAt: at, revokedReason: reason }),
    touchLink: async (i, at) => { s.links.find(l => l.id === i).lastSeen = at; },
    setMode: async (i, mode) => { s.links.find(l => l.id === i).mode = mode; },
    linksForPhones: async es => s.links.filter(l => es.includes(l.phoneE164) && !l.revokedAt),
    // An ops approval, typed the way a person types it. Created a day before T0 unless said otherwise.
    addAccess(entityId, phone, role = 'owner', label = null, createdAt = new Date(T0.getTime() - DAY)) {
      const phoneE164 = toE164(phone, { from: 'ops' });
      assert.ok(phoneE164, 'test approvals must be valid numbers');
      const a = { id: id('A'), kind: 'building', entityId, phoneKey: 'ph:' + phoneE164.slice(-9), phoneE164, role, label, createdAt, revokedAt: null };
      s.access.push(a); return a;
    },
    enable(entityId) { s.switches.push({ agent: 'owner', kind: 'building', entityId, disabledAt: null }); },
  };
}

function setup() {
  const store = memStore(), audits = [];
  let t = T0.getTime();
  const access = makeOwnerAccess({ store, audit: (b, action, detail) => audits.push({ b, action, detail }), now: () => new Date(t) });
  return { store, audits, access, tick: msec => { t += msec; }, at: () => new Date(t) };
}
// A contact shared through the Share-my-phone button: the sender's own, in their private chat with the bot.
const own = (phone, uid = 42) => ({ chat: { id: uid, type: 'private' }, from: { id: uid }, contact: { phone_number: phone, user_id: uid }, forwarded: false });
const linkOf = (store, uid) => store.s.links.find(l => l.telegramId === String(uid));

test('the scope names the approval that gave the role, so an owner action can be recorded against it', async () => {
  const { store, access } = setup();
  const a = store.addAccess('b1', '0900000001', 'owner');
  const staff = store.addAccess('b2', '0900000001', 'staff');
  store.enable('b1'); store.enable('b2');
  const r = await access.linkFromContact(own('251900000001'));
  assert.deepEqual(r.scope.accessIds, { b1: a.id, b2: staff.id });
  assert.deepEqual((await access.scopeFor(42)).accessIds, { b1: a.id, b2: staff.id });
  const both = store.addAccess('b1', '0900000001', 'staff');
  assert.equal((await access.scopeFor(42)).accessIds.b1, a.id, 'owner outranks staff, and names the owner approval');
  assert.ok(both.id);
});

test('the owners\' own chats, for a card a staff member prepared: live links holding an owner approval, nobody else', async () => {
  const { store, access } = setup();
  store.addAccess('b1', '0900000001', 'owner');
  store.addAccess('b1', '0900000002', 'staff');
  store.enable('b1');
  assert.deepEqual(await access.ownerChatsForBuilding('b1'), [], 'nobody has linked yet');
  await access.linkFromContact(own('251900000001', 42));
  await access.linkFromContact(own('251900000002', 43));
  assert.deepEqual(await access.ownerChatsForBuilding('b1'), [{ telegramId: '42', chatId: '42' }]);
  await access.unlink(42);
  assert.deepEqual(await access.ownerChatsForBuilding('b1'), [], 'a signed-out owner has no chat');
});

test('a number Telegram vouches for, approved and switched on, links the account', async () => {
  const { store, audits, access } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  const r = await access.linkFromContact(own('251900000001'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.scope.buildingIds, ['b1']);
  assert.deepEqual(r.scope.roles, { b1: 'owner' });
  assert.equal(store.s.links[0].telegramId, '42');
  assert.equal(store.s.links[0].phoneE164, '+251900000001');
  assert.equal(store.s.links[0].phoneKey, 'ph:900000001');
  assert.deepEqual(audits.map(a => [a.b, a.action]), [['b1', 'OWNER_TG_LINKED']]);
  assert.doesNotMatch(audits[0].detail, /900000001|0900/, 'the audit keeps last four digits only');
  assert.match(audits[0].detail, /0001/);
  assert.equal((await access.linkFromContact(own('+251900000001'))).ok, true, 'with or without the plus');
});

test('only the sender’s own contact, in their private chat with the bot, counts', async () => {
  const { store, access } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  assert.equal((await access.linkFromContact({ ...own('251900000001'), chat: { id: -5, type: 'group' } })).reason, 'not_private');
  assert.equal((await access.linkFromContact({ ...own('251900000001'), chat: { id: 7, type: 'private' } })).reason, 'not_private', 'chat.id must be the sender');
  assert.equal((await access.linkFromContact({ ...own('251900000001'), contact: { phone_number: '251900000001', user_id: 99 } })).reason, 'not_own_contact');
  assert.equal((await access.linkFromContact({ ...own('251900000001'), contact: { phone_number: '251900000001' } })).reason, 'not_own_contact');
  assert.equal((await access.linkFromContact({ ...own('251900000001'), forwarded: true })).reason, 'not_own_contact');
  assert.equal(store.s.links.length, 0);
});

test('an unapproved number, a building that is not switched on, or a number not in Telegram’s form links nothing', async () => {
  const { store, access } = setup();
  assert.equal((await access.linkFromContact(own('251900000002'))).reason, 'not_registered');
  store.addAccess('b1', '0900000002');                       // approved but not switched on
  assert.equal((await access.linkFromContact(own('251900000002'))).reason, 'not_registered');
  store.enable('b1');
  assert.equal((await access.linkFromContact(own('not a phone'))).reason, 'not_registered');
  assert.equal((await access.linkFromContact(own('+251 900 000 002'))).reason, 'not_registered', 'spaces are not how Telegram sends a contact');
  assert.equal((await access.linkFromContact(own('0900000002'))).reason, 'not_registered', 'nor is the local 0… form');
  assert.equal(store.s.links.length, 0);
});

test('a foreign number with the same last nine digits is a different person', async () => {
  const { store, access } = setup();
  store.addAccess('b1', '0911 234 567'); store.enable('b1');
  for (const twin of ['+919911234567', '919911234567', '+249911234567', '+1911234567'])
    assert.equal((await access.linkFromContact(own(twin))).reason, 'not_registered', twin);
  assert.equal(store.s.links.length, 0);
  assert.equal((await access.linkFromContact(own('251911234567'))).ok, true, 'the approved number itself still links');
});

test('toE164: forgiving for numbers ops type, exact for what Telegram sends', () => {
  const ops = x => toE164(x, { from: 'ops' });
  assert.equal(ops('0911 234 567'), '+251911234567');
  assert.equal(ops('0911-234-567'), '+251911234567');
  assert.equal(ops('00251911234567'), '+251911234567');
  assert.equal(ops('251911234567'), '+251911234567');
  assert.equal(ops('+251 (91) 123.4567'), '+251911234567');
  assert.equal(ops('+1 202 555 0147'), '+12025550147');
  assert.equal(ops('0012025550147'), '+12025550147');
  for (const bad of ['abc', '', null, undefined, '911234567', '12025550147', '+0911234567', '+1234567', '+1234567890123456'])
    assert.equal(ops(bad), null, String(bad));
  const tg = x => toE164(x, { from: 'telegram' });
  assert.equal(tg('251911234567'), '+251911234567');
  assert.equal(tg('+251911234567'), '+251911234567');
  assert.equal(tg('12025550147'), '+12025550147');
  for (const bad of ['0911234567', '+251 911 234 567', '251-911-234-567', '00251911234567', 'abc', '', null, 251911234567, '+1234567'])
    assert.equal(tg(bad), null, String(bad));
  assert.throws(() => toE164('0911234567'), TypeError, 'the caller must say where the number came from');
});

test('too many attempts from one account are paused', async () => {
  const { access } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await access.linkFromContact(own('25190000000' + i))).reason, 'not_registered');
  assert.equal((await access.linkFromContact(own('251900000009'))).reason, 'too_many');
});

test('the scope is read again on every message: removing the number or switching off ends it at once', async () => {
  const { store, access } = setup();
  const a = store.addAccess('b1', '0900000001'); store.addAccess('b2', '0900000001', 'staff', 'accountant');
  store.enable('b1'); store.enable('b2');
  await access.linkFromContact(own('251900000001'));
  const sc = await access.scopeFor(42);
  assert.deepEqual(sc.buildingIds, ['b1', 'b2']);
  assert.deepEqual(sc.roles, { b1: 'owner', b2: 'staff' });
  store.s.switches.find(w => w.entityId === 'b2').disabledAt = T0;
  assert.deepEqual((await access.scopeFor(42)).buildingIds, ['b1']);
  a.revokedAt = T0;
  assert.equal(await access.scopeFor(42), null);
  assert.equal(await access.scopeFor(777), null, 'an account that never linked has no scope');
});

test('owner outranks staff when one number holds both approvals for a building', async () => {
  const { store, access } = setup();
  store.addAccess('b1', '0900000001', 'staff'); store.addAccess('b1', '0900000001', 'owner'); store.enable('b1');
  const r = await access.linkFromContact(own('251900000001'));
  assert.deepEqual(r.scope.roles, { b1: 'owner' });
  assert.deepEqual((await access.scopeFor(42)).roles, { b1: 'owner' });
  assert.equal((await access.linksForBuilding('b1'))[0].role, 'owner');
});

test('modes, logout, and a revoked link', async () => {
  const { store, audits, access } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  await access.linkFromContact(own('251900000001'));
  assert.equal((await access.scopeFor(42)).mode, 'owner');
  assert.equal(await access.setMode(42, 'bini'), true);
  assert.equal((await access.scopeFor(42)).mode, 'bini');
  assert.equal(await access.setMode(42, 'admin'), false, 'only owner and bini are modes');
  assert.equal(linkOf(store, 42).mode, 'bini');
  assert.equal(await access.unlink(42), true);
  assert.equal(linkOf(store, 42).revokedReason, 'self');
  assert.equal(await access.scopeFor(42), null);
  assert.equal(await access.unlink(42), false);
  assert.equal(await access.setMode(42, 'owner'), false);
  assert.ok(audits.some(a => a.action === 'OWNER_TG_UNLINKED' && a.b === 'b1'));
  assert.equal((await access.linkFromContact(own('251900000001'))).ok, true, 'signing yourself out does not lock you out');
});

test('the dashboard lists and removes only its own building’s links', async () => {
  const { store, audits, access } = setup();
  store.addAccess('b1', '0900000001', 'owner'); store.addAccess('b2', '0900000003', 'owner');
  store.enable('b1'); store.enable('b2');
  await access.linkFromContact(own('251900000001'));
  await access.linkFromContact(own('251900000003', 43));
  const list = await access.linksForBuilding('b1');
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'label', 'lastSeen', 'linkedAt', 'mode', 'phoneLast4', 'role']);
  assert.equal(list[0].phoneLast4, '0001');
  const other = linkOf(store, 43);
  assert.equal(await access.revokeForBuilding('b1', other.id), false, 'building 1 cannot sign out building 2’s owner');
  assert.equal(other.revokedAt, null);
  assert.equal(await access.revokeForBuilding('b1', list[0].id), true);
  assert.equal(linkOf(store, 42).revokedReason, 'dashboard');
  assert.equal(await access.scopeFor(42), null);
  assert.equal((await access.linksForBuilding('b1')).length, 0);
  const n = audits.length;
  assert.equal(await access.revokeForBuilding('b1', list[0].id), false, 'removing twice is a no-op');
  assert.equal(audits.length, n, 'and is not audited twice');
  assert.ok(audits.some(a => a.b === 'b1' && a.action === 'OWNER_TG_UNLINKED' && /dashboard/.test(a.detail)));
});

test('a Remove from the dashboard sticks until ops approve the number again', async () => {
  const { store, access, tick, at } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  const first = await access.linkFromContact(own('251900000001'));
  await access.revokeForBuilding('b1', first.scope.linkId);
  tick(60000);
  assert.equal((await access.linkFromContact(own('251900000001'))).reason, 'blocked');
  assert.equal(await access.scopeFor(42), null);
  tick(60000);
  store.addAccess('b1', '0900000001', 'owner', null, at());           // ops approve it again, after the Remove
  tick(60000);
  const again = await access.linkFromContact(own('251900000001'));
  assert.equal(again.ok, true);
  assert.deepEqual((await access.scopeFor(42)).buildingIds, ['b1']);
  assert.equal(linkOf(store, 42).revokedReason, null);
});

test('a second Telegram account proving the same number replaces the first', async () => {
  const { store, audits, access, tick } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  await access.linkFromContact(own('251900000001', 42));
  tick(60000);
  assert.equal((await access.linkFromContact(own('251900000001', 43))).ok, true);
  assert.equal(await access.scopeFor(42), null, 'the older account is signed out');
  assert.equal(linkOf(store, 42).revokedReason, 'replaced');
  assert.deepEqual((await access.scopeFor(43)).buildingIds, ['b1']);
  assert.ok(audits.some(a => a.action === 'OWNER_TG_UNLINKED' && /replaced by a newer link/.test(a.detail)));
  assert.deepEqual((await access.linksForBuilding('b1')).map(l => l.id), [linkOf(store, 43).id]);
  tick(60000);
  assert.equal((await access.linkFromContact(own('251900000001', 42))).ok, true, 'a replaced account may prove the number again');
  assert.equal(await access.scopeFor(43), null);
});

test('a number revoked and approved again does not revive an old link until the phone is shared again', async () => {
  const { store, access, tick, at } = setup();
  const a = store.addAccess('b1', '0900000001'); store.enable('b1');
  await access.linkFromContact(own('251900000001'));
  tick(60000);
  a.revokedAt = at();
  tick(60000);
  store.addAccess('b1', '0900000001', 'owner', null, at());
  assert.equal(await access.scopeFor(42), null);
  assert.equal((await access.linksForBuilding('b1')).length, 0, 'nor does the dashboard show it as linked');
  tick(60000);
  assert.equal((await access.linkFromContact(own('251900000001'))).ok, true);
  assert.deepEqual((await access.scopeFor(42)).buildingIds, ['b1']);
});

test('revokeAccess signs out the number’s links only when no approval for it remains', async () => {
  const { store, audits, access, tick } = setup();
  const a1 = store.addAccess('b1', '0900000001'); const a2 = store.addAccess('b2', '0900000001', 'staff');
  store.enable('b1'); store.enable('b2');
  await access.linkFromContact(own('251900000001'));
  tick(60000);
  assert.deepEqual(await access.revokeAccess(a1.id, { by: 'ops' }), { ok: true, linksRevoked: 0 });
  assert.ok(a1.revokedAt);
  assert.deepEqual((await access.scopeFor(42)).buildingIds, ['b2']);
  assert.equal(linkOf(store, 42).revokedAt, null);
  tick(60000);
  assert.deepEqual(await access.revokeAccess(a2.id, { by: 'ops' }), { ok: true, linksRevoked: 1 });
  assert.equal(linkOf(store, 42).revokedReason, 'access');
  assert.equal(await access.scopeFor(42), null);
  assert.deepEqual(await access.revokeAccess(a2.id, { by: 'ops' }), { ok: false, linksRevoked: 0 }, 'already revoked');
  assert.deepEqual(await access.revokeAccess('nope', { by: 'ops' }), { ok: false, linksRevoked: 0 });
  assert.ok(audits.some(x => x.b === 'b1' && x.action === 'OWNER_ACCESS_REVOKED'));
  assert.ok(audits.some(x => x.b === 'b2' && x.action === 'OWNER_TG_UNLINKED' && /no longer approved/.test(x.detail)));
  store.addAccess('b2', '0900000001', 'staff', null, new Date(T0.getTime() - DAY));   // an old approval does not unblock
  tick(60000);
  assert.equal((await access.linkFromContact(own('251900000001'))).reason, 'blocked');
});

test('audit details never carry more than the last four digits of a phone or a Telegram id', async () => {
  const { store, audits, access, tick } = setup();
  const TG1 = 5550001234, TG2 = 5550005678;
  const a = store.addAccess('b1', '+1 202 555 0147'); store.enable('b1');
  const l1 = await access.linkFromContact(own('12025550147', TG1));
  tick(60000);
  await access.linkFromContact(own('12025550147', TG2));
  await access.setMode(TG2, 'bini');
  await access.unlink(TG2);
  tick(60000);
  await access.linkFromContact(own('12025550147', TG2));
  await access.revokeForBuilding('b1', linkOf(store, TG2).id);
  await access.revokeAccess(a.id, { by: 'ops' });
  assert.ok(l1.ok);
  assert.ok(audits.length >= 6, 'every path was audited');
  for (const { detail } of audits) {
    for (const run of detail.match(/\d+/g) || []) assert.ok(run.length <= 4, detail);
    for (const whole of ['12025550147', '2025550147', String(TG1), String(TG2), '0001234', '0005678']) assert.equal(detail.includes(whole), false, detail);
  }
  const linked = audits.find(x => x.action === 'OWNER_TG_LINKED');
  assert.match(linked.detail, /telegram …1234/);
  assert.match(linked.detail, /phone …0147/);
});

test('the Prisma store asks exactly the right questions', async () => {
  const calls = [];
  const model = name => new Proxy({}, { get: (_, op) => async args => { calls.push({ name, op, args }); return op === 'findMany' ? [] : null; } });
  const store = makeOwnerAccessStore({ ownerAccess: model('ownerAccess'), ownerTgLink: model('ownerTgLink'), agentSwitch: model('agentSwitch') });
  await store.activeAccessByPhone('+251900000001');
  await store.enabledEntities('owner', 'building', ['b1']);
  await store.upsertLink({ telegramId: '42', chatId: '42', phoneKey: 'ph:900000001', phoneE164: '+251900000001', at: T0 });
  await store.accessForEntity('building', 'b1');
  await store.linksForPhones(['+251900000001']);
  await store.revokeLink('L1', T0, 'dashboard');
  await store.accessById('A1');
  await store.revokeAccess('A1', T0);
  const by = (name, op) => calls.find(c => c.name === name && c.op === op).args;
  const accessFinds = calls.filter(c => c.name === 'ownerAccess' && c.op === 'findMany');
  assert.deepEqual(accessFinds[0].args.where, { phoneE164: '+251900000001', revokedAt: null });
  assert.equal(accessFinds[0].args.select.createdAt, true, 'approvals carry createdAt for the link-age rule');
  assert.equal(accessFinds[0].args.select.phoneE164, true);
  assert.deepEqual(accessFinds[1].args.where, { kind: 'building', entityId: 'b1', revokedAt: null });
  assert.deepEqual(by('agentSwitch', 'findMany').where, { agent: 'owner', kind: 'building', entityId: { in: ['b1'] }, disabledAt: null });
  const up = by('ownerTgLink', 'upsert');
  assert.deepEqual(up.where, { telegramId: '42' });
  assert.equal(up.create.phoneE164, '+251900000001');
  assert.equal(up.update.phoneE164, '+251900000001');
  assert.equal(up.update.revokedAt, null, 'linking again reopens a revoked link');
  assert.equal(up.update.revokedReason, null);
  assert.equal(up.update.mode, 'owner');
  const lf = by('ownerTgLink', 'findMany');
  assert.deepEqual(lf.where, { phoneE164: { in: ['+251900000001'] }, revokedAt: null }, 'revoked links are filtered before take');
  assert.equal(lf.take, 50);
  assert.deepEqual(by('ownerTgLink', 'update'), { where: { id: 'L1' }, data: { revokedAt: T0, revokedReason: 'dashboard' } });
  assert.deepEqual(by('ownerAccess', 'findUnique').where, { id: 'A1' });
  assert.deepEqual(by('ownerAccess', 'update'), { where: { id: 'A1' }, data: { revokedAt: T0 } });
});
