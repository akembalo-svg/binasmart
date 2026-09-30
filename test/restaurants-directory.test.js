'use strict';
// bina.et/restaurants (1 Oct 2026): restaurants, cafes and fast food from the city map, one page each, claimed through
// Bini. Nothing a restaurant sends is public until the team approves it; a mobile from a map tag is never shown.
// Every place below is invented.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

const STORE = path.join(os.tmpdir(), 'rest-test-' + process.pid + '.json');
const OSMF = path.join(os.tmpdir(), 'rest-osm-' + process.pid + '.json');
process.env.RESTAURANTS_FILE = STORE; process.env.RESTAURANTS_OSM_FILE = OSMF;
const OSM = { bySub: { node1: 'Arada', node2: 'Bole', node3: 'Kirkos', node6: 'Bole' }, elements: [
  { type: 'node', id: 1, lat: 9.0343, lon: 38.7546, tags: { amenity: 'restaurant', name: 'Sample Trattoria', 'name:am': 'ናሙና ትራቶሪያ', cuisine: 'italian;pizza', phone: '+251 11 000 0071; 0900 000 071' } },
  { type: 'node', id: 11, lat: 9.0344, lon: 38.7547, tags: { amenity: 'restaurant', name: 'Sample Trattoria' } },          // the same place again, 15 m away
  { type: 'node', id: 2, lat: 8.99, lon: 38.79, tags: { amenity: 'cafe', name: 'Sample Buna ናሙና ቡና' } },                   // both scripts in one tag
  { type: 'node', id: 3, lat: 9.01, lon: 38.76, tags: { amenity: 'fast_food', name: 'Sample Burger', phone: '0900 000 072' } },   // a mobile only
  { type: 'node', id: 4, lat: 9.02, lon: 38.77, tags: { amenity: 'pharmacy', name: 'Not Food' } },
  { type: 'node', id: 5, lat: 9.02, lon: 38.77, tags: { amenity: 'restaurant' } },                                          // no name: skipped
  { type: 'node', id: 6, lat: 8.991, lon: 38.791, tags: { amenity: 'cafe', name: 'Cafe' } }] };                             // a name that names nothing
const R = require('../restaurants/directory');

function app() {
  const routes = {}, sent = [];
  const fastify = { get(p, a, b) { routes['GET ' + p] = b || a; }, post(p, a, b) { routes['POST ' + p] = b || a; } };
  R(fastify, { limiter: () => () => true, tell: async t => { sent.push(t); return true; } }, () => {});
  const call = async (k, req = {}) => {
    const r = { c: 200, h: {}, code(n) { this.c = n; return this; }, header(a, b) { this.h[a] = b; return this; }, type() { return this; }, send(x) { this.body = x; return x; } };
    const out = await routes[k](Object.assign({ headers: {}, query: {}, params: {}, body: {} }, req), r);
    return { code: r.c, body: out, headers: r.h };
  };
  return { call, sent };
}
const tokenOf = (sent, i) => /approve\?t=([a-f0-9]+)/.exec(sent[i])[1];

test.before(() => fs.writeFileSync(OSMF, JSON.stringify(OSM)));
test.beforeEach(() => { try { fs.unlinkSync(STORE); } catch (e) {} });
test.after(() => { for (const f of [STORE, OSMF]) try { fs.unlinkSync(f); } catch (e) {} });

test('places from the map: kinds, names in both scripts, landlines only, one listing per place, cuisine', () => {
  const L = R.buildPlaces(OSM);
  assert.deepEqual(L.map(p => p.name), ['Sample Trattoria', 'Sample Burger', 'Cafe', 'Sample Buna']);
  const t = L.find(p => p.name === 'Sample Trattoria');
  assert.equal(t.slug, 'sample-trattoria-n1'); assert.equal(t.nameAm, 'ናሙና ትራቶሪያ'); assert.equal(t.sub, 'Arada'); assert.deepEqual(t.cuisine, ['italian', 'pizza']);
  assert.deepEqual(t.phones, ['+251 11 000 0071'], 'the mobile in the same tag is never shown');
  assert.deepEqual(L.find(p => p.name === 'Sample Burger').phones, []);
  assert.equal(L.find(p => p.name === 'Sample Buna').nameAm, 'ናሙና ቡና');
});

test('only places with something to say are indexed; a generic name never is', async () => {
  const { call } = app();
  const page = s => call('GET /restaurants/:slug', { params: { slug: s } });
  const trat = await page('sample-trattoria-n1');
  assert.equal(trat.headers['X-Robots-Tag'], undefined);
  assert.match(trat.body, /"@type":"Restaurant"/); assert.match(trat.body, /"servesCuisine":\["italian","pizza"\]/);
  assert.match(trat.body, /tel:\+251110000071/); assert.doesNotMatch(trat.body, /0900 ?000 ?071|900000071/);
  assert.match(trat.body, /href="\?bini=restaurant"/);
  assert.match(trat.body, /\/ride\?to=Sample%20Trattoria&lat=9\.0343&lng=38\.7546/);
  assert.equal((await page('cafe-n6')).headers['X-Robots-Tag'], 'noindex, follow');
  assert.equal((await page('sample-burger-n3')).headers['X-Robots-Tag'], 'noindex, follow');   // a mobile is not a reason
  assert.equal((await page('nope')).code, 404);
  assert.deepEqual(R.findableSlugs(), ['/restaurants/sample-trattoria-n1']);
  const hub = await call('GET /restaurants');
  assert.match(hub.body, /Sample Trattoria/); assert.match(hub.body, /Show all 4 places/);
});

