'use strict';
// Table QR ordering (restaurants/orders.js, 1 Oct 2026). A confirmed restaurant's dishes become a menu a table card
// opens; with ordering switched on, a guest's order reaches the owner's Telegram and dashboard at the restaurant's
// own prices. Every place, person and chat below is invented; no real Telegram message is ever sent.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

const STORE = path.join(os.tmpdir(), 'rest-ord-store-' + process.pid + '.json');
const OSMF = path.join(os.tmpdir(), 'rest-ord-osm-' + process.pid + '.json');
const ORD = path.join(os.tmpdir(), 'rest-ord-orders-' + process.pid + '.json');
Object.assign(process.env, { RESTAURANTS_FILE: STORE, RESTAURANTS_OSM_FILE: OSMF, RESTAURANT_ORDERS_FILE: ORD, BINA_RIDER_BOT_TOKEN: '' });
const OSM = { bySub: { node1: 'Arada', node2: 'Bole' }, elements: [
  { type: 'node', id: 1, lat: 9.0343, lon: 38.7546, tags: { amenity: 'restaurant', name: 'Sample Trattoria' } },
  { type: 'node', id: 2, lat: 8.995, lon: 38.79, tags: { amenity: 'cafe', name: 'Sample Buna' } }] };
const R = require('../restaurants/directory');
const O = require('../restaurants/orders');
const { makeBinaBot } = require('../ride/binaBot');

const TOK = 'a'.repeat(32);
function entry(over) {
  return Object.assign({ id: 'e1', ref: 'node/1', restaurant: 'Sample Trattoria', status: 'live', ownerUserId: 'u1', approvedAt: '2026-10-01T08:00:00Z',
    dishes: [{ name: 'Lasagna', price: '450 ETB' }, { name: 'Pizza <b>Margherita</b>', price: '1,200 birr' }, { name: 'Soup of the day', price: '' }] }, over);
}
function app() {
  const routes = {}, sent = [], team = [];
  const fastify = { get(p, a, b) { routes['GET ' + p] = b || a; }, post(p, a, b) { routes['POST ' + p] = b || a; } };
  O(fastify, { limiter: () => () => true, tell: async t => { team.push(t); return true; }, send: async (chat, text) => { sent.push({ chat, text }); return !!chat; } }, () => {});
  const call = async (k, req = {}) => {
    const r = { c: 200, h: {}, code(n) { this.c = n; return this; }, header(a, b) { this.h[a] = b; return this; }, type() { return this; },
      redirect(u) { this.c = 302; this.loc = u; return this; }, send(x) { this.body = x; return x; } };
    const out = await routes[k](Object.assign({ headers: {}, query: {}, params: {}, body: {} }, req), r);
    return { code: r.c, body: out === r ? r.body : out, headers: r.h, loc: r.loc };
  };
  return { call, sent, team };
}
const store = entries => R.writeStore({ entries });
const order = (call, body, slug = 'sample-trattoria-n1') => call('POST /api/restaurants/:slug/order', { params: { slug }, body, headers: { 'x-real-ip': '10.0.0.1' } });
const owner = uid => ({ authUser: { id: uid } });

test.before(() => fs.writeFileSync(OSMF, JSON.stringify(OSM)));
test.beforeEach(() => { for (const f of [STORE, ORD]) try { fs.unlinkSync(f); } catch (e) {} });
test.after(() => { for (const f of [STORE, OSMF, ORD]) try { fs.unlinkSync(f); } catch (e) {} });

test('the menu: nothing to order from sends the guest to the page; ordering off shows the menu only; on adds the order sheet', async () => {
  const { call } = app();
  const menu = (q = { table: '7' }) => call('GET /restaurants/:slug/menu', { params: { slug: 'sample-trattoria-n1' }, query: q });
  let r = await menu();
  assert.equal(r.code, 302); assert.equal(r.loc, '/restaurants/sample-trattoria-n1');   // unclaimed: the map page
  store([entry()]);
  r = await menu();
  assert.equal(r.code, 200); assert.equal(r.headers['X-Robots-Tag'], 'noindex');
  assert.match(r.body, /Lasagna/); assert.match(r.body, /Table 7/); assert.match(r.body, /Order with the waiter/);
  assert.doesNotMatch(r.body, /Send order/);
  assert.match(r.body, /Pizza &lt;b&gt;Margherita&lt;\/b&gt;/, 'a dish name is escaped');
  store([entry({ ordersOn: true })]);
  r = await menu();
  assert.match(r.body, /Send order/); assert.match(r.body, /data-p="1200"/); assert.match(r.body, /You pay at your table/);
  assert.doesNotMatch(r.body, /Table number/, 'the card already says the table');
  assert.match((await menu({})).body, /Table number/, 'no table in the link: the guest types it');
  assert.equal((await call('GET /restaurants/:slug/menu', { params: { slug: 'nope' }, query: {} })).code, 404);
});

