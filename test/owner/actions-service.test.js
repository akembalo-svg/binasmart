'use strict';
// Preparing, confirming and cancelling an owner action (owner actions design §3.2, §3.3). The resolver and the cards
// are the real ones over the Prisma double; the store is in memory; the delivery layer, the dashboard's invoice code
// and the Telegram access rules are doubles that RECORD what they were asked to do — so a test fails loudly if
// anything is sent or written before the owner presses ✅.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeOwnerActions } = require('../../agents/owner/actions/service');
const { makeActionResolver, LINK_SAMPLE } = require('../../agents/owner/actions/resolve');
const P = require('../../agents/owner/actions/policy');
const { fakePrisma, data, NOW, QUIET } = require('./actions-fixture');

function memStore() {
  const rows = new Map();
  return {
    rows,
    create: async d => { rows.set(d.id, { ...d }); return { id: d.id }; },
    get: async id => (rows.has(id) ? { ...rows.get(id) } : null),
    transition: async (id, from, to, d = {}) => { const a = rows.get(id); if (!a || a.status !== from) return 0; Object.assign(a, d, { status: to }); return 1; },
    claim: async (id, at, d = {}) => { const a = rows.get(id); if (!a || a.status !== 'pending' || new Date(a.expiresAt) <= at) return 0; Object.assign(a, d, { status: 'running', confirmedAt: at }); return 1; },
    finish: async (id, status, result) => { const a = rows.get(id); if (!a || a.status !== 'running') return 0; Object.assign(a, { status, result: result == null ? a.result : result }); return 1; },
    setCards: async (id, cards) => { rows.get(id).cards = cards; return { id }; },
    countBulkSince: async (buildingId, since, excludeId) => [...rows.values()].filter(a => a.buildingId === buildingId && a.bulk
      && ['running', 'done', 'failed'].includes(a.status) && a.confirmedAt && a.confirmedAt >= since && a.id !== excludeId).length,
    expiredPending: async at => [...rows.values()].filter(a => a.status === 'pending' && new Date(a.expiresAt) <= at),
  };
}

// The delivery layer's preview with its real shape: Telegram when the tenant linked, else SMS to an 09… number, else
// not reachable; one SMS part per recipient is enough here.
function fakeDelivery({ limit = 500, used = 0, mode = 'test', real = true } = {}) {
  return {
    plan: async ({ recipients }) => {
      const rows = recipients.map(r => (r.telegramChatId ? { tenancyId: r.tenancyId, channel: 'telegram', smsParts: 0 }
        : /^09\d{8}$/.test(String(r.phone || '')) ? { tenancyId: r.tenancyId, channel: 'sms', smsParts: 1 }
        : { tenancyId: r.tenancyId, channel: 'none', smsParts: 0, errorKind: 'no_contact' }));
      const count = ch => rows.filter(r => r.channel === ch).length;
      const parts = rows.reduce((s, r) => s + r.smsParts, 0);
      const remaining = Math.max(0, limit - used);
      return { rows, counts: { telegram: count('telegram'), sms: count('sms'), none: count('none') }, smsParts: parts,
        used, limit, remaining, withinLimit: parts <= remaining, mode: real ? mode : 'test', unitPriceEtb: 0.7475, costEtb: Math.round(parts * 0.7475 * 100) / 100 };
    },
  };
}

