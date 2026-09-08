'use strict';
// BinaPool lifecycle. A pool is a car being filled: either on a fixed commute corridor (riders board at
// its stops) or a "group near me" any rider starts from where they stand to any destination. Riders
// join a seat; the car leaves when full or when the wait runs out; then the normal ride machinery
// (dispatch auction, driver app, tracking) carries it as ONE Ride whose fare is the ladder's driver total.
//   filling -> dispatching -> (the Ride's own status: assigned/arriving/arrived/ontrip/completed) | cancelled
// Timers are not used: sweep() is scheduled by ride/index.js and dispatches anything whose time is up,
// so a restart can never strand a pool. Clock is injectable for tests.
const { quoteFare } = require('../fare');
const { ladder, rowFor } = require('./ladder');
const C = require('./corridors');

const WAIT_S = 8 * 60;           // "wait to pay less" window
const DRIVER_WAIT_S = 15 * 60;   // a driver filling a car at a station waits longer than a rider would
const NOSHOW_STRIKES = 2;        // from the 2nd no-show in 30 days a rider can only "Go now" (no held seats)
const NOSHOW_WINDOW_MS = 30 * 86400000;
const QUOTE_TTL_MS = 30 * 60000;  // car-fare cache per pool spec
const NEAR_M = 2500;              // "near me": pools whose boarding point is within this radius
const JOIN_MAX_M = 3000;          // a custom group can be joined only from near its start
const OPEN = ['filling', 'dispatching', 'assigned', 'arriving', 'arrived', 'ontrip'];

