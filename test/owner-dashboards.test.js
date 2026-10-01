'use strict';
// Owner dashboards by PROVEN phone (1 Oct 2026): home owners on /property/dashboard (price, rented / sold, back on the
// market) and approved hotels on /hotels/dashboard (room prices). Invented owners, hotel and numbers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'owndash-'));
Object.assign(process.env, { BINA_OSM_ADDIS: DIR + '/osm.json', BINA_WD_HOTELS: DIR + '/wd.json', BINA_HOTELS_HIDDEN: DIR + '/hidden.json',
  HOTEL_OWNER_ROOMS_FILE: DIR + '/owner-rooms.json', HOTEL_CLAIM_ROOMS_FILE: DIR + '/claim-rooms.json', HOTEL_OWNER_PHONES_FILE: DIR + '/owner-phones.json', BINA_RIDER_BOT_TOKEN: '' });
fs.writeFileSync(DIR + '/osm.json', JSON.stringify({ bySub: { node1: 'Bole' }, elements: [
  { type: 'node', id: 1, lat: 9.0, lon: 38.8, tags: { tourism: 'hotel', name: 'Sample Grand Hotel', stars: '3', phone: '+251110000091' } }] }));
const Fastify = require('fastify');
const USERS = { owner: { phone: '0900000071', phoneVerifiedAt: new Date() }, hotel: { phone: '0900000051', phoneVerifiedAt: new Date() },
  unproven: { phone: '0900000071', phoneVerifiedAt: null }, other: { phone: '0900000079', phoneVerifiedAt: new Date() } };
const authUser = { findUnique: async ({ where }) => USERS[where.id] || null };
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

function listing(id, phone, over) {
  return Object.assign({ id, slug: 'owner-' + id, title: 'Apartment for rent · Bole Atlas', listingType: 'rent', location: 'Bole Atlas', price: '25,000 birr per month',
    agencyPhone: phone, active: true, verified: true, details: { submittedVia: 'bini', review: { status: 'approved' } } }, over);
}
async function propertyApp() {
  const rows = [listing('a1', '+251900000071'), listing('a2', '+251900000071', { active: false, details: { submittedVia: 'bini', review: { status: 'pending', token: 'x' } } }),
    listing('a3', '+251900000079'), listing('a4', '+251900000071', { details: { review: { status: 'approved' } } })];   // a4: an imported listing, not via Bini
  const team = [];
  const prisma = { authUser, propertyListing: {
    findMany: async ({ where }) => rows.filter(r => r.agencyPhone === where.agencyPhone),
    findUnique: async ({ where }) => rows.find(r => r.id === where.id) || null,
    findFirst: async () => null, create: async () => null,
    update: async ({ where, data }) => Object.assign(rows.find(r => r.id === where.id), data) } };
  const f = Fastify();
  f.addHook('onRequest', async req => { const u = req.headers['x-test-user']; req.authUser = u ? { id: u } : null; });
  const tell = async t => { team.push(t); return true; };
  f.register(require('../property/owner-listing'), { prisma, limiter: () => () => true, tell });
  f.register(require('../property/dashboard'), { prisma, limiter: () => () => true, tell });
  await f.ready();
  return { rows, team, go: (m, url, body, user) => f.inject({ method: m, url, payload: body, headers: user ? { 'x-test-user': user } : {} }) };
}

test('property: an owner sees and changes only their own approved Bini listings', async () => {
  const { go, rows, team } = await propertyApp();
  assert.equal((await go('GET', '/api/property/mine')).statusCode, 401);
  assert.deepEqual((await go('GET', '/api/property/mine', null, 'unproven')).json().listings, []);
  const mine = (await go('GET', '/api/property/mine', null, 'owner')).json();
  assert.deepEqual(mine.listings.map(l => l.id), ['a1'], 'not the pending one, not an imported one, not someone else\'s');
  assert.equal(mine.pending, 1);
  assert.equal((await go('POST', '/api/property/mine/a3', { price: '1 birr' }, 'owner')).statusCode, 404);
  assert.equal((await go('POST', '/api/property/mine/a4', { price: '1 birr' }, 'owner')).statusCode, 404);
  const r = (await go('POST', '/api/property/mine/a1', { price: '23,000 birr per month', status: 'closed' }, 'owner')).json();
  assert.deepEqual(r.changed, ['marked RENTED (off the site)', 'price: 23,000 birr per month']);
  assert.equal(rows[0].active, false); assert.equal(rows[0].details.closed.as, 'rented');
  assert.match(team[0], /changed by its owner/); assert.match(team[0], /remove\?t=[a-f0-9]{32}/);
  assert.equal((await go('POST', '/api/property/mine/a1', { status: 'open' }, 'owner')).json().listing.status, 'open');
  assert.equal(rows[0].active, true);
  assert.equal((await go('POST', '/api/property/mine/a1', { status: 'gone' }, 'owner')).json().error, 'status');
});

test('property: once the team takes a listing down, the owner cannot bring it back', async () => {
  const { go, rows, team } = await propertyApp();
  await go('POST', '/api/property/mine/a1', { status: 'closed' }, 'owner');
  const tok = /remove\?t=([a-f0-9]+)/.exec(team[0])[1];
  assert.match((await go('GET', '/ops/listing-requests/a1/remove?t=' + tok)).body, /Taken down/);
  assert.equal((await go('POST', '/api/property/mine/a1', { status: 'open' }, 'owner')).statusCode, 404);
  assert.equal(rows[0].active, false);
});