function setup({ d = data(), now = NOW, role = 'owner', staffConfirm = false, on = ['b1', 'b2'], delivery = fakeDelivery(),
  chats = [{ telegramId: '77', chatId: '77' }], sendThrows = false, real = true } = {}) {
  const prisma = fakePrisma(d);
  const store = memStore();
  const did = [];                                   // what the outside world was asked to do, in order
  const sent = [];                                  // the whole send, for the two rules pinned at the end of this file
  const audits = [];
  const links = { 77: () => ({ buildingIds: ['b1'], roles: { b1: role }, accessIds: { b1: 'A1' }, mode: 'owner' }) };
  const state = { on: on.slice(), staffConfirm, chats };
  const ops = {
    tenantBuilding: b => ({ id: b.id, slug: b.qrSlug, real, smsLabel: 'BinaSmart · ' + b.name, smsMonthlyLimit: b.smsMonthlyLimit, smsSender: '' }),
    sendBatch: async a => {
      if (sendThrows) throw new Error('provider down');
      did.push(['sendBatch', a.kind, a.recipients.length, a.actor]);
      sent.push(a);
      return { ok: true, batchId: 'B1', counts: { telegram: 1, sms: 1, none: 1, sent: 2, test: 0, failed: 1 },
        results: a.recipients.map((r, i) => ({ tenancyId: r.tenancyId, status: i === a.recipients.length - 1 && a.recipients.length > 1 ? 'failed' : 'sent' })) };
    },
    sendInvoice: async a => { did.push(['sendInvoice', a.invoiceId, a.actor]); return { ok: true, delivered: true, channel: 'telegram', status: 'sent', reason: null, batchId: 'B2' }; },
    markPaid: async a => { did.push(['markPaid', a.invoiceId, a.method, a.actor]);
      return { ok: true, invoice: { id: a.invoiceId }, receipt: Promise.resolve({ delivered: true, channel: 'telegram', status: 'sent', batchId: 'B3' }) }; },
    generateInvoices: async (id, month) => { did.push(['generateInvoices', id, month]); return { created: 1, skipped: 2, month }; },
    invoiceLink: async id => { did.push(['invoiceLink', id]); return 'bina.et/i/RealToken12'; },
  };
  const access = {
    scopeFor: async tg => (links[String(tg)] ? links[String(tg)]() : null),
    ownerChatsForBuilding: async () => state.chats,
  };
  let clock = now;
  const actions = makeOwnerActions({ store, resolver: makeActionResolver({ prisma, now: () => clock }), delivery, ops, access,
    switches: async ids => ({ on: ids.filter(id => state.on.includes(id)), staff: state.staffConfirm ? ids.filter(id => state.on.includes(id)) : [] }),
    audit: (b, action, detail, amount, actor) => audits.push({ b, action, detail, amount, actor }), now: () => clock });
  const scope = { buildingIds: ['b1'], roles: { b1: role }, accessIds: { b1: 'A1' }, actionsOn: state.on, staffConfirm: staffConfirm ? state.on : [], telegramId: '77' };
  return { prisma, store, did, sent, audits, actions, scope, d, links, state,
    tick: ms => { clock = new Date(clock.getTime() + ms); } };
}
const TG = { channel: 'owner-telegram', telegramId: '77', chatId: '77', messageId: 9 };
const WEB = { channel: 'owner-web', buildingId: 'b1' };
const prepareMessage = (s, args = {}) => s.actions.prepare({ kind: 'message', args: { target: 'all', text: 'ነገ ውሃ ይቋረጣል', ...args }, scope: s.scope, channel: 'owner-telegram' });

test('preparing writes one pending action and a preview — and sends nothing, records nothing', async () => {
  const s = setup();
  const r = await prepareMessage(s);
  assert.equal(r.ok, true);
  assert.match(r.id, P.ID_RE);
  assert.deepEqual(s.did, [], 'nothing was sent, marked paid or generated');
  const a = s.store.rows.get(r.id);
  assert.equal(a.status, 'pending');
  assert.equal(a.kind, 'message');
  assert.equal(a.text, 'ነገ ውሃ ይቋረጣል');
  assert.equal(a.bulk, true);
  assert.equal(a.expiresAt - NOW, P.EXPIRY_MS);
  assert.equal(JSON.stringify(a.payload).includes('0900000001'), false, 'no phone number is stored');
  assert.match(r.card.text, /ቅድመ እይታ/);
  assert.match(r.card.text, /Recipients: 3/);
  assert.match(r.card.text, /101, 102, 201/);
  assert.match(r.card.text, /📢 ዴሞ ታወር\n\nነገ ውሃ ይቋረጣል\n\n— Demo Tower · BinaSmart/);
  assert.match(r.card.text, /Telegram 1 · SMS 1 · አይደርስም · not reachable 1 \(201\)/);
  assert.match(r.card.text, /Valid until 12:10 Addis time/);
  assert.deepEqual(r.card.buttons.map(b => b.verb), ['confirm', 'cancel']);
  assert.deepEqual(r.model, { prepared: true, kind: 'message', recipients: 3, units: ['101', '102', '201'],
    note: 'The owner now sees a preview with ✅ and ✖. Nothing has been sent or recorded, and you must not say it was.' });
  assert.equal(s.audits[0].action, 'OWNER_ACTION_PREPARED');
  assert.equal(s.audits[0].actor, 'A1');
  assert.equal(s.audits[0].detail.includes('ውሃ'), false, 'the audit never carries the notice text');
  assert.match(s.audits[0].detail, /message · owner-telegram · 3 recipients · tg 1 sms 1 none 1 parts 1/);
});