function makePool({ prisma, geo, settings, dispatch, api, baseUrl, now, waitS, dstate }) {
  const clock = now || Date.now;
  const wait = (waitS == null ? WAIT_S : waitS);
  const quotes = new Map(); // spec key -> { at, q }

  // The no-show rule. A rider who let the car leave without them twice this month may still ride,
  // but only by "Go now": they cannot hold a seat that others wait for.
  async function strikes(phone) {
    if (!prisma.rider || !prisma.rider.findUnique) return 0;
    const r = await prisma.rider.findUnique({ where: { phone } }).catch(() => null);
    if (!r || !r.noShows || !r.lastNoShowAt) return 0;
    return (clock() - new Date(r.lastNoShowAt).getTime() < NOSHOW_WINDOW_MS) ? r.noShows : 0;
  }
  async function mayHold(phone, mode) {
    if (mode === 'now') return null;
    return (await strikes(phone)) >= NOSHOW_STRIKES ? { ok: false, error: 'go_now_only', strikes: await strikes(phone) } : null;
  }

  // What a pool runs on: a corridor (stops, both ends fixed) or a custom start -> destination.
  function specOf(pool) {
    if (pool.kind === 'custom' || pool.kind === 'driver') {
      const from = { id: 'origin', label: pool.pickup.label, labelAm: pool.pickup.labelAm || pool.pickup.label, lat: pool.pickup.lat, lng: pool.pickup.lng };
      const to = { id: 'dest', label: pool.dropoff.label, labelAm: pool.dropoff.labelAm || pool.dropoff.label, lat: pool.dropoff.lat, lng: pool.dropoff.lng };
      return { key: 'custom:' + pool.id, kind: 'custom', tier: pool.tier, from, to, stops: [from, to], name: from.label + ' → ' + to.label, nameAm: from.labelAm + ' → ' + to.labelAm };
    }
    const c = C.byKey(pool.corridorKey);
    return c ? { ...c, kind: 'corridor' } : null;
  }

  // The car fare for the whole run, from the fixed-fare engine. Cached; a routing failure falls back
  // to straight-line x 1.3 at 22 km/h so the pool never goes dark because GraphHopper hiccuped.
  async function quoteFor(spec) {
    const hit = quotes.get(spec.key);
    if (hit && clock() - hit.at < QUOTE_TTL_MS) return hit.q;
    const s = await settings.get();
    let r;
    try { r = await geo.route(spec.from, spec.to); }
    catch (e) { const m = C.haversineM(spec.from, spec.to) * 1.3; r = { distanceM: Math.round(m), durationS: Math.round(m / 6.1), geometry: [], estimate: true }; }
    const f = quoteFare(s, spec.tier, r.distanceM, r.durationS);
    const seats = (s.tiers[spec.tier] && s.tiers[spec.tier].seats) || 4;
    const q = { distanceM: r.distanceM, durationS: r.durationS, estimate: !!r.estimate, geometry: r.geometry || [],
      carFareEtb: f.fareEtb, seats, ladder: ladder(f.fareEtb, seats, s.commissionPct) };
    quotes.set(spec.key, { at: clock(), q });
    return q;
  }
  const corridorQuote = c => quoteFor({ ...c, kind: 'corridor' });

  async function openPoolFor(key) {
    return prisma.pool.findFirst({ where: { corridorKey: key, status: 'filling', dispatchAt: { gt: new Date(clock()) } }, orderBy: { openedAt: 'asc' } });
  }
  async function heldSeats(poolId) { return prisma.poolSeat.findMany({ where: { poolId, status: { in: ['held', 'boarded'] } }, orderBy: { joinedAt: 'asc' } }); }
  async function mySeat(phone) {
    return prisma.poolSeat.findFirst({ where: { riderPhone: phone, status: { in: ['held', 'boarded'] }, pool: { status: { in: OPEN } } } });
  }

  // What the rider sees before joining: every corridor today, nearest stop, the ladder, who is waiting.
  async function list(lat, lng) {
    const ms = clock();
    const out = [];
    for (const c of C.activeCorridors(ms)) {
      const q = await corridorQuote(c);
      const pool = await openPoolFor(c.key);
      const seats = pool ? await heldSeats(pool.id) : [];
      const near = (lat != null && lng != null) ? C.nearestStop(c, lat, lng) : null;
      out.push({ key: c.key, dir: c.dir, name: c.name, nameAm: c.nameAm, tier: c.tier, stops: c.stops, from: c.from, to: c.to,
        distanceM: q.distanceM, durationS: q.durationS, carFareEtb: q.carFareEtb, seats: q.seats, ladder: q.ladder.rows,
        nearest: near, waiting: seats.length, leavesInS: pool ? Math.max(0, Math.round((new Date(pool.dispatchAt).getTime() - ms) / 1000)) : null });
    }
    const dist = c => (c.nearest && c.nearest.distM != null) ? c.nearest.distM : 1e9;
    if (lat != null && lng != null) out.sort((a, b) => dist(a) - dist(b));
    return { peak: C.isPeak(ms), dir: C.directionNow(ms), waitS: wait, corridors: out };
  }

  // Groups near me: every car still filling whose boarding point is within reach, nearest first.
  async function near(lat, lng, radiusM) {
    const ms = clock();
    const R = radiusM || NEAR_M;
    const pools = await prisma.pool.findMany({ where: { status: 'filling', dispatchAt: { gt: new Date(ms) } }, orderBy: { openedAt: 'asc' }, take: 100 });
    const out = [];
    for (const p of pools) {
      const spec = specOf(p); if (!spec) continue;
      const seats = await heldSeats(p.id);
      // an empty car is offered only when its driver is already there waiting
      if ((!seats.length && !p.driverId) || seats.length >= p.seats) continue;
      const q = await quoteFor(spec);
      const board = spec.kind === 'custom' ? { stop: spec.from, distM: Math.round(C.haversineM({ lat, lng }, spec.from)) } : C.nearestStop(spec, lat, lng);
      if (!board || board.distM > R) continue;
      const nowRow = rowFor(q.ladder, seats.length + 1), full = rowFor(q.ladder, q.seats);
      out.push({ id: p.id, kind: spec.kind, corridorKey: p.corridorKey, name: spec.name, nameAm: spec.nameAm, from: spec.from, to: spec.to,
        board: board.stop, distM: board.distM, filled: seats.length, seats: p.seats, leavesInS: Math.max(0, Math.round((new Date(p.dispatchAt).getTime() - ms) / 1000)),
        seatIfJoinEtb: nowRow.seatEtb, seatIfFullEtb: full.seatEtb, distanceM: q.distanceM, durationS: q.durationS,
        womenOnly: !!p.womenOnly, driverWaiting: !!p.driverId,
        riders: seats.map(s => String(s.riderName || '').split(' ')[0]) });
    }
    // A car with its driver already waiting beats one still hoping for a driver; then nearest first.
    out.sort((a, b) => (b.driverWaiting - a.driverWaiting) || (a.distM - b.distM));
    return { groups: out, radiusM: R };
  }

  // The public card behind a share link (/pool/<id>): no phones, no seat ids.
  async function pub(poolId) {
    const p = await prisma.pool.findUnique({ where: { id: poolId } });
    if (!p) return null;
    const spec = specOf(p); if (!spec) return null;
    const seats = await heldSeats(p.id);
    const q = await quoteFor(spec);
    const ms = clock();
    const open = p.status === 'filling' && new Date(p.dispatchAt).getTime() > ms && seats.length < p.seats;
    const nowRow = rowFor(q.ladder, Math.min(q.seats, seats.length + 1)), full = rowFor(q.ladder, q.seats);
    return { id: p.id, kind: spec.kind, status: p.status, open, name: spec.name, nameAm: spec.nameAm, board: spec.from, to: spec.to,
      filled: seats.length, seats: p.seats, leavesInS: open ? Math.max(0, Math.round((new Date(p.dispatchAt).getTime() - ms) / 1000)) : 0,
      seatIfJoinEtb: nowRow.seatEtb, seatIfFullEtb: full.seatEtb, womenOnly: !!p.womenOnly, driverWaiting: !!p.driverId,
      riders: seats.map(s => String(s.riderName || '').split(' ')[0]), stops: spec.stops };
  }

  async function addSeat(pool, spec, { stopId, mode, name, phone, telegramId, paymentMethod }) {
    const ms = clock();
    if (mode === 'now' && new Date(pool.dispatchAt).getTime() > ms) {
      // "Go now" shortens the wait for everyone in this car: it leaves with whoever is in it.
      pool = await prisma.pool.update({ where: { id: pool.id }, data: { dispatchAt: new Date(ms) } });
    }
    const rider = await prisma.rider.upsert({ where: { phone }, update: { name }, create: { phone, name } });
    if (telegramId && rider.telegramId !== String(telegramId)) await prisma.rider.update({ where: { id: rider.id }, data: { telegramId: String(telegramId) } });
    await prisma.poolSeat.create({ data: { poolId: pool.id, riderId: rider.id, riderName: name, riderPhone: phone, telegramId: telegramId ? String(telegramId) : null,
      stopId, status: 'held', paymentMethod: paymentMethod === 'chapa' ? 'chapa' : 'cash', joinedAt: new Date(ms) } });
    const n = (await heldSeats(pool.id)).length;
    if (n >= pool.seats || new Date(pool.dispatchAt).getTime() <= ms) await dispatchPool(pool.id);
    return { ok: true, ...(await view(pool.id, phone)) };
  }

  // Join a corridor pool (idempotent per phone: a second tap returns the seat already held).
  async function join({ corridorKey, stopId, mode, name, phone, telegramId, paymentMethod }) {
    const c = C.byKey(corridorKey);
    if (!c) return { ok: false, error: 'unknown_corridor' };
    if (c.dir !== C.directionNow(clock())) return { ok: false, error: 'corridor_not_running_now' };
    const si = C.stopIndex(c, stopId);
    if (si < 0 || si === c.stops.length - 1) return { ok: false, error: 'pick_a_boarding_stop' };
    if (!name || !phone) return { ok: false, error: 'name_and_phone_required' };
    const mine = await mySeat(phone);
    if (mine) return { ok: true, duplicate: true, ...(await view(mine.poolId, phone)) };
    const held = await mayHold(phone, mode); if (held) return held;
    const q = await corridorQuote(c);
    const ms = clock();
    let pool = await openPoolFor(c.key);
    if (pool && (await heldSeats(pool.id)).length >= pool.seats) pool = null; // full and about to leave: open the next car
    if (!pool) {
      pool = await prisma.pool.create({ data: { kind: 'corridor', corridorKey: c.key, tier: c.tier, seats: q.seats, status: 'filling',
        openedAt: new Date(ms), dispatchAt: new Date(ms + (mode === 'now' ? 0 : wait) * 1000) } });
    }
    return addSeat(pool, c, { stopId, mode, name, phone, telegramId, paymentMethod });
  }

  // Start a group from where I stand to anywhere in Addis. Others nearby see it under "near me".
  async function create({ pickup, dropoff, mode, name, phone, telegramId, paymentMethod, womenOnly }) {
    if (!pickup || !dropoff) return { ok: false, error: 'pickup_and_dropoff_required' };
    if (!name || !phone) return { ok: false, error: 'name_and_phone_required' };
    if (C.haversineM(pickup, dropoff) < 400) return { ok: false, error: 'too_close' };
    const mine = await mySeat(phone);
    if (mine) return { ok: true, duplicate: true, ...(await view(mine.poolId, phone)) };
    const held = await mayHold(phone, mode); if (held) return held;
    const s = await settings.get();
    const tier = C.TIER, seats = (s.tiers[tier] && s.tiers[tier].seats) || 4;
    const ms = clock();
    const pool = await prisma.pool.create({ data: { kind: 'custom', corridorKey: 'custom', tier, seats, status: 'filling', createdBy: phone, womenOnly: !!womenOnly,
      pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label }, dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label },
      openedAt: new Date(ms), dispatchAt: new Date(ms + (mode === 'now' ? 0 : wait) * 1000) } });
    return addSeat(pool, specOf(pool), { stopId: 'origin', mode, name, phone, telegramId, paymentMethod });
  }

  // Join a specific car from the "near me" list. Corridor cars take a boarding stop; custom groups
  // board at their start, and only riders actually near it may join.
  async function joinById(poolId, { stopId, mode, name, phone, telegramId, paymentMethod, lat, lng, female }) {
    if (!name || !phone) return { ok: false, error: 'name_and_phone_required' };
    const pool = await prisma.pool.findUnique({ where: { id: poolId } });
    if (!pool) return { ok: false, error: 'not_found' };
    const spec = specOf(pool); if (!spec) return { ok: false, error: 'not_found' };
    const mine = await mySeat(phone);
    if (mine) return { ok: true, duplicate: true, ...(await view(mine.poolId, phone)) };
    if (pool.womenOnly && female !== true) return { ok: false, error: 'women_only' };
    const held = await mayHold(phone, mode); if (held) return held;
    if (pool.status !== 'filling' || new Date(pool.dispatchAt).getTime() <= clock()) return { ok: false, error: 'car_already_leaving' };
    if ((await heldSeats(pool.id)).length >= pool.seats) return { ok: false, error: 'car_full' };
    let sid = 'origin';
    if (spec.kind === 'corridor') {
      const si = C.stopIndex(spec, stopId);
      if (si < 0 || si === spec.stops.length - 1) return { ok: false, error: 'pick_a_boarding_stop' };
      sid = stopId;
    } else if (lat != null && lng != null && C.haversineM({ lat, lng }, spec.from) > JOIN_MAX_M) {
      return { ok: false, error: 'too_far_from_group' };
    }
    return addSeat(pool, spec, { stopId: sid, mode, name, phone, telegramId, paymentMethod });
  }

  // ---- driver-opened cars: a driver at a station fills a car like a minibus, at the fixed seat price ----
  async function openByDriver(driver, { pickup, dropoff, womenOnly }) {
    if (!driver || driver.status !== 'approved') return { ok: false, error: 'not_approved' };
    if (driver.onRideId) return { ok: false, error: 'finish_your_ride_first' };
    if (!pickup || !dropoff) return { ok: false, error: 'pickup_and_dropoff_required' };
    if (C.haversineM(pickup, dropoff) < 400) return { ok: false, error: 'too_close' };
    const open = await prisma.pool.findFirst({ where: { driverId: driver.id, status: 'filling' } });
    if (open) return { ok: true, duplicate: true, ...(await driverView(open.id)) };
    const s = await settings.get();
    const tier = (s.tiers[driver.tier] ? driver.tier : C.TIER), seats = (s.tiers[tier] && s.tiers[tier].seats) || 4;
    const ms = clock();
    const pool = await prisma.pool.create({ data: { kind: 'driver', corridorKey: 'custom', tier, seats, status: 'filling', driverId: driver.id, womenOnly: !!womenOnly,
      pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label }, dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label },
      openedAt: new Date(ms), dispatchAt: new Date(ms + DRIVER_WAIT_S * 1000) } });
    return { ok: true, ...(await driverView(pool.id)) };
  }
  // What the driver's screen shows while the car fills.
  async function driverView(poolId) {
    const pool = await prisma.pool.findUnique({ where: { id: poolId } });
    if (!pool) return { pool: null };
    const spec = specOf(pool), q = await quoteFor(spec), seats = await heldSeats(pool.id);
    const n = seats.length, row = rowFor(q.ladder, Math.max(1, n));
    return { pool: { id: pool.id, status: pool.status, name: spec.name, nameAm: spec.nameAm, from: spec.from, to: spec.to, seats: pool.seats, filled: n, womenOnly: !!pool.womenOnly,
      leavesInS: pool.status === 'filling' ? Math.max(0, Math.round((new Date(pool.dispatchAt).getTime() - clock()) / 1000)) : 0,
      seatFareEtb: pool.seatFareEtb || row.seatEtb, driverTakeEtb: n ? row.driverTakeEtb : 0, ladder: q.ladder.rows, rideId: pool.rideId,
      riders: seats.map(s => ({ id: s.id, name: String(s.riderName || '').split(' ')[0], phone: s.riderPhone, status: s.status })) } };
  }
  async function driverOpenPool(driverId) {
    if (!prisma.pool) return null;
    const p = await prisma.pool.findFirst({ where: { driverId, status: 'filling' } });
    return p ? (await driverView(p.id)).pool : null;
  }
  // "Leave now": the driver goes with whoever is in the car (at least one rider).
  async function driverGo(poolId, driverId) {
    const pool = await prisma.pool.findUnique({ where: { id: poolId } });
    if (!pool || pool.driverId !== driverId) return { ok: false, error: 'not_your_pool' };
    if (pool.status !== 'filling') return { ok: false, error: 'car_already_leaving' };
    if (!(await heldSeats(poolId)).length) return { ok: false, error: 'no_riders_yet' };
    await prisma.pool.update({ where: { id: poolId }, data: { dispatchAt: new Date(clock()) } });
    const ride = await dispatchPool(poolId);
    return ride ? { ok: true, rideId: ride.id } : { ok: false, error: 'car_already_leaving' };
  }
  // Close an unfilled car: riders already in it are told, the pool is cancelled.
  async function driverClose(poolId, driverId) {
    const pool = await prisma.pool.findUnique({ where: { id: poolId } });
    if (!pool || pool.driverId !== driverId) return { ok: false, error: 'not_your_pool' };
    if (pool.status !== 'filling') return { ok: false, error: 'car_already_leaving' };
    await notifySeats(poolId, 'cancelled').catch(() => {});
    await prisma.poolSeat.updateMany({ where: { poolId, status: 'held' }, data: { status: 'cancelled' } });
    await prisma.pool.updateMany({ where: { id: poolId, status: 'filling' }, data: { status: 'cancelled' } });
    return { ok: true };
  }

  // Turns a full/expired pool into one Ride: a driver-opened car goes straight to its driver, any other
  // car goes to the auction. DB-level mutex on status.
  async function dispatchPool(poolId) {
    const won = await prisma.pool.updateMany({ where: { id: poolId, status: 'filling' }, data: { status: 'dispatching' } });
    if (won.count === 0) return null;
    const pool = await prisma.pool.findUnique({ where: { id: poolId } });
    const seats = await heldSeats(poolId);
    if (!seats.length) { await prisma.pool.update({ where: { id: poolId }, data: { status: 'cancelled' } }); return null; }
    const spec = specOf(pool);
    const q = await quoteFor(spec);
    const row = rowFor(q.ladder, seats.length);
    // Pickup = the earliest boarding stop anybody chose; drop-off = the run's end.
    const firstIdx = Math.min(...seats.map(s => Math.max(0, C.stopIndex(spec, s.stopId))));
    const pickup = spec.stops[firstIdx], dropoff = spec.to;
    const label = s => s.labelAm && s.labelAm !== s.label ? s.label + ' · ' + s.labelAm : s.label;
    const lead = seats[0];
    // The driver who opened the car takes it, if they are still free; otherwise the auction finds one.
    let driverId = null;
    if (pool.driverId && dstate) { if (await dstate.claim(prisma, pool.driverId, 'pool:' + poolId)) driverId = pool.driverId; }
    const at = new Date(clock());
    const ride = await prisma.ride.create({ data: {
      riderId: lead.riderId, tier: spec.tier, driverId,
      pickup: { lat: pickup.lat, lng: pickup.lng, label: 'ጋራ · Pool · ' + label(pickup) },
      dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: label(dropoff) },
      distanceM: q.distanceM, durationS: q.durationS, estimate: q.estimate,
      fareEtb: row.driverTotalEtb, driverTakeEtb: row.driverTakeEtb, paymentMethod: 'cash',
      status: driverId ? 'arrived' : 'dispatching', assignedAt: driverId ? at : null, arrivedAt: driverId ? at : null, driverAcceptedAt: driverId ? at : null,
      riderName: 'Pool · ' + seats.length + ' riders · ' + lead.riderName, riderPhone: lead.riderPhone } });
    if (driverId) await prisma.driver.updateMany({ where: { id: driverId }, data: { onRideId: ride.id } }); // swap the placeholder claim for the real ride id
    await prisma.pool.update({ where: { id: poolId }, data: { rideId: ride.id, seatFareEtb: row.seatEtb, dispatchedAt: at } });
    await prisma.poolSeat.updateMany({ where: { poolId, status: { in: ['held', 'boarded'] } }, data: { fareEtb: row.seatEtb } });
    if (!driverId && dispatch) dispatch.start(ride.id).catch(e => console.error('[pool] dispatch.start failed for ride ' + ride.id + ': ' + e.message));
    notifySeats(poolId, driverId ? 'assigned' : 'dispatched').catch(() => {});
    console.log('[pool] ' + poolId + ' -> ride ' + ride.id + ' · ' + seats.length + ' seat(s) · ' + row.seatEtb + ' ETB each' + (driverId ? ' · driver ' + driverId + ' (station car)' : ''));
    return ride;
  }

  // Scheduled by ride/index.js: anything whose wait ran out leaves now.
  async function sweep() {
    const due = await prisma.pool.findMany({ where: { status: 'filling', dispatchAt: { lte: new Date(clock()) } }, select: { id: true }, take: 50 });
    let n = 0;
    for (const p of due) { try { if (await dispatchPool(p.id)) n++; } catch (e) { console.error('[pool] sweep failed for ' + p.id + ': ' + e.message); } }
    return n;
  }

  function pubRide(ride) {
    if (!ride) return null;
    const d = ride.driver;
    return { id: ride.id, status: ride.status, concierge: ride.concierge, tier: ride.tier, pickup: ride.pickup, dropoff: ride.dropoff,
      distanceM: ride.distanceM, durationS: ride.durationS, fareEtb: ride.fareEtb, paymentMethod: ride.paymentMethod, paymentStatus: ride.paymentStatus,
      requestedAt: ride.requestedAt, assignedAt: ride.assignedAt, completedAt: ride.completedAt, cancelledAt: ride.cancelledAt, driverRating: ride.driverRating,
      driver: d ? { name: d.name, phone: d.phone, photo: d.photo, carPhoto: d.carPhotoUrl || null, plate: d.plate, vehicle: [d.vehicleColour, d.vehicleMake].filter(Boolean).join(' '), rating: d.rating, tier: d.tier } : null };
  }

  // The rider's poll. Phone must hold a seat (any status) in this pool.
  async function view(poolId, phone) {
    const pool = await prisma.pool.findUnique({ where: { id: poolId } });
    if (!pool) return { ok: false, error: 'not_found' };
    const all = await prisma.poolSeat.findMany({ where: { poolId }, orderBy: { joinedAt: 'asc' } });
    const mine = all.find(s => s.riderPhone === phone);
    if (!mine) return { ok: false, error: 'not_found' };
    const spec = specOf(pool);
    const q = await quoteFor(spec);
    const seats = all.filter(s => s.status === 'held' || s.status === 'boarded');
    const ride = pool.rideId ? await prisma.ride.findUnique({ where: { id: pool.rideId }, include: { driver: true } }) : null;
    const status = ride ? ride.status : pool.status;
    const n = seats.length;
    const row = rowFor(q.ladder, Math.max(1, n));
    const myStop = spec.stops.find(s => s.id === mine.stopId) || spec.from;
    return { ok: true, pool: { id: pool.id, kind: spec.kind, status, womenOnly: !!pool.womenOnly, driverWaiting: !!pool.driverId, corridor: { key: spec.key, name: spec.name, nameAm: spec.nameAm, stops: spec.stops, from: spec.from, to: spec.to },
      seats: pool.seats, filled: n, leavesInS: pool.status === 'filling' ? Math.max(0, Math.round((new Date(pool.dispatchAt).getTime() - clock()) / 1000)) : 0,
      seatFareEtb: pool.seatFareEtb || row.seatEtb, ladder: q.ladder.rows,
      riders: seats.map(s => ({ name: String(s.riderName || '').split(' ')[0], stopId: s.stopId, status: s.status, me: s.riderPhone === phone })) },
      seat: { id: mine.id, status: mine.status, stop: myStop, fareEtb: mine.fareEtb || row.seatEtb, paymentMethod: mine.paymentMethod },
      ride: pubRide(ride) };
  }

  // Telegram resume: the newest live seat this user holds, as a full view.
  async function mine(telegramId) {
    const seat = await prisma.poolSeat.findFirst({ where: { telegramId: String(telegramId), status: { in: ['held', 'boarded'] }, pool: { status: { in: OPEN } } }, orderBy: { joinedAt: 'desc' } });
    if (!seat) return { pool: null };
    const v = await view(seat.poolId, seat.riderPhone);
    return v.ok ? { pool: v.pool, seat: v.seat, ride: v.ride, phone: seat.riderPhone } : { pool: null };
  }

  // Leaving is free while the car is still filling. Once it is dispatched, the seat is committed.
  async function leave(poolId, phone) {
    const pool = await prisma.pool.findUnique({ where: { id: poolId } });
    if (!pool) return { ok: false, error: 'not_found' };
    const seat = await prisma.poolSeat.findFirst({ where: { poolId, riderPhone: phone, status: 'held' } });
    if (!seat) return { ok: false, error: 'not_found' };
    if (pool.status !== 'filling') return { ok: false, error: 'car_already_leaving' };
    await prisma.poolSeat.update({ where: { id: seat.id }, data: { status: 'cancelled' } });
    const left = await heldSeats(poolId);
    if (!left.length) await prisma.pool.updateMany({ where: { id: poolId, status: 'filling' }, data: { status: 'cancelled' } });
    return { ok: true, left: left.length };
  }

  // Driver: tick riders on as they board (or mark a no-show). Only the ride's driver may do it.
  async function board(rideId, driverId, seatId, status) {
    if (!['boarded', 'noshow', 'held'].includes(status)) return { ok: false, error: 'bad_status' };
    const pool = await prisma.pool.findUnique({ where: { rideId } });
    if (!pool) return { ok: false, error: 'not_a_pool' };
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.driverId !== driverId) return { ok: false, error: 'not_your_ride' };
    const before = await prisma.poolSeat.findFirst({ where: { id: seatId, poolId: pool.id } });
    const n = await prisma.poolSeat.updateMany({ where: { id: seatId, poolId: pool.id, status: { in: ['held', 'boarded', 'noshow'] } }, data: { status } });
    if (!n.count) return { ok: false, error: 'not_found' };
    // The no-show counter follows the tick: marking counts one, undoing gives it back.
    if (before && prisma.rider && prisma.rider.updateMany) {
      if (status === 'noshow' && before.status !== 'noshow') await prisma.rider.updateMany({ where: { phone: before.riderPhone }, data: { noShows: { increment: 1 }, lastNoShowAt: new Date(clock()) } }).catch(() => {});
      else if (before.status === 'noshow' && status !== 'noshow') await prisma.rider.updateMany({ where: { phone: before.riderPhone, noShows: { gt: 0 } }, data: { noShows: { decrement: 1 } } }).catch(() => {});
    }
    return { ok: true, pool: await seatsForRide(rideId) };
  }

  // For the driver app and for tracking auth: who is in this car.
  async function seatsForRide(rideId) {
    if (!prisma.pool) return null;
    const pool = await prisma.pool.findUnique({ where: { rideId } });
    if (!pool) return null;
    const spec = specOf(pool);
    const seats = await prisma.poolSeat.findMany({ where: { poolId: pool.id, status: { in: ['held', 'boarded', 'noshow'] } }, orderBy: { joinedAt: 'asc' } });
    return { poolId: pool.id, kind: spec.kind, corridor: { key: spec.key, name: spec.name, nameAm: spec.nameAm, stops: spec.stops }, seatFareEtb: pool.seatFareEtb,
      seats: seats.map(s => { const st = spec.stops.find(x => x.id === s.stopId) || spec.from; return { id: s.id, name: s.riderName, phone: s.riderPhone, status: s.status, paymentMethod: s.paymentMethod, fareEtb: s.fareEtb, stop: { id: st.id, label: st.label, labelAm: st.labelAm } }; }) };
  }
  async function phoneMayTrack(rideId, phone) {
    const s = await seatsForRide(rideId);
    return !!(s && s.seats.some(x => x.phone === phone));
  }

  // Telegram pushes to every seat that came through the bot. Fire-and-forget.
  const TEXT = {
    dispatched: (p, s) => '🚘 ጋራ ጉዞ · Pool car is leaving · ' + p.filled + ' riders\nየእርስዎ መቀመጫ · Your seat: ' + s.fareEtb + ' ETB\nወደ ' + s.stop.labelAm + ' ይሂዱ · Walk to ' + s.stop.label + ' — we are finding your driver.',
    assigned: (p, s, r) => '🚗 Driver ' + r.driver.name + ' · plate ' + r.driver.plate + ' · ' + r.driver.phone + '\nሹፌርዎ እየመጣ ነው። መቀመጫዎ ' + s.fareEtb + ' ETB · pay the driver in cash.\n👀 ታርጋውን ያረጋግጡ · Match the plate before you get in.',
    arrived: (p, s) => '📍 Your pool car is at ' + s.stop.label + ' · ' + s.stop.labelAm + '። ሹፌርዎ ደርሷል።',
    completed: (p, s) => '✅ Pool trip complete · your seat ' + s.fareEtb + ' ETB — pay the driver.\nጉዞው ተጠናቅቋል። አመሰግናለን!',
    cancelled: () => '❌ The pool car was cancelled — sorry. ጉዞው ተሰርዟል።',
  };
  async function notifySeats(poolId, event) {
    if (!api) return 0;
    const fn = TEXT[event]; if (!fn) return 0;
    const pool = await prisma.pool.findUnique({ where: { id: poolId } });
    if (!pool) return 0;
    const seats = await prisma.poolSeat.findMany({ where: { poolId, status: { in: ['held', 'boarded'] } } });
    const ride = pool.rideId ? await prisma.ride.findUnique({ where: { id: pool.rideId }, include: { driver: true } }) : null;
    if (event === 'assigned' && !(ride && ride.driver)) return 0;
    const spec = specOf(pool);
    let n = 0;
    for (const s of seats) {
      if (!s.telegramId) continue;
      const stop = spec.stops.find(x => x.id === s.stopId) || spec.from;
      const text = fn({ filled: seats.length }, { fareEtb: s.fareEtb || pool.seatFareEtb, stop }, ride);
      const markup = pool.rideId ? { inline_keyboard: [[{ text: '📍 Open tracking · መከታተያ', web_app: { url: (baseUrl || 'https://bina.et') + '/ride?pool=' + pool.id } }]] } : undefined;
      try { await api.sendMessage(String(s.telegramId), text, markup ? { reply_markup: markup } : undefined); n++; }
      catch (e) { console.error('[pool] notify ' + event + ' to ' + s.telegramId + ' failed: ' + e.message); }
    }
    return n;
  }
  // ride/riderNotify calls this for ride events so pool riders beyond the lead get told too.
  async function notifyRideEvent(rideId, event) {
    if (!prisma.pool) return 0;
    const pool = await prisma.pool.findUnique({ where: { rideId } });
    return pool ? notifySeats(pool.id, event) : 0;
  }

  return { list, near, pub, join, create, joinById, dispatchPool, sweep, view, leave, board, mine, seatsForRide, phoneMayTrack, notifySeats, notifyRideEvent, corridorQuote, specOf,
    openByDriver, driverView, driverOpenPool, driverGo, driverClose, strikes, WAIT_S: wait, DRIVER_WAIT_S };
}

module.exports = { makePool, WAIT_S, DRIVER_WAIT_S, NOSHOW_STRIKES, OPEN, NEAR_M };
