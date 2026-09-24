'use strict';
// One sign-in for all owners: /business also opens for a signed-in bina.et account through its ACTIVE
// OWNER memberships, scoped to exactly those shops and venues. Invented businesses, no phone numbers
// that could be real. req.authUser is set the way server.js's preHandler sets it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const registerBusiness = require('../../business');
const { makeBuildingMember } = require('../../building/memberAccess');

function fakeDb() {
  const T = {
    shop: [
      { id: 'sA', name: 'Alpha Cafe', nameAm: 'አልፋ ካፌ', category: 'CAFE', phone: '+251100000101', status: 'live', photos: [], slug: 'alpha-cafe' },
      { id: 'sB', name: 'Beta Shop', category: 'RETAIL', phone: '+251100000102', status: 'live', photos: [], slug: 'beta-shop' },
      { id: 'sC', name: 'Someone Else', category: 'CLINIC', phone: '+251100000103', status: 'live', photos: [], slug: 'someone-else' },
      { id: 'sH', name: 'Hidden', category: 'RETAIL', phone: '+251100000104', status: 'hidden', photos: [], slug: 'hidden' }
    ],
    venue: [{ id: 'vA', name: 'Alpha Cinema', nameAm: 'አልፋ ሲኒማ', slug: 'alpha-cinema', active: true, phone: '+251100000105' }],
    membership: [
      { id: 'm1', userId: 'acct-1', kind: 'shop', shopId: 'sA', role: 'owner', status: 'active', createdAt: new Date(1) },
      { id: 'm2', userId: 'acct-1', kind: 'venue', venueId: 'vA', role: 'owner', status: 'active', createdAt: new Date(2) },
      { id: 'm3', userId: 'acct-1', kind: 'shop', shopId: 'sB', role: 'owner', status: 'suspended', createdAt: new Date(3) },
      { id: 'm4', userId: 'acct-staff', kind: 'shop', shopId: 'sA', role: 'staff', status: 'active', createdAt: new Date(4) },
      { id: 'm5', userId: 'acct-hidden', kind: 'shop', shopId: 'sH', role: 'owner', status: 'active', createdAt: new Date(5) },
      { id: 'm6', userId: 'acct-2', kind: 'building', buildingSlug: 'tower-a', role: 'owner', status: 'active', createdAt: new Date(6) },
      { id: 'm7', userId: 'acct-2', kind: 'building', buildingSlug: 'tower-b', role: 'owner', status: 'suspended', createdAt: new Date(7) },
      { id: 'm8', userId: 'acct-3', kind: 'building', buildingSlug: 'tower-a', role: 'staff', status: 'active', createdAt: new Date(8) }
    ],
    ownerSession: [], ownerClaim: [], product: [], offer: [], order: [], programme: []
  };
  const cmp = (v, c) => (c && typeof c === 'object' && !(c instanceof Date)) ? ('in' in c ? c.in.includes(v) : 'not' in c ? v !== c.not : false) : v === c;
  const match = (r, w) => Object.entries(w || {}).every(([k, c]) => k === 'OR' ? c.some(x => match(r, x)) : cmp(r[k], c));
  const model = n => ({
    findUnique: async ({ where }) => { const r = T[n].find(x => match(x, where)); return r ? { ...r } : null; },
    findFirst: async ({ where }) => { const r = T[n].find(x => match(x, where)); return r ? { ...r } : null; },
    findMany: async ({ where, orderBy } = {}) => { let rows = T[n].filter(r => match(r, where)).map(r => ({ ...r })); if (orderBy && orderBy.createdAt) rows.sort((a, b) => a.createdAt - b.createdAt); return rows; },
    count: async ({ where } = {}) => T[n].filter(r => match(r, where)).length,
    update: async ({ where, data }) => { const r = T[n].find(x => match(x, where)); Object.assign(r, data); return { ...r }; },
    updateMany: async ({ where, data }) => { let c = 0; for (const r of T[n]) if (match(r, where)) { Object.assign(r, data); c++; } return { count: c }; },
    create: async ({ data }) => { const r = { id: n + (T[n].length + 1), createdAt: new Date(), lastSeen: new Date(), ...data }; T[n].push(r); return { ...r }; },
    deleteMany: async () => ({ count: 0 })
  });
  const db = { _: T }; for (const k of Object.keys(T)) db[k] = model(k); return db;
}