test('✅ from the linked owner runs it once: the second press changes nothing', async () => {
  const s = setup();
  const { id } = await prepareMessage(s);
  const first = await s.actions.press({ id, verb: 'confirm', actor: TG });
  assert.equal(first.ok, true);
  assert.equal(first.status, 'done');
  assert.deepEqual(s.did, [['sendBatch', 'notice', 3, 'A1']]);
  assert.match(first.card.text, /✅ ተልኳል · Sent 2/);
  assert.match(first.card.text, /📵 ያልደረሳቸው · Not delivered: 201/);
  assert.deepEqual(first.card.buttons, []);
  assert.deepEqual(first.edits.map(e => [e.chatId, e.messageId]), [['77', 9]]);
  const second = await s.actions.press({ id, verb: 'confirm', actor: TG });
  assert.equal(second.ok, false);
  assert.equal(second.status, 'done');
  assert.equal(s.did.length, 1, 'the second press sent nothing');
  assert.deepEqual(s.audits.map(a => a.action), ['OWNER_ACTION_PREPARED', 'OWNER_ACTION_CONFIRMED', 'OWNER_ACTION_DONE']);
  assert.match(s.audits[2].detail, /sent 2 test 0 failed 1 · batch B1/);
});

test('✖ cancels it, and nothing can run afterwards', async () => {
  const s = setup();
  const { id } = await prepareMessage(s);
  const r = await s.actions.press({ id, verb: 'cancel', actor: TG });
  assert.equal(r.status, 'cancelled');
  assert.match(r.card.text, /✖ ተሰርዟል/);
  assert.deepEqual(s.did, []);
  assert.equal((await s.actions.press({ id, verb: 'confirm', actor: TG })).status, 'cancelled');
  assert.deepEqual(s.did, []);
  assert.deepEqual(s.audits.map(a => a.action), ['OWNER_ACTION_PREPARED', 'OWNER_ACTION_CANCELLED']);
});

test('a preview older than ten minutes is expired, by the press or by the sweep', async () => {
  const s = setup();
  const { id } = await prepareMessage(s);
  s.tick(P.EXPIRY_MS + 1000);
  const r = await s.actions.press({ id, verb: 'confirm', actor: TG });
  assert.equal(r.status, 'expired');
  assert.match(r.card.text, /⌛ ጊዜው አልፏል/);
  assert.deepEqual(s.did, []);
  assert.equal(s.audits.filter(a => a.action === 'OWNER_ACTION_EXPIRED').length, 1);

  const s2 = setup();
  const p2 = await prepareMessage(s2);
  s2.tick(P.EXPIRY_MS + 1000);
  assert.equal(await s2.actions.expireOld(), 1);
  assert.equal(s2.store.rows.get(p2.id).status, 'expired');
  assert.equal(await s2.actions.expireOld(), 0, 'an expired action is swept once');
  assert.equal(s2.audits.filter(a => a.action === 'OWNER_ACTION_EXPIRED').length, 1);
});

test('nobody else can confirm: another Telegram account, another chat, the other channel', async () => {
  const s = setup();
  const { id } = await prepareMessage(s);
  for (const actor of [{ ...TG, telegramId: '88', chatId: '88' }, { ...TG, chatId: '99' }, WEB]) {
    const r = await s.actions.press({ id, verb: 'confirm', actor });
    assert.equal(r.ok, false, JSON.stringify(actor));
    assert.equal(r.status, 'not_allowed');
  }
  assert.deepEqual(s.did, []);
  assert.equal(s.store.rows.get(id).status, 'pending');
  assert.equal(s.audits.filter(a => a.action === 'OWNER_ACTION_REFUSED').length, 3);
});

