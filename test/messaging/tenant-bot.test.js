'use strict';
// @bina_smart_bot's tenant paths with a fake Telegram API and a fake link service (the last tests use the real link
// rules over a fake Prisma): nothing is sent anywhere.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBinaBot } = require('../../ride/binaBot');

function harness({ link = { ok: true, buildingId: 'b1', units: ['211'] }, linkThrows = false, unlinkResult = 1, unlinkThrows = false,
  withTenant = true, withOwner = false, clock = null } = {}) {
  const sent = [], calls = { link: [], unlink: [], ownerLink: [], bini: [] };
  const api = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; },
    sendChatAction: async () => true, answerCallbackQuery: async () => true };
  const fetchImpl = async (url, init) => { calls.bini.push(JSON.parse(init.body)); return { json: async () => ({ reply: 'customer bini' }) }; };
  const tenant = {
    linkFromContact: async a => { calls.link.push(a); if (linkThrows) throw new Error('db down'); return link; },
    unlink: async id => { calls.unlink.push(String(id)); if (unlinkThrows) throw new Error('db down'); return unlinkResult; },
  };
  const owner = { access: { scopeFor: async () => null, linkFromContact: async a => { calls.ownerLink.push(a); return { ok: false, reason: 'not_registered' }; },
    unlink: async () => false, setMode: async () => false }, answer: async () => 'x', health: async () => 'h' };
  const b = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://127.0.0.1:4210/api/assistant', fetchImpl, botUsername: 'bina_smart_bot', internalKey: 'k',
    tenant: withTenant ? tenant : undefined, owner: withOwner ? owner : undefined, now: clock ? () => clock.t : undefined });
  return { sent, calls, b };
}
const pm = (text, extra = {}, chatId = 42) => ({ message: Object.assign({ chat: { id: chatId, type: 'private' }, from: { id: 42, first_name: 'T' }, text }, extra) });
const contact = (extra = {}) => pm('', Object.assign({ contact: { phone_number: '251900000001', user_id: 42 } }, extra));
const MIN = 60000;

test('/start tenant_<slug> in a private chat asks for the phone and links nothing yet', async () => {
  const { sent, calls, b } = harness();
  await b.handleUpdate(pm('/start tenant_darulle'));
  assert.equal(sent[0].extra.reply_markup.keyboard[0][0].request_contact, true);
  assert.match(sent[0].text, /Rent notices on Telegram/);
  assert.equal(calls.link.length, 0);
});

test('a contact shared right after it is checked against that building, and a match says which units', async () => {
  const { sent, calls, b } = harness({ link: { ok: true, buildingId: 'b1', units: ['211', '212'] } });
  await b.handleUpdate(pm('/start tenant_darulle'));
  await b.handleUpdate(contact());
  assert.equal(calls.link.length, 1);
  assert.deepEqual([calls.link[0].slug, calls.link[0].forwarded, calls.link[0].from.id, calls.link[0].contact.phone_number], ['darulle', false, 42, '251900000001']);
  assert.match(sent[1].text, /✅/);
  assert.match(sent[1].text, /211, 212/);
  assert.match(sent[1].text, /\/stop/);
  assert.equal(sent[1].extra.reply_markup.remove_keyboard, true);
});