async function app() {
  const f = Fastify({ logger: false });
  const routes = [];
  f.addHook('onRoute', r => { [].concat(r.method).forEach(m => routes.push(m + ' ' + r.url)); });
  f.decorateReply('sendFile', function (name) { this.type('text/html').send('<!-- ' + name + ' -->'); });
  f.addHook('preHandler', async req => { const u = req.headers['x-test-user']; req.authUser = u ? { id: u } : null; });
  const db = fakeDb();
  registerBusiness(f, { prisma: db, OWNER_KEY: 'ops-test-key', BASE_URL: 'https://bina.et', tgApi: { sendMessage: async () => ({ ok: true }) }, riderBotToken: '1:x', force: true, uploadsDir: '/tmp/bina-test-shops' });
  await f.ready();
  return { f, db, routes };
}
const as = (user, extra) => Object.assign({ 'content-type': 'application/json' }, user ? { 'x-test-user': user } : {}, extra || {});
const cookieOf = res => [].concat(res.headers['set-cookie'] || []).join('; ');

test('an account with an active owner membership opens its own shop without the phone claim', async () => {
  const { f } = await app();
  const r = await f.inject({ method: 'GET', url: '/api/business/me', headers: as('acct-1') });
  assert.equal(r.statusCode, 200);
  const me = r.json();
  assert.equal(me.kind, 'shop');
  assert.equal(me.shop.id, 'sA', 'the oldest membership opens first');
  assert.deepEqual(me.pages.map(p => p.id).sort(), ['sA', 'vA'], 'the switcher lists only this account\'s memberships (not the suspended sB)');
  await f.close();
});

test('the switcher accepts only the account\'s own pages; a forged choice cookie cannot reach another shop', async () => {
  const { f } = await app();
  for (const id of ['sC', 'sB', 'sH', '../sA', '']) {
    const r = await f.inject({ method: 'POST', url: '/api/business/switch', headers: as('acct-1'), payload: { id } });
    assert.equal(r.statusCode, 403, 'switch to ' + JSON.stringify(id));
  }
  const ok = await f.inject({ method: 'POST', url: '/api/business/switch', headers: as('acct-1'), payload: { id: 'vA' } });
  assert.equal(ok.statusCode, 200);
  assert.match(cookieOf(ok), /bsacct=vA; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax/);
  const venue = (await f.inject({ method: 'GET', url: '/api/business/me', headers: as('acct-1', { cookie: 'bsacct=vA' }) })).json();
  assert.equal(venue.kind, 'venue');
  assert.equal(venue.venue.id, 'vA');
  const forged = (await f.inject({ method: 'GET', url: '/api/business/me', headers: as('acct-1', { cookie: 'bsacct=sC' }) })).json();
  assert.equal(forged.shop.id, 'sA', 'a cookie naming someone else\'s shop is ignored, not obeyed');
  await f.close();
});

test('suspended, staff, hidden-shop and no-membership accounts keep the old phone sign-in (401)', async () => {
  const { f } = await app();
  for (const u of ['acct-staff', 'acct-hidden', 'acct-2', 'acct-nobody', null]) {
    const r = await f.inject({ method: 'GET', url: '/api/business/me', headers: as(u) });
    assert.equal(r.statusCode, 401, String(u));
    assert.equal(r.json().error, 'sign_in');
  }
  // acct-1's only shop membership besides sA is suspended: it cannot be written to
  const w = await f.inject({ method: 'POST', url: '/api/business/switch', headers: as('acct-1'), payload: { id: 'sB' } });
  assert.equal(w.statusCode, 403);
  await f.close();
});

test('a valid bsown session still wins over the account, exactly as before', async () => {
  const { f, db } = await app();
  db._.ownerSession.push({ id: 'os1', token: 'T'.repeat(43), kind: 'shop', shopId: 'sC', venueId: null, phone: '+251100000103', createdAt: new Date(), lastSeen: new Date(), expiresAt: new Date(Date.now() + 86400000) });
  const r = (await f.inject({ method: 'GET', url: '/api/business/me', headers: as('acct-1', { cookie: 'bsown=' + 'T'.repeat(43) }) })).json();
  assert.equal(r.shop.id, 'sC', 'the phone session decides');
  const expired = 'E'.repeat(43);
  db._.ownerSession.push({ id: 'os2', token: expired, kind: 'shop', shopId: 'sC', phone: 'x', createdAt: new Date(), lastSeen: new Date(), expiresAt: new Date(Date.now() - 1000) });
  const r2 = (await f.inject({ method: 'GET', url: '/api/business/me', headers: as('acct-1', { cookie: 'bsown=' + expired }) })).json();
  assert.equal(r2.shop.id, 'sA', 'an expired phone session falls back to the account');
  await f.close();
});