test('the owner\'s access and the building\'s switch are read again at the press, not trusted from the preview', async () => {
  const revoked = setup();
  const a = await prepareMessage(revoked);
  delete revoked.links['77'];                                  // the link was removed while the card was open
  assert.equal((await revoked.actions.press({ id: a.id, verb: 'confirm', actor: TG })).status, 'not_allowed');
  assert.deepEqual(revoked.did, []);

  const switched = setup();
  const b = await prepareMessage(switched);
  switched.state.on = [];                                      // ops switched owner actions off
  assert.equal((await switched.actions.press({ id: b.id, verb: 'confirm', actor: TG })).status, 'not_allowed');
  assert.deepEqual(switched.did, []);

  const demoted = setup();
  const c = await prepareMessage(demoted);
  demoted.links['77'] = () => ({ buildingIds: ['b1'], roles: { b1: 'staff' }, accessIds: { b1: 'A1' }, mode: 'owner' });
  assert.equal((await demoted.actions.press({ id: c.id, verb: 'confirm', actor: TG })).status, 'not_allowed');
  assert.deepEqual(demoted.did, []);
});

test('with the building\'s actions switch off nothing is even prepared', async () => {
  const s = setup({ on: [] });
  assert.deepEqual(await prepareMessage(s), { ok: false, error: 'actions_off', kind: 'message' });
  assert.equal(s.store.rows.size, 0);
});

test('staff may prepare; the card goes to the owner\'s chat and only the owner\'s ✅ runs it', async () => {
  const s = setup({ role: 'staff' });
  const r = await prepareMessage(s);
  assert.equal(r.ok, true);
  assert.equal(r.staff, true);
  assert.deepEqual(r.card.buttons, [], 'the staff member gets no buttons');
  assert.match(r.card.text, /ለባለቤቱ ተልኳል/);
  const cards = await s.actions.ownerCards(r.id);
  assert.deepEqual(cards.map(c => [c.chatId, c.buttons.map(b => b.verb)]), [['77', ['confirm', 'cancel']]]);
  const refused = await s.actions.press({ id: r.id, verb: 'confirm', actor: TG });   // the staff member's own account
  assert.equal(refused.status, 'not_allowed');
  assert.deepEqual(s.did, []);
});

test('with the per-building staff switch on, staff confirm what they prepared', async () => {
  const s = setup({ role: 'staff', staffConfirm: true });
  const r = await prepareMessage(s);
  assert.equal(r.staff, false);
  assert.deepEqual(r.card.buttons.map(b => b.verb), ['confirm', 'cancel']);
  assert.equal((await s.actions.press({ id: r.id, verb: 'confirm', actor: TG })).status, 'done');
});

test('staff cannot prepare when no owner is linked to confirm', async () => {
  const s = setup({ role: 'staff', chats: [] });
  assert.deepEqual(await prepareMessage(s), { ok: false, error: 'no_owner_chat' });
  assert.equal(s.store.rows.size, 0);
});

test('quiet hours hold a bulk send until 07:00, or until the owner presses ⚠️', async () => {
  const s = setup({ now: QUIET });
  const r = await prepareMessage(s);
  assert.deepEqual(r.card.buttons.map(b => b.verb), ['urgent', 'cancel'], 'no plain ✅ in quiet hours');
  assert.match(r.card.text, /🌙/);
  const held = await s.actions.press({ id: r.id, verb: 'confirm', actor: TG });
  assert.equal(held.status, 'quiet');
  assert.deepEqual(s.did, []);
  assert.equal(s.store.rows.get(r.id).status, 'pending', 'a held press does not use the preview up');
  assert.deepEqual(held.card.buttons.map(b => b.verb), ['urgent', 'cancel']);
  const urgent = await s.actions.press({ id: r.id, verb: 'urgent', actor: TG });
  assert.equal(urgent.status, 'done');
  assert.equal(s.store.rows.get(r.id).urgent, true);
  assert.deepEqual(s.did, [['sendBatch', 'notice', 3, 'A1']]);
});

test('a single-unit message is not a bulk send: quiet hours do not hold it', async () => {
  const s = setup({ now: QUIET });
  const r = await s.actions.prepare({ kind: 'message', args: { target: 'units', units: '101', text: 'እባክዎ ይለፉ' }, scope: s.scope, channel: 'owner-telegram' });
  assert.equal(s.store.rows.get(r.id).bulk, false);
  assert.deepEqual(r.card.buttons.map(b => b.verb), ['confirm', 'cancel']);
  assert.equal((await s.actions.press({ id: r.id, verb: 'confirm', actor: TG })).status, 'done');
});