test('an order: the restaurant\'s own prices, caps, and it reaches the owner\'s chat', async () => {
  const { call, sent } = app();
  store([entry({ ordersOn: false, tgChatId: '700000001' })]);
  assert.equal((await order(call, { table: 3, items: [{ i: 0, qty: 1 }] })).body.error, 'off');
  store([entry({ ordersOn: true, tgChatId: '700000001' })]);
  assert.equal((await order(call, { table: 0, items: [{ i: 0, qty: 1 }] })).body.error, 'table');
  assert.equal((await order(call, { table: 501, items: [{ i: 0, qty: 1 }] })).body.error, 'table');
  assert.equal((await order(call, { table: 3, items: [{ i: 9, qty: 1 }, { i: 0, qty: 0 }] })).body.error, 'empty');
  const r = await order(call, { table: 3, note: 'no onion <script>', items: [{ i: 0, qty: 2, price: 1 }, { i: 1, qty: 99 }, { i: 2, qty: 1 }, { i: 9, qty: 1 }] });
  assert.equal(r.body.ok, true); assert.match(r.body.code, /^[0-9A-F]{4}$/);
  assert.equal(r.body.total, 2 * 450 + 20 * 1200, 'prices from the dashboard; qty capped at 20; a guest\'s price is ignored');
  const saved = O.readOrders().orders;
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].items.map(x => [x.name, x.qty, x.price]), [['Lasagna', 2, 450], ['Pizza <b>Margherita</b>', 20, 1200], ['Soup of the day', 1, null]]);
  assert.equal(saved[0].priced, false); assert.equal(saved[0].table, 3); assert.equal(saved[0].telegram, true);
  assert.doesNotMatch(saved[0].note, /</);
  assert.equal(sent.length, 1); assert.equal(sent[0].chat, '700000001');
  assert.match(sent[0].text, /Table 3/); assert.match(sent[0].text, /2 × Lasagna/); assert.match(sent[0].text, /Pay at the table/);
  assert.equal((await order(call, { table: 3, items: [{ i: 0, qty: 1 }] }, 'nope')).code, 404);
});

test('a hidden or unclaimed restaurant takes no orders, and nothing is sent', async () => {
  const { call, sent } = app();
  store([entry({ ordersOn: true, status: 'hidden', tgChatId: '700000001' })]);
  assert.equal((await order(call, { table: 1, items: [{ i: 0, qty: 1 }] })).body.error, 'off');
  assert.equal((await order(call, { table: 1, items: [{ i: 0, qty: 1 }] }, 'sample-buna-n2')).body.error, 'off');
  assert.equal(sent.length, 0); assert.equal(O.readOrders().orders.length, 0);
});

test('Telegram: the owner gets a link once; /start rest_<token> binds that chat; a wrong token binds nothing', async () => {
  const { call } = app();
  store([entry(), entry({ id: 'e2', ownerUserId: 'u2', restaurant: 'Other' })]);
  const tg = uid => call('GET /api/restaurants/mine/:id/telegram', Object.assign({ params: { id: 'e1' } }, owner(uid)));
  assert.equal((await call('GET /api/restaurants/mine/:id/telegram', { params: { id: 'e1' } })).code, 401);
  assert.equal((await tg('u2')).code, 404, 'someone else\'s restaurant');
  const a = (await tg('u1')).body, b = (await tg('u1')).body;
  assert.match(a.url, /^https:\/\/t\.me\/bina_smart_bot\?start=rest_[a-f0-9]{32}$/); assert.equal(a.url, b.url); assert.equal(a.linked, false);
  const token = a.url.split('rest_')[1];
  assert.equal(O.linkTelegram('b'.repeat(32), '700000002'), null);
  assert.equal(O.linkTelegram('not-hex', '700000002'), null);
  assert.deepEqual(O.linkTelegram(token, '700000002'), { name: 'Sample Trattoria' });
  assert.equal(R.readStore().entries[0].tgChatId, '700000002');
  assert.equal((await tg('u1')).body.linked, true);
});

