'use strict';
// Bina Partner (the et.bina.partner Android app, a TWA of /partner): who lands where, and the files the
// app and Google's Digital Asset Links check depend on. People and slugs here are invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const html = fs.readFileSync(path.join(pub, 'partner.html'), 'utf8');

function loadRoute() {
  const m = html.match(/\/\* route:start[\s\S]*?\*\/([\s\S]*?)\/\* route:end \*\//);
  assert.ok(m, 'partner.html keeps the route function between its markers');
  const ctx = {};
  vm.runInNewContext(m[1] + '\nthis.partnerRoute = partnerRoute;', ctx);
  return ctx.partnerRoute;
}
const route = loadRoute();
const me = (roles, extra) => Object.assign({ id: 'u-test', name: 'Test Person', roles: ['user'].concat(roles) }, extra || {});

test('signed out (no /api/me answer) gets the sign-in screen', () => {
  assert.equal(route(null, null).view, 'signin');
  assert.equal(route(undefined, 'driver').view, 'signin', 'a remembered choice never stands in for a session');
});

test('an approved driver goes straight to /drive', () => {
  const r = route(me(['rider', 'driver']), null);
  assert.equal(r.view, 'go');
  assert.equal(r.to.href, '/drive');
});

test('a building owner goes straight to their own dashboard, slug encoded', () => {
  const r = route(me(['building_owner'], { buildingSlug: 'demo-tower' }), null);
  assert.equal(r.view, 'go');
  assert.equal(r.to.href, '/owner/demo-tower');
  assert.equal(route(me(['building_owner'], { buildingSlug: 'a b/../x' }), null).to.href, '/owner/a%20b%2F..%2Fx');
});

test('driver and owner get the chooser; the last choice is remembered only if it is still theirs', () => {
  const both = me(['driver', 'building_owner'], { buildingSlug: 'demo-tower' });
  const r = route(both, 'owner');
  assert.equal(r.view, 'choose');
  assert.equal(r.options.map(o => o.kind).join(','), 'driver,owner');
  assert.equal(r.last, 'owner');
  assert.equal(route(both, 'admin').last, null, 'an unknown stored value is ignored');
  assert.equal(route(both, null).last, null);
});

test('a pending driver sees the waiting screen; with a building they get the chooser plus their application', () => {
  assert.equal(route(me(['driver_pending'], { driver: { status: 'pending' } }), null).view, 'pending');
  const r = route(me(['driver_pending', 'building_owner'], { buildingSlug: 'demo-tower' }), 'owner');
  assert.equal(r.view, 'choose');
  assert.equal(r.pending, true);
  assert.equal(r.options.map(o => o.kind).join(','), 'owner');
});

test('nobody is guessed into a role: riders, businesses and admins without a building or car get the "not yet" screen', () => {
  assert.equal(route(me([]), null).view, 'none');
  assert.equal(route(me(['rider']), 'driver').view, 'none', 'a stored "driver" choice does not make a driver');
  assert.equal(route(me(['business'], { businesses: [{ kind: 'building', buildingSlug: 'demo-tower' }] }), null).view, 'none',
    'a building membership is not dashboard access (the server only admits AuthUser.buildingSlug)');
  assert.equal(route(me(['admin']), null).view, 'none');
  assert.equal(route(me(['building_owner']), null).view, 'none', 'the role without a slug opens nothing');
});

test('partner.html uses the existing sign-in endpoints, writes people as text, and is light only', () => {
  for (const ep of ['/api/me', '/api/auth-methods', '/api/auth/sign-in/phone-code/send', '/api/auth/sign-in/phone-code/verify', '/api/auth/sign-in/telegram', '/api/auth/sign-out'])
    assert.ok(html.includes("'" + ep + "'"), 'uses ' + ep);
  assert.ok(!/prefers-color-scheme:\s*dark/.test(html), 'no dark theme');
  assert.ok(html.includes('name="color-scheme" content="light only"'));
  assert.ok(html.includes('viewport-fit=cover') && html.includes('safe-area-inset-bottom'), 'safe areas');
  assert.ok(html.includes('rel="manifest" href="/partner.webmanifest"'));
  assert.ok(html.includes('location.replace(to.href)'), 'a single destination replaces /partner in the history (Android back closes the app)');
  assert.ok(!/innerHTML\s*=\s*[^'"]*me\./.test(html), 'nothing from /api/me is written as HTML');
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]); // the inline script parses
});

test('the app manifest keeps /drive and /owner inside the app and points at real icons', () => {
  const m = JSON.parse(fs.readFileSync(path.join(pub, 'partner.webmanifest'), 'utf8'));
  assert.equal(m.scope, '/');
  assert.ok(m.start_url.startsWith('/partner'));
  assert.equal(m.display, 'standalone');
  const png = f => { const b = fs.readFileSync(path.join(pub, f.replace(/^\/static\//, ''))); assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a', f + ' is a PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  for (const i of m.icons) {
    const [w, h] = png(i.src);
    assert.equal(w + 'x' + h, i.sizes, i.src);
  }
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
});

test('server.js serves /partner and its manifest', () => {
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(src.includes("fastify.get('/partner', "));
  assert.ok(src.includes("fastify.get('/partner.webmanifest', ") && src.includes("sendFile('partner.webmanifest')"));
});

test('assetlinks.json names the app and a well-formed SHA-256', () => {
  const a = JSON.parse(fs.readFileSync(path.join(pub, '.well-known', 'assetlinks.json'), 'utf8'));
  const st = a.find(s => s.target && s.target.package_name === 'et.bina.partner');
  assert.ok(st, 'statement for et.bina.partner');
  assert.deepEqual(st.relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(st.target.namespace, 'android_app');
  for (const f of st.target.sha256_cert_fingerprints) assert.match(f, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});
