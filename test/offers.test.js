'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeOffers } = require('../ride/offers');

const PICKUP = { lat: 9.010, lng: 38.760, label: 'Edna Mall' };
const DROP = { lat: 9.040, lng: 38.750, label: 'Piassa' };

// A hand-rolled in-memory Prisma. It enforces exactly the guards the real one does — a where clause
// that no longer matches returns count 0 — which is what makes the accept-race test meaningful.
function world(over) {
  const clockRef = { t: 1_000_000 };
  const state = {
    ride: { id: 'r1', status: 'dispatching', tier: 'economy', pickup: PICKUP, dropoff: DROP, fareEtb: 295, driverTakeEtb: 295, driverId: null, riderName: 'Sara', riderPhone: '+251911000000', distanceM: 5000, durationS: 900, requestedAt: new Date(1_000_000) },
    drivers: [
      { id: 'dA', name: 'Abel',   tier: 'economy', status: 'approved', online: true,  away: false, onRideId: null, lat: 9.011, lng: 38.761, telegramId: '111' },
      { id: 'dB', name: 'Bekele', tier: 'economy', status: 'approved', online: true,  away: false, onRideId: null, lat: 9.014, lng: 38.764, telegramId: '222' },
      { id: 'dC', name: 'Chala',  tier: 'economy', status: 'approved', online: true,  away: false, onRideId: null, lat: 9.020, lng: 38.770, telegramId: '333' },
      { id: 'dJ', name: 'Jemal',  tier: 'economy', status: 'approved', online: true,  away: false, onRideId: null, lat: 9.022, lng: 38.772, telegramId: '110' },
      { id: 'dD', name: 'Dawit',  tier: 'economy', status: 'approved', online: true,  away: false, onRideId: null, lat: 9.045, lng: 38.795, telegramId: '444' },
      { id: 'dE', name: 'Elias',  tier: 'moto',    status: 'approved', online: true,  away: false, onRideId: null, lat: 9.011, lng: 38.760, telegramId: '555' },
      { id: 'dF', name: 'Fikru',  tier: 'economy', status: 'pending',  online: true,  away: false, onRideId: null, lat: 9.011, lng: 38.760, telegramId: '666' },
      { id: 'dG', name: 'Girma',  tier: 'economy', status: 'approved', online: false, away: false, onRideId: null, lat: 9.011, lng: 38.760, telegramId: '777' },
      { id: 'dH', name: 'Hana',   tier: 'economy', status: 'approved', online: true,  away: true,  onRideId: null, lat: 9.011, lng: 38.760, telegramId: '888' },
      { id: 'dI', name: 'Ibsa',   tier: 'economy', status: 'approved', online: true,  away: false, onRideId: 'r9', lat: 9.011, lng: 38.760, telegramId: '999' },
      { id: 'dK', name: 'Kebede', tier: 'economy', status: 'approved', online: true,  away: false, onRideId: null, lat: null,  lng: null,   telegramId: '000' },
    ],
    offers: [],
  };
  Object.assign(state, over || {});
  let seq = 0;
  const sent = [], escalated = [], notified = [], timersCancelled = [];

  const prisma = {
    ride: {
      findUnique: async ({ where }) => (where.id === state.ride.id ? { ...state.ride } : null),
      updateMany: async ({ where, data }) => {
        const r = state.ride;
        if (where.id !== r.id) return { count: 0 };
        if (where.status && where.status.in && !where.status.in.includes(r.status)) return { count: 0 };
        if ('driverId' in where && where.driverId === null && r.driverId !== null) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
    },
    driver: {
      findMany: async ({ where }) => state.drivers
        .filter(d => d.status === 'approved' && d.online === true && d.away === false && d.onRideId === null && (!where.tier || d.tier === where.tier))
        .map(d => ({ ...d })),
      findUnique: async ({ where }) => state.drivers.find(d => d.id === where.id) || null,
      updateMany: async ({ where, data }) => {
        const d = state.drivers.find(x => x.id === where.id && (!('onRideId' in where) || x.onRideId === where.onRideId));
        if (!d) return { count: 0 };
        Object.assign(d, data);
        return { count: 1 };
      },
    },
    rideOffer: {
      createMany: async ({ data }) => {
        data.forEach(o => state.offers.push({ id: 'o' + (++seq), status: 'open', createdAt: new Date(clockRef.t), decidedAt: null, ...o }));
        return { count: data.length };
      },
      findMany: async ({ where }) => state.offers.filter(o => match(o, where)).map(o => ({ ...o })),
      findFirst: async ({ where }) => { const o = state.offers.find(x => match(x, where)); return o ? { ...o } : null; },
      updateMany: async ({ where, data }) => {
        let n = 0;
        for (const o of state.offers) { if (match(o, where)) { Object.assign(o, data); n++; } }
        return { count: n };
      },
    },
  };
  function match(o, where) {
    if (!where) return true;
    if (where.id && o.id !== where.id) return false;
    if (where.rideId && o.rideId !== where.rideId) return false;
    if (where.driverId && o.driverId !== where.driverId) return false;
    if (where.status && o.status !== where.status) return false;
    if (where.createdAt && !(o.createdAt < where.createdAt.lt)) return false;
    if (where.NOT && where.NOT.driverId && o.driverId === where.NOT.driverId) return false;
    return true;
  }

  // Straight-line ETA at 30 km/h keeps the ranking deterministic without touching GraphHopper.
  const geo = { route: async (from, to) => {
    const km = Math.hypot((to.lat - from.lat) * 111, (to.lng - from.lng) * 109.6);
    return { distanceM: Math.round(km * 1000), durationS: Math.round(km * 120), geometry: [], estimate: false };
  } };
  const settings = { get: async () => ({ offerWindowS: 25, conciergeAfterS: 60, radiiKm: [3, 6, 10], commissionPct: 0 }) };
  const api = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; } };
  const make = () => makeOffers({
    prisma, geo, settings, api,
    concierge: async id => { escalated.push(id); return true; },
    cancelTimer: id => timersCancelled.push(id),
    riderNotify: { notify: async (id, ev) => { notified.push(ev); return true; } },
    baseUrl: 'https://bina.et', now: () => clockRef.t,
  });
  return { state, clockRef, sent, escalated, notified, timersCancelled, make };
}

