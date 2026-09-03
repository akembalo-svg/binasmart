'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDriverApi } = require('../ride/driverApi');
const tgauth = require('../ride/tgauth');

const TOKEN = '8726715201:TEST-DRIVER-BOT-TOKEN';
const PICKUP = { lat: 9.010, lng: 38.760, label: 'Edna Mall' };
const DROP = { lat: 9.040, lng: 38.750, label: 'Piassa' };

function initFor(tgId, t) {
  return tgauth.sign({ auth_date: String(Math.floor(t / 1000)), user: { id: tgId, first_name: 'Abel' } }, TOKEN);
}
function reply() {
  const r = { statusCode: 200, body: null };
  r.code = c => { r.statusCode = c; return r; };
  r.send = b => { r.body = b; return r; };
  return r;
}

function world() {
  const clockRef = { t: 1_700_000_000_000 };
  const state = {
    drivers: [
      { id: 'd1', name: 'Abel', phone: '+251911111111', telegramId: '900001', tier: 'economy', plate: 'AA 12345', status: 'approved', online: true, away: false, onRideId: null, lat: 9.011, lng: 38.761, bearing: 90, speedKph: 20, lastSeenAt: new Date(1_700_000_000_000), rating: 5, ridesCount: 4, carPhotoUrl: '/var/www/uploads/drivers/car-d1.jpg', photo: null, vehicleMake: 'Vitz', vehicleColour: 'Blue', earningsTodayEtb: 0, earningsDay: null },
      { id: 'd2', name: 'Bekele', phone: '+251922222222', telegramId: '900002', tier: 'economy', plate: 'AA 54321', status: 'pending', online: false, away: false, onRideId: null, lat: null, lng: null, rating: 5, ridesCount: 0, earningsTodayEtb: 0, earningsDay: null },
    ],
    rides: [
      { id: 'r1', status: 'dispatching', tier: 'economy', pickup: PICKUP, dropoff: DROP, distanceM: 5000, durationS: 900, fareEtb: 295, driverTakeEtb: 295, paymentMethod: 'cash', riderName: 'Sara', riderPhone: '+251933333333', bookedBy: null, driverId: null, requestedAt: new Date(1_700_000_000_000) },
    ],
    offers: [],
    windowS: 25,
  };
  const notified = [], ownerNotes = [];
  const prisma = {
    driver: {
      findFirst: async ({ where }) => state.drivers.find(d => d.telegramId === where.telegramId) || null,
      findUnique: async ({ where }) => state.drivers.find(d => d.id === where.id) || null,
      update: async ({ where, data }) => {
        const d = state.drivers.find(x => x.id === where.id);
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in v) d[k] = (d[k] || 0) + v.increment;
          else d[k] = v;
        }
        return { ...d };
      },
    },
    ride: {
      findUnique: async ({ where, include }) => {
        const r = state.rides.find(x => x.id === where.id);
        if (!r) return null;
        return include && include.driver ? { ...r, driver: state.drivers.find(d => d.id === r.driverId) || null } : { ...r };
      },
      update: async ({ where, data }) => { const r = state.rides.find(x => x.id === where.id); Object.assign(r, data); return { ...r }; },
    },
    rideOffer: {
      findMany: async ({ where }) => state.offers.filter(o => o.driverId === where.driverId && o.status === where.status).map(o => ({ ...o })),
    },
  };
  const location = {
    fixes: [], forgotten: [], _latest: null,
    record: async (id, fix, rideId) => {
      location.fixes.push({ id, fix, rideId });
      const la = Number(fix.lat), ln = Number(fix.lng);
      if (!(la > 8.5 && la < 9.5 && ln > 38.4 && ln < 39.2)) return { ok: false, error: 'outside_addis' };
      const d = state.drivers.find(x => x.id === id);
      d.lat = Number(fix.lat); d.lng = Number(fix.lng); d.away = false;
      location._latest = { lat: d.lat, lng: d.lng, bearing: 90, speedKph: 20, ageS: 2 };
      return { ok: true };
    },
    latest: () => location._latest,
    trail: () => [{ lat: 9.011, lng: 38.761 }, { lat: 9.012, lng: 38.762 }],
    forget: id => location.forgotten.push(id),
  };
  const offers = {
    accept: async (rideId, driverId) => {
      const r = state.rides.find(x => x.id === rideId);
      if (!state.offers.some(o => o.rideId === rideId && o.driverId === driverId && o.status === 'open')) return { ok: false, error: 'no_offer' };
      if (r.driverId) return { ok: false, error: 'taken' };
      r.driverId = driverId; r.status = 'assigned'; r.assignedAt = new Date(clockRef.t);
      state.drivers.find(d => d.id === driverId).onRideId = rideId;
      state.offers.filter(o => o.rideId === rideId).forEach(o => { o.status = o.driverId === driverId ? 'accepted' : 'lost'; });
      return { ok: true, rideId, driverId };
    },
    decline: async (rideId, driverId) => {
      const o = state.offers.find(x => x.rideId === rideId && x.driverId === driverId && x.status === 'open');
      if (!o) return { ok: false, error: 'no_offer' };
      o.status = 'declined';
      return { ok: true };
    },
  };
  const api = makeDriverApi({
    prisma, driverBotToken: TOKEN, location, offers,
    settings: { get: async () => ({ offerWindowS: state.windowS || 25 }) },
    geo: { route: async (from, to) => { if (to.label === 'boom') throw new Error('router down'); return { geometry: [[38.76, 9.01], [38.75, 9.04]], distanceM: 5200, durationS: 780 }; } },
    telegram: { ownerNote: async t => { ownerNotes.push(t); return true; } },
    riderNotify: { notify: async (id, ev) => { notified.push(ev); return true; } },
    now: () => clockRef.t,
  });
  return { state, clockRef, api, location, notified, ownerNotes,
    req: (over) => ({ body: { initData: initFor(900001, clockRef.t), ...(over && over.body) }, query: {}, params: (over && over.params) || {} }) };
}

