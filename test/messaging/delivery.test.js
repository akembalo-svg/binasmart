'use strict';
// One road for every tenant message, over an in-memory store, a fake Telegram and a recording SMS provider.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDelivery, addisMonthStart, isRealMiss } = require('../../messaging/delivery');
const { makeSms, geezSupports, smsParts } = require('../../messaging/sms');

const NOW = new Date('2026-10-10T09:00:00Z');
function memStore() {
  const s = { batches: [], messages: [], seq: 0 };
  return {
    s,
    createBatch: async d => { const b = { id: 'B' + (++s.seq), ...d }; s.batches.push(b); return { id: b.id }; },
    createMessage: async d => { const m = { id: 'M' + (++s.seq), createdAt: NOW, smsParts: 0, providerId: null, errorKind: null, ...d }; s.messages.push(m); return { id: m.id }; },
    updateMessage: async (id, d) => { Object.assign(s.messages.find(m => m.id === id), d); return { id }; },
    smsPartsSinceAll: async (since, statuses) => s.messages.filter(m => m.channel === 'sms' && statuses.includes(m.status) && m.createdAt >= since).reduce((a, m) => a + (m.smsParts || 0), 0),
    smsPartsSince: async (b, since, statuses) => s.messages.filter(m => m.buildingId === b && m.channel === 'sms' && statuses.includes(m.status) && m.createdAt >= since).reduce((a, m) => a + (m.smsParts || 0), 0),
    userHadSms: async (u, statuses) => s.messages.some(m => m.userId === u && m.channel === 'sms' && statuses.includes(m.status)),
    markByProvider: async (ids, status) => { let n = 0; for (const m of s.messages) if (ids.includes(m.providerId) && m.channel === 'sms' && ['queued', 'sent'].includes(m.status)) { m.status = status; n++; } return n; },
  };
}
function recorder({ ok = true } = {}) {
  const calls = [];
  return { calls, name: 'fake', supports: geezSupports, send: async a => { calls.push(a); return ok ? { ok: true, providerId: 'P' + calls.length } : { ok: false, error: 'no' }; } };
}
function setup({ mode = 'test', tgOk = true } = {}) {
  const store = memStore(), tg = [], provider = recorder();
  const d = makeDelivery({ store, now: () => NOW, sms: makeSms({ mode, provider, supports: geezSupports }),
    sendTg: async (chat, text) => { tg.push({ chat, text }); return tgOk; } });
  return { store, tg, provider, d };
}
const REAL = { id: 'b1', slug: 'darulle', real: true, smsLabel: 'BinaSmart · Darulle', smsMonthlyLimit: 100, smsSender: '' };
const DEMO = { id: 'b2', slug: 'century-mall', real: false, smsLabel: 'BinaSmart · Demo', smsMonthlyLimit: 100, smsSender: '' };
const FIRST = 'BinaSmart · Darulle፦ short text\nTelegram: t.me/bina_smart_bot?start=tenant_darulle';   // a tenant's first SMS
const rcpt = (o = {}) => ({ tenancyId: 't1', userId: 'u1', telegramChatId: null, phone: '0900000001', text: 'full text', smsText: 'short text', ...o });
const send = (d, building, recipients, extra = {}) => d.sendToTenants({ building, kind: 'invoice', source: 'dashboard-send', actor: 'dashboard', recipients, ...extra });

test('a tenant who linked Telegram gets the full text by Telegram, and nothing by SMS', async () => {
  const { store, tg, provider, d } = setup();
  const r = await send(d, REAL, [rcpt({ telegramChatId: '4242' })]);
  assert.equal(r.ok, true);
  assert.deepEqual(tg, [{ chat: '4242', text: 'full text' }]);
  assert.equal(provider.calls.length, 0);
  assert.deepEqual(r.results.map(x => [x.channel, x.status]), [['telegram', 'sent']]);
  assert.deepEqual(store.s.messages.map(m => [m.channel, m.status, m.kind, m.invoiceId]), [['telegram', 'sent', 'invoice', null]]);
  assert.deepEqual(r.counts, { telegram: 1, sms: 0, none: 0, sent: 1, test: 0, failed: 0 });
});

