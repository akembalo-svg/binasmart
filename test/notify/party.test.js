'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeNotify } = require('../../notify/notify');

function harness(opts = {}) {
  const tg = [], wa = [];
  const n = makeNotify(Object.assign({
    sendTg: async (chat, text) => { tg.push({ chat, text }); return opts.tgOk !== false; },
    sendWa: async (phone, text, ch) => { wa.push({ phone, text, ch }); return opts.waOk !== false; },
  }, opts.cfg || { adminChatIds: ['A1', 'A2'] }));
  return { tg, wa, n };
}

test('several admin chats: each gets the copy once, blanks and duplicates dropped', async () => {
  const { tg, n } = harness({ cfg: { adminChatId: 'A1', adminChatIds: ['A1', '', ' A2 ', null] } });
  assert.deepEqual(n.admins, ['A1', 'A2']);
  await n.notifyParty({ name: 'Owner', phone: '+2519', tgChatId: 'O' }, 'MAINT');
  assert.deepEqual(tg.map(x => x.chat), ['O', 'A1', 'A2']);
});

test('notifyAdmins sends only to admins and reports the count that took it', async () => {
  const seen = [];
  const n = makeNotify({ sendTg: async (c, t) => { seen.push(c); return c === 'A1'; }, sendWa: async () => true, adminChatIds: ['A1', 'A2'] });
  const count = await n.notifyAdmins('NEW LEAD');
  assert.equal(count, 1);
  assert.deepEqual(seen, ['A1', 'A2']);
});

test('a party with no Telegram and no phone still reaches the admins as a warning', async () => {
  const { tg, wa, n } = harness();
  const r = await n.notifyParty({ name: 'Tech' }, 'FIX LIFT', null, 'add a phone in staff');
  assert.deepEqual(r, { ok: false, via: null });
  assert.equal(wa.length, 0);
  assert.match(tg[0].text, /⚠️ COULD NOT REACH Tech \(no phone\) — add a phone in staff/);
});

test('notifyShop is notifyParty with the dashboard link command as the hint', async () => {
  const { tg, n } = harness({ tgOk: false, waOk: false });
  const seen = [];
  const n2 = makeNotify({ sendTg: async (c, t) => { seen.push(t); return c.startsWith('A'); }, sendWa: async () => false, adminChatIds: ['A1'] });
  await n2.notifyShop({ id: 's9', name: 'Hanud', phone: '+1' }, 'REQ');
  assert.match(seen.at(-1), /\/start shop_s9/);
  void tg; void n;
});
