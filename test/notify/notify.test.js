'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeNotify } = require('../../notify/notify');

function harness({ tgOk = true, waOk = true, admin = 'ADMIN' } = {}) {
  const tg = [], wa = [];
  const n = makeNotify({
    sendTg: async (chat, text) => { tg.push({ chat, text }); return tgOk; },
    sendWa: async (phone, text, ch) => { wa.push({ phone, text, ch }); return waOk; },
    adminChatId: admin,
  });
  return { tg, wa, n };
}
const SHOP = { id: 'shop1', name: 'Hanud', phone: '+251910921274', tgChatId: '555' };

test('a linked shop is told on Telegram, WhatsApp is not touched, admin gets a ✅ copy', async () => {
  const { tg, wa, n } = harness();
  const r = await n.notifyShop(SHOP, 'NEW FLIGHT REQUEST');
  assert.deepEqual(r, { ok: true, via: 'telegram' });
  assert.equal(wa.length, 0);
  assert.equal(tg[0].chat, '555');
  assert.equal(tg[1].chat, 'ADMIN');
  assert.match(tg[1].text, /^✅ Hanud — notified via telegram/);
  assert.match(tg[1].text, /NEW FLIGHT REQUEST/);
});

test('no Telegram link → WhatsApp, and the admin copy says so', async () => {
  const { tg, wa, n } = harness();
  const r = await n.notifyShop({ ...SHOP, tgChatId: null }, 'NEW ORDER', 'darulle');
  assert.deepEqual(r, { ok: true, via: 'whatsapp' });
  assert.equal(wa[0].phone, SHOP.phone); assert.equal(wa[0].ch, 'darulle');
  assert.equal(tg.length, 1); assert.match(tg[0].text, /via whatsapp/);
});

test('Telegram failing falls through to WhatsApp instead of giving up', async () => {
  const { tg, wa, n } = harness({ tgOk: false, waOk: true });
  // sendTg returns false for everything here, so even the admin copy "fails" — that must not throw
  const r = await n.notifyShop(SHOP, 'X');
  assert.equal(r.via, 'whatsapp');
  assert.equal(wa.length, 1);
});

test('both channels dead → ok:false and the admin is warned with the link command', async () => {
  const { tg, wa, n } = harness({ tgOk: false, waOk: false });
  const seen = [];
  const n2 = makeNotify({ sendTg: async (c, t) => { seen.push({ c, t }); return c === 'ADMIN'; }, sendWa: async () => false, adminChatId: 'ADMIN' });
  const r = await n2.notifyShop(SHOP, 'NEW ORDER OD-1');
  assert.deepEqual(r, { ok: false, via: null });
  const adminMsg = seen.find(x => x.c === 'ADMIN');
  assert.match(adminMsg.t, /⚠️ COULD NOT REACH Hanud/);
  assert.match(adminMsg.t, /\/start shop_shop1/);
  assert.match(adminMsg.t, /NEW ORDER OD-1/);
  void tg; void wa;
});

test('a sender that throws is treated as a failure, not a crash', async () => {
  const n = makeNotify({ sendTg: async () => { throw new Error('boom'); }, sendWa: async () => true, adminChatId: 'ADMIN' });
  const r = await n.notifyShop(SHOP, 'X');
  assert.equal(r.via, 'whatsapp');
});

test('no admin chat configured → no extra message, still delivers', async () => {
  const { tg, n } = harness({ admin: '' });
  await n.notifyShop(SHOP, 'X');
  assert.equal(tg.length, 1);
});