test('without Telegram, a mobile gets SMS — recorded as test while SMS is in test mode', async () => {
  const { store, tg, provider, d } = setup();
  const r = await send(d, REAL, [rcpt()]);
  assert.deepEqual(r.results.map(x => [x.channel, x.status]), [['sms', 'test']]);
  assert.equal(tg.length, 0);
  assert.equal(provider.calls.length, 0);
  assert.equal(store.s.messages[0].smsParts, smsParts(FIRST));
  assert.equal(smsParts(FIRST), 2, 'label and Telegram link make the first SMS two Unicode parts');
});

test('no Telegram and no reachable mobile: recorded as not delivered, with the reason', async () => {
  const { d } = setup();
  const r = await send(d, REAL, [rcpt({ tenancyId: 'a', phone: '0700000001' }), rcpt({ tenancyId: 'b', phone: '0111234567' }), rcpt({ tenancyId: 'c', phone: null })]);
  assert.deepEqual(r.results.map(x => [x.tenancyId, x.channel, x.status, x.errorKind]),
    [['a', 'none', 'failed', 'sms_unsupported_number'], ['b', 'none', 'failed', 'no_mobile'], ['c', 'none', 'failed', 'no_contact']]);
  assert.equal(r.ok, false);
});

test('a demo building reaches nobody: Telegram and SMS are both recorded as test, even with SMS live', async () => {
  const { tg, provider, d } = setup({ mode: 'live' });
  const r = await send(d, DEMO, [rcpt({ tenancyId: 'a', telegramChatId: '1' }), rcpt({ tenancyId: 'b', userId: 'u2' })]);
  assert.deepEqual(r.results.map(x => [x.channel, x.status]), [['telegram', 'test'], ['sms', 'test']]);
  assert.equal(tg.length, 0);
  assert.equal(provider.calls.length, 0);
});

test('a batch that needs more SMS parts than the month has left is refused whole: nothing is sent', async () => {
  const { store, tg, provider, d } = setup({ mode: 'live' });
  const r = await send(d, { ...REAL, smsMonthlyLimit: 1 }, [rcpt({ tenancyId: 'a', telegramChatId: '1' }), rcpt({ tenancyId: 'b', userId: 'u2' }), rcpt({ tenancyId: 'c', userId: 'u3', phone: '0900000003' })]);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'sms_limit');
  assert.deepEqual([r.needed, r.remaining], [4, 1]);
  assert.equal(tg.length + provider.calls.length, 0);
  assert.deepEqual(store.s.messages.map(m => [m.channel, m.status, m.errorKind]), [['none', 'failed', 'sms_limit'], ['none', 'failed', 'sms_limit'], ['none', 'failed', 'sms_limit']]);
  const zero = await send(d, { ...REAL, smsMonthlyLimit: 0 }, [rcpt({ userId: 'u9' })]);
  assert.equal(zero.error, 'sms_limit', 'a building without a limit sends no SMS');
});

test('this month’s usage counts from midnight Addis time; test rows never count against the limit, in any mode', async () => {
  assert.equal(addisMonthStart(NOW).toISOString(), '2026-09-30T21:00:00.000Z');
  for (const mode of ['test', 'live']) {
    const t = setup({ mode });
    t.store.s.messages.push({ id: 'old', buildingId: 'b1', channel: 'sms', status: 'sent', smsParts: 5, createdAt: new Date('2026-09-30T20:59:00Z') });
    t.store.s.messages.push({ id: 'new', buildingId: 'b1', channel: 'sms', status: 'sent', smsParts: 5, createdAt: new Date('2026-09-30T21:00:00Z') });
    t.store.s.messages.push({ id: 'tst', buildingId: 'b1', channel: 'sms', status: 'test', smsParts: 50, createdAt: NOW });
    const p = await t.d.plan({ building: { ...REAL, smsMonthlyLimit: 7 }, recipients: [rcpt()] });
    assert.deepEqual([p.used, p.remaining], [5, 2], mode + ': only the sent row of this month counts');
    assert.equal((await send(t.d, { ...REAL, smsMonthlyLimit: 7 }, [rcpt()])).ok, true, mode + ': 5 used of 7, a two-part first SMS fits');
    const second = await send(t.d, { ...REAL, smsMonthlyLimit: 7 }, [rcpt({ userId: 'u2' })]);
    if (mode === 'test') assert.equal(second.ok, true, 'test: the first send was a test row, so it used nothing');
    else assert.equal(second.error, 'sms_limit', 'live: the first send really went, 7 used of 7');
  }
});

