'use strict';
// bina.et/shop/dashboard (1 Oct 2026): a seller manages the posts that carry the phone their account has PROVEN. Price,
// description, sold / back on sale are live at once and copied to the team with a take-down link. Invented sellers and numbers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shopdash-'));
Object.assign(process.env, { SHOP_POSTS_FILE: DIR + '/posts.json', BINA_RIDER_BOT_TOKEN: '' });
const Fastify = require('fastify');
const SP = require('../shops/posts');

const USERS = { u1: { phone: '0900000061', phoneVerifiedAt: new Date() }, u2: { phone: '0900000062', phoneVerifiedAt: null }, u3: { phone: '0900000063', phoneVerifiedAt: new Date() } };
const post = (id, phone, status, extra) => Object.assign({ id, status, token: null, createdAt: '2026-10-01T06:00:00Z', approvedAt: '2026-10-01T07:00:00Z', kind: 'product', category: 'phones',
  title: 'Sample Phone ' + id, price: '18,500 birr', description: 'brand new', shop: { name: 'Sample Phones', area: 'Bole', phone, whatsapp: true }, owner: { name: 'Sample Seller' }, photos: [] }, extra);
async function app() {
  SP.writeStore({ posts: [post('p1', '+251900000061', 'live'), post('p2', '+251900000061', 'pending'), post('p3', '+251900000063', 'live'), post('p4', '+251900000061', 'removed')] });
  const team = [];
  const f = Fastify();
  f.addHook('onRequest', async req => { const u = req.headers['x-test-user']; req.authUser = u ? { id: u } : null; });
  const prisma = { authUser: { findUnique: async ({ where }) => USERS[where.id] || null } };
  const tell = async t => { team.push(t); return true; };
  f.register(SP, { prisma: {}, limiter: () => () => true, tell });
  f.register(require('../shops/dashboard'), { prisma, limiter: () => () => true, tell });
  await f.ready();
  const go = (method, url, body, user) => f.inject({ method, url, payload: body, headers: user ? { 'x-test-user': user } : {} });
  return { f, go, team };
}
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('a seller sees only their own live / sold posts, by PROVEN phone', async () => {
  const { go } = await app();
  assert.equal((await go('GET', '/api/shop/mine')).statusCode, 401);
  const unproven = (await go('GET', '/api/shop/mine', null, 'u2')).json();
  assert.equal(unproven.phone, false); assert.deepEqual(unproven.posts, [], 'a phone typed at sign-up but never proven shows nothing');
  const mine = (await go('GET', '/api/shop/mine', null, 'u1')).json();
  assert.deepEqual(mine.posts.map(p => p.id), ['p1'], 'not the pending one, not the removed one, not someone else\'s');
  assert.equal(mine.pending, 1); assert.equal(mine.phone, '…0061');
});

test('price and description go live at once; the team gets a take-down link', async () => {
  const { go, team } = await app();
  const r = (await go('POST', '/api/shop/mine/p1', { price: '17,900 birr', description: 'brand new, 1 year warranty' }, 'u1')).json();
  assert.equal(r.ok, true); assert.deepEqual(r.changed, ['price: 17,900 birr', 'description: brand new, 1 year warranty']);
  const feed = (await go('GET', '/api/shop/feed')).json().posts;
  assert.equal(feed.find(p => p.id === 'p1').price, '17,900 birr');
  assert.match(team[0], /edited by the seller/); assert.match(team[0], /\/ops\/shop-posts\/p1\/remove\?t=[a-f0-9]{32}/);
  const tok = /remove\?t=([a-f0-9]+)/.exec(team[0])[1];
  assert.match((await go('GET', '/ops/shop-posts/p1/remove?t=' + tok)).body, /Taken down/, 'one tap takes it down');
  assert.equal((await go('POST', '/api/shop/mine/p1', { price: '1 birr' }, 'u1')).statusCode, 404, 'a taken-down post is no longer the seller\'s to edit');
});

test('sold takes it off the page and out of the feed; back on sale returns it', async () => {
  const { go } = await app();
  assert.equal((await go('POST', '/api/shop/mine/p1', { status: 'sold' }, 'u1')).json().post.status, 'sold');
  assert.ok(!(await go('GET', '/api/shop/feed')).json().posts.some(p => p.id === 'p1'));
  assert.ok(!(await go('GET', '/shop')).body.includes('Sample Phone p1'));
  assert.equal((await go('GET', '/api/shop/mine', null, 'u1')).json().posts[0].status, 'sold', 'still in the seller\'s list');
  assert.equal((await go('POST', '/api/shop/mine/p1', { status: 'live' }, 'u1')).json().post.status, 'live');
  assert.ok((await go('GET', '/api/shop/feed')).json().posts.some(p => p.id === 'p1'));
});

test('nobody edits a post that is not theirs; bad input is refused', async () => {
  const { go } = await app();
  assert.equal((await go('POST', '/api/shop/mine/p3', { price: '1 birr' }, 'u1')).statusCode, 404, 'another seller\'s post');
  assert.equal((await go('POST', '/api/shop/mine/p2', { price: '1 birr' }, 'u1')).statusCode, 404, 'a pending post waits for the team');
  assert.equal((await go('POST', '/api/shop/mine/p1', { price: '1 birr' }, 'u2')).statusCode, 403, 'an unproven phone');
  assert.equal((await go('POST', '/api/shop/mine/p1', { price: '1 birr' })).statusCode, 401);
  assert.equal((await go('POST', '/api/shop/mine/p1', { status: 'deleted' }, 'u1')).json().error, 'status');
  assert.equal((await go('POST', '/api/shop/mine/p1', { price: '  ' }, 'u1')).json().error, 'price');
  assert.equal((await go('POST', '/api/shop/mine/p1', { description: '<script>x</script>' }, 'u1')).json().post.description.includes('<'), false);
});
