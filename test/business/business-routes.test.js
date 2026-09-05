'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const registerBusiness = require('../../business');

const KEY = 'owner-secret';
function fakeDb() {
  const T = { shop: [], venue: [], product: [], offer: [], order: [], orderItem: [], ownerClaim: [], ownerSession: [], programme: [] };
  let seq = 0;
  const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' });
  const cmp = (v, c) => { if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) { if ('not' in c) return v !== c.not; if ('in' in c) return c.in.includes(v); if ('gte' in c) return v >= c.gte; if ('lt' in c) return v < c.lt; return true; } return v === c; };
  const match = (r, w) => Object.entries(w || {}).every(([k, c]) => k === 'OR' ? c.some(x => match(r, x)) : k === 'tenancy' ? true : cmp(r[k], c));
  const inc = (n, r, i) => {
    if (!r) return null; const o = { ...r }; if (!i) return o;
    if (n === 'shop') { if (i.products) o.products = T.product.filter(p => p.shopId === r.id && (!i.products.where || match(p, i.products.where))); if (i.offers) o.offers = T.offer.filter(x => x.shopId === r.id); if (i.tenancy) o.tenancy = null; }
    if (n === 'order' && i.items) o.items = T.orderItem.filter(x => x.orderId === r.id).map(x => ({ ...x, product: T.product.find(p => p.id === x.productId) || null }));
    if (n === 'ownerClaim') { o.shop = T.shop.find(x => x.id === r.shopId) || null; o.venue = T.venue.find(x => x.id === r.venueId) || null; }
    return o;
  };
  const model = n => ({
    create: async ({ data, include }) => {
      if (data.slug && T[n].some(r => r.slug === data.slug)) throw p2002();
      const row = { id: n[0] + (++seq), createdAt: new Date(), lastSeen: new Date(), tries: 0, photos: [], orderCount: 0, avgRating: 0, reviewCount: 0, ...data };
      if (n === 'ownerClaim' && !row.status) row.status = 'PENDING';
      if (n === 'order') { row.status = row.status || 'NEW'; const kids = (data.items && data.items.create) || []; delete row.items; T[n].push(row); kids.forEach(k => T.orderItem.push({ id: 'oi' + (++seq), orderId: row.id, ...k })); return inc(n, row, include); }
      T[n].push(row); return inc(n, row, include);
    },
    findUnique: async ({ where, include }) => inc(n, T[n].find(r => match(r, where)) || null, include),
    findFirst: async ({ where, include }) => inc(n, T[n].find(r => match(r, where)) || null, include),
    findMany: async ({ where, include, orderBy, take } = {}) => { let rows = T[n].filter(r => match(r, where)); if (take) rows = rows.slice(0, take); return rows.map(r => inc(n, r, include)); },
    count: async ({ where } = {}) => T[n].filter(r => match(r, where)).length,
    update: async ({ where, data, include }) => { const r = T[n].find(x => match(x, where)); for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === 'object' && 'increment' in v ? (r[k] || 0) + v.increment : v; return inc(n, r, include); },
    updateMany: async ({ where, data }) => { let c = 0; for (const r of T[n]) if (match(r, where)) { for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === 'object' && 'increment' in v ? (r[k] || 0) + v.increment : v; c++; } return { count: c }; },
    delete: async ({ where }) => { const i = T[n].findIndex(r => match(r, where)); return T[n].splice(i, 1)[0]; },
    deleteMany: async ({ where }) => { let c = 0; for (let i = T[n].length - 1; i >= 0; i--) if (match(T[n][i], where)) { T[n].splice(i, 1); c++; } return { count: c }; },
  });
  const db = { _: T }; for (const k of Object.keys(T)) db[k] = model(k); return db;
}
const sent = [];
const tgApi = { sendMessage: async (chat, text) => { sent.push({ chat, text }); return { ok: true }; } };
async function app() {
  const f = Fastify({ logger: false });
  f.decorateReply('sendFile', function (name) { this.type('text/html').send('<!-- ' + name + ' -->'); });
  const db = fakeDb();
  db._.shop.push({ id: 's1', name: 'Kaldi\'s Café', nameAm: 'ካልዲስ ካፌ', category: 'CAFE', phone: '+251910530813', telegram: '777', status: 'live', photos: [], avgRating: 0, reviewCount: 0 });
  db._.shop.push({ id: 's2', name: 'Other Office', phone: '+251911419313', status: 'live', photos: [] });
  db._.shop.push({ id: 's3', name: 'Demo Bank Branch', phone: '+251953000100', status: 'demo', photos: [] });
  const b = registerBusiness(f, { prisma: db, OWNER_KEY: KEY, BASE_URL: 'https://bina.et', tgApi, riderBotToken: '1:x', force: true, uploadsDir: '/tmp/bina-test-shops' });
  await f.ready(); return { f, db, b };
}
const OPS = { 'x-owner-key': KEY, 'content-type': 'application/json' };
const J = { 'content-type': 'application/json' };
// A shop with a Telegram id gets a code; one without (most JJ Darule tenants) waits for ops approval.
async function signIn(f, phone) {
  sent.length = 0;
  const c = (await f.inject({ method: 'POST', url: '/api/business/claim', headers: J, payload: { phone } })).json();
  assert.equal(c.ok, true, JSON.stringify(c));
  const code = c.sent ? (sent[0].text.match(/code: (\d{6})/) || [])[1] : null;
  const v = code
    ? (await f.inject({ method: 'POST', url: '/api/business/verify', headers: J, payload: { claimId: c.claimId, code } })).json()
    : (await f.inject({ method: 'POST', url: '/api/business/ops/claims/' + c.claimId + '/approve', headers: OPS, payload: {} })).json();
  const H = { ...J, 'x-owner-token': v.token };
  const me = (await f.inject({ method: 'GET', url: '/api/business/me', headers: H })).json();   // the dashboard loads this first
  return { token: v.token, H, me };
}