test('the owner report counts a message as not delivered only when a real, live send failed', () => {
  const live = { real: true, mode: 'live' };
  assert.equal(isRealMiss(live, { status: 'failed', channel: 'none', errorKind: 'no_mobile' }), true);
  assert.equal(isRealMiss(live, { status: 'failed', channel: 'telegram', errorKind: 'tg_failed' }), true);
  assert.equal(isRealMiss(live, { status: 'failed', channel: 'none', errorKind: 'sms_limit' }), true);
  assert.equal(isRealMiss(live, null), true, 'the layer threw on a real send');
  for (const s of ['sent', 'delivered', 'test']) assert.equal(isRealMiss(live, { status: s }), false, s);
  for (const ctx of [{ real: true, mode: 'test' }, { real: false, mode: 'live' }, { real: false, mode: 'test' }, {}, null])
    for (const r of [{ status: 'failed', channel: 'none', errorKind: 'no_contact' }, { status: 'failed', channel: 'telegram', errorKind: 'tg_failed' }, { status: 'test' }, null])
      assert.equal(isRealMiss(ctx, r), false, JSON.stringify(ctx) + ' ' + JSON.stringify(r));
});

test('when Telegram refuses, the same message goes by SMS on the same row, and says Telegram failed', async () => {
  const { store, tg, provider, d } = setup({ mode: 'live', tgOk: false });
  const r = await send(d, REAL, [rcpt({ telegramChatId: '1' })]);
  assert.deepEqual(r.results.map(x => [x.channel, x.status, x.errorKind]), [['sms', 'sent', 'tg_failed']]);
  assert.equal(tg.length, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(store.s.messages.length, 1);
  const noPhone = await send(d, REAL, [rcpt({ telegramChatId: '1', phone: null })]);
  assert.deepEqual(noPhone.results.map(x => [x.channel, x.status, x.errorKind]), [['telegram', 'failed', 'tg_failed']]);
});

test('the first SMS a tenant receives ends with the Telegram start link; later ones do not', async () => {
  const { provider, d } = setup({ mode: 'live' });
  await send(d, REAL, [rcpt()]);
  await send(d, REAL, [rcpt()]);
  assert.equal(provider.calls[0].text, FIRST);
  assert.equal(provider.calls[1].text, 'BinaSmart · Darulle፦ short text');
});

test('one tenant with two units in a batch gets the Telegram link once, and only in a first-ever SMS', async () => {
  const BASE = FIRST.split('\n')[0];
  const { provider, d } = setup({ mode: 'live' });
  const two = [rcpt({ tenancyId: 'a' }), rcpt({ tenancyId: 'b' })];
  assert.equal((await d.plan({ building: REAL, recipients: two })).smsParts, smsParts(FIRST) + smsParts(BASE));
  await send(d, REAL, two);
  await send(d, REAL, two);
  assert.deepEqual(provider.calls.map(c => c.text), [FIRST, BASE, BASE, BASE]);
  const f = setup({ mode: 'live', tgOk: false });
  await send(f.d, REAL, [rcpt({ tenancyId: 'a', telegramChatId: '1' }), rcpt({ tenancyId: 'b' })]);
  assert.equal(f.provider.calls.length, 2);
  assert.equal(f.provider.calls.filter(c => c.text === FIRST).length, 1, 'a Telegram fallback does not repeat the link');
});

test('a record never stays queued after an error: Telegram refused with no SMS label, or a failed store write', async () => {
  const { store, provider, d } = setup({ mode: 'live', tgOk: false });
  const r = await send(d, { ...REAL, smsLabel: '' }, [rcpt({ telegramChatId: '1' })]);
  assert.deepEqual(r.results.map(x => [x.channel, x.status, x.errorKind]), [['telegram', 'failed', 'error']]);
  assert.equal(r.results[0].messageId, store.s.messages[0].id);
  assert.deepEqual(store.s.messages.map(m => [m.channel, m.status, m.errorKind]), [['telegram', 'failed', 'error']]);
  assert.equal(provider.calls.length, 0);
  const t = setup({ mode: 'live' });
  const update = t.store.updateMessage;
  let n = 0;
  t.store.updateMessage = async (id, data) => { if (++n === 1) throw new Error('store down'); return update(id, data); };
  const r2 = await send(t.d, REAL, [rcpt()]);
  assert.deepEqual(r2.results.map(x => [x.status, x.errorKind]), [['failed', 'error']]);
  assert.deepEqual(t.store.s.messages.map(m => [m.status, m.errorKind]), [['failed', 'error']]);
});

test('an SMS cannot be planned without a label; a Telegram-only send does not need one', async () => {
  const { d } = setup();
  await assert.rejects(send(d, { ...REAL, smsLabel: '' }, [rcpt()]), /label/);
  assert.equal((await send(d, { ...REAL, smsLabel: '' }, [rcpt({ telegramChatId: '1' })])).ok, true);
});

test('SMS live on a real building: the provider is called with the building’s sender, and its id is kept', async () => {
  const { store, provider, d } = setup({ mode: 'live' });
  const r = await send(d, { ...REAL, smsSender: 'DemoSender' }, [rcpt({ invoiceId: 'inv1' })]);
  assert.deepEqual(r.results.map(x => [x.channel, x.status]), [['sms', 'sent']]);
  assert.deepEqual([provider.calls[0].to, provider.calls[0].sender], ['+251900000001', 'DemoSender']);
  assert.deepEqual([store.s.messages[0].providerId, store.s.messages[0].invoiceId, store.s.messages[0].status], ['P1', 'inv1', 'sent']);
});

test('a notice keeps its text once on the batch; nothing stored carries a phone number', async () => {
  const { store, d } = setup();
  await d.sendToTenants({ building: REAL, kind: 'notice', source: 'owner-action', actor: 'access-1', text: 'ነገ ውሃ ይቋረጣል', recipients: [rcpt(), rcpt({ tenancyId: 't2', userId: 'u2', telegramChatId: '9' })] });
  await send(d, REAL, [rcpt()]);
  assert.deepEqual(store.s.batches.map(b => [b.kind, b.text, b.total, b.actor]), [['notice', 'ነገ ውሃ ይቋረጣል', 2, 'access-1'], ['invoice', null, 1, 'dashboard']]);
  assert.doesNotMatch(JSON.stringify(store.s), /900000001/);
});

test('plan() previews channels, parts and the limit without writing anything', async () => {
  const { store, d } = setup();
  const p = await d.plan({ building: { ...REAL, smsMonthlyLimit: 3 }, recipients: [rcpt({ telegramChatId: '1' }), rcpt({ userId: 'u2' }), rcpt({ phone: null })] });
  assert.deepEqual(p.counts, { telegram: 1, sms: 1, none: 1 });
  assert.deepEqual([p.smsParts, p.used, p.limit, p.remaining, p.withinLimit, p.mode], [2, 0, 3, 3, true, 'test']);
  assert.deepEqual([p.unitPriceEtb, p.costEtb], [0.7475, Math.round(2 * 0.7475 * 100) / 100]);
  assert.equal(store.s.batches.length + store.s.messages.length, 0);
});

test('transactional SMS (sign-in codes): no building, the code is never stored, test until live', async () => {
  const t = setup();
  await assert.rejects(t.d.sendTransactionalSms({ to: '0900000001', text: 'code 123456' }), /label/);
  const r = await t.d.sendTransactionalSms({ to: '0900000001', text: 'code 123456', label: 'BinaSmart', kind: 'otp' });
  assert.deepEqual([r.status, r.channel], ['test', 'sms']);
  assert.deepEqual(t.store.s.batches.map(b => [b.buildingId, b.kind, b.source, b.text]), [[null, 'otp', 'transactional', null]]);
  assert.doesNotMatch(JSON.stringify(t.store.s), /123456|900000001/);
  const live = setup({ mode: 'live' });
  assert.equal((await live.d.sendTransactionalSms({ to: '0900000001', text: 'code 1', label: 'BinaSmart' })).status, 'sent');
  assert.deepEqual([live.provider.calls.length, live.provider.calls[0].text], [1, 'BinaSmart፦ code 1']);
  assert.deepEqual(await live.d.sendTransactionalSms({ to: '0700000001', text: 'code 2', label: 'BinaSmart' }), { status: 'failed', channel: 'none', errorKind: 'sms_unsupported_number', messageId: live.store.s.messages[1].id });
});

test('transactional SMS: a record write that fails after the send neither throws nor hides that the SMS went', async () => {
  const store = memStore(), provider = recorder(), logs = [];
  store.updateMessage = async () => { const e = new Error('store down for +251900000001'); e.code = 'P1001'; throw e; };
  const d = makeDelivery({ store, now: () => NOW, sms: makeSms({ mode: 'live', provider, supports: geezSupports }),
    sendTg: async () => true, log: line => logs.push(line) });
  const r = await d.sendTransactionalSms({ to: '0900000001', text: 'code 1', label: 'BinaSmart' });
  assert.deepEqual([r.status, r.channel, provider.calls.length], ['sent', 'sms', 1], 'a caller that saw a throw would send a second code');
  assert.equal(store.s.messages[0].status, 'queued', 'the row stays queued, which counts as an SMS that may have gone');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /P1001/);
  assert.doesNotMatch(logs.join(' '), /store down|900000001/);
});

