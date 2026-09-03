'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeRiderNotify } = require('../ride/riderNotify');

function fakes(ride, opts) {
  const sent = [], photos = [];
  const api = {
    sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: 1 }; },
    sendPhoto: async (chat, photo, caption, extra) => { if (opts && opts.photoFails) throw new Error('photo too big'); photos.push({ chat, photo, caption, extra }); return { message_id: 2 }; },
  };
  if (opts && opts.noPhotoSupport) delete api.sendPhoto;
  const prisma = { ride: { findUnique: async () => ride } };
  return { sent, photos, notify: makeRiderNotify({ prisma, api, baseUrl: 'https://bina.et' }).notify };
}
const base = { id: 'r1', status: 'assigned', fareEtb: 295, pickup: { label: 'Edna Mall' }, rider: { telegramId: '42' }, bookedBy: null,
  driver: { name: 'Abel', phone: '+251900000000', plate: 'A12345', vehicleMake: 'Toyota Vitz', vehicleColour: 'white', carPhotoUrl: '/api/ride/car/d1.jpg' } };

test('assigned → the car PHOTO with the details as caption and an Open tracking button', async () => {
  const { sent, photos, notify } = fakes(base);
  assert.equal(await notify('r1', 'assigned'), true);
  assert.equal(sent.length, 0, 'no plain message when the photo went out');
  assert.equal(photos.length, 1);
  assert.equal(photos[0].chat, '42');
  assert.equal(photos[0].photo, 'https://bina.et/api/ride/car/d1.jpg');
  assert.match(photos[0].caption, /Abel/); assert.match(photos[0].caption, /A12345/); assert.match(photos[0].caption, /white Toyota Vitz/);
  assert.match(photos[0].caption, /Match the plate/i);
  assert.equal(photos[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://bina.et/ride?id=r1');
});

test('no car photo on the driver → plain text message', async () => {
  const { sent, photos, notify } = fakes({ ...base, driver: { ...base.driver, carPhotoUrl: null } });
  await notify('r1', 'assigned');
  assert.equal(photos.length, 0); assert.equal(sent.length, 1);
  assert.match(sent[0].text, /A12345/);
});

test('photo send failure falls back to text; a client without sendPhoto also falls back', async () => {
  const a = fakes(base, { photoFails: true });
  assert.equal(await a.notify('r1', 'assigned'), true);
  assert.equal(a.sent.length, 1, 'fell back to text');
  const b = fakes(base, { noPhotoSupport: true });
  assert.equal(await b.notify('r1', 'assigned'), true);
  assert.equal(b.sent.length, 1);
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