test('sign in with the shop phone, see my own shop, and never another shop', async () => {
  const { f } = await app();
  assert.equal((await f.inject({ method: 'GET', url: '/api/business/me' })).statusCode, 401);
  const a = await signIn(f, '0910530813');
  const me = (await f.inject({ method: 'GET', url: '/api/business/me', headers: a.H })).json();
  assert.equal(me.kind, 'shop'); assert.equal(me.shop.nameAm, 'ካልዲስ ካፌ'); assert.equal(me.shop.slug, 'kaldis-cafe'); assert.equal(me.url, 'https://bina.et/shop/kaldis-cafe');
  assert.equal((await f.inject({ method: 'POST', url: '/api/business/switch', headers: a.H, payload: { id: 's2' } })).statusCode, 403);
  await f.close();
});

test('a demo shop cannot be claimed and has no public page', async () => {
  const { f } = await app();
  const r = await f.inject({ method: 'POST', url: '/api/business/claim', headers: J, payload: { phone: '0953000100' } });
  assert.equal(r.statusCode, 404); assert.equal(r.json().error, 'no_match');
  await f.close();
});

test('products: add, edit, hide, cap; the public page shows only visible ones', async () => {
  const { f, db } = await app();
  const a = await signIn(f, '0910530813');
  const p = (await f.inject({ method: 'POST', url: '/api/business/products', headers: a.H, payload: { name: 'Macchiato', nameAm: 'ማኪያቶ', price: 60 } })).json();
  assert.equal(p.ok, true); assert.equal(p.product.price, 60); assert.equal(p.product.visible, true);
  assert.equal((await f.inject({ method: 'POST', url: '/api/business/products', headers: a.H, payload: { name: 'No price' } })).statusCode, 400);
  const hidden = (await f.inject({ method: 'POST', url: '/api/business/products', headers: a.H, payload: { name: 'Secret', price: 10, visible: false } })).json();
  const pub = (await f.inject({ method: 'GET', url: '/api/shops/kaldis-cafe' })).json();
  assert.deepEqual(pub.products.map(x => x.name), ['Macchiato']);
  const upd = (await f.inject({ method: 'POST', url: '/api/business/products/' + p.product.id, headers: a.H, payload: { price: 70 } })).json();
  assert.equal(upd.product.price, 70);
  // another owner cannot touch it
  const b2 = await signIn(f, '0911419313');
  assert.equal((await f.inject({ method: 'POST', url: '/api/business/products/' + p.product.id, headers: b2.H, payload: { price: 1 } })).statusCode, 404);
  assert.equal((await f.inject({ method: 'GET', url: '/api/business/products', headers: b2.H })).json().products.length, 0);
  assert.equal(db._.product.find(x => x.id === p.product.id).price, 70);
  await f.close();
});