test('an unexpected store error is logged by its kind only: no message text, no phone digits', async () => {
  const store = memStore(), logs = [];
  store.createMessage = async () => { const e = new Error('boom for +251900000001'); e.code = 'P2002'; throw e; };
  const d = makeDelivery({ store, now: () => NOW, sms: makeSms({ mode: 'test', provider: recorder(), supports: geezSupports }),
    sendTg: async () => true, log: line => logs.push(line) });
  const r = await send(d, REAL, [rcpt({ telegramChatId: '1' })]);
  assert.deepEqual(r.results.map(x => [x.channel, x.status, x.errorKind]), [['telegram', 'failed', 'error']]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /P2002/);
  assert.doesNotMatch(logs.join(' '), /boom|900000001/);
});

test('delivery reports move a sent SMS to delivered or failed by provider id; the logged shape has no values', async () => {
  const { store, d } = setup({ mode: 'live' });
  await send(d, REAL, [rcpt(), rcpt({ tenancyId: 't2', userId: 'u2' })]);
  assert.equal(await d.applyDeliveryReport({ api_log_id: 'P1', status: 'DELIVERED' }), 1);
  assert.equal(await d.applyDeliveryReport({ log: 'P1', status: 'undelivered' }), 0, 'a delivered row is not moved back');
  assert.equal(await d.applyDeliveryReport({ log: 'P2', delivery_status: 'Undelivered' }), 1);
  assert.equal(await d.applyDeliveryReport({ foo: 1 }), 0);
  assert.equal(await d.applyDeliveryReport({ api_log_id: 'P1', message_status: 'success' }), 0);
  assert.deepEqual(store.s.messages.map(m => m.status), ['delivered', 'failed']);
  assert.equal(d.reportShape({ api_log_id: 6569829, phone: '251900000001', status: 'x', list: [] }), 'api_log_id:number,phone:string,status:string,list:array');
});
