'use strict';
// First-visit weight of /ride: the booking app must not sit behind the map engine, the Telegram SDK
// must not load outside the mini app, and fonts.css must not ship the same file more than once.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const PUB = path.join(__dirname, '..', 'public');
const rd = f => fs.readFileSync(path.join(PUB, f), 'utf8');

test('ride.html loads the app, not the map engine, on the critical path', () => {
  const h = rd('ride.html');
  assert.ok(!/<script src="\/static\/vendor\/maplibre-gl\.js">/.test(h), 'maplibre is not a blocking script tag');
  assert.ok(!/<link rel="stylesheet" href="\/static\/vendor\/maplibre-gl\.css">/.test(h), 'map CSS does not block first paint');
  assert.ok(h.includes('/static/ride/maplazy.js'), 'the lazy map stub is loaded');
  const stub = h.indexOf('maplazy.js'), app = h.indexOf('ride/app.js');
  assert.ok(stub > 0 && app > stub, 'the stub is defined before the app runs');
});

test('the Telegram SDK only loads inside the mini app', () => {
  for (const f of ['ride.html', 'watch.html', 'cinema.html', 'ticket.html', 'drive.html']) {
    const h = rd(f);
    assert.ok(!/<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"><\/script>/.test(h), f + ' has no unconditional Telegram tag');
    assert.ok(h.includes('TelegramWebviewProxy') && h.includes('tgWebApp'), f + ' guards the SDK');
  }
});

test('the map stub answers every BinaMap call the ride app makes', () => {
  const used = new Set((rd('ride/app.js').match(/BinaMap\.[a-zA-Z0-9_$]+/g) || []).map(s => s.slice(8)));
  const ctx = { window: {}, document: { readyState: 'complete', createElement: () => ({}), head: { appendChild() {} }, getElementById: () => null }, localStorage: null, navigator: {}, setTimeout() {}, addEventListener() {}, Promise };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  new vm.Script(fs.readFileSync(path.join(PUB, 'ride', 'maplazy.js'), 'utf8')).runInContext(ctx);
  const stub = ctx.BinaMap || ctx.window.BinaMap;
  assert.ok(stub, 'the stub is installed on window');
  for (const name of used) assert.ok(name in stub, 'BinaMap.' + name + ' is missing from the stub');
  assert.strictEqual(stub.map, null, 'the live map reads null until the engine arrives');
  assert.strictEqual(typeof stub.is3D(), 'boolean');
});

test('map.js exposes whenReady and still exports the old API', () => {
  const m = fs.readFileSync(path.join(PUB, 'ride', 'map.js'), 'utf8');
  new vm.Script(m);
  assert.ok(m.includes('function whenReady'));
  assert.ok(/return \{ init: init, whenReady: whenReady,/.test(m));
});

test('fonts.css ships each file once and every file exists', () => {
  const css = rd('fonts/fonts.css');
  const files = (css.match(/url\(\/static\/fonts\/([^)]+)\)/g) || []).map(s => s.replace(/^url\(\/static\/fonts\//, '').replace(/\)$/, ''));
  assert.strictEqual(new Set(files).size, files.length, 'no file is declared twice');
  const sums = new Map();
  for (const f of files) {
    const p = path.join(PUB, 'fonts', f);
    assert.ok(fs.existsSync(p), f + ' exists');
    const sum = crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
    assert.ok(!sums.has(sum), f + ' is a byte-for-byte copy of ' + sums.get(sum));
    sums.set(sum, f);
  }
  assert.ok(!rd('ride.html').includes('fonts.css?v=1'), 'the stylesheet version was bumped with its contents');
});
