'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ladder, rowFor } = require('../../ride/pool/ladder');
const C = require('../../ride/pool/corridors');
const { makePool } = require('../../ride/pool/pool');
const { DEFAULTS } = require('../../ride/settings');

// 07:30 Addis (UTC+3) on a weekday = 04:30 UTC
const MORNING = Date.UTC(2026, 8, 9, 4, 30);
const EVENING = Date.UTC(2026, 8, 9, 14, 30); // 17:30 Addis

test('fare ladder: every extra seat lowers the seat price and raises the driver total', () => {
  const l = ladder(380, 4, 15);
  assert.equal(l.bonusEtb, 40);
  assert.deepEqual(l.rows.map(r => [r.n, r.seatEtb, r.driverTotalEtb]), [[1, 380, 380], [2, 210, 420], [3, 155, 460], [4, 125, 500]]);
  for (let i = 1; i < l.rows.length; i++) {
    assert.ok(l.rows[i].seatEtb < l.rows[i - 1].seatEtb, 'seat price falls');
    assert.ok(l.rows[i].driverTotalEtb > l.rows[i - 1].driverTotalEtb, 'driver total rises');
    assert.ok(l.rows[i].riderTotalEtb >= l.rows[i].driverTotalEtb, 'riders together always cover the driver');
  }
  assert.equal(l.rows[3].driverTakeEtb, 425); // 500 minus 15 %
  assert.equal(rowFor(l, 9).n, 4, 'clamped to capacity');
});

test('corridors: inbound before 13:00 Addis, outbound after; nearest boarding stop never the terminus', () => {
  assert.equal(C.directionNow(MORNING), 'in');
  assert.equal(C.directionNow(EVENING), 'out');
  assert.equal(C.isPeak(MORNING), true);
  assert.equal(C.isPeak(Date.UTC(2026, 8, 9, 9, 0)), false); // 12:00 Addis
  const inb = C.activeCorridors(MORNING).find(c => c.lineId === 'megenagna-bole');
  assert.equal(inb.from.id, 'megenagna'); assert.equal(inb.to.id, 'bole');
  const out = C.activeCorridors(EVENING).find(c => c.lineId === 'megenagna-bole');
  assert.equal(out.from.id, 'bole'); assert.equal(out.to.id, 'megenagna');
  // standing at Bole in the morning: the nearest boardable stop is Gerji, not Bole itself
  const near = C.nearestStop(inb, 8.9975, 38.7876);
  assert.equal(near.stop.id, 'gerji');
  assert.equal(C.byKey('nope:in'), null);
  assert.equal(C.byKey('megenagna-bole:sideways'), null);
});

// ---- in-memory Prisma for pools ----
function world() {
  const clock = { t: MORNING };
  const db = { pools: [], seats: [], riders: [], rides: [] };
  let seq = 0; const id = p => p + (++seq);
  const match = (row, where) => Object.keys(where).every(k => {
    const w = where[k];
    if (k === 'pool') return db.pools.some(p => p.id === row.poolId && match(p, w));
    if (w && typeof w === 'object' && !(w instanceof Date)) {
      if ('in' in w) return w.in.includes(row[k]);
      if ('gt' in w) return new Date(row[k]).getTime() > new Date(w.gt).getTime();
      if ('lte' in w) return new Date(row[k]).getTime() <= new Date(w.lte).getTime();
    }
    return row[k] === w;
  });
  const sorted = (rows, orderBy) => { if (!orderBy) return rows; const k = Object.keys(orderBy)[0], dir = orderBy[k] === 'desc' ? -1 : 1; return rows.slice().sort((a, b) => (new Date(a[k]) - new Date(b[k])) * dir); };
  const table = (rows, mk) => ({
    findFirst: async ({ where, orderBy }) => { const r = sorted(rows.filter(x => match(x, where)), orderBy)[0]; return r ? { ...r } : null; },
    findMany: async ({ where, orderBy, take }) => sorted(rows.filter(x => match(x, where || {})), orderBy).slice(0, take || 1e9).map(x => ({ ...x })),
    findUnique: async ({ where, include }) => { const r = rows.find(x => Object.keys(where).every(k => x[k] === where[k])); if (!r) return null; const o = { ...r }; if (include && include.driver) o.driver = r.driverId ? { name: 'Abel', plate: 'B12345', phone: '+251911000999', rating: 5 } : null; return o; },
    create: async ({ data }) => { const r = mk(data); rows.push(r); return { ...r }; },
    update: async ({ where, data }) => { const r = rows.find(x => x.id === where.id); Object.assign(r, data); return { ...r }; },
    updateMany: async ({ where, data }) => { const hit = rows.filter(x => match(x, where)); hit.forEach(x => Object.assign(x, data)); return { count: hit.length }; },
    upsert: async ({ where, update, create }) => { let r = rows.find(x => x.phone === where.phone); if (r) Object.assign(r, update); else { r = { id: id('rd'), telegramId: null, ...create }; rows.push(r); } return { ...r }; },
  });
  const prisma = {
    pool: table(db.pools, d => ({ id: id('p'), rideId: null, seatFareEtb: null, dispatchedAt: null, ...d })),
    poolSeat: table(db.seats, d => ({ id: id('s'), fareEtb: null, ...d })),
    rider: table(db.riders, d => ({ id: id('rd'), telegramId: null, ...d })),
    ride: table(db.rides, d => ({ id: id('r'), driverId: null, concierge: false, paymentStatus: 'unpaid', requestedAt: new Date(clock.t), ...d })),
  };
  const started = [], sent = [];
  const settings = { get: async () => DEFAULTS };
  const geo = { route: async () => ({ distanceM: 6200, durationS: 900, geometry: [[38.8, 9.02], [38.79, 9.0]], estimate: false }) };
  const dispatch = { start: async rid => { started.push(rid); return 'waiting'; } };
  const api = { sendMessage: async (chat, text) => { sent.push({ chat, text }); } };
  const pool = makePool({ prisma, geo, settings, dispatch, api, baseUrl: 'https://bina.et', now: () => clock.t });
  return { pool, prisma, db, clock, started, sent };
}
const KEY = 'megenagna-bole:in';
const rider = (n, i) => ({ corridorKey: KEY, stopId: 'megenagna', mode: 'wait', name: n, phone: '+2519110000' + i });

