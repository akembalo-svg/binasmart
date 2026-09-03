'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const routes = require('../ride/routes');
const { sign } = require('../ride/tgauth');

const TOKEN = '111:RIDERTOKEN';
function fakePrisma() {
  const rides = [], riders = [], drivers = [{ id: 'd1', name: 'Abel', phone: '+251900000000', plate: 'A1', status: 'pending', telegramId: '555', tier: 'economy' }];
  const inc = { rides, riders, drivers };
  const ACTIVE = ['requested', 'dispatching', 'assigned', 'arriving', 'arrived', 'ontrip'];
  const apply = (row, data) => { for (const [k, v] of Object.entries(data)) row[k] = (v && typeof v === 'object' && 'increment' in v) ? (row[k] || 0) + v.increment : v; };
  return { _: inc,
    rider: { upsert: async ({ where, update, create }) => { let r = riders.find(x => x.phone === where.phone); if (r) Object.assign(r, update); else { r = { id: 'u' + (riders.length + 1), telegramId: null, ...create }; riders.push(r); } return r; },
             update: async ({ where, data }) => { const r = riders.find(x => x.id === where.id); Object.assign(r, data); return r; } },
    ride: { findUnique: async ({ where }) => { const r = rides.find(x => x.id === where.id || (where.idemKey && x.idemKey === where.idemKey)) || null; return r && { ...r, driver: null, rider: riders.find(u => u.id === r.riderId) }; },
            create: async ({ data }) => { const r = { id: 'r' + (rides.length + 1), status: 'dispatching', requestedAt: new Date(), ...data }; rides.push(r); return r; },
            findFirst: async ({ where }) => { const tg = where.OR[0].rider.telegramId; const r = rides.slice().reverse().find(x => ACTIVE.includes(x.status) && ((riders.find(u => u.id === x.riderId) || {}).telegramId === tg || (x.bookedBy && x.bookedBy.telegramId === tg))); return r ? { ...r, driver: null } : null; },
            updateMany: async () => ({ count: 1 }), update: async ({ where, data }) => { const r = rides.find(x => x.id === where.id); Object.assign(r, data); return { ...r, driver: null }; } },
    driver: {
      findUnique: async ({ where }) => drivers.find(d => d.id === where.id || d.phone === where.phone) || null,
      update: async ({ where, data }) => { const d = drivers.find(x => x.id === where.id); apply(d, data); return d; },
      // onRideId guards are the whole point of these paths, so the fake must honour them.
      updateMany: async ({ where, data }) => {
        const d = drivers.find(x => x.id === where.id && (!('onRideId' in where) || x.onRideId === where.onRideId));
        if (!d) return { count: 0 };
        apply(d, data);
        return { count: 1 };
      },
      count: async () => 0, findMany: async () => drivers,
    },
    rideOffer: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
  };
}
const geo = { route: async () => ({ distanceM: 5000, durationS: 900, estimate: false, geometry: [] }), searchPlaces: async () => [] };
const tier = (label, labelAm, icon, seats, base, perKm, perMin, min) => ({ label, labelAm, icon, seats, base, perKm, perMin, min });
const settings = { get: async () => ({ tiers: { moto: tier('Moto', 'ሞተር', '🏍', 1, 50, 15, 1, 80), bajaj: tier('Bajaj', 'ባጃጅ', '🛺', 3, 70, 20, 1, 100), economy: tier('Economy', 'ኢኮኖሚ', '🚗', 4, 100, 30, 2, 150), comfort: tier('Comfort', 'ኮምፎርት', '🚙', 4, 150, 40, 3, 250), xl: tier('XL', 'ቫን', '🚐', 7, 200, 50, 3, 350) }, commissionPct: 0, conciergeAfterS: 0 }) };
const telegram = { conciergeAlert: async () => true, ownerNote: async () => true };
const dispatch = { start: async () => 'ok', cancel: () => {} };
const notified = []; const riderNotify = { notify: async (id, ev) => { notified.push(ev); return true; } };
const driverStatus = []; const driverTold = [];
const driverBot = { handleUpdate: async () => { driverStatus.push('dupdate'); }, notifyStatus: async (d, s) => { driverStatus.push(s); return true; },
  tell: async (d, text) => { driverTold.push(text); return true; } };
