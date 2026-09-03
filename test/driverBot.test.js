'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { makeDriverBot } = require('../ride/driverBot');

function fakeApi() {
  const sent = [];
  return { sent,
    sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; },
    answerCallbackQuery: async () => true,
    getFile: async () => ({ file_path: 'photos/x.jpg' }),
    downloadFile: async () => Buffer.from([0xff, 0xd8, 0xff]) };
}
function fakePrisma() {
  const drivers = [];
  return { drivers, driver: {
    findUnique: async ({ where }) => drivers.find(d => d.phone === where.phone) || null,
    create: async ({ data }) => { const d = { id: 'd' + (drivers.length + 1), rating: 5, ridesCount: 0, ...data }; drivers.push(d); return d; },
    update: async ({ where, data }) => { const d = drivers.find(x => x.id === where.id); Object.assign(d, data); return d; } } };
}
function bot() {
  const api = fakeApi(), prisma = fakePrisma(), notes = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'));
  const b = makeDriverBot({ prisma, api, telegram: { ownerNote: async t => { notes.push(t); return true; } }, uploadsDir: dir, baseUrl: 'https://bina.et' });
  return { api, prisma, notes, dir, b };
}
const msg = (text, extra) => ({ message: Object.assign({ chat: { id: 555 }, text }, extra || {}) });

test('happy path: /start → name → contact → tier button → vehicle → plate → photo → pending driver + owner alert', async () => {
  const { api, prisma, notes, dir, b } = bot();
  await b.handleUpdate(msg('/start'));
  assert.match(api.sent.at(-1).text, /0% commission/i);
  await b.handleUpdate(msg('Abel Tesfaye'));
  assert.equal(api.sent.at(-1).extra.reply_markup.keyboard[0][0].request_contact, true, 'asks to share phone');
  await b.handleUpdate(msg(undefined, { contact: { phone_number: '251911244344', user_id: 555 } }));
  const tiers = api.sent.at(-1).extra.reply_markup.inline_keyboard.flat().map(x => x.callback_data);
  assert.deepEqual(tiers, ['tier:moto', 'tier:bajaj', 'tier:economy', 'tier:comfort', 'tier:xl']);
  await b.handleUpdate({ callback_query: { id: 'cq1', data: 'tier:economy', message: { chat: { id: 555 } } } });
  assert.match(api.sent.at(-1).text, /make and colour/i);
  await b.handleUpdate(msg('Toyota Vitz white'));
  assert.match(api.sent.at(-1).text, /plate/i);
  await b.handleUpdate(msg('A12345'));
  assert.match(api.sent.at(-1).text, /photo/i);
  await b.handleUpdate(msg(undefined, { photo: [{ file_id: 'small' }, { file_id: 'big' }] }));
  assert.equal(prisma.drivers.length, 1);
  const d = prisma.drivers[0];
  assert.equal(d.status, 'pending'); assert.equal(d.phone, '+251911244344'); assert.equal(d.tier, 'economy'); assert.equal(d.plate, 'A12345'); assert.equal(d.telegramId, '555');
  assert.equal(d.licenceUrl, '/api/ride/ops/driver-doc/d1');
  assert.ok(fs.existsSync(path.join(dir, 'd1.jpg')));
  assert.match(api.sent.at(-1).text, /24 hours/);
  assert.equal(notes.length, 1); assert.match(notes[0], /Abel Tesfaye/); assert.match(notes[0], /A12345/);
});

test('wrong input re-asks the current step; duplicate phone ends politely; the next message starts a fresh registration', async () => {
  const { api, prisma, b } = bot();
  prisma.drivers.push({ id: 'd0', phone: '+251911244344', status: 'approved' });
  await b.handleUpdate(msg('/start'));
  await b.handleUpdate(msg('A'));
  assert.match(api.sent.at(-1).text, /name/i);
  await b.handleUpdate(msg('Abel'));
  await b.handleUpdate(msg('hello'));
  assert.match(api.sent.at(-1).text, /Ethiopian number|phone/i);
  await b.handleUpdate(msg('0911244344'));
  assert.match(api.sent.at(-1).text, /already registered/i);
  await b.handleUpdate(msg('Another Driver'));   // fresh session: taken as the name → asks for the phone
  assert.match(api.sent.at(-1).text, /phone/i);
  assert.equal(b._sessions.get('555').step, 'phone');
});

test('licence step: sending text instead of a photo is refused and no driver is created', async () => {
  const { api, prisma, b } = bot();
  await b.handleUpdate(msg('/start')); await b.handleUpdate(msg('Abel'));
  await b.handleUpdate(msg(undefined, { contact: { phone_number: '0911244344' } }));
  await b.handleUpdate({ callback_query: { id: 'c', data: 'tier:moto', message: { chat: { id: 555 } } } });
  await b.handleUpdate(msg('Bajaj blue')); await b.handleUpdate(msg('B1'));
  assert.match(api.sent.at(-1).text, /plate/i);
  await b.handleUpdate(msg('B12345'));
  await b.handleUpdate(msg('here is my licence'));
  assert.match(api.sent.at(-1).text, /photo/i);
  assert.equal(prisma.drivers.length, 0);
});

test('notifyStatus messages the driver on approval, nothing without telegramId', async () => {
  const { api, b } = bot();
  assert.equal(await b.notifyStatus({ id: 'd1', telegramId: '555' }, 'approved'), true);
  assert.match(api.sent.at(-1).text, /Approved/);
  assert.equal(await b.notifyStatus({ id: 'd2', telegramId: null }, 'approved'), false);
});