test('the bot: /start rest_<token> confirms in Amharic + English; a bad link says how to retry', async () => {
  const sent = [], calls = [];
  const api = { sendMessage: async (chat, text) => { sent.push({ chat, text }); return {}; }, answerCallbackQuery: async () => ({}) };
  const b = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://x', fetchImpl: async () => ({ json: async () => ({}) }), botUsername: 'bina_smart_bot',
    linkRestaurant: (t, c) => { calls.push([t, c]); return t === TOK ? { name: 'Sample Trattoria' } : null; } });
  const msg = text => ({ message: { chat: { id: 700000003 }, text, from: { first_name: 'T' } } });
  await b.handleUpdate(msg('/start rest_' + TOK));
  assert.deepEqual(calls, [[TOK, '700000003']]);
  assert.match(sent[0].text, /Sample Trattoria/); assert.match(sent[0].text, /ትዕዛዞች/); assert.match(sent[0].text, /Table orders/);
  await b.handleUpdate(msg('/start rest_' + 'c'.repeat(32)));
  assert.match(sent[1].text, /did not work/);
});

test('the owner\'s side: the switch needs dishes; orders list only their own; seen and done', async () => {
  const { call, team } = app();
  store([entry({ dishes: [] }), entry({ id: 'e2', ownerUserId: 'u2', restaurant: 'Other', ref: 'node/2', ordersOn: true })]);
  const set = (uid, id, body) => call('POST /api/restaurants/mine/:id/settings', Object.assign({ params: { id }, body }, owner(uid)));
  assert.equal((await set('u1', 'e1', { ordersOn: true })).body.error, 'no_dishes');
  store([entry(), entry({ id: 'e2', ownerUserId: 'u2', restaurant: 'Other', ref: 'node/2', ordersOn: true })]);
  assert.equal((await set('u2', 'e1', { ordersOn: true })).code, 404);
  assert.equal((await set('u1', 'e1', { ordersOn: true })).body.ordersOn, true);
  assert.match(team.at(-1), /turned table ordering ON/);
  await order(call, { table: 4, items: [{ i: 0, qty: 1 }] });
  await order(call, { table: 9, items: [{ i: 0, qty: 1 }] }, 'sample-buna-n2');
  const list = uid => call('GET /api/restaurants/mine/:id/orders', Object.assign({ params: { id: uid === 'u1' ? 'e1' : 'e2' } }, owner(uid)));
  const mine = (await list('u1')).body;
  assert.equal(mine.ordersOn, true); assert.equal(mine.telegram, false);
  assert.deepEqual(mine.orders.map(o => o.table), [4]);
  assert.deepEqual((await list('u2')).body.orders.map(o => o.table), [9]);
  const st = (uid, oid, status) => call('POST /api/restaurants/mine/:id/orders/:oid', Object.assign({ params: { id: 'e1', oid }, body: { status } }, owner(uid)));
  const oid = mine.orders[0].id;
  assert.equal((await st('u1', oid, 'cooking')).body.error, 'status');
  assert.equal((await st('u2', oid, 'done')).code, 404);
  assert.equal((await st('u1', (await list('u2')).body.orders[0].id, 'done')).code, 404, 'another restaurant\'s order');
  assert.equal((await st('u1', oid, 'done')).body.ok, true);
  assert.equal((await list('u1')).body.orders[0].status, 'done');
  assert.equal((await call('GET /api/restaurants/mine/:id/orders', { params: { id: 'e1' } })).code, 401);
});

test('table cards: one QR per table, pointing at the menu with its number, at most 60', async () => {
  const { call } = app();
  const r = await call('GET /restaurants/:slug/qr', { params: { slug: 'sample-trattoria-n1' }, query: { n: '3', from: '5' } });
  assert.equal(r.headers['X-Robots-Tag'], 'noindex');
  const qrs = r.body.match(/\/qr\.svg\?p=[^"]+/g);
  assert.deepEqual(qrs.map(q => decodeURIComponent(q.split('p=')[1])), [5, 6, 7].map(t => '/restaurants/sample-trattoria-n1/menu?table=' + t));
  const many = await call('GET /restaurants/:slug/qr', { params: { slug: 'sample-trattoria-n1' }, query: { n: '999' } });
  assert.equal(many.body.match(/\/qr\.svg\?p=/g).length, 60);
  assert.equal((await call('GET /restaurants/:slug/qr', { params: { slug: 'nope' }, query: {} })).code, 404);
});

test('price reads the number out of what the owner typed', () => {
  assert.equal(O.price('450 ETB'), 450); assert.equal(O.price('ብር 1,200'), 1200); assert.equal(O.price('12.5'), 12.5);
  assert.equal(O.price(''), null); assert.equal(O.price('ask'), null); assert.equal(O.price('0'), null);
});
