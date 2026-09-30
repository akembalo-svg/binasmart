// bina.et/shop: shop owners post through Bini; nothing is public until the team approves (30 Sep 2026).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

const STORE = path.join(os.tmpdir(), 'shop-posts-test-' + process.pid + '.json');
process.env.SHOP_POSTS_FILE = STORE;
const shopPosts = require('../shops/posts');

function app() {
  const routes = {}, sent = [];
  const fastify = { get(p, a, b) { routes['GET ' + p] = b || a; }, post(p, a, b) { routes['POST ' + p] = b || a; } };
  const prisma = { shop: { findMany: async () => [
    { slug: 'bina-restaurant', name: 'Bina Restaurant', category: 'RESTAURANT' },      // demo: never listed
    { slug: 'mnnb-pharmacy', name: 'MNNB Pharmacy', category: 'PHARMACY' }] } };
  shopPosts(fastify, { prisma, limiter: () => () => true, tell: async t => { sent.push(t); return true; } }, () => {});
  const call = async (k, req = {}) => {
    const r = { c: 200, code(n) { this.c = n; return this; }, header() { return this; }, type() { return this; }, send(x) { this.body = x; return x; } };
    const out = await routes[k](Object.assign({ headers: {}, query: {}, params: {}, body: {} }, req), r);
    return { code: r.c, body: out };
  };
  return { call, sent };
}
const KEY = { 'x-bini-internal': shopPosts.INTERNAL_KEY };
const good = { action: 'add', shop: 'Selam Fashion', area: 'Merkato', name: 'Selam', phone: '0900 000 031', kind: 'product',
  title: 'Habesha kemis, handmade', price: '4,500 birr', category: 'fashion', description: 'Cotton, all sizes' };

test.beforeEach(() => { try { fs.unlinkSync(STORE); } catch (e) {} });
test.after(() => { try { fs.unlinkSync(STORE); } catch (e) {} });

test('phone and price helpers', () => {
  assert.strictEqual(shopPosts.ethPhone('0900 000 031'), '+251900000031');
  assert.strictEqual(shopPosts.ethPhone('011 000 0090'), '+251110000090');
  assert.strictEqual(shopPosts.ethPhone('12345'), '');
  assert.strictEqual(shopPosts.priceNum('4,500 birr'), 4500);
  assert.strictEqual(shopPosts.priceNum('ብር 950'), 950);
  assert.strictEqual(shopPosts.priceNum('20% off'), null);
});

test('only Bini can post: the public gets 404', async () => {
  const { call } = app();
  assert.strictEqual((await call('POST /api/shop/post', { body: good })).code, 404);
  assert.strictEqual((await call('POST /api/shop/post', { headers: { 'x-bini-internal': 'guess' }, body: good })).code, 404);
});

