'use strict';
// Place reviews - only from people who actually went there.
//
//   GET  /api/ride/:id/place?phone=…              the named place at this completed ride's drop-off, and its rating
//   POST /api/ride/:id/place-review               { phone, stars 1-5, text? }  one review per ride (re-sent = updated)
//   GET  /api/places/rating?ref=node/123          { avg, count, reviews: the approved texts, newest first }
//   GET  /ops/place-reviews/:id/:action?t=…       approve | hide a written review, one tap from the Telegram note
//
// Why a ride and nothing else (25 September 2026): AddisMap pays 10 ETB per 10 reviews; a review anyone can post
// is a review a competitor or a bot can post. Here the only door is a completed BinaSmart ride whose drop-off is
// within 80 m of the named place, checked against the rider's phone - every review is somebody who was there.
// Stars count at once. Words are a public statement about a real business, so a person reads them first.
const crypto = require('crypto');

function makePlaceReviews({ prisma, gazetteer, telegram, baseUrl = 'https://bina.et' }) {
  let memo = { at: 0, map: new Map() };
  async function ratings() {
    if (Date.now() - memo.at < 300000) return memo.map;
    const rows = await prisma.placeReview.groupBy({ by: ['placeRef'], _avg: { stars: true }, _count: { _all: true } }).catch(() => []);
    memo = { at: Date.now(), map: new Map(rows.map(r => [r.placeRef, { avg: Math.round(r._avg.stars * 10) / 10, count: r._count._all }])) };
    return memo.map;
  }
  // "★4.5 (3)" on a search result that has reviews; nothing on one that has none.
  async function decorate(results) {
    const m = await ratings();
    return results.map(r => { const x = r.ref && m.get(r.ref); return x ? { ...r, rating: x, sub: (r.sub ? r.sub + ' · ' : '') + '★' + x.avg.toFixed(1) + ' (' + x.count + ')' } : r; });
  }
  const placeFor = ride => {
    const d = ride && ride.dropoff;
    return d && d.lat != null ? gazetteer.nearest(d.lat, d.lng, d.label) : null;
  };
  return { ratings, decorate, placeFor, invalidate: () => { memo.at = 0; } };
}

function placeReviewRoutes(fastify, { prisma, reviews, telegram, normPhone, escH = s => String(s), baseUrl = 'https://bina.et' }) {
  const hits = new Map();
  const allowed = key => { const now = Date.now(); const a = (hits.get(key) || []).filter(t => now - t < 3600000); a.push(now); hits.set(key, a); return a.length <= 20; };
  async function rideFor(req, phone) {
    const ride = await prisma.ride.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    return ride && ride.status === 'completed' && normPhone(phone) === ride.riderPhone ? ride : null;
  }

  fastify.get('/api/ride/:id/place', async (req, reply) => {
    const ride = await rideFor(req, req.query.phone);
    if (!ride) return reply.code(404).send({ ok: false, error: 'not_found' });
    const place = reviews.placeFor(ride);
    if (!place) return { ok: true, place: null };
    const mine = await prisma.placeReview.findUnique({ where: { rideId: ride.id } }).catch(() => null);
    return { ok: true, place: { ref: place.ref, name: place.label, nameAm: place.labelAm || null, kind: place.kind }, mine: mine ? { stars: mine.stars, text: mine.text } : null };
  });

  fastify.post('/api/ride/:id/place-review', async (req, reply) => {
    if (!allowed(String(req.params.id))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const b = req.body || {};
    const ride = await rideFor(req, b.phone);
    if (!ride) return reply.code(404).send({ ok: false, error: 'not_found' });
    const stars = Math.round(Number(b.stars));
    if (!(stars >= 1 && stars <= 5)) return reply.code(400).send({ ok: false, error: 'stars_1_to_5' });
    const place = reviews.placeFor(ride);
    if (!place) return reply.code(409).send({ ok: false, error: 'no_named_place_here' });
    const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const data = { placeRef: place.ref, placeName: place.label, lat: place.lat, lng: place.lng, stars,
      text: text || null, textStatus: text ? 'pending' : 'none', token: crypto.randomBytes(16).toString('base64url') };
    const row = await prisma.placeReview.upsert({ where: { rideId: ride.id }, update: data, create: { rideId: ride.id, ...data } });
    reviews.invalidate();
    if (text && telegram && telegram.ownerNote) {
      const base = baseUrl + '/ops/place-reviews/' + row.id;
      telegram.ownerNote('⭐ Place review (' + stars + '/5) for ' + place.label + ' from a completed ride:\n«' + text + '»\n\nApprove: ' + base + '/approve?t=' + row.token + '\nHide: ' + base + '/hide?t=' + row.token).catch(() => {});
    }
    return { ok: true, place: place.label, stars, textStatus: row.textStatus };
  });

  fastify.get('/api/places/rating', async (req, reply) => {
    const ref = String(req.query.ref || '').slice(0, 60);
    const x = (await reviews.ratings()).get(ref);
    if (!x) return { ok: true, avg: null, count: 0, reviews: [] };
    const texts = await prisma.placeReview.findMany({ where: { placeRef: ref, textStatus: 'published' }, orderBy: { createdAt: 'desc' }, take: 5, select: { stars: true, text: true, createdAt: true } });
    return { ok: true, avg: x.avg, count: x.count, reviews: texts };
  });

  fastify.get('/ops/place-reviews/:id/:action', async (req, reply) => {
    const r = await prisma.placeReview.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!r || !req.query.t || r.token !== String(req.query.t)) return reply.code(404).type('text/html').send('<h2>Not found</h2>');
    const act = String(req.params.action);
    if (act !== 'approve' && act !== 'hide') return reply.code(404).type('text/html').send('<h2>Not found</h2>');
    await prisma.placeReview.update({ where: { id: r.id }, data: { textStatus: act === 'approve' ? 'published' : 'hidden' } });
    return reply.header('cache-control', 'no-store').type('text/html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><body style="font-family:system-ui,sans-serif;padding:24px"><h2>'
      + (act === 'approve' ? '✅ Published' : '🙈 Hidden') + '</h2><p>' + escH(r.placeName) + ' — ' + r.stars + '/5</p><p>«' + escH(r.text || '') + '»</p><p style="color:#667">The stars count either way; only the words are published or hidden.</p></body>');
  });
}

module.exports = { makePlaceReviews, placeReviewRoutes };