test('session returns the driver, and unsigned or forged initData is rejected', async () => {
  const w = world();
  const rp = reply();
  const s = await w.api.session(w.req(), rp);
  assert.equal(s.ok, true);
  assert.equal(s.driver.name, 'Abel');
  assert.equal(s.driver.carPhoto, '/api/ride/car/car-d1.jpg', 'the car photo is served through the public route, never a filesystem path');
  assert.equal(s.job, null);
  assert.deepEqual(s.offers, []);

  const bad = reply();
  assert.equal(await w.api.session({ body: { initData: 'user=%7B%22id%22%3A900001%7D&hash=' + 'a'.repeat(64) }, query: {}, params: {} }, bad), undefined);
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.body.error, 'telegram_auth_invalid');
});

test('a driver signed by the WRONG bot token is rejected', async () => {
  const w = world();
  const rp = reply();
  const forged = tgauth.sign({ auth_date: String(Math.floor(w.clockRef.t / 1000)), user: { id: 900001, first_name: 'Abel' } }, 'some-other-bot-token');
  await w.api.session({ body: { initData: forged }, query: {}, params: {} }, rp);
  assert.equal(rp.statusCode, 401);
});

test('an unregistered Telegram user gets 404 and a pending driver gets their own status back', async () => {
  const w = world();
  const r1 = reply();
  await w.api.session({ body: { initData: initFor(999999, w.clockRef.t) }, query: {}, params: {} }, r1);
  assert.equal(r1.statusCode, 404);
  assert.equal(r1.body.error, 'not_registered');

  const r2 = reply();
  const s = await w.api.session({ body: { initData: initFor(900002, w.clockRef.t) }, query: {}, params: {} }, r2);
  assert.equal(s.ok, true, 'session lets a pending driver in so the app can explain why');
  assert.equal(s.driver.status, 'pending');

  const r3 = reply();
  await w.api.ping({ body: { initData: initFor(900002, w.clockRef.t), lat: 9.01, lng: 38.76 }, query: {}, params: {} }, r3);
  assert.equal(r3.statusCode, 403);
  assert.equal(r3.body.error, 'awaiting_approval', 'but a pending driver cannot work');
});

test('ping stores the fix and returns offers, the job and the server clock in one round trip', async () => {
  const w = world();
  w.state.offers.push({ id: 'o1', rideId: 'r1', driverId: 'd1', status: 'open', etaS: 180, distanceM: 900, round: 1, createdAt: new Date(w.clockRef.t - 5000) });
  const res = await w.api.ping(w.req({ body: { lat: 9.012, lng: 38.762, bearing: 45, speedKph: 18, accuracy: 9 } }), reply());
  assert.equal(res.fix, 'stored');
  assert.equal(w.location.fixes.length, 1);
  assert.equal(w.location.fixes[0].rideId, null, 'no ride yet, so the breadcrumb is not tied to one');
  assert.equal(res.offers.length, 1);
  assert.equal(res.offers[0].rideId, 'r1');
  assert.equal(res.offers[0].expiresInS, 20, '25 s window, 5 s elapsed');
  assert.equal(res.offers[0].driverTakeEtb, 295);
  assert.equal(res.serverTime, w.clockRef.t, 'the app trusts the server clock, not the phone');
});

test('a rejected fix does not fail the request — the driver keeps polling', async () => {
  const w = world();
  const res = await w.api.ping(w.req({ body: { lat: 48.85, lng: 2.35 } }), reply());
  assert.equal(res.ok, true);
  assert.equal(res.fix, 'outside_addis');
});