test('at most two bulk sends a day: the third is refused before it is prepared', async () => {
  const s = setup();
  for (let i = 0; i < 2; i++) {
    const r = await prepareMessage(s);
    assert.equal((await s.actions.press({ id: r.id, verb: 'confirm', actor: TG })).status, 'done');
  }
  assert.deepEqual(await prepareMessage(s), { ok: false, error: 'bulk_limit' });
  assert.equal(s.did.length, 2);
});

test('a send that would pass the month\'s SMS limit is refused in the preview, and nothing is stored', async () => {
  const s = setup({ delivery: fakeDelivery({ limit: 500, used: 500 }) });
  assert.deepEqual(await prepareMessage(s), { ok: false, error: 'sms_limit', needed: 1, remaining: 0 });
  assert.equal(s.store.rows.size, 0);
});

test('if the records changed since the preview, the card becomes a new preview instead of running', async () => {
  const s = setup();
  const r = await s.actions.prepare({ kind: 'remind_unpaid', args: {}, scope: s.scope, channel: 'owner-telegram' });
  assert.match(r.card.text, /Tenants: 2/);
  s.d.invoices.find(i => i.id === 'i3').status = 'PAID';       // unit 102 paid while the owner was reading
  const pressed = await s.actions.press({ id: r.id, verb: 'confirm', actor: TG });
  assert.equal(pressed.status, 'replaced');
  assert.deepEqual(s.did, [], 'nothing was sent');
  assert.equal(s.store.rows.get(r.id).status, 'replaced');
  assert.notEqual(pressed.id, r.id);
  assert.equal(s.store.rows.get(pressed.id).status, 'pending');
  assert.match(pressed.card.text, /🔄/);
  assert.match(pressed.card.text, /Tenants: 1/);
  assert.deepEqual(pressed.edits.map(e => [e.id, e.buttons.map(b => b.verb)]), [[pressed.id, ['confirm', 'cancel']]],
    'the card now carries the new preview and its buttons');
  assert.equal((await s.actions.press({ id: pressed.id, verb: 'confirm', actor: TG })).status, 'done');
  assert.deepEqual(s.did, [['invoiceLink', 'i2'], ['sendBatch', 'reminder', 1, 'A1']]);
});

test('a reminder gets its real short link only when the send runs', async () => {
  const s = setup();
  const r = await s.actions.prepare({ kind: 'remind_unpaid', args: { units: '102' }, scope: s.scope, channel: 'owner-telegram' });
  assert.match(r.card.text, /bina\.et\/i\/XXXXXXXXXXXX/);
  assert.deepEqual(s.did, []);
  await s.actions.press({ id: r.id, verb: 'confirm', actor: TG });
  assert.deepEqual(s.did.map(x => x[0]), ['invoiceLink', 'sendBatch']);
});

test('sending invoices, creating a month\'s invoices and recording a payment run the dashboard\'s own code', async () => {
  const s = setup();
  const inv = await s.actions.prepare({ kind: 'send_invoice', args: { units: '101,102' }, scope: s.scope, channel: 'owner-telegram' });
  assert.match(inv.card.text, /• 101 — Demo Shop One \(አማርኛ\) — RENT 10,000 ETB — 2026-09-05/);
  assert.equal((await s.actions.press({ id: inv.id, verb: 'confirm', actor: TG })).status, 'done');
  assert.deepEqual(s.did, [['sendInvoice', 'i1', 'A1'], ['sendInvoice', 'i3', 'A1']]);

  const gen = await s.actions.prepare({ kind: 'create_invoices', args: { month: '2026-10' }, scope: s.scope, channel: 'owner-telegram' });
  assert.match(gen.card.text, /To create: 3/);
  assert.match(gen.card.text, /ማዘጋጀት መላክ አይደለም/);
  const genDone = await s.actions.press({ id: gen.id, verb: 'confirm', actor: TG });
  assert.match(genDone.card.text, /1 invoices created \(2 already existed\)/);
  assert.deepEqual(s.did[2], ['generateInvoices', 'b1', '2026-10']);

  const pay = await s.actions.prepare({ kind: 'record_payment', args: { unit: '101', amount: 10500, method: 'telebirr' }, scope: s.scope, channel: 'owner-telegram' });
  assert.match(pay.card.text, /OVERDUE → PAID · በ · via TELEBIRR/);
  assert.match(pay.card.text, /ደረሰኝ · Receipt: ቴሌግራም · Telegram 1/);
  const paid = await s.actions.press({ id: pay.id, verb: 'confirm', actor: TG });
  assert.equal(paid.status, 'done');
  assert.deepEqual(s.did[3], ['markPaid', 'i2', 'TELEBIRR', 'A1']);
  assert.match(paid.card.text, /✅ ክፍያ ተመዝግቧል · Payment recorded — 101 · 10,500 ETB · PAID/);
  assert.match(paid.card.text, /receipt sent by telegram/);
  assert.equal(s.audits.filter(x => x.action === 'OWNER_ACTION_DONE').length, 3);
});