test('open() asks the nearest three eligible drivers, closest first, with Accept/Skip buttons', async () => {
  const w = world();
  const n = await w.make().open('r1');
  assert.equal(n, 3);
  assert.deepEqual(w.state.offers.map(o => o.driverId), ['dA', 'dB', 'dC'], 'nearest three by driving ETA');
  assert.equal(w.state.offers.every(o => o.status === 'open' && o.round === 1), true);
  assert.deepEqual(w.sent.map(s => s.chat), ['111', '222', '333']);
  assert.match(w.sent[0].text, /Edna Mall/);
  assert.match(w.sent[0].text, /Piassa/);
  assert.match(w.sent[0].text, /295 ETB \(0% commission\)/, 'the launch promise is on the card');
  const kb = w.sent[0].extra.reply_markup.inline_keyboard;
  assert.deepEqual(kb[0].map(b => b.callback_data), ['acc:r1', 'dec:r1']);
  assert.equal(kb[1][0].web_app.url, 'https://bina.et/drive');
  assert.ok(w.state.offers.every(o => o.etaS > 0 && o.distanceM > 0), 'ETA and distance are stored');
});

test('wrong tier, pending, offline, away, busy and location-less drivers are never asked', async () => {
  const w = world();
  await w.make().open('r1');
  const asked = w.state.offers.map(o => o.driverId);
  for (const id of ['dE', 'dF', 'dG', 'dH', 'dI', 'dK']) {
    assert.equal(asked.includes(id), false, id + ' must not be asked');
  }
});

test('two drivers accepting in the same tick: exactly one wins, the loser is told it is taken', async () => {
  const w = world();
  const offers = w.make();
  await offers.open('r1');
  const [a, b] = await Promise.all([offers.accept('r1', 'dA'), offers.accept('r1', 'dB')]);
  const wins = [a, b].filter(x => x.ok);
  assert.equal(wins.length, 1, 'exactly one winner');
  assert.equal([a, b].find(x => !x.ok).error, 'taken');
  assert.equal(w.state.ride.status, 'assigned');
  assert.equal(w.state.ride.driverId, wins[0].driverId);
  assert.ok(w.state.ride.driverAcceptedAt instanceof Date);
  assert.equal(w.state.drivers.find(d => d.id === wins[0].driverId).onRideId, 'r1', 'winner is marked busy');
  assert.equal(w.state.offers.find(o => o.driverId === wins[0].driverId).status, 'accepted');
  assert.equal(w.state.offers.filter(o => o.status === 'lost').length, 2, 'the other two offers are closed');
  assert.deepEqual(w.notified, ['assigned'], 'the rider is told exactly once');
  assert.deepEqual(w.timersCancelled, ['r1'], 'the concierge timer is cancelled');
});

