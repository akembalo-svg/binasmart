'use strict';
// BinaPool lifecycle. A pool is a car being filled on one corridor: riders join a seat at a boarding
// stop, the car leaves when it is full or when the wait runs out, then the normal ride machinery
// (dispatch auction, driver app, tracking) carries it as ONE Ride whose fare is the ladder's driver total.
//   filling -> dispatching -> (the Ride's own status: assigned/arriving/arrived/ontrip/completed) | cancelled
// Timers are not used: sweep() is scheduled by ride/index.js and dispatches anything whose time is up,
// so a restart can never strand a pool. Clock is injectable for tests.
const { quoteFare } = require('../fare');
const { ladder, rowFor } = require('./ladder');
const C = require('./corridors');

const WAIT_S = 8 * 60;          // "wait to pay less" window
const QUOTE_TTL_MS = 30 * 60000; // corridor car-fare cache
const OPEN = ['filling', 'dispatching', 'assigned', 'arriving', 'arrived', 'ontrip'];

function makePool({ prisma, geo, settings, dispatch, api, baseUrl, now, waitS }) {
  const clock = now || Date.now;
  const wait = (waitS == null ? WAIT_S : waitS);
  const quotes = new Map(); // corridor key -> { at, q }

  // The car fare for the whole corridor, from the fixed-fare engine. Cached; a routing failure falls
  // back to straight-line x 1.3 at 22 km/h so the pool never goes dark because GraphHopper hiccuped.
  async function corridorQuote(c) {
    const hit = quotes.get(c.key);
    if (hit && clock() - hit.at < QUOTE_TTL_MS) return hit.q;
    const s = await settings.get();
    let r;
    try { r = await geo.route(c.from, c.to); }
    catch (e) { const m = C.haversineM(c.from, c.to) * 1.3; r = { distanceM: Math.round(m), durationS: Math.round(m / 6.1), geometry: [], estimate: true }; }
    const f = quoteFare(s, c.tier, r.distanceM, r.durationS);
    const seats = (s.tiers[c.tier] && s.tiers[c.tier].seats) || 4;
    const q = { distanceM: r.distanceM, durationS: r.durationS, estimate: !!r.estimate, geometry: r.geometry || [],
      carFareEtb: f.fareEtb, seats, ladder: ladder(f.fareEtb, seats, s.commissionPct) };
    quotes.set(c.key, { at: clock(), q });
    return q;
  }

  async function openPoolFor(key) {
    return prisma.pool.findFirst({ where: { corridorKey: key, status: 'filling', dispatchAt: { gt: new Date(clock()) } }, orderBy: { openedAt: 'asc' } });
  }
  async function heldSeats(poolId) { return prisma.poolSeat.findMany({ where: { poolId, status: { in: ['held', 'boarded'] } }, orderBy: { joinedAt: 'asc' } }); }

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

  // Join (idempotent per phone: a second tap returns the seat already held).
  async function join({ corridorKey, stopId, mode, name, phone, telegramId, paymentMethod }) {
    const c = C.byKey(corridorKey);
    if (!c) return { ok: false, error: 'unknown_corridor' };
    if (c.dir !== C.directionNow(clock())) return { ok: false, error: 'corridor_not_running_now' };
    const si = C.stopIndex(c, stopId);
    if (si < 0 || si === c.stops.length - 1) return { ok: false, error: 'pick_a_boarding_stop' };
    if (!name || !phone) return { ok: false, error: 'name_and_phone_required' };
    const mine = await prisma.poolSeat.findFirst({ where: { riderPhone: phone, status: { in: ['held', 'boarded'] }, pool: { status: { in: OPEN } } }, include: { pool: true } });
    if (mine) return { ok: true, duplicate: true, ...(await view(mine.poolId, phone)) };
    const q = await corridorQuote(c);
    const ms = clock();
    let pool = await openPoolFor(c.key);
    if (pool) {
      const n = (await heldSeats(pool.id)).length;
      if (n >= pool.seats) pool = null; // full and about to leave: open the next car
    }
    if (!pool) {
      pool = await prisma.pool.create({ data: { corridorKey: c.key, tier: c.tier, seats: q.seats, status: 'filling',
        openedAt: new Date(ms), dispatchAt: new Date(ms + (mode === 'now' ? 0 : wait) * 1000) } });
    } else if (mode === 'now' && new Date(pool.dispatchAt).getTime() > ms) {
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

  // Turns a full/expired pool into one Ride and hands it to the auction. DB-level mutex on status.
  async function dispatchPool(poolId) {
    const won = await prisma.pool.updateMany({ where: { id: poolId, status: 'filling' }, data: { status: 'dispatching' } });
    if (won.count === 0) return null;
    const pool = await prisma.pool.findUnique({ where: { id: poolId } });
    const seats = await heldSeats(poolId);
    if (!seats.length) { await prisma.pool.update({ where: { id: poolId }, data: { status: 'cancelled' } }); return null; }
    const c = C.byKey(pool.corridorKey);
    const q = await corridorQuote(c);
    const row = rowFor(q.ladder, seats.length);
    // Pickup = the earliest boarding stop anybody chose; drop-off = the corridor's end.
    const firstIdx = Math.min(...seats.map(s => Math.max(0, C.stopIndex(c, s.stopId))));
    const pickup = c.stops[firstIdx], dropoff = c.to;
    const label = s => s.label + ' · ' + s.labelAm;
    const lead = seats[0];
    const ride = await prisma.ride.create({ data: {
      riderId: lead.riderId, tier: c.tier,
      pickup: { lat: pickup.lat, lng: pickup.lng, label: 'ጋራ · Pool · ' + label(pickup) },
      dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: label(dropoff) },
      distanceM: q.distanceM, durationS: q.durationS, estimate: q.estimate,
      fareEtb: row.driverTotalEtb, driverTakeEtb: row.driverTakeEtb, paymentMethod: 'cash', status: 'dispatching',
      riderName: 'Pool · ' + seats.length + ' riders · ' + lead.riderName, riderPhone: lead.riderPhone } });
    await prisma.pool.update({ where: { id: poolId }, data: { rideId: ride.id, seatFareEtb: row.seatEtb, dispatchedAt: new Date(clock()) } });
    await prisma.poolSeat.updateMany({ where: { poolId, status: { in: ['held', 'boarded'] } }, data: { fareEtb: row.seatEtb } });
    if (dispatch) dispatch.start(ride.id).catch(e => console.error('[pool] dispatch.start failed for ride ' + ride.id + ': ' + e.message));
    notifySeats(poolId, 'dispatched').catch(() => {});
    console.log('[pool] ' + poolId + ' -> ride ' + ride.id + ' · ' + seats.length + ' seat(s) · ' + row.seatEtb + ' ETB each');
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
    const c = C.byKey(pool.corridorKey);
    const q = await corridorQuote(c);
    const seats = all.filter(s => s.status === 'held' || s.status === 'boarded');
    const ride = pool.rideId ? await prisma.ride.findUnique({ where: { id: pool.rideId }, include: { driver: true } }) : null;
    const status = ride ? ride.status : pool.status;
    const n = seats.length;
    const row = rowFor(q.ladder, Math.max(1, n));
    const myStop = c.stops.find(s => s.id === mine.stopId) || c.from;
    return { ok: true, pool: { id: pool.id, status, corridor: { key: c.key, name: c.name, nameAm: c.nameAm, stops: c.stops, from: c.from, to: c.to },
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
    const n = await prisma.poolSeat.updateMany({ where: { id: seatId, poolId: pool.id, status: { in: ['held', 'boarded', 'noshow'] } }, data: { status } });
    if (!n.count) return { ok: false, error: 'not_found' };
    return { ok: true, pool: await seatsForRide(rideId) };
  }

  // For the driver app and for tracking auth: who is in this car.
  async function seatsForRide(rideId) {
    if (!prisma.pool) return null;
    const pool = await prisma.pool.findUnique({ where: { rideId } });
    if (!pool) return null;
    const c = C.byKey(pool.corridorKey);
    const seats = await prisma.poolSeat.findMany({ where: { poolId: pool.id, status: { in: ['held', 'boarded', 'noshow'] } }, orderBy: { joinedAt: 'asc' } });
    return { poolId: pool.id, corridor: { key: c.key, name: c.name, nameAm: c.nameAm, stops: c.stops }, seatFareEtb: pool.seatFareEtb,
      seats: seats.map(s => { const st = c.stops.find(x => x.id === s.stopId) || c.from; return { id: s.id, name: s.riderName, phone: s.riderPhone, status: s.status, paymentMethod: s.paymentMethod, fareEtb: s.fareEtb, stop: { id: st.id, label: st.label, labelAm: st.labelAm } }; }) };
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
    const c = C.byKey(pool.corridorKey);
    let n = 0;
    for (const s of seats) {
      if (!s.telegramId) continue;
      const stop = c.stops.find(x => x.id === s.stopId) || c.from;
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

  return { list, join, dispatchPool, sweep, view, leave, board, mine, seatsForRide, phoneMayTrack, notifySeats, notifyRideEvent, corridorQuote, WAIT_S: wait };
}

module.exports = { makePool, WAIT_S, OPEN };