test('an offer for a ride somebody else already took is not shown', async () => {
  const w = world();
  w.state.offers.push({ id: 'o1', rideId: 'r1', driverId: 'd1', status: 'open', etaS: 180, distanceM: 900, round: 1, createdAt: new Date(w.clockRef.t) });
  w.state.rides[0].driverId = 'dX';
  w.state.rides[0].status = 'assigned';
  const res = await w.api.ping(w.req({ body: { lat: 9.012, lng: 38.762 } }), reply());
  assert.deepEqual(res.offers, []);
});

test('accept hands back the job with the rider phone; a taken ride returns 409', async () => {
  const w = world();
  w.state.offers.push({ id: 'o1', rideId: 'r1', driverId: 'd1', status: 'open', etaS: 180, distanceM: 900, round: 1, createdAt: new Date(w.clockRef.t) });
  const res = await w.api.accept(w.req({ params: { id: 'r1' } }), reply());
  assert.equal(res.ok, true);
  assert.equal(res.job.id, 'r1');
  assert.equal(res.job.riderPhone, '+251933333333', 'the driver can call the passenger');
  assert.deepEqual(res.job.next, ['arriving', 'arrived']);
  assert.equal(res.driver.onRideId, 'r1');

  const rp = reply();
  await w.api.accept(w.req({ params: { id: 'r1' } }), rp);
  assert.equal(rp.statusCode, 404, 'the offer is no longer open');
});

test('decline closes the offer and returns the shortened list', async () => {
  const w = world();
  w.state.offers.push({ id: 'o1', rideId: 'r1', driverId: 'd1', status: 'open', etaS: 180, distanceM: 900, round: 1, createdAt: new Date(w.clockRef.t) });
  const res = await w.api.decline(w.req({ params: { id: 'r1' } }), reply());
  assert.equal(res.ok, true);
  assert.deepEqual(res.offers, []);
  const rp = reply();
  await w.api.decline(w.req({ params: { id: 'r1' } }), rp);
  assert.equal(rp.statusCode, 404);
});

test('the status ladder only moves forwards and the rider is told at every step', async () => {
  const w = world();
  w.state.rides[0].driverId = 'd1'; w.state.rides[0].status = 'assigned';
  w.state.drivers[0].onRideId = 'r1';
  for (const s of ['arriving', 'arrived', 'ontrip', 'completed']) {
    const res = await w.api.status(w.req({ params: { id: 'r1' }, body: { status: s } }), reply());
    assert.equal(res.ok, true, s);
    assert.equal(res.job.status, s);
  }
  assert.deepEqual(w.notified, ['arriving', 'arrived', 'ontrip', 'completed']);

  const back = reply();
  await w.api.status(w.req({ params: { id: 'r1' }, body: { status: 'ontrip' } }), back);
  assert.equal(back.statusCode, 409, 'a completed ride cannot go back on trip');
});

test('completing a ride frees the driver, counts the trip and banks the earnings for the Addis day', async () => {
  const w = world();
  w.state.rides[0].driverId = 'd1'; w.state.rides[0].status = 'ontrip';
  w.state.drivers[0].onRideId = 'r1';
  const res = await w.api.status(w.req({ params: { id: 'r1' }, body: { status: 'completed' } }), reply());
  assert.equal(res.driver.onRideId, null, 'free for the next offer');
  assert.equal(res.driver.ridesCount, 5);
  assert.equal(res.driver.earningsTodayEtb, 295);
  assert.equal(w.state.drivers[0].earningsDay.getTime(), w.api.addisDay(w.clockRef.t).getTime());
  assert.equal(w.ownerNotes.length, 1);
  assert.match(w.ownerNotes[0], /completed by Abel/);
});

test("yesterday's earnings do not carry into today", async () => {
  const w = world();
  w.state.drivers[0].earningsTodayEtb = 1200;
  w.state.drivers[0].earningsDay = w.api.addisDay(w.clockRef.t - 86400000);
  const s = await w.api.session(w.req(), reply());
  assert.equal(s.driver.earningsTodayEtb, 0, 'a new Addis day starts at zero');
  w.state.rides[0].driverId = 'd1'; w.state.rides[0].status = 'ontrip';
  w.state.drivers[0].onRideId = 'r1';
  const res = await w.api.status(w.req({ params: { id: 'r1' }, body: { status: 'completed' } }), reply());
  assert.equal(res.driver.earningsTodayEtb, 295, 'not 1495');
});

test('a driver cannot touch a ride that is not theirs', async () => {
  const w = world();
  w.state.rides[0].driverId = 'dX'; w.state.rides[0].status = 'assigned';
  const rp = reply();
  await w.api.status(w.req({ params: { id: 'r1' }, body: { status: 'arrived' } }), rp);
  assert.equal(rp.statusCode, 404);
  assert.equal(rp.body.error, 'not_your_ride');
});

