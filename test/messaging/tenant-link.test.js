'use strict';
// Who may receive a building's tenant messages on a Telegram account. Over an in-memory store; the last test pins the
// Prisma store's queries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTenantLink, makeTenantLinkStore } = require('../../messaging/tenant-link');

function memStore() {
  const s = { buildings: [{ id: 'b1', qrSlug: 'darulle' }, { id: 'b2', qrSlug: 'other' }], users: [], tenancies: [] };
  const view = t => { const u = s.users.find(x => x.id === t.userId); return { id: t.id, userId: t.userId, unit: { number: t.unit }, user: { phone: u.phone, telegramChatId: u.telegramChatId } }; };
  return {
    s,
    buildingBySlug: async slug => s.buildings.find(b => b.qrSlug === slug) || null,
    activeTenancies: async buildingId => s.tenancies.filter(t => t.active && t.buildingId === buildingId).map(view),
    setChat: async (userId, chatId) => { s.users.find(u => u.id === userId).telegramChatId = chatId; return { id: userId }; },
    usersWithChat: async chatId => s.users.filter(u => u.telegramChatId === chatId).map(u => ({ id: u.id,
      tenancies: s.tenancies.filter(t => t.active && t.userId === u.id).map(t => ({ unit: { buildingId: t.buildingId, number: t.unit } })) })),
    clearChat: async userId => { s.users.find(u => u.id === userId).telegramChatId = null; return { id: userId }; },
    add(buildingId, unit, phone, active = true) {
      let u = s.users.find(x => x.phone === phone);
      if (!u) { u = { id: 'u' + (s.users.length + 1), phone, telegramChatId: null }; s.users.push(u); }
      const t = { id: 't' + (s.tenancies.length + 1), buildingId, unit, userId: u.id, active };
      s.tenancies.push(t); return t;
    },
  };
}
const NOW = () => new Date('2026-09-20T09:00:00Z');
function setup() {
  const store = memStore(), audits = [];
  const link = makeTenantLink({ store, audit: (b, action, detail) => audits.push({ b, action, detail }), now: NOW });
  return { store, audits, link };
}
// startedAt: when this account sent /start tenant_<slug> (the bot passes it; two minutes ago here).
const own = (slug, phone, extra = {}) => ({ slug, chat: { id: 42, type: 'private' }, from: { id: 42 }, contact: { phone_number: phone, user_id: 42 }, forwarded: false,
  startedAt: new Date('2026-09-20T08:58:00Z').getTime(), ...extra });

test('the full number of an active tenancy in that building links the tenant, and the audit keeps no phone digits', async () => {
  const { store, audits, link } = setup();
  store.add('b1', '211', '0900000001');
  store.add('b1', '212', '0900000001');
  const r = await link.linkFromContact(own('darulle', '251900000001'));
  assert.deepEqual(r, { ok: true, buildingId: 'b1', units: ['211', '212'] });
  assert.equal(store.s.users[0].telegramChatId, '42');
  assert.deepEqual(audits.map(a => [a.b, a.action]), [['b1', 'TENANT_TG_LINKED']]);
  assert.match(audits[0].detail, /211, 212/);
  assert.doesNotMatch(audits[0].detail, /900000001|0900/);
});

test('only the sender’s own contact, unforwarded, in their private chat with the bot, counts', async () => {
  const { store, link } = setup();
  store.add('b1', '211', '0900000001');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { chat: { id: -5, type: 'group' } }))).reason, 'not_private');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { chat: { id: 7, type: 'private' } }))).reason, 'not_private');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { contact: { phone_number: '251900000001', user_id: 99 } }))).reason, 'not_own_contact');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { contact: { phone_number: '251900000001' } }))).reason, 'not_own_contact');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { forwarded: true }))).reason, 'not_own_contact');
  // Fail closed: a caller that does not say the contact was unforwarded (the bot maps via_bot to forwarded) gets nothing.
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { forwarded: undefined }))).reason, 'not_own_contact');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { from: { id: 7 }, contact: { phone_number: '251900000001', user_id: 7 } }))).reason, 'not_private');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { chat: undefined }))).reason, 'not_private');
  assert.equal(store.s.users[0].telegramChatId, null);
});

test('a contact counts only within ten minutes after /start tenant_<slug>', async () => {
  const { store, audits, link } = setup();
  store.add('b1', '211', '0900000001');
  const at = iso => new Date(iso).getTime();
  for (const startedAt of [undefined, null, 'soon', at('2026-09-20T08:49:59Z'), at('2026-09-20T07:00:00Z'), at('2026-09-20T09:05:00Z')])
    assert.deepEqual(await link.linkFromContact(own('darulle', '251900000001', { startedAt })), { ok: false, reason: 'expired' }, String(startedAt));
  assert.equal(store.s.users[0].telegramChatId, null);
  assert.equal(audits.length, 0);
  // Stale contacts use up no attempts: the account can still link right after a fresh /start.
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { startedAt: at('2026-09-20T08:50:00Z') }))).ok, true);
  assert.equal(store.s.users[0].telegramChatId, '42');
});

