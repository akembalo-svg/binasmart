'use strict';
// ride/placeReviews.js: only a completed ride that ended at a named place can review it. Everything is invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { makePlaceReviews, placeReviewRoutes } = require('../../ride/placeReviews');

function world() {
  const rides = {
    r1: { id: 'r1', status: 'completed', riderPhone: '251900000042', dropoff: { lat: 9.0301, lng: 38.7641, label: 'Sample Cathedral' } },
    r2: { id: 'r2', status: 'ontrip', riderPhone: '251900000042', dropoff: { lat: 9.0301, lng: 38.7641, label: 'Sample Cathedral' } },
    r3: { id: 'r3', status: 'completed', riderPhone: '251900000042', dropoff: { lat: 9.1, lng: 38.9, label: 'Nowhere' } },
  };
  const rows = [], notes = [];
  const prisma = {
    ride: { findUnique: async ({ where }) => rides[where.id] || null },
    placeReview: {
      findUnique: async ({ where }) => rows.find(r => (where.rideId && r.rideId === where.rideId) || (where.id && r.id === where.id)) || null,
      upsert: async ({ where, create, update }) => { let r = rows.find(x => x.rideId === where.rideId); if (r) Object.assign(r, update); else { r = { id: 'p' + rows.length, ...create }; rows.push(r); } return r; },
      update: async ({ where, data }) => Object.assign(rows.find(r => r.id === where.id), data),
      groupBy: async () => { const m = {}; for (const r of rows) (m[r.placeRef] ||= []).push(r.stars); return Object.entries(m).map(([k, v]) => ({ placeRef: k, _avg: { stars: v.reduce((a, b) => a + b, 0) / v.length }, _count: { _all: v.length } })); },
      findMany: async ({ where }) => rows.filter(r => r.placeRef === where.placeRef && r.textStatus === where.textStatus),
    },
  };
  const gazetteer = { nearest: (lat, lng) => (Math.abs(lat - 9.03) < 0.001 ? { ref: 'node/1', label: 'Sample Cathedral', lat: 9.03, lng: 38.764, kind: 'place of worship' } : null) };
  const reviews = makePlaceReviews({ prisma, gazetteer });
  const f = Fastify();
  placeReviewRoutes(f, { prisma, reviews, telegram: { ownerNote: async t => { notes.push(t); return true; } }, normPhone: p => String(p).replace(/\D/g, '').replace(/^0/, '251') });
  return { f, rows, notes, reviews };
}
const post = (f, id, body) => f.inject({ method: 'POST', url: '/api/ride/' + id + '/place-review', payload: body }).then(r => ({ code: r.statusCode, ...r.json() }));

test('a completed ride at a named place can rate it; stars count at once, words wait for a person', async () => {
  const w = world();
  assert.equal((await w.f.inject({ url: '/api/ride/r1/place?phone=0900000042' })).json().place.name, 'Sample Cathedral');
  const r = await post(w.f, 'r1', { phone: '0900000042', stars: 4, text: 'Quiet and well kept.' });
  assert.equal(r.ok, true); assert.equal(r.textStatus, 'pending');
  assert.equal(w.notes.length, 1); assert.match(w.notes[0], /Approve: .*\/approve\?t=/);
  const rating = (await w.f.inject({ url: '/api/places/rating?ref=node/1' })).json();
  assert.equal(rating.avg, 4); assert.equal(rating.count, 1); assert.deepEqual(rating.reviews, [], 'words are not public before approval');
  const row = w.rows[0];
  await w.f.inject({ url: '/ops/place-reviews/' + row.id + '/approve?t=' + row.token });
  w.reviews.invalidate();
  assert.equal((await w.f.inject({ url: '/api/places/rating?ref=node/1' })).json().reviews[0].text, 'Quiet and well kept.');
});

test('no review without a completed ride, the rider\'s phone, a named place, or 1-5 stars; one per ride', async () => {
  const w = world();
  assert.equal((await post(w.f, 'r2', { phone: '0900000042', stars: 5 })).code, 404, 'not completed');
  assert.equal((await post(w.f, 'r1', { phone: '0900000043', stars: 5 })).code, 404, 'someone else\'s phone');
  assert.equal((await post(w.f, 'r3', { phone: '0900000042', stars: 5 })).error, 'no_named_place_here');
  assert.equal((await post(w.f, 'r1', { phone: '0900000042', stars: 9 })).error, 'stars_1_to_5');
  await post(w.f, 'r1', { phone: '0900000042', stars: 2 }); await post(w.f, 'r1', { phone: '0900000042', stars: 5 });
  assert.equal(w.rows.length, 1); assert.equal(w.rows[0].stars, 5);
  assert.equal((await w.f.inject({ url: '/ops/place-reviews/' + w.rows[0].id + '/approve?t=wrong' })).statusCode, 404);
});

test('search results with reviews carry "★avg (count)"', async () => {
  const w = world();
  await post(w.f, 'r1', { phone: '0900000042', stars: 5 });
  w.reviews.invalidate();
  const [r] = await w.reviews.decorate([{ ref: 'node/1', label: 'Sample Cathedral', sub: 'place of worship · Arada' }]);
  assert.match(r.sub, /★5\.0 \(1\)$/);
});

test('the ride search shows one place mapped twice under one name once', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gz2-')), 'twice.json');
  fs.writeFileSync(f, JSON.stringify({ bySub: {}, elements: [
    { type: 'node', id: 1, lat: 9.0, lon: 38.79, tags: { shop: 'mall', name: 'Sample Mall' } },
    { type: 'way', id: 2, center: { lat: 9.0005, lon: 38.7902 }, tags: { shop: 'department_store', name: 'Sample Mall' } } ] }));
  const g = require('../../ride/gazetteer').makeGazetteer({ file: f });
  const r = g.search('Sample Mall');
  assert.equal(r.length, 1);
  assert.match(r[0].ref, /^(node\/1|way\/2)$/);
  assert.equal(g.nearest(9.0001, 38.7901, 'Sample Mall').label, 'Sample Mall');
  assert.equal(g.nearest(9.05, 38.7901, 'x'), null, 'nothing named within 80 m');
});
