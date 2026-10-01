'use strict';
// Company page claims (companies/directory.js), brought in line with hotel claims on 1 Oct 2026: an Ethiopian number in one
// stored form, and a second tap on approve does nothing. Invented company, people and numbers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'company-claims-'));
Object.assign(process.env, { BINA_COMPANIES: DIR + '/companies.json', BINA_RIDER_BOT_TOKEN: '' });
fs.writeFileSync(DIR + '/companies.json', JSON.stringify({ companies: [
  { kind: 'real_estate', name: 'Sample Homes PLC', slug: 'sample-homes-plc', key: 'real_estate:sample homes', phones: ['+251 11 000 0093'], sub: 'Bole', places: [], sources: ['web'] }] }));
const C = require('../companies/directory');

function app() {
  const routes = {}, team = [], claims = [];
  const match = (r, w) => Object.entries(w || {}).every(([k, v]) => (v && typeof v === 'object' && 'startsWith' in v ? String(r[k]).startsWith(v.startsWith) : r[k] === v));
  const prisma = { hotelClaim: {
    findFirst: async ({ where }) => claims.find(r => match(r, where)) || null,
    findMany: async ({ where }) => claims.filter(r => match(r, where)),
    findUnique: async ({ where }) => claims.find(r => r.id === where.id) || null,
    create: async ({ data }) => { const r = Object.assign({ id: 'k' + (claims.length + 1), status: 'pending' }, data); claims.push(r); return r; },
    update: async ({ where, data }) => Object.assign(claims.find(r => r.id === where.id), data) } };
  const fastify = { log: { error() {} }, get(p, a, b) { routes['GET ' + p] = b || a; }, post(p, a, b) { routes['POST ' + p] = b || a; } };
  C(fastify, { prisma, limiter: () => () => true, tell: async t => { team.push(t); return true; } }, () => {});
  const call = async (k, req = {}) => {
    const r = { c: 200, h: {}, code(n) { this.c = n; return this; }, header(a, b) { this.h[a] = b; return this; }, type() { return this; }, redirect(u) { this.c = 302; return this; }, send(x) { this.body = x; return x; } };
    const out = await routes[k](Object.assign({ headers: { 'x-real-ip': '10.0.0.8' }, query: {}, params: {}, body: {} }, req), r);
    return { code: r.c, body: out === r ? r.body : out };
  };
  return { call, team, claims };
}
const claim = { ref: 'company:sample-homes-plc', name: 'Sample Manager', role: 'manager', phone: '0900000081', note: 'claim our page' };
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('a company claim needs an Ethiopian number; one stored form, so the same person twice is one claim', async () => {
  const { call, claims, team } = app();
  for (const phone of ['+971500000000', '12345']) assert.equal((await call('POST /api/companies/claim', { body: Object.assign({}, claim, { phone }) })).body.error, 'phone', phone);
  assert.equal((await call('POST /api/companies/claim', { body: claim })).body.ok, true);
  assert.equal(claims[0].phone, '+251900000081');
  assert.equal((await call('POST /api/companies/claim', { body: Object.assign({}, claim, { phone: '+251 900 000 081' }) })).body.ok, true);
  assert.equal(claims.length, 1); assert.equal(team.length, 1);
  assert.match(team[0], /Company claim/); assert.match(team[0], /Call before approving/);
});

test('approve works once; a reject of a company not in the directory does not say "add it by hand"', async () => {
  const { call, claims } = app();
  await call('POST /api/companies/claim', { body: claim });
  const c = claims[0], link = (a, t = c.token, id = c.id) => call('GET /ops/company-claims/:id/:action', { params: { id, action: a }, query: { t } });
  assert.match((await link('approve')).body, /Approved/);
  assert.match((await link('approve')).body, /Already approved/);
  assert.equal((await link('approve', 'x'.repeat(32))).code, 404);
  await call('POST /api/companies/claim', { body: { ref: 'new:real_estate', company: 'Sample New Realty', area: 'Bole', name: 'Sample Owner', role: 'owner', phone: '0900000082' } });
  const n = claims[1], r = await link('reject', n.token, n.id);
  assert.match(r.body, /Rejected/); assert.doesNotMatch(r.body, /add it by hand/);
});