test('the account can edit its own shop; logout clears the choice and says an account was used', async () => {
  const { f, db } = await app();
  const p = await f.inject({ method: 'POST', url: '/api/business/profile', headers: as('acct-1'), payload: { name: 'Alpha Cafe 2', nameAm: 'አልፋ ካፌ' } });
  assert.equal(p.statusCode, 200, p.body);
  assert.equal(db._.shop.find(s => s.id === 'sA').name, 'Alpha Cafe 2');
  assert.equal(db._.shop.find(s => s.id === 'sC').name, 'Someone Else');
  const out = await f.inject({ method: 'POST', url: '/api/business/logout', headers: as('acct-1'), payload: {} });
  assert.equal(out.json().account, true);
  assert.match(cookieOf(out), /bsacct=; Path=\/; Max-Age=0/);
  assert.match(cookieOf(out), /bsown=; Path=\/; Max-Age=0/);
  await f.close();
});

test('every state-changing /api/business route is a POST; the GETs are the known reads', async () => {
  const { f, routes } = await app();
  const gets = routes.filter(r => r.startsWith('GET /api/business')).map(r => r.slice(4)).sort();
  // /api/business/me also assigns a missing public slug once (ensureSlug) — the only write behind a GET.
  assert.deepEqual(gets, ['/api/business/me', '/api/business/offers', '/api/business/ops/claims', '/api/business/ops/overview', '/api/business/orders', '/api/business/products', '/api/business/programme']);
  for (const r of routes.filter(r => /\/api\/business\/.+\/(delete|status|approve|remove)$|\/api\/business\/(profile|photos|switch|logout|claim|verify)$/.test(r)))
    assert.ok(r.startsWith('POST ') || r.startsWith('HEAD '), r);
  await f.close();
});

test('building/memberAccess: only an active OWNER membership on that exact slug opens /owner/<slug>', async () => {
  const db = fakeDb();
  const isMember = makeBuildingMember({ prisma: db });
  assert.equal(await isMember('acct-2', 'tower-a'), true);
  assert.equal(await isMember('acct-2', 'tower-b'), false, 'suspended');
  assert.equal(await isMember('acct-3', 'tower-a'), false, 'staff has no dashboard tier');
  assert.equal(await isMember('acct-2', 'tower-c'), false, 'another building');
  assert.equal(await isMember('acct-1', 'tower-a'), false, 'another account');
  assert.equal(await isMember(null, 'tower-a'), false);
  assert.equal(await isMember('acct-2', { in: ['tower-a'] }), false, 'a slug must be a plain string');
  const broken = makeBuildingMember({ prisma: { membership: { findFirst: async () => { throw new Error('db down'); } } } });
  assert.equal(await broken('acct-2', 'tower-a'), false, 'an error never opens a dashboard');
});

test('server.js asks building/memberAccess inside authBuildingFail, after the account\'s own building', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'server.js'), 'utf8');
  const at = src.indexOf('async function authBuildingFail(');
  const body = src.slice(at, src.indexOf('\n}\n', at));
  assert.ok(body.includes('if (await isBuildingMember(req.authUser.id, slug)) return false;'));
  assert.ok(body.indexOf('buildingSlug === slug') < body.indexOf('isBuildingMember'));
});

test('every kind of owner business opens the same way: all shop categories and a venue, only for their own account', async () => {
  const CATS = ['CAFE', 'RESTAURANT', 'PHARMACY', 'RETAIL', 'SERVICE', 'GYM', 'SALON', 'CLINIC', 'BANK', 'OFFICE', 'OTHER'];
  for (const cat of CATS) {
    const { f, db } = await app();
    db._.shop.find(s => s.id === 'sA').category = cat;
    const mine = await f.inject({ method: 'GET', url: '/api/business/me', headers: as('acct-1') });
    assert.equal(mine.statusCode, 200, cat);
    assert.equal(mine.json().shop.id, 'sA', cat);
    const other = await f.inject({ method: 'GET', url: '/api/business/me', headers: as('acct-nobody') });
    assert.equal(other.statusCode, 401, cat + ': an account without the membership');
    await f.close();
  }
  const { f } = await app();
  const v = await f.inject({ method: 'POST', url: '/api/business/switch', headers: as('acct-1'), payload: { id: 'vA' } });
  assert.equal(v.statusCode, 200, 'a cinema / venue');
  const outsider = await f.inject({ method: 'POST', url: '/api/business/switch', headers: as('acct-staff'), payload: { id: 'vA' } });
  assert.equal(outsider.statusCode, 401, 'a staff-only account has no /business session at all');
  await f.close();
});
