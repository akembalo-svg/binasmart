'use strict';
// The evaluation header must stay behind api/evalGate.js.
//
// `x-binasmart-eval: 1` changes who a request is counted as (server.js passes isEval into the per-user
// memory key and the limiter). Until 2026-09-18 anybody could send it and step out of being counted by
// adding one header. api/evalGate.js now requires the owner key or a loopback call, and
// test/api-gate.test.js proves the gate itself.
//
// What that test cannot see is the WIRING: the one line in server.js that routes isEval through the gate.
// server.js is edited by more than one session, so that line can disappear in a revert or a rewrite and
// every test of the gate would still pass while the door stood open again. This file fails if it does.
//
// If this test fails and you meant to change how evaluation traffic is recognised, change
// api/evalGate.js and its tests, and keep isEval routed through evalAllowed. Do not read the header
// directly anywhere else.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEADER = 'x-binasmart-eval';

// Code that runs in production and could read a request header. Harnesses under ops/ SEND the header
// and are not served; tests and static pages are not request handlers.
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', 'public', 'ops', 'docs',
  'workspaces', '.tmp-embedfix', 'uploads', 'storage']);

function servedSources(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') && ent.name !== '.') { if (ent.isDirectory()) continue; }
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) servedSources(p, out);
    } else if (/\.(c|m)?js$/.test(ent.name) && !/\.bak/.test(ent.name) && !/\.test\.(c|m)?js$/.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('server.js recognises evaluation traffic only through api/evalGate.js', () => {
  const defs = serverSrc.split('\n').filter(l => /\bconst\s+isEval\s*=/.test(l));
  assert.equal(defs.length, 1,
    'server.js must define isEval exactly once; found ' + defs.length +
    '. If it was removed, evaluation traffic is no longer gated.');
  assert.match(defs[0], /evalAllowed\s*\(/,
    'server.js defines isEval without api/evalGate.evalAllowed:\n  ' + defs[0].trim() +
    '\nThat reopens the hole closed on 2026-09-18: anyone could send x-binasmart-eval: 1 and stop being counted.');
  assert.match(defs[0], /OWNER_KEY/,
    'isEval must pass OWNER_KEY to evalAllowed, or the owner-key path of the gate is dead:\n  ' + defs[0].trim());
});

test('no served file reads the evaluation header except api/evalGate.js', () => {
  const readers = servedSources(ROOT)
    .filter(p => fs.readFileSync(p, 'utf8').toLowerCase().includes(HEADER))
    .map(rel)
    .sort();
  assert.deepEqual(readers, ['api/evalGate.js'],
    'Only api/evalGate.js may read the ' + HEADER + ' header in served code. Also found:\n  ' +
    readers.filter(r => r !== 'api/evalGate.js').join('\n  ') +
    '\nRoute the check through require("./api/evalGate").evalAllowed(req, OWNER_KEY) instead.');
});

test('the gate the wiring relies on still refuses an outside caller', () => {
  const { evalAllowed } = require(path.join(ROOT, 'api', 'evalGate.js'));
  const outside = { ip: '127.0.0.1', headers: { [HEADER]: '1', 'x-forwarded-for': '196.188.1.1' } };
  assert.equal(evalAllowed(outside, 'k'), false,
    'a request that came through nginx (it carries X-Forwarded-For) must not count as evaluation');
  const noKey = { ip: '196.188.1.1', headers: { [HEADER]: '1' } };
  assert.equal(evalAllowed(noKey, 'k'), false, 'the header alone must not be enough');
  const withKey = { ip: '196.188.1.1', headers: { [HEADER]: '1', 'x-owner-key': 'k' } };
  assert.equal(evalAllowed(withKey, 'k'), true, 'the owner key must still open it');
});
