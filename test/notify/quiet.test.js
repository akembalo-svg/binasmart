'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeNotify } = require('../../notify/notify');

test('notifyQuiet: Telegram first, WhatsApp fallback, and never a copy to the admins', async () => {
  const tg = [], wa = [];
  const n = makeNotify({ sendTg: async (c, t) => { tg.push(c); return c === 'T1'; }, sendWa: async (p) => { wa.push(p); return true; }, adminChatIds: ['A1'] });
  assert.deepEqual(await n.notifyQuiet({ name: 'Tenant', phone: '+1', tgChatId: 'T1' }, 'rent due'), { ok: true, via: 'telegram' });
  assert.deepEqual(await n.notifyQuiet({ name: 'Tenant2', phone: '+2', tgChatId: 'dead' }, 'rent due'), { ok: true, via: 'whatsapp' });
  assert.ok(!tg.includes('A1'), 'admins must not receive tenant messages');
  assert.deepEqual(wa, ['+2']);
});

test('notifyQuiet: unreachable tenant is reported to the caller and logged, not hidden', async () => {
  const logs = [];
  const n = makeNotify({ sendTg: async () => false, sendWa: async () => false, adminChatIds: [], log: m => logs.push(m) });
  assert.deepEqual(await n.notifyQuiet({ name: 'Ghost', phone: '+3' }, 'receipt'), { ok: false, via: null });
  assert.match(logs[0], /unreachable Ghost/);
});
