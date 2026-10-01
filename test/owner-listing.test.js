'use strict';
// Owner listings through Bini (property/owner-listing.js): nothing is public until the team approves,
// only Bini's tool (internal key) can create one, and one-tap links need the right token once.
const test = require('node:test');
const assert = require('node:assert');
const Fastify = require('fastify');
const ownerListing = require('../property/owner-listing');
const propertyDetail = require('../property/detail');

function fakePrisma() {
  const rows = [];
  const match = (r, w) => Object.entries(w || {}).every(([k, v]) => {
    if (k === 'OR') return v.some(x => match(r, x));
    if (v && typeof v === 'object' && 'gt' in v) return r[k] > v.gt;
    return r[k] === v;
  });
  return { rows, propertyListing: {
    async create({ data }) { const r = Object.assign({ id: 'id' + (rows.length + 1), createdAt: new Date(), imageUrl: null }, data); rows.push(r); return r; },
    async findFirst({ where }) { return rows.find(r => match(r, where)) || null; },
    async findUnique({ where }) { return rows.find(r => (where.id ? r.id === where.id : r.slug === where.slug)) || null; },
    async findMany() { return rows.filter(r => r.active); },
    async update({ where, data }) { const r = rows.find(x => x.id === where.id); Object.assign(r, data); return r; } } };
}
const noLimit = () => () => true;
async function app(prisma, sent) {
  const f = Fastify();
  f.register(ownerListing, { prisma, limiter: noLimit, tell: async t => { sent.push(t); return true; } });
  f.register(propertyDetail, { prisma });
  await f.ready(); return f;
}
const KEY = { 'x-bini-internal': ownerListing.INTERNAL_KEY, 'x-real-ip': 'bini-900000012' };
const RENT = { action: 'add', listingType: 'rent', propertyType: 'villa', location: 'Bole', price: '120,000 birr', beds: '4', name: 'Test Owner', role: 'owner', phone: '0900 000 012' };

test('only Bini\'s tool can create a listing', async () => {
  const f = await app(fakePrisma(), []);
  const r = await f.inject({ method: 'POST', url: '/api/property/owner-listing', payload: RENT });
  assert.equal(r.statusCode, 404);
  const r2 = await f.inject({ method: 'POST', url: '/api/property/owner-listing', headers: { 'x-bini-internal': 'wrong' }, payload: RENT });
  assert.equal(r2.statusCode, 404);
});

test('add: a pending, invisible listing; phone normalised; rent gets "/ month"; the team is told once', async () => {
  const prisma = fakePrisma(), sent = [], f = await app(prisma, sent);
  const r = await f.inject({ method: 'POST', url: '/api/property/owner-listing', headers: KEY, payload: RENT });
  assert.equal(r.statusCode, 200, r.body);
  const L = prisma.rows[0];
  assert.match(L.slug, /^owner-[0-9a-f]{10}$/);
  assert.equal(L.active, false); assert.equal(L.verified, false);
  assert.equal(L.agencyPhone, '+251900000012'); assert.equal(L.agencyWhatsapp, '+251900000012');
  assert.equal(L.price, '120,000 birr / month'); assert.equal(L.listingType, 'rent');
  assert.equal(L.details.review.status, 'pending');
  assert.equal(sent.length, 1); assert.match(sent[0], /RENT listing via Bini/); assert.match(sent[0], /approve\?t=/);
  // the detail page and its text API do not show it yet
  assert.equal((await f.inject({ url: '/property/' + L.slug })).statusCode, 404);
  assert.equal(JSON.parse((await f.inject({ url: '/api/listing-text/property/' + L.slug })).body).text, '');
  // the same request again within hours is not a second listing
  await f.inject({ method: 'POST', url: '/api/property/owner-listing', headers: KEY, payload: RENT });
  assert.equal(prisma.rows.length, 1);
});

test('missing facts are refused with a reason Bini can act on', async () => {
  const f = await app(fakePrisma(), []);
  for (const [patch, err] of [[{ phone: '12345' }, 'phone'], [{ name: 'x' }, 'name'], [{ location: '' }, 'location'], [{ propertyType: 'castle' }, 'type'], [{ price: '' }, 'price']]) {
    const r = await f.inject({ method: 'POST', url: '/api/property/owner-listing', headers: KEY, payload: Object.assign({}, RENT, patch) });
    assert.equal(r.statusCode, 400); assert.equal(JSON.parse(r.body).error, err);
  }
});