test('list: corridors sorted by nearest stop, with the ladder and the car fare', async () => {
  const { pool } = world();
  const l = await pool.list(9.0206, 38.8010); // standing at Megenagna
  assert.equal(l.dir, 'in'); assert.equal(l.peak, true); assert.equal(l.waitS, 480);
  assert.equal(l.corridors[0].nearest.stop.id, 'megenagna');
  assert.ok(l.corridors[0].nearest.distM < 50);
  assert.equal(l.corridors[0].ladder.length, 4);
  assert.equal(l.corridors[0].carFareEtb, l.corridors[0].ladder[0].seatEtb);
  assert.equal(l.corridors[0].waiting, 0);
});

test('join: first rider opens a pool with an 8 min wait; a second tap is idempotent; a full car leaves as ONE ride', async () => {
  const w = world();
  const a = await w.pool.join(rider('Sara', 1));
  assert.equal(a.ok, true); assert.equal(a.pool.status, 'filling'); assert.equal(a.pool.filled, 1); assert.equal(a.pool.leavesInS, 480);
  assert.equal(a.seat.fareEtb, a.pool.ladder[0].seatEtb, 'alone: the full car fare');
  const again = await w.pool.join(rider('Sara', 1));
  assert.equal(again.duplicate, true); assert.equal(w.db.seats.length, 1);
  await w.pool.join({ ...rider('Beti', 2), stopId: 'imperial' });
  await w.pool.join(rider('Chala', 3));
  const d = await w.pool.join({ ...rider('Dawit', 4), stopId: 'gerji' });
  assert.equal(w.db.pools.length, 1, 'all four in the same car');
  assert.equal(d.pool.status, 'dispatching');
  assert.equal(w.started.length, 1, 'one ride handed to the auction');
  const ride = w.db.rides[0];
  const l = ladder(d.pool.ladder[0].seatEtb, 4, DEFAULTS.commissionPct); // n=1 seat price IS the car fare
  assert.equal(ride.fareEtb, l.rows[3].driverTotalEtb, 'ride fare = driver total at n=4');
  assert.equal(ride.driverTakeEtb, l.rows[3].driverTakeEtb);
  assert.equal(ride.riderName.startsWith('Pool · 4 riders'), true);
  assert.equal(ride.pickup.lat, C.STOPS.megenagna.lat, 'pickup = earliest boarding stop');
  assert.equal(ride.dropoff.lat, C.STOPS.bole.lat, 'drop-off = corridor end');
  assert.ok(w.db.seats.every(s => s.fareEtb === d.pool.seatFareEtb), 'every seat priced at the n=4 row');
  assert.equal(d.pool.seatFareEtb * 4 >= ride.fareEtb, true);
  // a fifth rider opens the NEXT car
  const e = await w.pool.join(rider('Eden', 5));
  assert.equal(w.db.pools.length, 2); assert.equal(e.pool.filled, 1);
});