test('the dashboard chat prepares and confirms in its own channel, as the building\'s key', async () => {
  const s = setup();
  const web = Object.assign({}, s.scope, { roles: {}, accessIds: {}, telegramId: null });
  const r = await s.actions.prepare({ kind: 'message', args: { target: 'units', units: '101', text: 'ይለፉ' }, scope: web, channel: 'owner-web' });
  assert.equal(s.store.rows.get(r.id).preparedBy, 'dashboard');
  assert.equal((await s.actions.press({ id: r.id, verb: 'confirm', actor: TG })).status, 'not_allowed', 'a Telegram press cannot confirm a dashboard preview');
  const done = await s.actions.press({ id: r.id, verb: 'confirm', actor: WEB });
  assert.equal(done.status, 'done');
  assert.deepEqual(done.edits, [], 'the dashboard shows the result in its own answer, not by editing a Telegram card');
  assert.equal(s.audits.find(a => a.action === 'OWNER_ACTION_CONFIRMED').actor, 'dashboard');
  assert.equal((await s.actions.press({ id: r.id, verb: 'cancel', actor: { channel: 'owner-web', buildingId: 'b2' } })).status, 'not_allowed');
});

test('the Telegram card is remembered so every copy of it is edited with the result', async () => {
  const s = setup();
  const r = await prepareMessage(s);
  await s.actions.attachCard(r.id, '77', 42);
  await s.actions.attachCard(r.id, '78', 43);
  const done = await s.actions.press({ id: r.id, verb: 'confirm', actor: TG });
  assert.deepEqual(done.edits.map(e => [e.chatId, e.messageId]), [['77', 42], ['78', 43], ['77', 9]]);
  for (const e of done.edits) assert.deepEqual(e.buttons, []);
});

test('an action for a building that is not the owner\'s, and a name that matches two of them', async () => {
  const s = setup();
  assert.deepEqual(await s.actions.prepare({ kind: 'message', args: { target: 'all', text: 'x', building: 'Other Plaza' }, scope: s.scope, channel: 'owner-telegram' }),
    { ok: false, error: 'no_building' });
  const two = Object.assign({}, s.scope, { buildingIds: ['b1', 'b2'] });
  assert.deepEqual(await s.actions.prepare({ kind: 'message', args: { target: 'all', text: 'x', building: 'Demo' }, scope: two, channel: 'owner-telegram' }),
    { ok: false, error: 'which_building' });
});

test('a failure while sending is recorded as failed, and says nothing about what arrived', async () => {
  const s = setup({ sendThrows: true });
  const r = await prepareMessage(s);
  const failed = await s.actions.press({ id: r.id, verb: 'confirm', actor: TG });
  assert.equal(failed.status, 'failed');
  assert.match(failed.card.text, /❌ አልተሳካም/);
  assert.equal(s.store.rows.get(r.id).status, 'failed');
  assert.equal(s.audits.filter(a => a.action === 'OWNER_ACTION_FAILED').length, 1);
});

