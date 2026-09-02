'use strict';
const { quoteAll, quoteFare, TIERS } = require('./fare');

const ACTIVE = ['requested', 'dispatching', 'assigned', 'arriving', 'arrived', 'ontrip'];
const NEXT = { assigned: ['arriving', 'arrived', 'cancelled'], arriving: ['arrived', 'cancelled'], arrived: ['ontrip', 'cancelled'], ontrip: ['completed'], dispatching: ['cancelled'], requested: ['cancelled'] };

function limiter(windowMs, max) {
  const m = new Map();
  return key => {
    const now = Date.now(); const hits = (m.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now); m.set(key, hits);
    if (m.size > 5000) for (const [k, v] of m) { if (!v.length || now - v[v.length - 1] > windowMs) m.delete(k); }
    return true;
  };
}
// Behind nginx req.ip is 127.0.0.1 for everyone; X-Real-IP is set by nginx from $remote_addr and,
// unlike X-Forwarded-For, cannot be appended to by the client.
function clientIp(req) { return String(req.headers['x-real-ip'] || req.ip); }
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
function point(p) {
  if (!p || typeof p !== 'object') return null;
  const lat = num(p.lat, 8.5, 9.5), lng = num(p.lng, 38.4, 39.2);
  if (lat == null || lng == null) return null;
  return { lat, lng, label: String(p.label || '').slice(0, 120) || (lat.toFixed(5) + ', ' + lng.toFixed(5)) };
}
function normPhone(s) { s = String(s || '').replace(/[^\d+]/g, ''); if (/^0\d{9}$/.test(s)) s = '+251' + s.slice(1); if (/^251\d{9}$/.test(s)) s = '+' + s; return /^\+251\d{9}$/.test(s) ? s : null; }
function pubRide(ride) {
  const d = ride.driver;
  return { id: ride.id, status: ride.status, concierge: ride.concierge, tier: ride.tier, pickup: ride.pickup, dropoff: ride.dropoff,
    distanceM: ride.distanceM, durationS: ride.durationS, fareEtb: ride.fareEtb, estimate: ride.estimate,
    paymentMethod: ride.paymentMethod, paymentStatus: ride.paymentStatus, requestedAt: ride.requestedAt, assignedAt: ride.assignedAt,
    completedAt: ride.completedAt, cancelledAt: ride.cancelledAt, driverRating: ride.driverRating,
    driver: d ? { name: d.name, phone: d.phone, photo: d.photo, plate: d.plate, vehicle: [d.vehicleColour, d.vehicleMake].filter(Boolean).join(' '), rating: d.rating, tier: d.tier } : null };
}

