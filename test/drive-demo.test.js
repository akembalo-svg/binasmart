'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Demo mode (/drive?demo=1) replays a baked Addis route through the real driver app so the driving
// view can be reviewed from outside the geofence. Its safety rests on one sentence: every
// /api/drive/* call is answered locally. That holds because drive.js funnels all of them through a
// single post(), and post() short-circuits to DDemo when demo is on.
//
// A fetch() written anywhere else in drive.js bypasses that, silently — the demo would start talking
// to live dispatch and nothing would say so. That already half-happened: the destination search calls
// the server directly, which is harmless and deliberate, but the file's own header claimed there was
// only ever one network request. This test is the thing that keeps the claim and the code together.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'ride', 'drive.js'), 'utf8');

// Network calls that are allowed to bypass post(), and why.
const ALLOWED = [
  { match: '/api/ride/search', why: 'read-only place search: no identity, no writes, rate limited per address' },
];

test('every network call in the driver app is either demo-gated or a named exception', () => {
  const lines = SRC.split(/\n/);
  const calls = [];
  lines.forEach((l, i) => {
    if (/\b(fetch\(|XMLHttpRequest|sendBeacon|new WebSocket|EventSource)/.test(l)) calls.push({ n: i + 1, text: l.trim() });
  });
  assert.ok(calls.length, 'expected to find some network calls');

  // The one inside post() is the gated path; find post() and its span.
  const at = SRC.indexOf('function post(path, body)');
  assert.ok(at > 0, 'post() not found — the demo gate lives in it');
  const before = SRC.slice(0, at).split(/\n/).length;
  let depth = 0, endLine = before;
  const rest = SRC.slice(at).split(/\n/);
  for (let i = 0; i < rest.length; i++) {
    for (const ch of rest[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth === 0 && i > 0) { endLine = before + i; break; }
  }
  const gate = SRC.slice(at, SRC.indexOf('\n', SRC.indexOf('DDemo.post', at)));
  assert.match(gate, /if \(DEMO\) return window\.DDemo\.post/, 'post() no longer short-circuits to the demo');

  const ungated = calls.filter(c => !(c.n >= before && c.n <= endLine))
    .filter(c => !ALLOWED.some(a => c.text.includes(a.match)));
  assert.deepEqual(ungated.map(c => 'drive.js:' + c.n + '  ' + c.text.slice(0, 90)), [],
    'a network call outside post() and outside the allowlist — demo mode would reach the server here');
});

test('the demo header lists exactly the exceptions the allowlist names', () => {
  const demo = fs.readFileSync(path.join(__dirname, '..', 'public', 'ride', 'drivedemo.js'), 'utf8');
  const header = demo.slice(0, demo.indexOf('*/'));
  for (const a of ALLOWED) {
    assert.ok(header.includes(a.match), 'drivedemo.js does not mention ' + a.match + ', which it does call');
  }
  assert.ok(header.includes('demo-route.json'), 'the baked route should still be named');
  assert.equal(/The only network request is/.test(header), false, 'that sentence was not true');
});

test('demo mode needs no sign-in and cannot be switched on by accident', () => {
  const demo = fs.readFileSync(path.join(__dirname, '..', 'public', 'ride', 'drivedemo.js'), 'utf8');
  const m = demo.match(/var active = ([^;]+);/);
  assert.ok(m, 'the demo switch was not found');
  const isActive = q => { const location = { search: q }; return eval('(function(){ var q = location.search || ""; return ' + m[1] + '; })()'); };   // eslint-disable-line no-eval
  assert.equal(isActive('?demo=1'), true);
  assert.equal(isActive(''), false, 'the driver app is not a demo by default');
  assert.equal(isActive('?demo=0'), false);
  assert.equal(isActive('?nodemo=1'), false, 'and a lookalike parameter does not turn it on');
});
