'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeRiderNotify } = require('../ride/riderNotify');

function fakes(ride) {
  const sent = [];
  const api = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: 1 }; } };
  const prisma = { ride: { findUnique: async () => ride } };
  return { sent, notify: makeRiderNotify({ prisma, api, baseUrl: 'https://bina.et' }).notify };
}
const base = { id: 'r1', status: 'assigned', fareEtb: 295, pickup: { label: 'Edna Mall' }, rider: { telegramId: '42' }, bookedBy: null,
  driver: { name: 'Abel', phone: '+251900000000', plate: 'A12345', vehicleMake: 'Toyota Vitz', vehicleColour: 'white' } };

test('assigned → one message to the rider Telegram with driver, plate and an Open tracking web_app button', async () => {
  const { sent, notify } = fakes(base);
  assert.equal(await notify('r1', 'assigned'), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat, '42');
  assert.match(sent[0].text, /Abel/); assert.match(sent[0].text, /A12345/); assert.match(sent[0].text, /white Toyota Vitz/);
  assert.equal(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://bina.et/ride?id=r1');
});

test('booker Telegram wins over rider Telegram (booked for someone else)', async () => {
  const { sent, notify } = fakes({ ...base, bookedBy: { name: 'Ibrahim', telegramId: '99' } });
  await notify('r1', 'arrived');
  assert.equal(sent[0].chat, '99'); assert.match(sent[0].text, /arrived/i);
});

test('no Telegram id → no message; unknown event → no message; API failure → false, no throw', async () => {
  const a = fakes({ ...base, rider: { telegramId: null } }); assert.equal(await a.notify('r1', 'assigned'), false); assert.equal(a.sent.length, 0);
  const b = fakes(base); assert.equal(await b.notify('r1', 'teleported'), false);
  const c = makeRiderNotify({ prisma: { ride: { findUnique: async () => base } }, api: { sendMessage: async () => { throw new Error('boom'); } }, baseUrl: 'https://bina.et' });
  assert.equal(await c.notify('r1', 'completed'), false);
});

test('completed and cancelled texts', async () => {
  const a = fakes({ ...base, status: 'completed' }); await a.notify('r1', 'completed'); assert.match(a.sent[0].text, /295 ETB/); assert.match(a.sent[0].text, /rate/i);
  const b = fakes({ ...base, status: 'cancelled' }); await b.notify('r1', 'cancelled'); assert.match(b.sent[0].text, /cancelled/i);
});