test('a customer orders from the public page; the owner sees it and moves it forward only in order', async () => {
  const { f } = await app();
  const a = await signIn(f, '0910530813');
  const p = (await f.inject({ method: 'POST', url: '/api/business/products', headers: a.H, payload: { name: 'Macchiato', price: 60 } })).json().product;
  const bad = await f.inject({ method: 'POST', url: '/api/shops/kaldis-cafe/order', headers: J, payload: { name: 'Sara', phone: '+971501234567', items: [{ productId: p.id, qty: 2 }] } });
  assert.equal(bad.statusCode, 400); assert.equal(bad.json().error, 'phone');
  const o = await f.inject({ method: 'POST', url: '/api/shops/kaldis-cafe/order', headers: J, payload: { name: 'Sara', phone: '0911223344', items: [{ productId: p.id, qty: 2 }], note: 'no sugar' } });
  assert.equal(o.statusCode, 200); assert.equal(o.json().order.total, 120);
  const list = (await f.inject({ method: 'GET', url: '/api/business/orders', headers: a.H })).json();
  assert.equal(list.orders.length, 1); assert.equal(list.orders[0].customerPhone, '+251911223344'); assert.deepEqual(list.orders[0].items, [{ name: 'Macchiato', qty: 2, price: 60 }]);
  const id = list.orders[0].id;
  assert.equal((await f.inject({ method: 'POST', url: '/api/business/orders/' + id + '/status', headers: a.H, payload: { status: 'COMPLETED' } })).statusCode, 400, 'cannot jump from NEW to COMPLETED');
  for (const st of ['ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED']) {
    assert.equal((await f.inject({ method: 'POST', url: '/api/business/orders/' + id + '/status', headers: a.H, payload: { status: st } })).statusCode, 200, st);
  }
  assert.ok(sent.some(x => /new order/.test(x.text)), 'the owner was pinged');
  await f.close();
});

test('profile edits are validated and land on the public page; hidden shops 404', async () => {
  const { f, db } = await app();
  const a = await signIn(f, '0910530813');
  assert.equal((await f.inject({ method: 'POST', url: '/api/business/profile', headers: a.H, payload: { phone: '12345' } })).statusCode, 400);
  assert.equal((await f.inject({ method: 'POST', url: '/api/business/profile', headers: a.H, payload: { socialLink: 'javascript:alert(1)' } })).statusCode, 400);
  const r = (await f.inject({ method: 'POST', url: '/api/business/profile', headers: a.H, payload: { about: 'ጥሩ ቡና', category: 'CAFE', address: 'JJ Darule, G-003' } })).json();
  assert.equal(r.shop.about, 'ጥሩ ቡና');
  const pub = (await f.inject({ method: 'GET', url: '/api/shops/kaldis-cafe' })).json();
  assert.equal(pub.shop.address, 'JJ Darule, G-003');
  db._.shop[0].status = 'hidden';
  assert.equal((await f.inject({ method: 'GET', url: '/api/shops/kaldis-cafe' })).statusCode, 404);
  assert.equal((await f.inject({ method: 'GET', url: '/api/business/me', headers: a.H })).statusCode, 401, 'the session dies with the shop');
  await f.close();
});

test('offers need an end date; ops can approve a claim and change a shop status', async () => {
  const { f, db } = await app();
  const a = await signIn(f, '0910530813');
  assert.equal((await f.inject({ method: 'POST', url: '/api/business/offers', headers: a.H, payload: { title: 'No dates' } })).statusCode, 400);
  const o = (await f.inject({ method: 'POST', url: '/api/business/offers', headers: a.H, payload: { title: '20% off', startsAt: '2026-09-05', endsAt: '2026-09-30' } })).json();
  assert.equal(o.ok, true);
  assert.equal((await f.inject({ method: 'GET', url: '/api/business/ops/claims' })).statusCode, 401);
  const c = (await f.inject({ method: 'POST', url: '/api/business/claim', headers: J, payload: { phone: '0911419313' } })).json();
  const pend = (await f.inject({ method: 'GET', url: '/api/business/ops/claims', headers: OPS })).json();
  assert.ok(pend.claims.some(x => x.id === c.claimId && x.target === 'Other Office'));
  const ap = (await f.inject({ method: 'POST', url: '/api/business/ops/claims/' + c.claimId + '/approve', headers: OPS, payload: {} })).json();
  assert.equal(ap.ok, true); assert.ok(ap.token);
  assert.equal((await f.inject({ method: 'POST', url: '/api/business/ops/shops/s2/status', headers: OPS, payload: { status: 'hidden' } })).json().changed, 1);
  assert.equal(db._.shop.find(x => x.id === 's2').status, 'hidden');
  await f.close();
});

test('pages are served', async () => {
  const { f } = await app();
  for (const u of ['/business', '/ops/business', '/for-business']) assert.equal((await f.inject({ method: 'GET', url: u })).statusCode, 200, u);
  await f.close();
});