test('a claim from Bini is not public until the team approves it; then the page shows the number, hours and dishes', async () => {
  const { call, sent } = app();
  const r = await call('POST /api/restaurants/claim', { body: { ref: 'node/3', name: 'Abel', role: 'owner', phone: '0900 000 073', publicPhone: '0900 000 074',
    hours: 'Every day 8:00-22:00', dishes: [{ name: 'Classic burger', price: '350 birr' }, { name: 'x' }], note: '[via Bini] add our number and dishes' } });
  assert.equal(r.body.ok, true); assert.match(r.body.page, /\/restaurants\/sample-burger-n3$/);
  assert.match(sent[0], /not live/); assert.match(sent[0], /Classic burger 350 birr/);
  let pg = await call('GET /restaurants/:slug', { params: { slug: 'sample-burger-n3' } });
  assert.doesNotMatch(pg.body, /Classic burger/, 'nothing shows before approval');
  const bad = await call('GET /ops/restaurants/:id/:action', { params: { id: r.body.id, action: 'approve' }, query: { t: 'wrong' } });
  assert.equal(bad.code, 404);
  const ok = await call('GET /ops/restaurants/:id/:action', { params: { id: r.body.id, action: 'approve' }, query: { t: tokenOf(sent, 0) } });
  assert.match(ok.body, /Live/);
  pg = await call('GET /restaurants/:slug', { params: { slug: 'sample-burger-n3' } });
  assert.match(pg.body, /Classic burger/); assert.match(pg.body, /350 birr/); assert.match(pg.body, /Every day 8:00-22:00/);
  assert.match(pg.body, /tel:\+251900000074/, 'the number they chose to show'); assert.doesNotMatch(pg.body, /900000073/, 'never the call-back number');
  assert.match(pg.body, /Confirmed by the restaurant/); assert.equal(pg.headers['X-Robots-Tag'], undefined, 'a confirmed page is indexed');
  const again = await call('GET /ops/restaurants/:id/:action', { params: { id: r.body.id, action: 'approve' }, query: { t: tokenOf(sent, 0) } });
  assert.equal(again.code, 404, 'the one-tap link works once');
});

test('a claim needs a name, a valid phone, and a place (on the map or named)', async () => {
  const { call } = app();
  assert.equal((await call('POST /api/restaurants/claim', { body: { ref: 'node/1', name: 'A', phone: '0900 000 075' } })).body.error, 'name');
  assert.equal((await call('POST /api/restaurants/claim', { body: { ref: 'node/1', name: 'Abel', phone: '12345' } })).body.error, 'phone');
  assert.equal((await call('POST /api/restaurants/claim', { body: { ref: 'new', name: 'Abel', phone: '0900 000 075' } })).body.error, 'restaurant');
  const n = await call('POST /api/restaurants/claim', { body: { ref: 'new', restaurant: 'Brand New Place', name: 'Abel', phone: '0900 000 075' } });
  assert.equal(n.body.ok, true); assert.equal(n.body.page, null);
});

test('Bini: company_request with kind "restaurant" goes to the restaurant claim, and an evaluation sends nothing', async () => {
  const { makeExecutor } = require('../assistant/tools');
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null }); return { ok: true, status: 200, json: async () => ({ ok: true, id: 'x' }) }; };
  const run = makeExecutor({ base: 'http://x', fetchImpl, publicBase: 'https://bina.et' });
  const r = await run('company_request', { company: 'sample-trattoria-n1', kind: 'restaurant', name: 'Abel', role: 'owner', phone: '0900 000 076',
    request: 'add our dishes', dishes: [{ name: 'Lasagne', price: '480 birr' }], hours: '12-22' });
  assert.equal(r.ok, true); assert.equal(r.page, 'https://bina.et/restaurants/sample-trattoria-n1');
  const c = calls.find(x => /\/api\/restaurants\/claim$/.test(x.url));
  assert.equal(c.body.ref, 'node/1'); assert.equal(c.body.dishes[0].name, 'Lasagne'); assert.equal(c.body.hours, '12-22');
  const dry = makeExecutor({ base: 'http://x', fetchImpl, dryRun: true });
  const d = await dry('company_request', { company: 'sample-trattoria-n1', kind: 'restaurant', name: 'Abel', phone: '0900 000 076', request: 'claim' });
  assert.equal(d.dryRun, true); assert.equal(calls.length, 1, 'no second request left the evaluation');
});

test('the same person about the same place again within half an hour is one request, not two messages to the team', async () => {
  const { call, sent } = app();
  const a = await call('POST /api/restaurants/claim', { body: { ref: 'node/1', name: 'Abel', role: 'owner', phone: '0900 000 079', note: '[via Bini] claim', dishes: [{ name: 'Lasagne', price: '480 birr' }] } });
  const b = await call('POST /api/restaurants/claim', { body: { ref: 'node/1', name: 'Abel', role: 'owner', phone: '0900 000 079', note: '[via Bini] yes, send it', hours: '12-22' } });
  assert.equal(b.body.duplicate, true); assert.equal(b.body.id, a.body.id); assert.equal(sent.length, 1);
  const E = R.readStore().entries.find(e => e.id === a.body.id);
  assert.equal(E.hours, '12-22'); assert.equal(E.dishes[0].name, 'Lasagne'); assert.match(E.note, /claim \| \[via Bini\] yes, send it/);
});

test('server.js keeps each named restaurant\'s page link in Bini\'s food answers', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(src.includes('foodSeen.push(...(r.mapPlaces || []).filter(x => x && x.name && x.page))'), 'the map places with a page are collected');
  assert.ok(src.includes("'https://bina.et/restaurants'"), 'the directory closes a food answer');
});