const riderBot = { handleUpdate: async () => {} };

const prisma = fakePrisma();
const app = Fastify();
routes(app, { prisma, settings, geo, telegram, dispatch, OWNER_KEY: 'OWNERKEY', riderBotToken: TOKEN, webhookSecret: 'SEKRET', riderBot, driverBot, riderNotify, uploadsDir: require('os').tmpdir() });
after(() => app.close());
const pt = { lat: 9.01, lng: 38.75, label: 'A' }, pt2 = { lat: 9.03, lng: 38.76, label: 'B' };
const NOWS = () => String(Math.floor(Date.now() / 1000) - 5);
const initData = sign({ user: { id: 42, first_name: 'Abel' }, auth_date: NOWS() }, TOKEN);
const contact = sign({ contact: { phone_number: '251911244344', user_id: 42 }, auth_date: NOWS() }, TOKEN);

test('webhooks: missing/wrong secret → 401; right secret → 200 and handler runs', async () => {
  assert.equal((await app.inject({ method: 'POST', url: '/api/tg/rider', payload: { message: {} } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/tg/rider', headers: { 'x-telegram-bot-api-secret-token': 'nope' }, payload: {} })).statusCode, 401);
  const r = await app.inject({ method: 'POST', url: '/api/tg/driver', headers: { 'x-telegram-bot-api-secret-token': 'SEKRET' }, payload: { message: { chat: { id: 1 }, text: '/start' } } });
  assert.equal(r.statusCode, 200);
  await new Promise(res => setImmediate(res));
  assert.deepEqual(driverStatus, ['dupdate']);
});

test('Telegram booking: signed contact phone wins, telegramId stored, response carries the phone for polling', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/ride/request', payload: { tier: 'economy', pickup: pt, dropoff: pt2, riderName: 'Abel', riderPhone: '0900000000', tg: { initData, contact } } });
  const d = r.json(); assert.equal(r.statusCode, 200, JSON.stringify(d));
  assert.equal(d.phone, '+251911244344');
  assert.equal(prisma._.riders[0].telegramId, '42');
  assert.equal(prisma._.rides[0].riderPhone, '+251911244344');
  assert.equal(prisma._.rides[0].bookedBy, null);
});

test('invalid Telegram signature → 401 with reopen message', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/ride/request', payload: { tier: 'economy', pickup: pt, dropoff: pt2, riderName: 'X', riderPhone: '0911111111', tg: { initData: 'user=%7B%7D&auth_date=1&hash=' + 'a'.repeat(64) } } });
  assert.equal(r.statusCode, 401); assert.match(r.json().error, /reopen/i);
});

test('book for someone else: passenger becomes the rider, booker stored in bookedBy, missing passenger phone → 400', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/ride/request', payload: { tier: 'moto', pickup: pt, dropoff: pt2, riderName: 'Ibrahim', riderPhone: '+447700900123', passenger: { name: 'Almaz', phone: '0922333444' }, tg: { initData } } });
  const d = r.json(); assert.equal(r.statusCode, 200, JSON.stringify(d));
  const ride = prisma._.rides.at(-1);
  assert.equal(ride.riderName, 'Almaz'); assert.equal(ride.riderPhone, '+251922333444');
  assert.deepEqual(ride.bookedBy, { name: 'Ibrahim', phone: '+447700900123', telegramId: '42' });
  const bad = await app.inject({ method: 'POST', url: '/api/ride/request', payload: { tier: 'moto', pickup: pt, dropoff: pt2, riderName: 'Ibrahim', riderPhone: '0911111111', passenger: { name: 'Almaz', phone: '+4477' } } });
  assert.equal(bad.statusCode, 400); assert.match(bad.json().error, /passenger/i);
});

test('/api/ride/mine returns the latest active ride for the Telegram user with its phone; 401 without valid initData', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/ride/mine?initData=' + encodeURIComponent(initData) });
  assert.equal(r.statusCode, 200); assert.equal(r.json().ride.id, 'r2'); assert.equal(r.json().phone, '+251922333444');
  assert.equal((await app.inject({ method: 'GET', url: '/api/ride/mine?initData=bad' })).statusCode, 401);
});