test('the same last nine digits from another country do not match', async () => {
  const { store, audits, link } = setup();
  store.add('b1', '211', '0900000001');
  for (const twin of ['+1900000001', '971900000001', '+91900000001', '900000001', '0900000001'])
    assert.deepEqual(await link.linkFromContact(own('darulle', twin)), { ok: false, reason: 'no_match' }, twin);
  assert.equal(store.s.users[0].telegramChatId, null);
  assert.equal(audits.length, 0);
});

test('a tenancy phone stored as 09…, 2519… or +2519… matches in full; one stored as bare nine digits never does', async () => {
  for (const [stored, ok] of [['0900000001', true], ['251900000001', true], ['+251 90 000 0001', true], ['900000001', false]]) {
    const { store, link } = setup();
    store.add('b1', '211', stored);
    assert.equal((await link.linkFromContact(own('darulle', '+251900000001'))).ok, ok, stored);
  }
});

test('a tenant of another building, an ended tenancy, an unknown or malformed building: the same neutral no_match', async () => {
  const { store, link } = setup();
  store.add('b2', '5', '0900000001');
  store.add('b1', '9', '0900000002', false);
  for (const [slug, phone] of [['darulle', '251900000001'], ['darulle', '251900000002'], ['nope', '251900000001'], ['bad slug!', '251900000001'], ['darulle', 'not a phone']]) {
    const { link: fresh } = { link: makeTenantLink({ store, audit: () => {}, now: NOW }) };
    assert.deepEqual(await fresh.linkFromContact(own(slug, phone)), { ok: false, reason: 'no_match' }, slug + ' ' + phone);
  }
  assert.ok(store.s.users.every(u => u.telegramChatId === null));
});

test('five attempts in fifteen minutes, then a pause', async () => {
  const { link } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await link.linkFromContact(own('darulle', '25190000000' + i))).reason, 'no_match');
  assert.equal((await link.linkFromContact(own('darulle', '251900000009'))).reason, 'too_many');
});

test('/stop clears the link for every tenancy of that account and audits each building', async () => {
  const { store, audits, link } = setup();
  store.add('b1', '211', '0900000001'); store.add('b2', '5', '0900000001');
  store.s.users[0].telegramChatId = '42';
  assert.equal(await link.unlink(42), 1);
  assert.equal(store.s.users[0].telegramChatId, null);
  assert.deepEqual(audits.map(a => [a.b, a.action]).sort(), [['b1', 'TENANT_TG_UNLINKED'], ['b2', 'TENANT_TG_UNLINKED']]);
  assert.equal(await link.unlink(42), 0);
});

test('the dashboard sees linked units and can remove one — only in its own building', async () => {
  const { store, audits, link } = setup();
  const t1 = store.add('b1', '211', '0900000001'); store.add('b1', '212', '0900000002'); const t3 = store.add('b2', '5', '0900000003');
  store.s.users[0].telegramChatId = '42'; store.s.users[2].telegramChatId = '43';
  assert.deepEqual(await link.statsForBuilding('b1'), { active: 2, linked: 1, units: [{ tenancyId: t1.id, unit: '211' }] });
  assert.equal(await link.removeForBuilding('b1', t3.id), false);
  assert.equal(store.s.users[2].telegramChatId, '43');
  assert.equal(await link.removeForBuilding('b1', t1.id), true);
  assert.equal(await link.removeForBuilding('b1', t1.id), false);
  assert.equal(store.s.users[0].telegramChatId, null);
  assert.deepEqual(audits.map(a => [a.b, a.action, a.detail]), [['b1', 'TENANT_TG_UNLINKED', 'unit 211 · removed from the dashboard']]);
});

test('the Prisma store reads active tenancies of one building and writes only telegramChatId', async () => {
  const seen = [];
  const prisma = {
    building: { findUnique: async a => { seen.push(['building', a]); return null; } },
    tenancy: { findMany: async a => { seen.push(['tenancies', a]); return []; } },
    user: { update: async a => { seen.push(['update', a]); return {}; }, findMany: async a => { seen.push(['users', a]); return []; } },
  };
  const st = makeTenantLinkStore(prisma);
  await st.buildingBySlug('darulle'); await st.activeTenancies('b1'); await st.setChat('u1', '42'); await st.clearChat('u1'); await st.usersWithChat('42');
  assert.deepEqual(seen.find(x => x[0] === 'building')[1].where, { qrSlug: 'darulle' });
  assert.deepEqual(seen.find(x => x[0] === 'tenancies')[1].where, { active: true, unit: { buildingId: 'b1' } });
  const ups = seen.filter(x => x[0] === 'update').map(x => x[1]);
  assert.deepEqual(ups.map(u => [u.where.id, Object.keys(u.data), u.data.telegramChatId]), [['u1', ['telegramChatId'], '42'], ['u1', ['telegramChatId'], null]]);
  assert.deepEqual(seen.find(x => x[0] === 'users')[1].where, { telegramChatId: '42' });
});