test('a driver already on a ride cannot accept another', async () => {
  const w = world();
  const offers = w.make();
  await offers.open('r1');
  w.state.drivers.find(d => d.id === 'dA').onRideId = 'r-other';
  assert.equal((await offers.accept('r1', 'dA')).error, 'busy');
  assert.equal(w.state.ride.driverId, null, 'the ride is untouched');
});

test('skip closes only that offer and the driver is not asked again', async () => {
  const w = world();
  const offers = w.make();
  await offers.open('r1');
  assert.equal((await offers.decline('r1', 'dA')).ok, true);
  assert.equal(w.state.offers.find(o => o.driverId === 'dA').status, 'declined');
  assert.equal(w.state.offers.filter(o => o.status === 'open').length, 2);
  assert.equal((await offers.decline('r1', 'dA')).error, 'no_offer', 'skipping twice is a no-op');
  await offers.open('r1', 1);
  assert.equal(w.state.offers.filter(o => o.driverId === 'dA').length, 1, 'dA is asked once, never again');
});

test('expire() closes the window and widens the radius on the next round', async () => {
  const w = world();
  const offers = w.make();
  await offers.open('r1');
  w.clockRef.t += 10_000;
  assert.equal(await offers.expire(), 0, 'inside the 25 s window nothing happens');
  assert.equal(w.state.offers.filter(o => o.status === 'open').length, 3);
  w.clockRef.t += 20_000;
  assert.equal(await offers.expire(), 1, 'one ride re-dispatched');
  assert.equal(w.state.offers.filter(o => o.status === 'expired').length, 3);
  const round2 = w.state.offers.filter(o => o.round === 2);
  assert.deepEqual(round2.map(o => o.driverId).sort(), ['dD', 'dJ'], 'the 6 km ring adds dJ and dD');
  assert.deepEqual(w.escalated, [], 'no human needed yet');
});

test('every radius exhausted -> the ride is handed to the concierge', async () => {
  const w = world();
  const offers = w.make();
  await offers.open('r1');                       // round 1: dA dB dC
  w.clockRef.t += 30_000; await offers.expire(); // round 2: dJ dD
  w.clockRef.t += 30_000;
  assert.equal(await offers.expire(), 0, 'nobody left to ask');
  assert.deepEqual(w.escalated, ['r1'], 'a human takes over');
  assert.equal(w.state.ride.status, 'dispatching', 'the ride is still live, not cancelled');
});

test('open() returns 0 when nobody is online and leaves escalation to dispatch', async () => {
  const w = world();
  w.state.drivers.forEach(d => { d.online = false; });
  const offers = w.make();
  assert.equal(await offers.open('r1'), 0);
  assert.deepEqual(w.escalated, [], 'dispatch.start() owns the first escalation, not offers');
  assert.equal(w.state.offers.length, 0);
});

test('an assigned or cancelled ride is never re-offered', async () => {
  const w = world();
  const offers = w.make();
  w.state.ride.status = 'assigned'; w.state.ride.driverId = 'dA';
  assert.equal(await offers.open('r1'), 0);
  w.state.ride.status = 'cancelled'; w.state.ride.driverId = null;
  assert.equal(await offers.open('r1'), 0);
  assert.equal(await offers.open('missing'), 0);
});

test('accept is refused without an open offer or after the ride is taken', async () => {
  const w = world();
  const offers = w.make();
  assert.equal((await offers.accept('r1', 'dA')).error, 'no_offer', 'no offer yet');
  await offers.open('r1');
  assert.equal((await offers.accept('r1', 'dD')).error, 'no_offer', 'dD was never asked');
  assert.equal((await offers.accept('r1', 'dA')).ok, true);
  // Once a winner is recorded the other offers are already closed, so a late tap reads as no_offer.
  // "taken" is reserved for the true race, where the loser still holds an open offer (test 3).
  assert.equal((await offers.accept('r1', 'dB')).error, 'no_offer');
  assert.equal((await offers.accept('r1', 'dA')).error, 'no_offer', 'the winner cannot accept twice');
});