test('ops: driver status change notifies the driver; licence doc needs the owner key', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/ride/ops/drivers/d1/status', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { status: 'approved' } });
  assert.equal(r.statusCode, 200); assert.equal(r.json().driver.status, 'approved'); assert.equal(driverStatus.at(-1), 'approved');
  assert.equal((await app.inject({ method: 'POST', url: '/api/ride/ops/drivers/d1/status', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { status: 'flying' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/ride/ops/driver-doc/d1' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/ride/ops/driver-doc/d1?key=OWNERKEY' })).statusCode, 404, 'no file saved in this test');
});

test('ops assign / status / rider cancel call riderNotify with the right event', async () => {
  prisma._.drivers[0].status = 'approved';
  await app.inject({ method: 'POST', url: '/api/ride/ops/r1/assign', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { driverId: 'd1' } });
  prisma._.rides[0].status = 'assigned';
  await app.inject({ method: 'POST', url: '/api/ride/ops/r1/status', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { status: 'arrived' } });
  await app.inject({ method: 'POST', url: '/api/ride/r2/cancel', payload: { phone: '0922333444' } });
  await new Promise(res => setImmediate(res));
  assert.deepEqual(notified, ['assigned', 'arrived', 'cancelled']);
});

// ---- Phase 2 regressions: onRideId is set and cleared on EVERY path, not just the driver app ----

test('a rider cancelling an assigned ride frees the driver and warns them', async () => {
  const d = prisma._.drivers[0];
  d.status = 'approved'; d.onRideId = 'r9';
  prisma._.rides.push({ id: 'r9', status: 'assigned', riderId: 'u1', riderPhone: '+251922333444', riderName: 'Almaz',
    driverId: 'd1', tier: 'moto', pickup: pt, dropoff: pt2, distanceM: 1, durationS: 1, fareEtb: 100, driverTakeEtb: 100 });
  driverTold.length = 0;

  const r = await app.inject({ method: 'POST', url: '/api/ride/r9/cancel', payload: { phone: '0922333444' } });
  assert.equal(r.statusCode, 200);
  assert.equal(d.onRideId, null, 'the driver must not stay busy forever');
  assert.equal(driverTold.length, 1, 'the driver is told the passenger cancelled');
  assert.match(driverTold[0], /cancelled/i);
  assert.match(driverTold[0], /ተጓዡ ጉዞውን ሰርዞታል/, 'and told in Amharic first');
});

test('a late cancellation cannot free a driver who has moved on to another ride', async () => {
  const d = prisma._.drivers[0];
  d.status = 'approved'; d.onRideId = 'r-new';
  prisma._.rides.push({ id: 'r10', status: 'assigned', riderId: 'u1', riderPhone: '+251922333444', riderName: 'Almaz',
    driverId: 'd1', tier: 'moto', pickup: pt, dropoff: pt2, distanceM: 1, durationS: 1, fareEtb: 100, driverTakeEtb: 100 });
  await app.inject({ method: 'POST', url: '/api/ride/r10/cancel', payload: { phone: '0922333444' } });
  assert.equal(d.onRideId, 'r-new', 'the newer ride is untouched');
});

