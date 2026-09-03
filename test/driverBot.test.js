'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { makeDriverBot } = require('../ride/driverBot');

function fakeApi() {
  const sent = [], files = [], answers = [], edits = [];
  return { sent, files, answers, edits,
    sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; },
    answerCallbackQuery: async (id, text, alert) => { answers.push({ id, text, alert: !!alert }); return true; },
    editMessageText: async (chat, message_id, text, extra) => { edits.push({ chat, message_id, text, extra }); return true; },
    getFile: async id => { files.push(id); return { file_path: 'photos/' + id + '.jpg' }; },
    downloadFile: async () => Buffer.from([0xff, 0xd8, 0xff]) };
}
function fakePrisma() {
  const drivers = [];
  return { drivers, driver: {
    findUnique: async ({ where }) => drivers.find(d => d.phone === where.phone) || null,
    findFirst: async ({ where }) => drivers.find(d => d.telegramId === where.telegramId) || null,
    create: async ({ data }) => { const d = { id: 'd' + (drivers.length + 1), rating: 5, ridesCount: 0, ...data }; drivers.push(d); return d; },
    update: async ({ where, data }) => { const d = drivers.find(x => x.id === where.id); Object.assign(d, data); return d; } } };
}
function bot(offers) {
  const api = fakeApi(), prisma = fakePrisma(), notes = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'));
  const b = makeDriverBot({ prisma, api, telegram: { ownerNote: async t => { notes.push(t); return true; } }, uploadsDir: dir, baseUrl: 'https://bina.et', offers });
  return { api, prisma, notes, dir, b };
}
// An offer card as the auction sends it, plus the tap that answers it.
const offerCard = () => ({ message_id: 77, chat: { id: 555 }, text: '\u{1F695} NEW RIDE \u00b7 ECONOMY\n\n\u{1F4CD} Pickup: Edna Mall\n   0.9 km away\n\u{1F3C1} Drop-off: Piassa\n\u{1F6E3} Trip: 5 km\n\u{1F4B0} You earn 295 ETB\n\nFirst to accept gets it' });
const tap = data => ({ callback_query: { id: 'cq1', data, message: offerCard() } });
const msg = (text, extra) => ({ message: Object.assign({ chat: { id: 555 }, text }, extra || {}) });
const photo = id => msg(undefined, { photo: [{ file_id: 'small' }, { file_id: id }] });

test('happy path: name → contact → tier → vehicle → plate → licence photo → CAR photo → pending driver, both files, owner alert', async () => {
  const { api, prisma, notes, dir, b } = bot();
  await b.handleUpdate(msg('/start'));
  assert.match(api.sent.at(-1).text, /0% commission/i);
  await b.handleUpdate(msg('Abel Tesfaye'));
  assert.equal(api.sent.at(-1).extra.reply_markup.keyboard[0][0].request_contact, true);
  await b.handleUpdate(msg(undefined, { contact: { phone_number: '251911244344', user_id: 555 } }));
  assert.deepEqual(api.sent.at(-1).extra.reply_markup.inline_keyboard.flat().map(x => x.callback_data), ['tier:moto', 'tier:bajaj', 'tier:economy', 'tier:comfort', 'tier:xl']);
  await b.handleUpdate({ callback_query: { id: 'cq1', data: 'tier:economy', message: { chat: { id: 555 } } } });
  await b.handleUpdate(msg('Toyota Vitz white'));
  await b.handleUpdate(msg('A12345'));
  assert.match(api.sent.at(-1).text, /Step 1 of 2/); assert.match(api.sent.at(-1).text, /licence/i);
  await b.handleUpdate(photo('licenceBig'));
  assert.match(api.sent.at(-1).text, /Step 2 of 2/); assert.match(api.sent.at(-1).text, /FRONT of your car/);
  assert.equal(prisma.drivers.length, 0, 'nothing saved until the car photo arrives');
  await b.handleUpdate(photo('carBig'));
  assert.equal(prisma.drivers.length, 1);
  const d = prisma.drivers[0];
  assert.equal(d.status, 'pending'); assert.equal(d.phone, '+251911244344'); assert.equal(d.tier, 'economy'); assert.equal(d.plate, 'A12345'); assert.equal(d.telegramId, '555');
  assert.equal(d.licenceUrl, '/api/ride/ops/driver-doc/d1?kind=licence');
  assert.equal(d.carPhotoUrl, '/api/ride/car/d1.jpg');
  assert.ok(fs.existsSync(path.join(dir, 'd1.jpg')), 'licence file');
  assert.ok(fs.existsSync(path.join(dir, 'd1-car.jpg')), 'car file');
  assert.deepEqual(api.files, ['licenceBig', 'carBig'], 'the largest photo of each message is downloaded');
  assert.match(api.sent.at(-1).text, /24 hours/);
  assert.equal(notes.length, 1); assert.match(notes[0], /Abel Tesfaye/); assert.match(notes[0], /licence ✅ · car ✅/);
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
  await b.handleUpdate(msg('Another Driver'));
  assert.match(api.sent.at(-1).text, /phone/i);
  assert.equal(b._sessions.get('555').step, 'phone');
});

test('text instead of a photo is refused at BOTH photo steps and no driver is created', async () => {
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
  await b.handleUpdate(photo('lic'));
  await b.handleUpdate(msg('my car is blue'));
  assert.match(api.sent.at(-1).text, /front of your car/i);
  assert.equal(prisma.drivers.length, 0, 'still nothing saved');
});

