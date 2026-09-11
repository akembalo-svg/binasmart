'use strict';
// PWA wiring: the service worker parses, every product page loads pwa.js and the manifest, the offline page exists.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pub = path.join(__dirname, '..', 'public');
const rd = f => fs.readFileSync(path.join(pub, f), 'utf8');

test('sw.js is valid and precaches the product pages', () => {
  const src = rd('sw.js');
  new vm.Script(src); // syntax
  for (const p of ['/ride', '/watch', '/cinema', '/offline']) assert.ok(src.includes("'" + p + "'"), 'precache ' + p);
  assert.ok(src.includes("req.headers.has('range')"), 'pmtiles range requests bypass the worker');
  assert.ok(/API_SKIP = .*assistant/.test(src), 'assistant replies are never cached');
});

test('pwa.js is valid and exposes the offline queue', () => {
  const src = rd('pwa.js');
  new vm.Script(src);
  assert.ok(src.includes('window.BinaOffline'));
  assert.ok(src.includes("'bina:sent'"));
});

test('product pages load pwa.js and the manifest', () => {
  for (const f of ['ride.html', 'drive.html', 'pool.html', 'watch.html', 'cinema.html', 'hotels.html', 'airport.html', 'ai.html', 'ticket.html', 'home-v3.html']) {
    const h = rd(f);
    assert.ok(h.includes('/static/pwa.js'), f + ' loads pwa.js');
    assert.ok(h.includes('rel="manifest"'), f + ' links the manifest');
  }
  assert.ok(!rd('home-v3.html').includes("serviceWorker.register('/sw.js')"), 'home no longer registers twice');
});

test('offline page and manifest shortcuts', () => {
  assert.ok(rd('offline.html').includes('/ride'));
  const m = JSON.parse(rd('manifest.webmanifest'));
  assert.ok(Array.isArray(m.shortcuts) && m.shortcuts.length >= 3);
});

test('ride app queues requests when offline', () => {
  const a = rd('ride/app.js');
  new vm.Script(a);
  assert.ok(a.includes('function sendRide(') && a.includes('function onRideResult(') && a.includes('function onJoinResult('));
  assert.ok(a.includes("queueOffline('ride'") && a.includes("kind: 'pool'"));
});

test('the service worker never stores the 10 MB basemap archive', () => {
  const src = rd('sw.js');
  assert.ok(/NO_STORE\s*=\s*\/\\.pmtiles\$\//.test(src), 'pmtiles requests bypass the worker');
  assert.ok(src.includes('if (res.status !== 200) return;'), 'partial responses are never cached');
  assert.ok(src.includes('MAX_ENTRY'), 'oversized responses are never cached');
  // Not pinned to an exact version: the tile rebuild bumps this monthly by design, and a test that
  // fails on a correct change gets ignored rather than fixed. What matters is that a version exists
  // and is at or past v6, which is the one that stopped the 10 MB archive being cached.
  const v = /VERSION\s*=\s*'bina-v(\d+)'/.exec(src);
  assert.ok(v, 'the worker declares a cache version');
  assert.ok(Number(v[1]) >= 6, 'version is at or past the bump that dropped the 10 MB entry, got v' + v[1]);
});