test('ops assignment marks the driver busy so the auction cannot double-book them', async () => {
  const d = prisma._.drivers[0];
  d.status = 'approved'; d.onRideId = null;
  prisma._.rides.push({ id: 'r11', status: 'dispatching', riderId: 'u1', riderPhone: '+251922333444', riderName: 'Almaz',
    tier: 'moto', pickup: pt, dropoff: pt2, distanceM: 1, durationS: 1, fareEtb: 100, driverTakeEtb: 100 });
  const r = await app.inject({ method: 'POST', url: '/api/ride/ops/r11/assign', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { driverId: 'd1' } });
  assert.equal(r.statusCode, 200);
  assert.equal(d.onRideId, 'r11', 'ops assignment must claim the driver');
});

test('ops completion frees the driver, counts the trip and banks the fare', async () => {
  const d = prisma._.drivers[0];
  d.status = 'approved'; d.onRideId = 'r12'; d.ridesCount = 3; d.earningsTodayEtb = 0; d.earningsDay = null;
  prisma._.rides.push({ id: 'r12', status: 'ontrip', riderId: 'u1', riderPhone: '+251922333444', riderName: 'Almaz',
    driverId: 'd1', tier: 'moto', pickup: pt, dropoff: pt2, distanceM: 1, durationS: 1, fareEtb: 100, driverTakeEtb: 100 });
  const r = await app.inject({ method: 'POST', url: '/api/ride/ops/r12/status', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { status: 'completed' } });
  assert.equal(r.statusCode, 200);
  assert.equal(d.onRideId, null, 'freed');
  assert.equal(d.ridesCount, 4, 'counted');
  assert.equal(d.earningsTodayEtb, 100, 'paid — the ops panel used to bank nothing');
  assert.ok(d.earningsDay, 'the earnings day is stamped');
});

test('ops cancellation frees the driver and warns them too', async () => {
  const d = prisma._.drivers[0];
  d.status = 'approved'; d.onRideId = 'r13';
  prisma._.rides.push({ id: 'r13', status: 'assigned', riderId: 'u1', riderPhone: '+251922333444', riderName: 'Almaz',
    driverId: 'd1', tier: 'moto', pickup: pt, dropoff: pt2, distanceM: 1, durationS: 1, fareEtb: 100, driverTakeEtb: 100 });
  driverTold.length = 0;
  await app.inject({ method: 'POST', url: '/api/ride/ops/r13/status', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { status: 'cancelled' } });
  assert.equal(d.onRideId, null);
  assert.equal(driverTold.length, 1);
  assert.match(driverTold[0], /do not continue/i);
});

test('a chapa booking falls back to cash while the integration is on test keys', async () => {
  const was = process.env.CHAPA_MODE;

  process.env.CHAPA_MODE = 'test';
  let r = await app.inject({ method: 'POST', url: '/api/ride/request',
    payload: { tier: 'moto', pickup: pt, dropoff: pt2, riderName: 'Almaz', riderPhone: '0911111111', paymentMethod: 'chapa' } });
  assert.equal(r.statusCode, 200);
  assert.equal(prisma._.rides.at(-1).paymentMethod, 'cash', 'test keys must never book a chapa ride');

  // An unset mode is treated as test — the safe default.
  delete process.env.CHAPA_MODE;
  r = await app.inject({ method: 'POST', url: '/api/ride/request',
    payload: { tier: 'moto', pickup: pt, dropoff: pt2, riderName: 'Almaz', riderPhone: '0911111111', paymentMethod: 'chapa' } });
  assert.equal(prisma._.rides.at(-1).paymentMethod, 'cash', 'unset mode defaults to cash');

  process.env.CHAPA_MODE = 'live';
  r = await app.inject({ method: 'POST', url: '/api/ride/request',
    payload: { tier: 'moto', pickup: pt, dropoff: pt2, riderName: 'Almaz', riderPhone: '0911111111', paymentMethod: 'chapa' } });
  assert.equal(prisma._.rides.at(-1).paymentMethod, 'chapa', 'live keys allow it through');

  if (was === undefined) delete process.env.CHAPA_MODE; else process.env.CHAPA_MODE = was;
});