test('a contact 11 minutes later is not a link attempt; 9 minutes is; the start is used once', async () => {
  let clock = { t: 1e12 };
  let h = harness({ clock });
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  clock.t += 11 * MIN;
  await h.b.handleUpdate(contact());
  assert.equal(h.calls.link.length, 0);
  assert.match(h.sent[1].text, /Ethiopia's all-in-one platform/);
  clock = { t: 1e12 };
  h = harness({ clock });
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  clock.t += 9 * MIN;
  await h.b.handleUpdate(contact());
  await h.b.handleUpdate(contact());
  assert.equal(h.calls.link.length, 1);
});

test('a contact from a Mini App, with no /start tenant_, gets exactly the reply it got before', async () => {
  const h = harness();
  await h.b.handleUpdate(contact());
  const before = harness({ withTenant: false });
  await before.b.handleUpdate(contact());
  assert.equal(h.calls.link.length, 0);
  assert.deepEqual(h.sent, before.sent);
});

test('forwarded contacts and contacts sent via a bot are passed on as forwarded', async () => {
  for (const extra of [{ forward_origin: { type: 'user', date: 1 } }, { forward_from: { id: 43 } }, { forward_date: 1 }, { via_bot: { id: 9, is_bot: true } }]) {
    const { calls, b } = harness({ link: { ok: false, reason: 'not_own_contact' } });
    await b.handleUpdate(pm('/start tenant_darulle'));
    await b.handleUpdate(contact(extra));
    assert.equal(calls.link[0].forwarded, true, Object.keys(extra)[0]);
  }
});

test('no match gets one neutral reply that names nothing; refusals say what to do; a failure says so', async () => {
  const replies = {};
  for (const reason of ['no_match', 'something_else', 'too_many', 'not_own_contact', 'not_private']) {
    const { sent, b } = harness({ link: { ok: false, reason } });
    await b.handleUpdate(pm('/start tenant_darulle'));
    await b.handleUpdate(contact());
    replies[reason] = sent[1].text;
  }
  assert.equal(replies.no_match, replies.something_else);
  assert.match(replies.no_match, /could not connect this number/);
  assert.doesNotMatch(replies.no_match, /darulle|211/);
  assert.match(replies.too_many, /15 minutes/);
  assert.match(replies.not_own_contact, /own number/);
  assert.match(replies.not_private, /private chat/);
  const { sent, b } = harness({ linkThrows: true });
  await b.handleUpdate(pm('/start tenant_darulle'));
  await b.handleUpdate(contact());
  assert.match(sent[1].text, /linking failed/);
});

test('a failing link or unlink service is logged by its error kind only, never its message', async () => {
  const logs = [], orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  try {
    let h = harness({ linkThrows: true });
    await h.b.handleUpdate(pm('/start tenant_darulle'));
    await h.b.handleUpdate(contact());
    h = harness({ unlinkThrows: true });
    await h.b.handleUpdate(pm('/stop'));
  } finally { console.error = orig; }
  assert.deepEqual(logs, ['[binaBot] tenant link: Error', '[binaBot] tenant unlink: Error']);
});

test('the newest start command decides what a contact means: owner or tenant', async () => {
  let h = harness({ withOwner: true });
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  await h.b.handleUpdate(pm('/start owner'));
  await h.b.handleUpdate(contact());
  assert.deepEqual([h.calls.ownerLink.length, h.calls.link.length], [1, 0]);
  h = harness({ withOwner: true });
  await h.b.handleUpdate(pm('/start owner'));
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  await h.b.handleUpdate(contact());
  assert.deepEqual([h.calls.ownerLink.length, h.calls.link.length], [0, 1]);
});

test('/stop unlinks through the link service and answers either way; a failure asks to retry', async () => {
  let h = harness();
  await h.b.handleUpdate(pm('/stop'));
  assert.deepEqual(h.calls.unlink, ['42']);
  assert.match(h.sent[0].text, /notices stopped/);
  h = harness({ unlinkResult: 0 });
  await h.b.handleUpdate(pm('/stop'));
  assert.match(h.sent[0].text, /were not receiving/);
  h = harness({ unlinkThrows: true });
  await h.b.handleUpdate(pm('/stop'));
  assert.match(h.sent[0].text, /Sorry, please try again/);
});

test('in a group, or without the tenant service, /start tenant_ is just the welcome', async () => {
  let h = harness();
  await h.b.handleUpdate({ message: { chat: { id: -100, type: 'group' }, from: { id: 42 }, text: '/start tenant_darulle' } });
  assert.equal(h.sent[0].extra.reply_markup.keyboard, undefined);
  h = harness({ withTenant: false });
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  assert.equal(h.sent[0].extra.reply_markup.keyboard, undefined);
  assert.match(h.sent[0].text, /Ethiopia's all-in-one platform/);
});

test('the bot passes when /start tenant_ arrived as startedAt, not when the contact came', async () => {
  const clock = { t: 1e12 };
  const h = harness({ clock });
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  clock.t += 9 * MIN;
  await h.b.handleUpdate(contact());
  assert.equal(h.calls.link[0].startedAt, 1e12);
});

test('an expired start gets the neutral reply and a hint to press the start link again', async () => {
  const { sent, b } = harness({ link: { ok: false, reason: 'expired' } });
  await b.handleUpdate(pm('/start tenant_darulle'));
  await b.handleUpdate(contact());
  assert.match(sent[1].text, /could not connect this number/);
  assert.match(sent[1].text, /press the start link again/);
  assert.doesNotMatch(sent[1].text, /darulle|211/);
  assert.equal(sent[1].extra.reply_markup.remove_keyboard, true);
});

// The real link rules (messaging/tenant-link.js) over a fake Prisma: a wiring mistake in the bot (for example not
// passing startedAt) must fail here, which a fake link service cannot show.
const { makeTenantLink, makeTenantLinkStore } = require('../../messaging/tenant-link');
function fakePrisma() {
  const db = { buildings: [{ id: 'b1', qrSlug: 'darulle' }], users: [{ id: 'u1', phone: '+251900000001', telegramChatId: null }],
    tenancies: [{ id: 't1', active: true, userId: 'u1', unit: { buildingId: 'b1', number: '211' } }], writes: 0 };
  const userOf = id => db.users.find(u => u.id === id);
  return { db,
    building: { findUnique: async ({ where }) => db.buildings.find(b => b.qrSlug === where.qrSlug) || null },
    tenancy: { findMany: async ({ where }) => db.tenancies.filter(t => t.active === where.active && t.unit.buildingId === where.unit.buildingId)
      .map(t => ({ id: t.id, userId: t.userId, unit: { number: t.unit.number }, user: { phone: userOf(t.userId).phone, telegramChatId: userOf(t.userId).telegramChatId } })) },
    user: {
      update: async ({ where, data }) => { db.writes++; Object.assign(userOf(where.id), data); return { id: where.id }; },
      findMany: async ({ where }) => db.users.filter(u => u.telegramChatId === where.telegramChatId)
        .map(u => ({ id: u.id, tenancies: db.tenancies.filter(t => t.active && t.userId === u.id).map(t => ({ unit: { buildingId: t.unit.buildingId, number: t.unit.number } })) })),
    },
  };
}
function realHarness({ wrap = s => s } = {}) {
  const clock = { t: Date.parse('2026-09-20T09:00:00Z') }, sent = [], audits = [];
  const prisma = fakePrisma();
  const service = makeTenantLink({ store: makeTenantLinkStore(prisma), audit: (b, action) => audits.push(action), now: () => new Date(clock.t) });
  const api = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; },
    sendChatAction: async () => true, answerCallbackQuery: async () => true };
  const fetchImpl = async () => ({ json: async () => ({ reply: 'customer bini' }) });
  const b = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://127.0.0.1:4210/api/assistant', fetchImpl, botUsername: 'bina_smart_bot',
    internalKey: 'k', tenant: wrap(service), now: () => clock.t });
  return { clock, sent, audits, prisma, b };
}

