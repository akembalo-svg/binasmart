'use strict';
// Hotel claims and owner room prices (hotels/directory.js), from the 1 Oct 2026 rehearsal: Bini re-sends the same claim on
// "yes, send it", and the one-tap approve/reject links stay valid after a decision. Invented hotel, people and numbers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-claims-'));
Object.assign(process.env, { BINA_OSM_ADDIS: DIR + '/osm.json', BINA_WD_HOTELS: DIR + '/wd.json', BINA_HOTELS_HIDDEN: DIR + '/hidden.json',
  HOTEL_OWNER_ROOMS_FILE: DIR + '/owner-rooms.json', HOTEL_CLAIM_ROOMS_FILE: DIR + '/claim-rooms.json', BINA_RIDER_BOT_TOKEN: '' });
fs.writeFileSync(DIR + '/osm.json', JSON.stringify({ bySub: { node1: 'Bole' }, elements: [
  { type: 'node', id: 1, lat: 9.0, lon: 38.8, tags: { tourism: 'hotel', name: 'Sample Grand Hotel', stars: '3', phone: '+251110000091' } }] }));
const H = require('../hotels/directory');

function app() {
  const routes = {}, team = [], claims = [];
  const match = (r, w) => Object.entries(w || {}).every(([k, v]) => r[k] === v);
  const prisma = {
    hotelClaim: {
      findFirst: async ({ where }) => claims.find(r => match(r, where)) || null,
      findMany: async ({ where }) => claims.filter(r => match(r, where)),
      findUnique: async ({ where }) => claims.find(r => r.id === where.id) || null,
      create: async ({ data }) => { const r = Object.assign({ id: 'c' + (claims.length + 1), status: 'pending' }, data); claims.push(r); return r; },
      update: async ({ where, data }) => Object.assign(claims.find(r => r.id === where.id), data) },
    placeReview: { findMany: async () => [], groupBy: async () => [] } };
  const fastify = { get(p, a, b) { routes['GET ' + p] = b || a; }, post(p, a, b) { routes['POST ' + p] = b || a; } };
  H(fastify, { prisma, limiter: () => () => true, tell: async t => { team.push(t); return true; } }, () => {});
  const call = async (k, req = {}) => {
    const r = { c: 200, h: {}, code(n) { this.c = n; return this; }, header(a, b) { this.h[a] = b; return this; }, type() { return this; }, redirect(u) { this.c = 302; this.loc = u; return this; }, send(x) { this.body = x; return x; } };
    const out = await routes[k](Object.assign({ headers: { 'x-real-ip': '10.0.0.9' }, query: {}, params: {}, body: {} }, req), r);
    return { code: r.c, body: out === r ? r.body : out };
  };
  return { call, team, claims };
}
const ROOMS = [{ name: 'Single room', price: 2500, currency: 'ETB' }, { name: 'Double room', price: 3200, currency: 'ETB' }];
const claim = { ref: 'node/1', name: 'Sample Manager', role: 'manager', phone: '0900000051', note: '[via Bini] claim and prices', rooms: ROOMS };
const priced = html => /2,500/.test(html) && /3,200/.test(html);

test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('the same claim sent twice is one claim and ONE team note; changed prices are a new note', async () => {
  const { call, team, claims } = app();
  assert.equal((await call('POST /api/hotels/claim', { body: claim })).body.ok, true);
  assert.equal((await call('POST /api/hotels/claim', { body: claim })).body.ok, true);
  assert.equal(claims.length, 1); assert.equal(team.length, 1, 'Bini re-sending on "yes" does not ping the team again');
  await call('POST /api/hotels/claim', { body: Object.assign({}, claim, { rooms: [{ name: 'Single room', price: 2700, currency: 'ETB' }] }) });
  assert.equal(team.length, 2); assert.match(team[1], /New room prices/);
});

test('approve puts the owner\'s prices on the page once; reject after approve takes them back', async () => {
  const { call, claims } = app();
  const page = async () => (await call('GET /hotels/:slug', { params: { slug: 'sample-grand-hotel-n1' } })).body;
  await call('POST /api/hotels/claim', { body: claim });
  const c = claims[0], link = a => call('GET /ops/hotel-claims/:id/:action', { params: { id: c.id, action: a }, query: { t: c.token } });
  assert.ok(!priced(await page()), 'nothing before approval');
  assert.match((await link('approve')).body, /Approved/);
  assert.ok(priced(await page()), 'the owner\'s prices are on the page');
  assert.doesNotMatch(await page(), /900000051|0900 000 051/, 'the manager\'s mobile is not');
  assert.match((await link('approve')).body, /Already approved/);
  assert.match((await link('reject')).body, /Rejected/);
  assert.equal(c.status, 'rejected');
  assert.ok(!priced(await page()), 'a reject after an approve takes the prices back');
  assert.equal((await call('GET /ops/hotel-claims/:id/:action', { params: { id: c.id, action: 'approve' }, query: { t: 'x'.repeat(32) } })).code, 404);
});