test('a preview that no longer exists, a made-up id and an unknown button are refused quietly', async () => {
  const s = setup();
  for (const id of ['x', 'A'.repeat(22), '../../etc/passwd']) {
    const r = await s.actions.press({ id, verb: 'confirm', actor: TG });
    assert.equal(r.status, 'gone');
    assert.deepEqual(r.edits, []);
  }
  const p = await prepareMessage(s);
  assert.equal((await s.actions.press({ id: p.id, verb: 'delete', actor: TG })).status, 'gone');
  assert.deepEqual(s.did, []);
});

// ---- Three rules the Task 5 review asked to pin here, where prepare and press decide them ----

// Everything the fixture knows that must never reach the model or the stored row.
const PRIVATE = ['0900000001', '0900000002', '0900000009', 'Demo Tenant', 'Demo Shop One', 'Demo Shop Two', 'Demo Annex Shop'];

test('the model is told counts and units only: no name, no phone, no recipients, no view', async () => {
  const s = setup();
  const kinds = [
    ['message', { target: 'all', text: 'Water is off tomorrow' }],
    ['remind_unpaid', {}],
    ['send_invoice', { units: '101,102' }],
    ['create_invoices', { month: '2026-10' }],
    ['record_payment', { unit: '101', amount: 10500, method: 'cash' }],
  ];
  for (const [kind, args] of kinds) {
    const r = await s.actions.prepare({ kind, args, scope: s.scope, channel: 'owner-telegram' });
    assert.equal(r.ok, true, kind);
    assert.deepEqual(Object.keys(r.model).sort(), ['kind', 'note', 'prepared', 'recipients', 'units'], kind);
    assert.equal(typeof r.model.recipients, 'number', kind + ': recipients is a count, not the list');
    const model = JSON.stringify(r.model);
    // The row keeps what the confirm needs; the card text is rendered on the server and may name the occupant.
    const row = s.store.rows.get(r.id);
    const stored = JSON.stringify([row.args, row.payload, row.figures, row.text]);
    for (const secret of PRIVATE) {
      assert.equal(model.includes(secret), false, kind + ' · model carried ' + secret);
      assert.equal(stored.includes(secret), false, kind + ' · the row stored ' + secret);
    }
    await s.actions.press({ id: r.id, verb: 'cancel', actor: TG });
  }
  assert.deepEqual(s.did, [], 'nothing ran while we were only preparing');
  // The same figures, on the card the server renders, do carry the occupant's real name.
  const inv = await s.actions.prepare({ kind: 'send_invoice', args: { units: '101' }, scope: s.scope, channel: 'owner-telegram' });
  assert.match(inv.card.text, /Demo Shop One/);
});

test('the reminder that goes out carries the real short link, never the placeholder', async () => {
  const s = setup();
  const r = await s.actions.prepare({ kind: 'remind_unpaid', args: { units: '102' }, scope: s.scope, channel: 'owner-telegram' });
  assert.match(r.card.text, /bina\.et\/i\/XXXXXXXXXXXX/, 'the preview counts SMS parts with a sample link');
  assert.equal((await s.actions.press({ id: r.id, verb: 'confirm', actor: TG })).status, 'done');
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].recipients.length, 1, 'there is a reminder to look at');
  for (const x of s.sent[0].recipients) {
    assert.equal(x.text.includes(LINK_SAMPLE), false, 'the placeholder never leaves the server');
    assert.equal(x.smsText.includes(LINK_SAMPLE), false);
    assert.ok(x.text.includes('bina.et/i/RealToken12'));
    assert.ok(x.smsText.includes('bina.et/i/RealToken12'));
    assert.ok('phone' in x && 'telegramChatId' in x, 'the delivery layer is given the contact details');
  }
});

test('two presses that arrive together run it once: the claim is the single use', async () => {
  const s = setup();
  const { id } = await prepareMessage(s);
  const both = await Promise.all([
    s.actions.press({ id, verb: 'confirm', actor: TG }),
    s.actions.press({ id, verb: 'confirm', actor: TG }),
  ]);
  assert.equal(both.filter(r => r.ok).length, 1, 'exactly one press ran it');
  assert.equal(s.did.filter(x => x[0] === 'sendBatch').length, 1, 'it was sent once');
  assert.equal(s.store.rows.get(id).status, 'done');
  assert.equal(s.audits.filter(a => a.action === 'OWNER_ACTION_CONFIRMED').length, 1);
});