test('with the real link rules, start then own contact links the tenant; /stop unlinks', async () => {
  const h = realHarness();
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  h.clock.t += 2 * MIN;
  await h.b.handleUpdate(contact());
  assert.equal(h.prisma.db.users[0].telegramChatId, '42');
  assert.match(h.sent[1].text, /✅/);
  assert.match(h.sent[1].text, /211/);
  assert.deepEqual(h.audits, ['TENANT_TG_LINKED']);
  await h.b.handleUpdate(pm('/stop'));
  assert.equal(h.prisma.db.users[0].telegramChatId, null);
  assert.match(h.sent[2].text, /notices stopped/);
});

test('with the real link rules, a bot that loses startedAt links nothing and asks to press the link again', async () => {
  const h = realHarness({ wrap: s => Object.assign({}, s, { linkFromContact: a => s.linkFromContact(Object.assign({}, a, { startedAt: undefined })) }) });
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  h.clock.t += 2 * MIN;
  await h.b.handleUpdate(contact());
  assert.equal(h.prisma.db.users[0].telegramChatId, null);
  assert.equal(h.prisma.db.writes, 0);
  assert.match(h.sent[1].text, /press the start link again/);
});

test('with the real link rules, a contact with no start, or one a Mini App drops later, writes nothing', async () => {
  const h = realHarness();
  await h.b.handleUpdate(contact());
  assert.match(h.sent[0].text, /Ethiopia's all-in-one platform/);
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  h.clock.t += 11 * MIN;
  await h.b.handleUpdate(contact());
  assert.match(h.sent[2].text, /Ethiopia's all-in-one platform/);
  assert.equal(h.prisma.db.writes, 0);
  assert.deepEqual(h.audits, []);
});