test('going offline mid-ride is refused; going offline otherwise clears the tracked position', async () => {
  const w = world();
  w.state.drivers[0].onRideId = 'r1';
  const rp = reply();
  await w.api.online(w.req({ body: { online: false } }), rp);
  assert.equal(rp.statusCode, 409);
  assert.equal(rp.body.error, 'finish_your_ride_first');

  w.state.drivers[0].onRideId = null;
  const res = await w.api.online(w.req({ body: { online: false } }), reply());
  assert.equal(res.driver.online, false);
  assert.deepEqual(w.location.forgotten, ['d1']);
});

test('track gives the rider the position, trail, ETA and the car photo — only while the ride is live', async () => {
  const w = world();
  const yes = () => true;
  w.state.rides[0].driverId = 'd1'; w.state.rides[0].status = 'assigned';
  await w.location.record('d1', { lat: 9.011, lng: 38.761 }, 'r1');
  const res = await w.api.track({ params: { id: 'r1' }, query: {} }, reply(), yes);
  assert.equal(res.live.status, 'assigned');
  assert.equal(res.live.driver.plate, 'AA 12345');
  assert.equal(res.live.driver.carPhoto, '/api/ride/car/car-d1.jpg');
  assert.equal(res.live.position.stale, false);
  assert.equal(res.live.trail.length, 2);
  assert.ok(res.live.etaS >= 30 && res.live.distanceM > 0, 'an ETA towards the pickup');

  w.state.rides[0].status = 'completed';
  const done = await w.api.track({ params: { id: 'r1' }, query: {} }, reply(), yes);
  assert.equal(done.live.position, null, 'tracking stops when the ride ends');

  const wrong = reply();
  await w.api.track({ params: { id: 'r1' }, query: {} }, wrong, () => false);
  assert.equal(wrong.statusCode, 404, 'a wrong phone number reveals nothing');
});

test('track marks a position stale when the last fix is over a minute old', async () => {
  const w = world();
  w.state.rides[0].driverId = 'd1'; w.state.rides[0].status = 'ontrip';
  w.location._latest = { lat: 9.02, lng: 38.77, bearing: 10, speedKph: 0, ageS: 130 };
  const res = await w.api.track({ params: { id: 'r1' }, query: {} }, reply(), () => true);
  assert.equal(res.live.position.stale, true);
  assert.equal(res.live.position.ageS, 130);
});

test('route gives the driver real road geometry, and survives a router outage', async () => {
  const w = world();
  w.state.rides[0].driverId = 'd1'; w.state.rides[0].status = 'assigned';
  w.state.drivers[0].onRideId = 'r1';
  const res = await w.api.route(w.req({ body: { lat: 9.011, lng: 38.761, to: 'pickup' } }), reply());
  assert.equal(res.ok, true);
  assert.equal(res.geometry.length, 2);
  assert.equal(res.distanceM, 5200);

  w.state.rides[0].pickup = { lat: 9.01, lng: 38.76, label: 'boom' };
  const down = await w.api.route(w.req({ body: { lat: 9.011, lng: 38.761 } }), reply());
  assert.equal(down.ok, true, 'a routing outage is not an error for the driver');
  assert.deepEqual(down.geometry, []);
  assert.equal(down.estimate, true);
});

test('route needs an active ride and a position', async () => {
  const w = world();
  const a = reply();
  await w.api.route(w.req({ body: { lat: 9.011, lng: 38.761 } }), a);
  assert.equal(a.statusCode, 409);
  assert.equal(a.body.error, 'no_active_ride');

  w.state.drivers[0].onRideId = 'r1';
  const b = reply();
  await w.api.route(w.req({ body: {} }), b);
  assert.equal(b.statusCode, 400);
});

test('the countdown comes from the live offer window, not a hardcoded 25', async () => {
  const w = world();
  w.state.offers.push({ id: 'o1', rideId: 'r1', driverId: 'd1', status: 'open', etaS: 180, distanceM: 900, round: 1, createdAt: new Date(w.clockRef.t - 10000) });

  var res = await w.api.ping(w.req({ body: { lat: 9.012, lng: 38.762 } }), reply());
  assert.equal(res.offers[0].windowS, 25);
  assert.equal(res.offers[0].expiresInS, 15, '25 s window, 10 s elapsed');

  w.state.windowS = 60;
  res = await w.api.ping(w.req({ body: { lat: 9.0121, lng: 38.7621 } }), reply());
  assert.equal(res.offers[0].windowS, 60, 'the app is told the real window');
  assert.equal(res.offers[0].expiresInS, 50, 'and the real time left');

  w.state.windowS = 5;
  res = await w.api.ping(w.req({ body: { lat: 9.0122, lng: 38.7622 } }), reply());
  assert.equal(res.offers[0].expiresInS, 0, 'a window already past reads as zero, never negative');
});