module.exports = function routes(fastify, { prisma, settings, geo, telegram, dispatch, OWNER_KEY }) {
  const quoteRL = limiter(600000, 60), requestRL = limiter(600000, 5), searchRL = limiter(60000, 40);
  const lookupRL = limiter(60000, 120);
  const ops = (req, reply) => { if ((req.query.key || req.headers['x-owner-key']) !== OWNER_KEY) { reply.code(401).send({ ok: false, error: 'unauthorized' }); return false; } return true; };

  // ---- pages ----
  fastify.get('/ride', async (req, reply) => reply.sendFile('ride.html'));
  fastify.get('/ride-ops', async (req, reply) => reply.sendFile('ride-ops.html'));

  // ---- public ----
  fastify.get('/api/ride/settings', async () => {
    const s = await settings.get();
    return { ok: true, tiers: TIERS.map(t => ({ id: t, ...s.tiers[t] })), freeCancelMin: s.freeCancelMin };
  });

  fastify.get('/api/ride/search', async (req, reply) => {
    if (!searchRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const lat = num(req.query.lat, 8.5, 9.5), lng = num(req.query.lng, 38.4, 39.2);
    const bias = (lat != null && lng != null) ? { lat, lng } : null;
    return { ok: true, results: await geo.searchPlaces(req.query.q, bias) };
  });

  fastify.post('/api/ride/quote', async (req, reply) => {
    if (!quoteRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const b = req.body || {}; const from = point(b.pickup), to = point(b.dropoff);
    if (!from || !to) return reply.code(400).send({ ok: false, error: 'pickup and dropoff inside Addis required' });
    const [r, s] = await Promise.all([geo.route(from, to), settings.get()]);
    return { ok: true, distanceM: r.distanceM, durationS: r.durationS, estimate: r.estimate, geometry: r.geometry,
      quotes: quoteAll(s, r.distanceM, r.durationS).map(q => ({ ...q, label: s.tiers[q.tier].label, labelAm: s.tiers[q.tier].labelAm, icon: s.tiers[q.tier].icon, seats: s.tiers[q.tier].seats })) };
  });

  fastify.post('/api/ride/request', async (req, reply) => {
    const b = req.body || {};
    const from = point(b.pickup), to = point(b.dropoff);
    const phone = normPhone(b.riderPhone); const name = String(b.riderName || '').trim().slice(0, 60);
    const tier = TIERS.includes(b.tier) ? b.tier : null;
    const paymentMethod = ['cash', 'chapa'].includes(b.paymentMethod) ? b.paymentMethod : 'cash';
    const idemKey = String(b.idemKey || '').slice(0, 64) || null;
    if (!from || !to || !phone || !name || !tier) return reply.code(400).send({ ok: false, error: 'tier, pickup, dropoff, riderName, riderPhone(+251…) required' });
    if (idemKey) { const dup = await prisma.ride.findUnique({ where: { idemKey }, include: { driver: true } }); if (dup) return { ok: true, ride: pubRide(dup), duplicate: true }; }
    if (!requestRL(phone) || !requestRL('ip:' + clientIp(req))) return reply.code(429).send({ ok: false, error: 'too_many_requests' });
    const [r, s] = await Promise.all([geo.route(from, to), settings.get()]); // fare is computed server-side and locked
    const q = quoteFare(s, tier, r.distanceM, r.durationS);
    const rider = await prisma.rider.upsert({ where: { phone }, update: { name }, create: { phone, name } });
    let ride;
    try {
      ride = await prisma.ride.create({ data: {
        idemKey, riderId: rider.id, tier, pickup: from, dropoff: to, distanceM: r.distanceM, durationS: r.durationS, estimate: r.estimate,
        fareEtb: q.fareEtb, driverTakeEtb: q.driverTakeEtb, paymentMethod, status: 'dispatching', riderName: name, riderPhone: phone } });
    } catch (e) {
      if (e.code === 'P2002' && idemKey) {
        const dup = await prisma.ride.findUnique({ where: { idemKey }, include: { driver: true } });
        if (dup) return { ok: true, ride: pubRide(dup), duplicate: true };
      }
      throw e;
    }
    dispatch.start(ride.id).catch(err => console.error('[ride/routes] dispatch.start failed:', err.message));
    return { ok: true, ride: pubRide({ ...ride, driver: null }) };
  });

  fastify.get('/api/ride/:id', async (req, reply) => {
    if (!lookupRL(req.params.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { driver: true } });
    if (!ride || normPhone(req.query.phone) !== ride.riderPhone) return reply.code(404).send({ ok: false, error: 'not_found' });
    return { ok: true, ride: pubRide(ride) };
  });

  fastify.post('/api/ride/:id/cancel', async (req, reply) => {
    if (!lookupRL(req.params.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id } });
    if (!ride || normPhone((req.body || {}).phone) !== ride.riderPhone) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (!['requested', 'dispatching', 'assigned', 'arriving', 'arrived'].includes(ride.status)) return reply.code(409).send({ ok: false, error: 'cannot_cancel_now' });
    dispatch.cancel(ride.id);
    const upd = await prisma.ride.update({ where: { id: ride.id }, data: { status: 'cancelled', cancelledBy: 'rider', cancelledAt: new Date() }, include: { driver: true } });
    telegram.ownerNote('❌ Rider cancelled ride ' + ride.id + ' (' + ride.riderName + ')').catch(() => {});
    return { ok: true, ride: pubRide(upd) };
  });

  fastify.post('/api/ride/:id/rate', async (req, reply) => {
    if (!lookupRL(req.params.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const b = req.body || {}; const stars = num(b.stars, 1, 5);
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id } });
    if (!ride || normPhone(b.phone) !== ride.riderPhone) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (ride.status !== 'completed' || stars == null) return reply.code(400).send({ ok: false, error: 'stars 1-5 on a completed ride' });
    await prisma.ride.update({ where: { id: ride.id }, data: { driverRating: Math.round(stars) } });
    if (ride.driverId) {
      const agg = await prisma.ride.aggregate({ where: { driverId: ride.driverId, driverRating: { not: null } }, _avg: { driverRating: true } });
      await prisma.driver.update({ where: { id: ride.driverId }, data: { rating: Number((agg._avg.driverRating || 5).toFixed(2)) } });
    }
    return { ok: true };
  });

  // ---- ops (owner) ----
  fastify.get('/api/ride/ops/queue', async (req, reply) => {
    if (!ops(req, reply)) return;
    const active = await prisma.ride.findMany({ where: { status: { in: ACTIVE } }, include: { driver: true }, orderBy: [{ concierge: 'desc' }, { requestedAt: 'asc' }], take: 100 });
    const recent = await prisma.ride.findMany({ where: { status: { in: ['completed', 'cancelled'] } }, include: { driver: true }, orderBy: { requestedAt: 'desc' }, take: 30 });
    const full = r => ({ ...pubRide(r), riderName: r.riderName, riderPhone: r.riderPhone, driverTakeEtb: r.driverTakeEtb });
    return { ok: true, active: active.map(full), recent: recent.map(full) };
  });

  fastify.get('/api/ride/ops/drivers', async (req, reply) => {
    if (!ops(req, reply)) return;
    return { ok: true, drivers: await prisma.driver.findMany({ orderBy: { createdAt: 'desc' } }) };
  });

  fastify.post('/api/ride/ops/drivers', async (req, reply) => {
    if (!ops(req, reply)) return;
    const b = req.body || {}; const phone = normPhone(b.phone); const tier = TIERS.includes(b.tier) ? b.tier : 'economy';
    const name = String(b.name || '').trim().slice(0, 60), plate = String(b.plate || '').trim().slice(0, 20);
    if (!phone || !name || !plate) return reply.code(400).send({ ok: false, error: 'name, phone(+251…), plate required' });
    const data = { name, tier, plate, vehicleMake: String(b.vehicleMake || '').slice(0, 40) || null, vehicleColour: String(b.vehicleColour || '').slice(0, 30) || null,
      status: ['pending', 'approved', 'suspended'].includes(b.status) ? b.status : 'approved' };
    const drv = await prisma.driver.upsert({ where: { phone }, update: data, create: { phone, ...data } });
    return { ok: true, driver: drv };
  });

  fastify.post('/api/ride/ops/:id/assign', async (req, reply) => {
    if (!ops(req, reply)) return;
    const drv = await prisma.driver.findUnique({ where: { id: String((req.body || {}).driverId || '') } });
    if (!drv || drv.status !== 'approved') return reply.code(400).send({ ok: false, error: 'approved driver required' });
    const res = await prisma.ride.updateMany({ where: { id: req.params.id, status: { in: ['requested', 'dispatching'] } }, data: { driverId: drv.id, status: 'assigned', assignedAt: new Date() } });
    if (res.count === 0) return reply.code(409).send({ ok: false, error: 'ride not assignable' });
    dispatch.cancel(req.params.id);
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { driver: true } });
    return { ok: true, ride: pubRide(ride) };
  });

  fastify.post('/api/ride/ops/:id/status', async (req, reply) => {
    if (!ops(req, reply)) return;
    const b = req.body || {}; const to = String(b.status || '');
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id } });
    if (!ride) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (!(NEXT[ride.status] || []).includes(to)) return reply.code(409).send({ ok: false, error: 'cannot go ' + ride.status + ' -> ' + to });
    const data = { status: to };
    if (to === 'arrived') data.arrivedAt = new Date();
    if (to === 'ontrip') data.startedAt = new Date();
    if (to === 'completed') { data.completedAt = new Date(); if (b.cashPaid === true) data.paymentStatus = 'paid'; }
    if (to === 'cancelled') { data.cancelledAt = new Date(); data.cancelledBy = 'ops'; dispatch.cancel(ride.id); }
    const upd = await prisma.ride.update({ where: { id: ride.id }, data, include: { driver: true } });
    if (to === 'completed' && ride.driverId) await prisma.driver.update({ where: { id: ride.driverId }, data: { ridesCount: { increment: 1 } } });
    return { ok: true, ride: pubRide(upd) };
  });

  fastify.post('/api/ride/ops/:id/paid', async (req, reply) => {
    if (!ops(req, reply)) return;
    const res = await prisma.ride.updateMany({ where: { id: req.params.id }, data: { paymentStatus: 'paid' } });
    if (res.count === 0) return reply.code(404).send({ ok: false, error: 'not_found' });
    const upd = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { driver: true } });
    return { ok: true, ride: pubRide(upd) };
  });

  fastify.get('/api/ride/ops/settings', async (req, reply) => { if (!ops(req, reply)) return; return { ok: true, settings: await settings.get() }; });
  fastify.post('/api/ride/ops/settings', async (req, reply) => {
    if (!ops(req, reply)) return;
    try { return { ok: true, settings: await settings.update(req.body || {}) }; }
    catch (e) { return reply.code(e.statusCode || 500).send({ ok: false, error: e.message }); }
  });
};