test('approve needs the right token, works once, and makes it live', async () => {
  const prisma = fakePrisma(), f = await app(prisma, []);
  await f.inject({ method: 'POST', url: '/api/property/owner-listing', headers: KEY, payload: Object.assign({}, RENT, { listingType: 'sale', price: '25,000,000 birr', whatsapp: false }) });
  const L = prisma.rows[0], tok = L.details.review.token;
  assert.equal(L.agencyWhatsapp, null);
  assert.equal((await f.inject({ url: '/ops/listing-requests/' + L.id + '/approve?t=bad' })).statusCode, 404);
  const ok = await f.inject({ url: '/ops/listing-requests/' + L.id + '/approve?t=' + tok });
  assert.equal(ok.statusCode, 200); assert.match(ok.body, /Live/);
  assert.equal(L.active, true); assert.equal(L.verified, true); assert.equal(L.details.review.status, 'approved');
  assert.equal((await f.inject({ url: '/ops/listing-requests/' + L.id + '/approve?t=' + tok })).statusCode, 404, 'token is spent');
  assert.equal((await f.inject({ url: '/property/' + L.slug })).statusCode, 200);
});

test('reject keeps it off the site', async () => {
  const prisma = fakePrisma(), f = await app(prisma, []);
  await f.inject({ method: 'POST', url: '/api/property/owner-listing', headers: KEY, payload: RENT });
  const L = prisma.rows[0];
  const r = await f.inject({ url: '/ops/listing-requests/' + L.id + '/reject?t=' + L.details.review.token });
  assert.equal(r.statusCode, 200); assert.equal(L.active, false); assert.equal(L.details.review.status, 'rejected');
  assert.equal((await f.inject({ url: '/property/' + L.slug })).statusCode, 404);
});

test('remove: the team gets a take-down link that works once', async () => {
  const prisma = fakePrisma(), sent = [], f = await app(prisma, sent);
  await f.inject({ method: 'POST', url: '/api/property/owner-listing', headers: KEY, payload: RENT });
  const L = prisma.rows[0];
  await f.inject({ url: '/ops/listing-requests/' + L.id + '/approve?t=' + L.details.review.token });
  const r = await f.inject({ method: 'POST', url: '/api/property/owner-listing', headers: KEY, payload: { action: 'remove', listing: 'https://bina.et/property/' + L.slug, name: 'Test Owner', phone: '0900000012', request: 'rented' } });
  assert.equal(JSON.parse(r.body).matched, true);
  const tok = L.details.removeRequest.token; assert.ok(tok);
  assert.match(sent[sent.length - 1], /take it down/);
  const d = await f.inject({ url: '/ops/listing-requests/' + L.id + '/remove?t=' + tok });
  assert.equal(d.statusCode, 200); assert.equal(L.active, false);
  assert.equal((await f.inject({ url: '/ops/listing-requests/' + L.id + '/remove?t=' + tok })).statusCode, 404, 'take-down token is spent');
});

test('remove asked from a number that is not on the listing: a note for the team, no one-tap take-down (1 Oct 2026)', async () => {
  const prisma = fakePrisma(), sent = [], f = await app(prisma, sent);
  await f.inject({ method: 'POST', url: '/api/property/owner-listing', headers: KEY, payload: RENT });
  const L = prisma.rows[0];
  await f.inject({ url: '/ops/listing-requests/' + L.id + '/approve?t=' + L.details.review.token });
  const r = await f.inject({ method: 'POST', url: '/api/property/owner-listing', headers: KEY, payload: { action: 'remove', listing: 'https://bina.et/property/' + L.slug, name: 'Someone Else', phone: '0900000099', request: 'take it down' } });
  assert.equal(JSON.parse(r.body).matched, false);
  assert.ok(!(L.details.removeRequest && L.details.removeRequest.token), 'no take-down token');
  assert.match(sent[sent.length - 1], /NOT on the listing/); assert.doesNotMatch(sent[sent.length - 1], /\/remove\?t=/);
  assert.equal(L.active, true, 'still live');
});

test('photo upload: needs a uid and a real-sized image', async () => {
  const f = await app(fakePrisma(), []);
  assert.equal(JSON.parse((await f.inject({ method: 'POST', url: '/api/property/photo', payload: { uid: '!', image: 'x' } })).body).error, 'uid');
  assert.equal(JSON.parse((await f.inject({ method: 'POST', url: '/api/property/photo', payload: { uid: 'wtest123', image: Buffer.alloc(500).toString('base64') } })).body).error, 'too_small');
});

test('phone numbers: Ethiopian forms normalise, junk is refused', () => {
  assert.equal(ownerListing.ethPhone('0900 000 012'), '+251900000012');
  assert.equal(ownerListing.ethPhone('900000012'), '+251900000012');
  assert.equal(ownerListing.ethPhone('+251700000012'), '+251700000012');
  assert.equal(ownerListing.ethPhone('12345'), '');
});