test('sweep: when the wait runs out the car leaves with whoever is in it, priced for that count', async () => {
  const w = world();
  await w.pool.join(rider('Sara', 1)); await w.pool.join(rider('Beti', 2));
  assert.equal(await w.pool.sweep(), 0, 'not yet');
  w.clock.t += 481 * 1000;
  assert.equal(await w.pool.sweep(), 1);
  const v = await w.pool.view(w.db.pools[0].id, '+25191100001');
  assert.equal(v.pool.status, 'dispatching'); assert.equal(v.pool.filled, 2);
  assert.equal(v.seat.fareEtb, v.pool.ladder[1].seatEtb);
  assert.equal(w.db.rides[0].fareEtb, v.pool.ladder[1].driverTotalEtb);
  assert.equal(await w.pool.sweep(), 0, 'dispatch is a one-way mutex');
});

test('go now: leaves immediately; a later "go now" on a filling car shortens everybody\'s wait', async () => {
  const w = world();
  const a = await w.pool.join({ ...rider('Sara', 1), mode: 'now' });
  assert.equal(a.pool.status, 'dispatching'); assert.equal(a.seat.fareEtb, a.pool.ladder[0].seatEtb);
  const b = await w.pool.join(rider('Beti', 2)); // new car, waiting
  assert.equal(b.pool.status, 'filling'); assert.equal(w.db.pools.length, 2);
  const c = await w.pool.join({ ...rider('Chala', 3), mode: 'now' });
  assert.equal(c.pool.id, b.pool.id); assert.equal(c.pool.status, 'dispatching'); assert.equal(c.pool.filled, 2);
});

test('leave: free while filling, empty pool closes; refused once the car is leaving', async () => {
  const w = world();
  const a = await w.pool.join(rider('Sara', 1));
  const r = await w.pool.leave(a.pool.id, '+25191100001');
  assert.equal(r.ok, true); assert.equal(r.left, 0);
  assert.equal(w.db.pools[0].status, 'cancelled');
  const b = await w.pool.join({ ...rider('Beti', 2), mode: 'now' });
  const no = await w.pool.leave(b.pool.id, '+25191100002');
  assert.equal(no.ok, false); assert.equal(no.error, 'car_already_leaving');
});

test('view is private to seat holders; wrong corridor, terminus stop and evening direction are refused', async () => {
  const w = world();
  const a = await w.pool.join(rider('Sara', 1));
  assert.equal((await w.pool.view(a.pool.id, '+251911999999')).ok, false);
  assert.equal((await w.pool.join({ ...rider('X', 7), stopId: 'bole' })).error, 'pick_a_boarding_stop');
  assert.equal((await w.pool.join({ ...rider('X', 7), corridorKey: 'megenagna-bole:out' })).error, 'corridor_not_running_now');
  assert.equal((await w.pool.join({ ...rider('X', 7), corridorKey: 'nope:in' })).error, 'unknown_corridor');
});

test('driver: seat list on the ride, boarding only by the assigned driver; tracking auth for every seat', async () => {
  const w = world();
  await w.pool.join(rider('Sara', 1)); await w.pool.join({ ...rider('Beti', 2), mode: 'now' });
  const ride = w.db.rides[0]; ride.driverId = 'dA'; ride.status = 'assigned';
  const info = await w.pool.seatsForRide(ride.id);
  assert.equal(info.seats.length, 2); assert.equal(info.corridor.name, 'Megenagna → Bole Medhanialem');
  assert.equal((await w.pool.board(ride.id, 'dZ', info.seats[0].id, 'boarded')).error, 'not_your_ride');
  const ok = await w.pool.board(ride.id, 'dA', info.seats[0].id, 'boarded');
  assert.equal(ok.ok, true); assert.equal(ok.pool.seats[0].status, 'boarded');
  assert.equal(await w.pool.phoneMayTrack(ride.id, '+25191100002'), true, 'second rider may track');
  assert.equal(await w.pool.phoneMayTrack(ride.id, '+251911000077'), false);
});

test('telegram: dispatched and assigned pushes reach every seat that came through the bot, with its own price', async () => {
  const w = world();
  await w.pool.join({ ...rider('Sara', 1), telegramId: 111 });
  await w.pool.join({ ...rider('Beti', 2), telegramId: 222, mode: 'now' });
  await new Promise(r => setImmediate(r));
  assert.equal(w.sent.filter(m => /Pool car is leaving/.test(m.text)).length, 2);
  const ride = w.db.rides[0]; ride.driverId = 'dA'; ride.status = 'assigned';
  const n = await w.pool.notifyRideEvent(ride.id, 'assigned');
  assert.equal(n, 2);
  assert.match(w.sent[w.sent.length - 1].text, /plate B12345/);
  assert.match(w.sent[w.sent.length - 1].text, /210 ETB|155 ETB|125 ETB|\d+ ETB/);
});