test('a post is private until approved, then live on the page and the feed', async () => {
  const { call, sent } = app();
  const r = await call('POST /api/shop/post', { headers: KEY, body: good });
  assert.ok(r.body.ok && r.body.id);
  assert.match(sent[0], /New shop post via Bini<\/b> \(not live\)/);
  assert.match(sent[0], /Habesha kemis/); assert.match(sent[0], /approve\?t=[0-9a-f]{32}/);
  assert.strictEqual((await call('GET /api/shop/feed')).body.count, 0);
  let page = (await call('GET /shop')).body;
  assert.match(page, /class="sec feed is-empty"/); assert.doesNotMatch(page, /Habesha kemis/);
  // the same post again within 6 hours is not a second request
  assert.strictEqual((await call('POST /api/shop/post', { headers: KEY, body: good })).body.duplicate, true);

  const id = r.body.id, token = JSON.parse(fs.readFileSync(STORE, 'utf8')).posts[0].token;
  assert.strictEqual((await call('GET /ops/shop-posts/:id/:action', { params: { id, action: 'approve' }, query: { t: 'x'.repeat(32) } })).code, 404);
  await call('GET /ops/shop-posts/:id/:action', { params: { id, action: 'approve' }, query: { t: token } });
  // a used approve link does nothing more
  assert.strictEqual((await call('GET /ops/shop-posts/:id/:action', { params: { id, action: 'approve' }, query: { t: token } })).code, 404);

  const feed = (await call('GET /api/shop/feed')).body;
  assert.strictEqual(feed.count, 1);
  assert.strictEqual(feed.posts[0].phone, '+251900000031'); assert.strictEqual(feed.posts[0].whatsapp, '+251900000031');
  assert.strictEqual(feed.posts[0].owner, undefined); assert.strictEqual(feed.posts[0].token, undefined);
  page = (await call('GET /shop')).body;
  assert.match(page, /class="sec feed "/); assert.match(page, /Habesha kemis, handmade/); assert.match(page, /4,500 birr/);
  assert.match(page, /"@type":"ItemList"/); assert.match(page, /"price":4500,"priceCurrency":"ETB"/);
  assert.match(page, /href="tel:\+251900000031"/); assert.match(page, /wa\.me\/251900000031/);
  // the demo restaurant is not a real business
  assert.match(page, /MNNB Pharmacy/); assert.doesNotMatch(page, /Bina Restaurant/);
});

test('reject keeps it off; remove takes a live post down', async () => {
  const { call, sent } = app();
  const a = await call('POST /api/shop/post', { headers: KEY, body: good });
  const b = await call('POST /api/shop/post', { headers: KEY, body: Object.assign({}, good, { title: 'Netela scarf', price: '800 birr' }) });
  const S = () => JSON.parse(fs.readFileSync(STORE, 'utf8')).posts;
  await call('GET /ops/shop-posts/:id/:action', { params: { id: a.body.id, action: 'reject' }, query: { t: S()[0].token } });
  await call('GET /ops/shop-posts/:id/:action', { params: { id: b.body.id, action: 'approve' }, query: { t: S()[1].token } });
  let feed = (await call('GET /api/shop/feed')).body;
  assert.deepStrictEqual(feed.posts.map(p => p.title), ['Netela scarf']);
  // "it is sold": the owner asks Bini, the team takes it down with one tap
  await call('POST /api/shop/post', { headers: KEY, body: { action: 'remove', name: 'Selam', phone: '0900000031', post: 'netela scarf' } });
  assert.match(sent[sent.length - 1], /remove request via Bini<\/b> · Netela scarf/);
  const rt = S().find(p => p.id === b.body.id).removeToken;
  await call('GET /ops/shop-posts/:id/:action', { params: { id: b.body.id, action: 'remove' }, query: { t: rt } });
  feed = (await call('GET /api/shop/feed')).body;
  assert.strictEqual(feed.count, 0);
});

test('bad input is refused and nothing leaks into the page', async () => {
  const { call } = app();
  assert.strictEqual((await call('POST /api/shop/post', { headers: KEY, body: Object.assign({}, good, { phone: '123' }) })).body.error, 'phone');
  assert.strictEqual((await call('POST /api/shop/post', { headers: KEY, body: Object.assign({}, good, { title: '' }) })).body.error, 'title');
  assert.strictEqual((await call('POST /api/shop/post', { headers: KEY, body: Object.assign({}, good, { price: '' }) })).body.error, 'price');
  const x = await call('POST /api/shop/post', { headers: KEY, body: Object.assign({}, good, { title: '<img src=x onerror=alert(1)> Dress', category: 'weapons' }) });
  const tok = JSON.parse(fs.readFileSync(STORE, 'utf8')).posts[0].token;
  await call('GET /ops/shop-posts/:id/:action', { params: { id: x.body.id, action: 'approve' }, query: { t: tok } });
  const page = (await call('GET /shop')).body;
  assert.doesNotMatch(page, /<img src=x/); assert.match(page, /data-cat="other"/);
});