test('a failed car download still creates the driver, with carPhotoUrl null and the alert saying so', async () => {
  const { api, prisma, notes, b } = bot();
  api.downloadFile = async () => { throw new Error('telegram down'); };
  await b.handleUpdate(msg('/start')); await b.handleUpdate(msg('Abel'));
  await b.handleUpdate(msg(undefined, { contact: { phone_number: '0911244344' } }));
  await b.handleUpdate({ callback_query: { id: 'c', data: 'tier:xl', message: { chat: { id: 555 } } } });
  await b.handleUpdate(msg('Hiace white')); await b.handleUpdate(msg('C12345'));
  await b.handleUpdate(photo('lic')); await b.handleUpdate(photo('car'));
  assert.equal(prisma.drivers.length, 1);
  assert.equal(prisma.drivers[0].carPhotoUrl, null);
  assert.equal(prisma.drivers[0].licenceUrl, null);
  assert.match(notes[0], /licence ❌ · car ❌/);
});

test('notifyStatus messages the driver on approval, nothing without telegramId', async () => {
  const { api, b } = bot();
  assert.equal(await b.notifyStatus({ id: 'd1', telegramId: '555' }, 'approved'), true);
  assert.match(api.sent.at(-1).text, /Approved/);
  assert.equal(await b.notifyStatus({ id: 'd2', telegramId: null }, 'approved'), false);
});


test('an approved driver taps Accept: the card settles, the popup confirms, and the trip link follows', async () => {
  const taken = [];
  const t = bot({ accept: async (rideId, driverId) => { taken.push([rideId, driverId]); return { ok: true, rideId, driverId }; },
                  decline: async () => ({ ok: true }) });
  t.prisma.drivers.push({ id: 'd9', name: 'Abel', telegramId: '555', tier: 'economy', plate: 'AA 1', status: 'approved', online: true, away: false, rating: 5, ridesCount: 3, earningsTodayEtb: 0 });
  await t.b.handleUpdate(tap('acc:r1'));
  assert.deepEqual(taken, [['r1', 'd9']]);
  assert.equal(t.api.answers.length, 1, 'the tap is answered exactly once');
  assert.match(t.api.answers[0].text, /Yours/);
  assert.equal(t.api.edits.length, 1, 'the offer card is rewritten so it no longer looks live');
  assert.match(t.api.edits[0].text, /YOURS/);
  assert.match(t.api.edits[0].text, /Edna Mall/, 'the trip details are kept');
  const last = t.api.sent[t.api.sent.length - 1];
  assert.equal(last.extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://bina.et/drive');
});

test('losing the race is explained, not silently dropped', async () => {
  const t = bot({ accept: async () => ({ ok: false, error: 'taken' }), decline: async () => ({ ok: true }) });
  t.prisma.drivers.push({ id: 'd9', name: 'Abel', telegramId: '555', tier: 'economy', plate: 'AA 1', status: 'approved', online: true, away: false, rating: 5, ridesCount: 3, earningsTodayEtb: 0 });
  await t.b.handleUpdate(tap('acc:r1'));
  assert.match(t.api.edits[0].text, /Another driver got this one/);
  assert.equal(t.api.answers[0].alert, true, 'a popup, because the driver was expecting the ride');
});

test('Skip closes the offer; an expired one says so', async () => {
  let first = true;
  const t = bot({ accept: async () => ({ ok: true }),
                  decline: async () => { if (first) { first = false; return { ok: true }; } return { ok: false, error: 'no_offer' }; } });
  t.prisma.drivers.push({ id: 'd9', name: 'Abel', telegramId: '555', tier: 'economy', plate: 'AA 1', status: 'approved', online: true, away: false, rating: 5, ridesCount: 3, earningsTodayEtb: 0 });
  await t.b.handleUpdate(tap('dec:r1'));
  assert.match(t.api.edits[0].text, /Skipped/);
  await t.b.handleUpdate(tap('dec:r1'));
  assert.match(t.api.edits[1].text, /already closed/);
});

test('a pending or unregistered driver cannot accept anything', async () => {
  const t = bot({ accept: async () => { throw new Error('must not be called'); }, decline: async () => ({ ok: true }) });
  await t.b.handleUpdate(tap('acc:r1'));
  assert.match(t.api.answers[0].text, /Register first/);
  t.prisma.drivers.push(Object.assign({}, { id: 'd9', name: 'Abel', telegramId: '555', tier: 'economy', plate: 'AA 1', status: 'approved', online: true, away: false, rating: 5, ridesCount: 3, earningsTodayEtb: 0 }, { status: 'pending' }));
  await t.b.handleUpdate(tap('acc:r1'));
  assert.match(t.api.answers[1].text, /not active yet/);
});

test('/start does not restart registration for an existing driver', async () => {
  const t = bot();
  t.prisma.drivers.push(Object.assign({}, { id: 'd9', name: 'Abel', telegramId: '555', tier: 'economy', plate: 'AA 1', status: 'approved', online: true, away: false, rating: 5, ridesCount: 3, earningsTodayEtb: 0 }, { ridesCount: 7, earningsTodayEtb: 640 }));
  await t.b.handleUpdate(msg('/start'));
  const home = t.api.sent[0];
  assert.match(home.text, /online and receiving offers/);
  assert.match(home.text, /640 ETB/);
  assert.equal(home.extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://bina.et/drive');

  t.prisma.drivers[0].status = 'pending';
  await t.b.handleUpdate(msg('/start'));
  assert.match(t.api.sent[1].text, /registration is with us/i);
  assert.equal(t.prisma.drivers.length, 1, 'no duplicate driver was created');
});
