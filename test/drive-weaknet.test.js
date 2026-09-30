'use strict';
// The driver app on a weak line: its pages open from the phone, trip steps survive a dead network,
// pings slow down only when nothing is at stake, and low-data mode drops the map without breaking anything.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const js = fs.readFileSync(path.join(pub, 'ride', 'drive.js'), 'utf8');
const html = fs.readFileSync(path.join(pub, 'drive.html'), 'utf8');
const sw = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8');

test('the service worker keeps the driver, partner and customer app pages on the phone', () => {
  const pages = JSON.parse(sw.match(/const PAGES = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  for (const p of ['/drive', '/partner', '/go']) assert.ok(pages.includes(p), p + ' is precached');
});

test('a trip step tapped with no connection is saved and sent before the next ping', () => {
  assert.match(js, /function queueStatus\(id, next\)/);
  assert.match(js, /\}, function \(\) \{\s*\/\/ No connection: the step is saved/, 'send() handles a failed request');
  assert.match(js, /if \(outbox\(\)\.length\) \{ flush\(\)\.then/, 'ping flushes the outbox first');
  assert.match(js, /window\.addEventListener\('online'/, 'the outbox is sent when the network returns');
  assert.ok(!/fetch\(/.test(js.slice(js.indexOf('// ---------- weak networks'), js.indexOf('// Mobile browsers stay silent'))),
    'the outbox goes through post(), so demo mode never touches the network');
});

test('pings slow down only with no trip or offer on screen, and well inside the 45 s away limit', () => {
  const slow = Number(js.match(/PING_SLOW_MS = (\d+)/)[1]);
  assert.ok(slow <= 15000, 'a slow ping is still far inside the server\'s 45 s away sweep');
  assert.match(js, /if \(st\.job \|\| st\.offer \|\| st\.filling \|\| outbox\(\)\.length\) return PING_MS;/);
});

test('low-data mode skips the map engine, and its stub answers every BinaMap call drive.js makes', () => {
  assert.ok(!/<script src="\/static\/vendor\/maplibre-gl\.js"><\/script>/.test(html), 'maplibre is never an unconditional tag');
  const stub = html.match(/window\.BinaMap=\{([^}]+)\}/)[1].split(',').map(x => x.split(':')[0].trim());
  const used = [...new Set([...js.matchAll(/BinaMap\.([a-zA-Z0-9]+)/g)].map(m => m[1]))];
  for (const u of used) assert.ok(stub.includes(u), 'the stub answers BinaMap.' + u);
  assert.match(html, /id="lite"/);
});
