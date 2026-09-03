'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeLocation } = require('../ride/location');

function fakes(driver) {
  const updates = [], created = [], pings = [];
  const drivers = [driver || { id: 'd1', online: true, away: false, status: 'approved', lat: null, lng: null, onRideId: null, telegramId: '555' }];
  const prisma = {
    driver: {
      update: async ({ where, data }) => { const d = drivers.find(x => x.id === where.id); Object.assign(d, data); updates.push({ id: where.id, data }); return d; },
      findMany: async () => drivers.filter(d => d.online && !d.away).map(d => ({ id: d.id, telegramId: d.telegramId })),
      findUnique: async ({ where }) => drivers.find(x => x.id === where.id) || null,
    },
    driverLocation: { create: async ({ data }) => { created.push(data); return { id: 'l' + created.length, ...data }; } },
  };
  const api = { sendMessage: async (chat, text) => { pings.push({ chat, text }); return { message_id: 1 }; } };
  return { drivers, updates, created, pings, prisma, api };
}
const ADDIS = { lat: 9.01, lng: 38.76 };

test('a valid fix is stored on the driver and appended as a breadcrumb', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now });
  const r = await loc.record('d1', { lat: ADDIS.lat, lng: ADDIS.lng, bearing: 90, speedKph: 24, accuracy: 12 }, 'r1');
  assert.equal(r.ok, true);
  assert.equal(f.drivers[0].lat, ADDIS.lat);
  assert.equal(f.drivers[0].bearing, 90);
  assert.equal(f.drivers[0].away, false);
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0].rideId, 'r1');
});

test('junk fixes are rejected: outside Addis, poor accuracy, missing numbers, teleport', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now });
  assert.equal((await loc.record('d1', { lat: 48.85, lng: 2.35 })).ok, false, 'Paris');
  assert.equal((await loc.record('d1', { lat: 'x', lng: 38.7 })).ok, false, 'not a number');
  assert.equal((await loc.record('d1', { lat: ADDIS.lat, lng: ADDIS.lng, accuracy: 900 })).ok, false, 'accuracy');
  assert.equal((await loc.record('d1', ADDIS)).ok, true);
  now += 5000;
  const jump = await loc.record('d1', { lat: 9.20, lng: 38.95 });
  assert.equal(jump.ok, false); assert.equal(jump.error, 'teleport');
  now += 600000;
  assert.equal((await loc.record('d1', { lat: 9.20, lng: 38.95 })).ok, true);
});

test('the trail keeps the last 25 points for a ride, newest last', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now });
  for (let i = 0; i < 30; i++) { now += 6000; await loc.record('d1', { lat: 9.01 + i * 0.0002, lng: 38.76 }, 'r1'); }
  const t = loc.trail('r1');
  assert.equal(t.length, 25);
  assert.ok(t[24].lat > t[0].lat, 'newest last');
  assert.deepEqual(loc.trail('nope'), []);
});

test('latest() returns the last fix with its age', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now });
  await loc.record('d1', { lat: 9.01, lng: 38.76, bearing: 12 });
  now += 8000;
  const l = loc.latest('d1');
  assert.equal(l.bearing, 12);
  assert.equal(l.ageS, 8);
  assert.equal(loc.latest('unknown'), null);
});

test('staleSweep marks silent drivers away and pings each of them once', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now, staleMs: 45000 });
  await loc.record('d1', ADDIS);
  now += 20000;
  assert.equal(await loc.staleSweep(), 0, 'still fresh');
  now += 40000;
  assert.equal(await loc.staleSweep(), 1);
  assert.equal(f.drivers[0].away, true);
  assert.equal(f.pings.length, 1);
  assert.match(f.pings[0].text, /stopped hearing from your phone/i, 'the generic silence message');
  assert.equal(await loc.staleSweep(), 0, 'not pinged twice');
});

test('a driver seen for the first time gets one grace period, then is marked away', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now, staleMs: 45000 });
  assert.equal(await loc.staleSweep(), 0, 'grace on first sight');
  now += 60000;
  assert.equal(await loc.staleSweep(), 1);
  assert.equal(f.drivers[0].away, true);
});

test('a driver outside Addis is told THAT, not that they went quiet', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now, staleMs: 45000 });

  // A good fix first, so the sweep has seen this driver before.
  await loc.record('d1', ADDIS);
  now += 5000;
  const abroad = await loc.record('d1', { lat: 25.2048, lng: 55.2708 }); // Dubai
  assert.equal(abroad.ok, false);
  assert.equal(abroad.error, 'outside_addis');
  assert.equal(loc.lastReject('d1').error, 'outside_addis', 'the reason is remembered');

  now += 60000;
  assert.equal(await loc.staleSweep(), 1);
  assert.equal(f.drivers[0].away, true);
  assert.match(f.pings[0].text, /outside Addis Ababa/, 'the message names the real cause');
  assert.match(f.pings[0].text, /ከአዲስ አበባ ውጭ/, 'and says it in Amharic first');
  assert.doesNotMatch(f.pings[0].text, /stopped hearing/, 'not the misleading silence message');
});

test('weak GPS gets its own message, and a good fix clears the reason', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now, staleMs: 45000 });
  await loc.record('d1', ADDIS);
  now += 5000;
  await loc.record('d1', { lat: ADDIS.lat, lng: ADDIS.lng, accuracy: 900 });
  assert.equal(loc.lastReject('d1').error, 'inaccurate');
  assert.match(loc.awayMessage('d1'), /GPS signal is too weak/);

  now += 5000;
  await loc.record('d1', { lat: ADDIS.lat + 0.0001, lng: ADDIS.lng });
  assert.equal(loc.lastReject('d1'), null, 'a good fix clears it');
  assert.match(loc.awayMessage('d1'), /stopped hearing/, 'back to the generic message');
});

test('a stale reason is not blamed for a fresh silence', async () => {
  const f = fakes();
  let now = 1_000_000;
  const loc = makeLocation({ prisma: f.prisma, api: f.api, now: () => now, staleMs: 45000 });
  await loc.record('d1', { lat: 25.2048, lng: 55.2708 });
  assert.equal(loc.lastReject('d1').error, 'outside_addis');
  now += 6 * 60 * 1000; // six minutes later it is no longer the explanation
  assert.equal(loc.lastReject('d1'), null);
  assert.match(loc.awayMessage('d1'), /stopped hearing/);
});