async function hotelApp() {
  const claims = [{ id: 'c1', placeRef: 'node/1', placeName: 'Sample Grand Hotel', slug: 'sample-grand-hotel-n1', phone: '0900000051', status: 'approved' },   // an older claim, digits as typed
    { id: 'c2', placeRef: 'new:sample-pension', placeName: 'Sample Pension', slug: '', phone: '+251900000051', status: 'approved' },
    { id: 'c3', placeRef: 'node/1', placeName: 'Sample Grand Hotel', slug: 'sample-grand-hotel-n1', phone: '+251900000079', status: 'pending' }];
  const team = [];
  const prisma = { authUser, hotelClaim: { findMany: async ({ where }) => claims.filter(c => !where || !where.status || c.status === where.status), findFirst: async () => null },
    placeReview: { findMany: async () => [], groupBy: async () => [] } };
  const f = Fastify();
  f.addHook('onRequest', async req => { const u = req.headers['x-test-user']; req.authUser = u ? { id: u } : null; });
  const tell = async t => { team.push(t); return true; };
  f.register(require('../hotels/directory'), { prisma, limiter: () => () => true, tell });
  f.register(require('../hotels/dashboard'), { prisma, limiter: () => () => true, tell });
  await f.ready();
  return { team, go: (m, url, body, user) => f.inject({ method: m, url, payload: body, headers: user ? { 'x-test-user': user } : {} }) };
}

test('hotels: the hotel the team approved for this number edits its room prices, live on the page', async () => {
  const { go, team } = await hotelApp();
  const mine = (await go('GET', '/api/hotels/mine', null, 'hotel')).json();
  assert.deepEqual(mine.hotels.map(h => h.claimId), ['c1'], 'a not-on-the-map claim has no page; a pending claim is not theirs yet');
  assert.deepEqual((await go('GET', '/api/hotels/mine', null, 'other')).json().hotels, []);
  const r = (await go('POST', '/api/hotels/mine/c1', { rooms: [{ name: 'Single room', price: 2500, currency: 'ETB' }, { name: 'Suite', price: 120, currency: 'USD' }, { name: 'Broom cupboard', price: 5 }] }, 'hotel')).json();
  assert.equal(r.kept, 2); assert.equal(r.dropped, 1, 'an unreal price is left out');
  const page = (await go('GET', '/hotels/sample-grand-hotel-n1')).body;
  assert.match(page, /2,500/); assert.match(page, /USD 120/);
  assert.match(team[0], /Room prices changed by the hotel/);
  assert.equal((await go('POST', '/api/hotels/mine/c1', { rooms: [{ name: 'Single room', price: 3 }] }, 'hotel')).json().error, 'prices');
  assert.equal((await go('POST', '/api/hotels/mine/c2', { rooms: [] }, 'hotel')).statusCode, 404);
  assert.equal((await go('POST', '/api/hotels/mine/c1', { rooms: [] }, 'other')).statusCode, 404);
  const tok = /remove\?t=([a-f0-9]+)/.exec(team[0])[1];
  assert.match((await go('GET', '/ops/hotel-rooms/c1/remove?t=' + tok)).body, /removed/);
  assert.doesNotMatch((await go('GET', '/hotels/sample-grand-hotel-n1')).body, /2,500/, 'the team\'s one tap takes them off');
  assert.equal((await go('GET', '/ops/hotel-rooms/c1/remove?t=' + tok)).statusCode, 404, 'once');
});

test('hotels: the number for guests, shown first on the page and in the search answers; the team can take it back', async () => {
  const { go, team } = await hotelApp();
  assert.equal((await go('POST', '/api/hotels/mine/c1', { phone: '+971 50 000 0000' }, 'hotel')).json().error, 'phone');
  const r = (await go('POST', '/api/hotels/mine/c1', { phone: '0900 000 052' }, 'hotel')).json();
  assert.equal(r.phone, '+251900000052'); assert.equal(r.hotel.phone, '+251900000052');
  const page = (await go('GET', '/hotels/sample-grand-hotel-n1')).body;
  assert.ok(page.indexOf('+251900000052') > -1 && page.indexOf('+251900000052') < page.indexOf('+251110000091'), 'the hotel\'s number comes before the map\'s landline');
  assert.match(page, /"telephone":"\+251900000052"/, 'and in the structured data');
  const hit = (await go('GET', '/api/hotels/search?q=Sample%20Grand')).json();
  assert.equal(JSON.stringify(hit).includes('+251900000052'), true, 'Bini and the MCP read the same number');
  assert.match(team.at(-1), /Phone changed by the hotel/); assert.doesNotMatch(team.at(-1), /Room prices/);
  const tok = /hotel-phone\/c1\/remove\?t=([a-f0-9]+)/.exec(team.at(-1))[1];
  assert.match((await go('GET', '/ops/hotel-phone/c1/remove?t=' + tok)).body, /removed/);
  assert.doesNotMatch((await go('GET', '/hotels/sample-grand-hotel-n1')).body, /900000052/);
  await go('POST', '/api/hotels/mine/c1', { phone: '0900 000 053' }, 'hotel');
  assert.equal((await go('POST', '/api/hotels/mine/c1', { phone: '' }, 'hotel')).json().hotel.phone, '', 'empty goes back to the map\'s number');
  assert.equal((await go('POST', '/api/hotels/mine/c1', {}, 'hotel')).json().error, 'rooms', 'nothing to change');
});
