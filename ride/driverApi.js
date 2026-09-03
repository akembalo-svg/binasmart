'use strict';
// The driver app's back end. Every handler authenticates from Telegram initData signed with the
// DRIVER bot token, so a driver is whoever Telegram says they are — there are no passwords.
//
// The heartbeat is deliberately one round trip: POST /api/drive/ping sends the position AND returns
// the open offers plus the current ride. Ethiopian mobile data is metered and latency is high, so one
// request every 4 s beats three.
const tgauth = require('./tgauth');
const { haversineM } = require('./geo');

const DRIVER_STATES = { assigned: ['arriving', 'arrived'], arriving: ['arrived'], arrived: ['ontrip'], ontrip: ['completed'] };
const ADDIS_TZ_OFFSET_MS = 3 * 3600 * 1000; // UTC+3, no DST — the earnings day rolls over at Addis midnight

function addisDay(ms) { return new Date(Math.floor((ms + ADDIS_TZ_OFFSET_MS) / 86400000) * 86400000 - ADDIS_TZ_OFFSET_MS); }
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

function makeDriverApi({ prisma, driverBotToken, location, offers, telegram, riderNotify, geo, settings, now }) {
  const clock = now || Date.now;

  function pubDriver(d) {
    return { id: d.id, name: d.name, phone: d.phone, tier: d.tier, plate: d.plate, status: d.status,
      online: d.online, away: d.away, rating: d.rating, ridesCount: d.ridesCount,
      carPhoto: d.carPhotoUrl ? '/api/ride/car/' + String(d.carPhotoUrl).split('/').pop() : null,
      earningsTodayEtb: sameDay(d) ? d.earningsTodayEtb : 0, onRideId: d.onRideId };
  }
  function sameDay(d) {
    return d.earningsDay && new Date(d.earningsDay).getTime() === addisDay(clock()).getTime();
  }
  function pubJob(ride) {
    return { id: ride.id, status: ride.status, tier: ride.tier, pickup: ride.pickup, dropoff: ride.dropoff,
      distanceM: ride.distanceM, durationS: ride.durationS, fareEtb: ride.fareEtb, driverTakeEtb: ride.driverTakeEtb,
      paymentMethod: ride.paymentMethod, riderName: ride.riderName, riderPhone: ride.riderPhone,
      bookedBy: ride.bookedBy || null, requestedAt: ride.requestedAt, assignedAt: ride.assignedAt,
      next: DRIVER_STATES[ride.status] || [] };
  }

  // Resolves initData -> Driver row. Returns null and answers the reply itself on any failure, so
  // every handler can simply `if (!drv) return;`.
  async function auth(req, reply, opts) {
    const body = req.body || {};
    const initData = String(body.initData || req.query.initData || '');
    // The injected clock, not Date.now(): keeps the 24 h freshness check honest under test.
    const tg = tgauth.verifyInitData(initData, driverBotToken, { now: clock() });
    if (!tg) { reply.code(401).send({ ok: false, error: 'telegram_auth_invalid' }); return null; }
    const drv = await prisma.driver.findFirst({ where: { telegramId: String(tg.user.id) } });
    if (!drv) { reply.code(404).send({ ok: false, error: 'not_registered' }); return null; }
    if (drv.status !== 'approved' && !(opts && opts.allowPending)) {
      reply.code(403).send({ ok: false, error: drv.status === 'suspended' ? 'suspended' : 'awaiting_approval', driver: pubDriver(drv) });
      return null;
    }
    return drv;
  }

  async function openOffers(driver) {
    const rows = await prisma.rideOffer.findMany({ where: { driverId: driver.id, status: 'open' }, orderBy: { createdAt: 'asc' } });
    // The window is a live setting. Hardcoding 25 here would make the app's countdown ring lie the
    // moment the window is changed in /ride-ops, and ride/offers.js expire() is the real authority.
    const s = settings ? await settings.get() : null;
    const windowS = (s && s.offerWindowS) || 25;
    const out = [];
    for (const o of rows) {
      const ride = await prisma.ride.findUnique({ where: { id: o.rideId } });
      if (!ride || ride.driverId || !['requested', 'dispatching'].includes(ride.status)) continue;
      out.push({ rideId: ride.id, etaS: o.etaS, distanceM: o.distanceM, round: o.round,
        expiresInS: Math.max(0, Math.round((new Date(o.createdAt).getTime() + windowS * 1000 - clock()) / 1000)),
        windowS: windowS,
        tier: ride.tier, pickup: ride.pickup, dropoff: ride.dropoff, fareEtb: ride.fareEtb,
        driverTakeEtb: ride.driverTakeEtb, tripDistanceM: ride.distanceM, tripDurationS: ride.durationS });
    }
    return out;
  }

  async function currentJob(driver) {
    if (!driver.onRideId) return null;
    const ride = await prisma.ride.findUnique({ where: { id: driver.onRideId } });
    if (!ride) return null;
    return pubJob(ride);
  }

  // GET/POST /api/drive/session — what the app needs on open. Pending drivers may call this (they get
  // a 403 body carrying their own status) so the app can show "waiting for approval" instead of an error.
  async function session(req, reply) {
    const drv = await auth(req, reply, { allowPending: true });
    if (!drv) return;
    return { ok: true, driver: pubDriver(drv), job: await currentJob(drv), offers: await openOffers(drv) };
  }

  // POST /api/drive/online { online: true|false }
  async function online(req, reply) {
    const drv = await auth(req, reply);
    if (!drv) return;
    const want = (req.body || {}).online !== false;
    // Going offline while carrying a passenger would strand them.
    if (!want && drv.onRideId) return reply.code(409).send({ ok: false, error: 'finish_your_ride_first' });
    const upd = await prisma.driver.update({ where: { id: drv.id },
      data: { online: want, away: false, lastSeenAt: new Date(clock()) } });
    if (!want && location) location.forget(drv.id);
    return { ok: true, driver: pubDriver(upd) };
  }

  // POST /api/drive/ping { lat, lng, bearing, speedKph, accuracy } — heartbeat + poll in one call.
  async function ping(req, reply) {
    const drv = await auth(req, reply);
    if (!drv) return;
    const b = req.body || {};
    let fix = { ok: false, error: 'no_fix' };
    if (b.lat != null && b.lng != null) {
      fix = await location.record(drv.id, {
        lat: b.lat, lng: b.lng, bearing: b.bearing, speedKph: b.speedKph, accuracy: b.accuracy,
      }, drv.onRideId || null);
    }
    // Re-read: record() may have cleared `away`, and an offer may have arrived a moment ago.
    const fresh = await prisma.driver.findUnique({ where: { id: drv.id } });
    return { ok: true, fix: fix.ok ? 'stored' : fix.error, driver: pubDriver(fresh || drv),
      job: await currentJob(fresh || drv), offers: await openOffers(drv), serverTime: clock() };
  }

  // POST /api/drive/offer/:id/accept
  async function accept(req, reply) {
    const drv = await auth(req, reply);
    if (!drv) return;
    const r = await offers.accept(String(req.params.id), drv.id);
    if (!r.ok) {
      const code = r.error === 'taken' ? 409 : r.error === 'no_offer' ? 404 : 409;
      return reply.code(code).send({ ok: false, error: r.error });
    }
    const fresh = await prisma.driver.findUnique({ where: { id: drv.id } });
    return { ok: true, job: await currentJob(fresh), driver: pubDriver(fresh) };
  }

  // POST /api/drive/offer/:id/decline
  async function decline(req, reply) {
    const drv = await auth(req, reply);
    if (!drv) return;
    const r = await offers.decline(String(req.params.id), drv.id);
    if (!r.ok) return reply.code(404).send({ ok: false, error: r.error });
    return { ok: true, offers: await openOffers(drv) };
  }

  // POST /api/drive/ride/:id/status { status } — arriving -> arrived -> ontrip -> completed.
  async function status(req, reply) {
    const drv = await auth(req, reply);
    if (!drv) return;
    const want = String((req.body || {}).status || '');
    const ride = await prisma.ride.findUnique({ where: { id: String(req.params.id) } });
    if (!ride || ride.driverId !== drv.id) return reply.code(404).send({ ok: false, error: 'not_your_ride' });
    const allowed = DRIVER_STATES[ride.status] || [];
    if (!allowed.includes(want)) return reply.code(409).send({ ok: false, error: 'cannot_go_to_' + (want || 'nothing'), from: ride.status, allowed });

    const at = new Date(clock());
    const data = { status: want };
    if (want === 'arrived') data.arrivedAt = at;
    if (want === 'ontrip') data.startedAt = at;
    if (want === 'completed') data.completedAt = at;
    const upd = await prisma.ride.update({ where: { id: ride.id }, data });

    if (want === 'completed') {
      const today = addisDay(clock());
      const carry = sameDay(drv) ? drv.earningsTodayEtb : 0;
      await prisma.driver.update({ where: { id: drv.id }, data: {
        onRideId: null, ridesCount: { increment: 1 },
        earningsTodayEtb: carry + ride.driverTakeEtb, earningsDay: today } });
      if (telegram) telegram.ownerNote('✅ Ride ' + ride.id + ' completed by ' + drv.name + ' · ' + ride.fareEtb + ' ETB ' + ride.paymentMethod).catch(() => {});
    }
    if (riderNotify) riderNotify.notify(ride.id, want).catch(e => console.error('[ride/driverApi] rider notify failed: ' + e.message));
    const fresh = await prisma.driver.findUnique({ where: { id: drv.id } });
    return { ok: true, job: pubJob(upd), driver: pubDriver(fresh || drv) };
  }

  // POST /api/drive/route { to: 'pickup'|'dropoff', lat, lng } — road geometry for the driver's map.
  // The driver app must not draw straight lines across buildings, and GraphHopper is not public.
  async function route(req, reply) {
    const drv = await auth(req, reply);
    if (!drv) return;
    const b = req.body || {};
    const from = { lat: Number(b.lat), lng: Number(b.lng) };
    if (!Number.isFinite(from.lat) || !Number.isFinite(from.lng)) return reply.code(400).send({ ok: false, error: 'need_lat_lng' });
    if (!drv.onRideId) return reply.code(409).send({ ok: false, error: 'no_active_ride' });
    const ride = await prisma.ride.findUnique({ where: { id: drv.onRideId } });
    if (!ride) return reply.code(404).send({ ok: false, error: 'not_found' });
    const to = b.to === 'dropoff' ? ride.dropoff : ride.pickup;
    try {
      const r = await geo.route(from, to);
      return { ok: true, geometry: r.geometry || [], distanceM: r.distanceM, durationS: r.durationS, estimate: !!r.estimate };
    } catch (e) {
      // A routing outage must not blind the driver: the app falls back to a bearing arrow.
      console.error('[ride/driverApi] route failed: ' + e.message);
      return { ok: true, geometry: [], distanceM: null, durationS: null, estimate: true };
    }
  }

  // GET /api/ride/:id/track?phone= — what the rider's map polls. Phone must match the ride, exactly
  // like /api/ride/:id, and only an active ride exposes a position.
  async function track(req, reply, riderPhoneMatches) {
    const ride = await prisma.ride.findUnique({ where: { id: String(req.params.id) }, include: { driver: true } });
    if (!ride || !riderPhoneMatches(ride)) return reply.code(404).send({ ok: false, error: 'not_found' });
    const live = { status: ride.status, driver: null, position: null, trail: [], etaS: null, distanceM: null };
    if (!ride.driver || !['assigned', 'arriving', 'arrived', 'ontrip'].includes(ride.status)) return { ok: true, live };
    const d = ride.driver;
    live.driver = { name: d.name, phone: d.phone, plate: d.plate, rating: d.rating,
      vehicle: [d.vehicleColour, d.vehicleMake].filter(Boolean).join(' '),
      carPhoto: d.carPhotoUrl ? '/api/ride/car/' + String(d.carPhotoUrl).split('/').pop() : null,
      photo: d.photo || null };
    const l = location.latest(d.id) || (d.lat != null && d.lng != null
      ? { lat: d.lat, lng: d.lng, bearing: d.bearing, speedKph: d.speedKph, ageS: d.lastSeenAt ? Math.round((clock() - new Date(d.lastSeenAt).getTime()) / 1000) : null }
      : null);
    if (l) {
      live.position = { lat: l.lat, lng: l.lng, bearing: l.bearing, speedKph: l.speedKph, ageS: l.ageS, stale: (l.ageS || 0) > 60 };
      live.trail = location.trail(ride.id);
      // Straight-line ETA at 22 km/h keeps this endpoint cheap; it is polled every few seconds.
      const target = ride.status === 'ontrip' ? ride.dropoff : ride.pickup;
      const m = haversineM({ lat: l.lat, lng: l.lng }, target) * 1.35;
      live.distanceM = Math.round(m);
      live.etaS = Math.max(30, Math.round(m / 6.1));
    }
    return { ok: true, live };
  }

  return { session, online, ping, accept, decline, status, track, route, _auth: auth, _pubDriver: pubDriver, addisDay };
}

module.exports = { makeDriverApi, DRIVER_STATES, num };
