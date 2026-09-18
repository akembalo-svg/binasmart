'use strict';
// The meter on the two advertised knowledge endpoints: api/gate.js, api/usage.js, api/keystore.js and
// the eval-header guard in api/evalGate.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeGate } = require('../api/gate');
const { makeUsage } = require('../api/usage');
const { makeKeystore, hashKey } = require('../api/keystore');
const { evalAllowed } = require('../api/evalGate');

const PEPPER = 'p'.repeat(48);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bina-gate-'));

// A gate on its own directory and its own clock. proxyHeader mirrors what nginx guarantees for the
// location under test: x-forwarded-for for bina.et/api/…, x-real-ip for bina.et/mcp.
function harness({ dir = tmp(), proc = 'api', proxyHeader = 'x-forwarded-for', keysFile = null, anonPerHour = 20, t0 = 1_800_000_000_000 } = {}) {
  let clock = t0;
  const now = () => clock;
  const usage = makeUsage({ dir, proc, now, timer: false, peerCacheMs: 0 });
  const keystore = makeKeystore({ file: keysFile || path.join(dir, 'no-such-keys.json'), pepper: PEPPER, reloadMs: 0, now });
  const gate = makeGate({ dir, proc, proxyHeader, anonPerHour, salt: PEPPER, keystore, usage, now });
  return { gate, usage, keystore, dir, tick: ms => { clock += ms; }, at: () => clock };
}
// A request that came through nginx from a real visitor.
const outside = (ip = '41.86.1.1', extra = {}) => ({ headers: { 'x-real-ip': ip, 'x-forwarded-for': ip, ...extra }, ip: '127.0.0.1' });

function writeKeys(dir, entries) {
  const f = path.join(dir, 'keys.json');
  fs.writeFileSync(f, JSON.stringify(entries, null, 2), { mode: 0o600 });
  return f;
}

test('anonymous under the allowance passes and is counted', () => {
  const h = harness();
  for (let i = 0; i < 20; i++) {
    const d = h.gate.check({ ...outside(), endpoint: 'knowledge_search' });
    assert.equal(d.allowed, true, 'request ' + (i + 1) + ' of 20 should pass');
    assert.equal(d.tier, 'anonymous');
  }
  const day = h.usage.snapshot();
  const row = Object.entries(day.callers).find(([k]) => k.endsWith('|knowledge_search'));
  assert.equal(row[1].count, 20);
  assert.equal(row[1].denied, 0);
  assert.match(row[0], /^ip:[0-9a-f]{16}\|/, 'anonymous callers are accounted for by a salted hash, not an address');
});

test('anonymous over the allowance gets 429 with Retry-After and how to get a key', () => {
  const h = harness();
  for (let i = 0; i < 20; i++) h.gate.check({ ...outside(), endpoint: 'knowledge_search' });
  const d = h.gate.check({ ...outside(), endpoint: 'knowledge_search' });
  assert.equal(d.allowed, false);
  assert.equal(d.status, 429);
  assert.ok(d.retryAfter > 0 && d.retryAfter <= 3600, 'Retry-After is the seconds left in the hour, got ' + d.retryAfter);
  assert.equal(d.body.error, 'rate_limited');
  assert.match(d.body.limit, /20 requests per hour/);
  assert.match(d.body.get_a_key, /info@gccdomestic\.com/);
  assert.match(d.body.terms, /bina\.et\/terms#api/);
  assert.equal(h.usage.snapshot().callers[d.caller + '|knowledge_search'].denied, 1);
  // A different address is untouched by the first one's flood.
  assert.equal(h.gate.check({ ...outside('102.22.3.4'), endpoint: 'knowledge_search' }).allowed, true);
});

test('the allowance is shared by /api/knowledge/search and /mcp', () => {
  const dir = tmp();
  const api = harness({ dir, proc: 'api' });
  const mcp = harness({ dir, proc: 'mcp', proxyHeader: 'x-real-ip' });
  for (let i = 0; i < 12; i++) assert.equal(api.gate.check({ ...outside(), endpoint: 'knowledge_search' }).allowed, true);
  api.usage.flush();
  for (let i = 0; i < 8; i++) assert.equal(mcp.gate.check({ ...outside(), endpoint: 'mcp' }).allowed, true);
  mcp.usage.flush();
  assert.equal(mcp.gate.check({ ...outside(), endpoint: 'mcp' }).allowed, false, '12 + 8 spends the 20');
  api.usage.flush();
  assert.equal(api.gate.check({ ...outside(), endpoint: 'knowledge_search' }).allowed, false, 'and the other door is shut too');
});

test('a valid key gets its own quota, not the anonymous one', () => {
  const dir = tmp();
  const keys = writeKeys(dir, [{ id: 'k_test', name: 'Test', org: 'Test', keyHash: hashKey('bina_secret', PEPPER), tier: 'partner', quotaPerMinute: 30, quotaPerDay: 100, origins: [], enabled: true, note: '', createdAt: '2026-09-18T00:00:00Z' }]);
  const h = harness({ dir, keysFile: keys });
  const req = () => h.gate.check({ ...outside('41.86.1.1', { authorization: 'Bearer bina_secret' }), endpoint: 'knowledge_search' });
  for (let i = 0; i < 30; i++) {
    const d = req();
    assert.equal(d.allowed, true, 'keyed request ' + (i + 1) + ' should pass the 20 an anonymous caller gets');
    assert.equal(d.caller, 'key:k_test');
  }
  const over = req();
  assert.equal(over.allowed, false, 'the 31st spends quotaPerMinute');
  assert.ok(over.retryAfter <= 60);
  h.tick(60_000);
  assert.equal(req().allowed, true, 'the next minute opens again');
  assert.equal(h.usage.snapshot().callers['key:k_test|knowledge_search'].count, 31);
});

test('a disabled key and an unknown key are anonymous, not an error, and read identically', () => {
  const dir = tmp();
  const keys = writeKeys(dir, [{ id: 'k_off', name: 'Off', keyHash: hashKey('bina_off', PEPPER), quotaPerMinute: 30, quotaPerDay: 100, enabled: false }]);
  const h = harness({ dir, keysFile: keys });
  const disabled = h.gate.check({ ...outside('41.0.0.1', { authorization: 'Bearer bina_off' }), endpoint: 'knowledge_search' });
  const unknown = h.gate.check({ ...outside('41.0.0.2', { authorization: 'Bearer bina_never_issued' }), endpoint: 'knowledge_search' });
  const none = h.gate.check({ ...outside('41.0.0.3'), endpoint: 'knowledge_search' });
  for (const d of [disabled, unknown, none]) { assert.equal(d.allowed, true); assert.equal(d.tier, 'anonymous'); }
  assert.equal(disabled.status, undefined, 'a revoked key is never told it was revoked');
});

test('loopback is exempt, and a forged X-Real-IP cannot buy the exemption from outside', () => {
  const h = harness();
  const local = h.gate.check({ headers: {}, ip: '127.0.0.1', endpoint: 'knowledge_search' });
  assert.equal(local.exempt, true);
  for (let i = 0; i < 50; i++) assert.equal(h.gate.check({ headers: {}, ip: '127.0.0.1', endpoint: 'knowledge_search' }).allowed, true);
  // Through nginx the X-Forwarded-For is always present, so the same trick from outside is metered.
  for (let i = 0; i < 20; i++) h.gate.check({ ...outside('9.9.9.9'), endpoint: 'knowledge_search' });
  assert.equal(h.gate.check({ ...outside('9.9.9.9'), endpoint: 'knowledge_search' }).allowed, false);
});

test('counters survive a restart', () => {
  const dir = tmp();
  const first = harness({ dir });
  for (let i = 0; i < 20; i++) first.gate.check({ ...outside(), endpoint: 'knowledge_search' });
  first.usage.flush();
  // Same directory, same clock, a brand new process: the allowance is already spent.
  const second = harness({ dir, t0: first.at() });
  const d = second.gate.check({ ...outside(), endpoint: 'knowledge_search' });
  assert.equal(d.allowed, false, 'a pm2 restart must not hand the caller a fresh twenty');
  assert.equal(second.usage.snapshot().callers[d.caller + '|knowledge_search'].count, 20, 'the day accounting came back too');
});

test('a stale bucket is not restored as an allowance', () => {
  const dir = tmp();
  const first = harness({ dir });
  for (let i = 0; i < 20; i++) first.gate.check({ ...outside(), endpoint: 'knowledge_search' });
  first.usage.flush();
  const later = harness({ dir, t0: first.at() + 3_600_000 });
  assert.equal(later.gate.check({ ...outside(), endpoint: 'knowledge_search' }).allowed, true, 'an hour later the hour is new');
});

test('MCP: the limit keys on the address, not on a session id the client picks', () => {
  const h = harness({ proc: 'mcp', proxyHeader: 'x-real-ip' });
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const d = h.gate.check({ headers: { 'x-real-ip': '41.86.1.1', 'mcp-session-id': 'sess-' + i }, ip: '127.0.0.1', endpoint: 'mcp' });
    assert.equal(d.allowed, true);
    seen.add(d.caller);
  }
  assert.equal(seen.size, 1, 'twenty invented session ids are one caller');
  assert.equal(h.gate.check({ headers: { 'x-real-ip': '41.86.1.1', 'mcp-session-id': 'sess-fresh' }, ip: '127.0.0.1', endpoint: 'mcp' }).allowed, false);
});

test('MCP: the handshake is recorded but not charged', () => {
  const h = harness({ proc: 'mcp', proxyHeader: 'x-real-ip' });
  for (let i = 0; i < 30; i++) {
    const d = h.gate.check({ headers: { 'x-real-ip': '41.86.1.1' }, ip: '127.0.0.1', endpoint: 'mcp:initialize', charge: false });
    assert.equal(d.allowed, true, 'initialize and notifications never lock an assistant out before it asks anything');
  }
  assert.equal(h.gate.check({ headers: { 'x-real-ip': '41.86.1.1' }, ip: '127.0.0.1', endpoint: 'mcp' }).allowed, true, 'the allowance is untouched');
  assert.equal(h.usage.snapshot().callers[Object.keys(h.usage.snapshot().callers).find(k => k.endsWith('|mcp:initialize'))].count, 30, 'but it is still counted for the record');
});

test('the eval header alone no longer changes who is being counted', () => {
  const OWNER = 'owner-key-for-this-test';
  const outsideEval = { headers: { 'x-binasmart-eval': '1', 'x-forwarded-for': '41.86.1.1', 'x-real-ip': '41.86.1.1' }, ip: '127.0.0.1' };
  assert.equal(evalAllowed(outsideEval, OWNER), false, 'anybody could send this header until 2026-09-18');
  assert.equal(evalAllowed({ headers: { ...outsideEval.headers, 'x-owner-key': OWNER }, ip: '127.0.0.1' }, OWNER), true);
  assert.equal(evalAllowed({ headers: { ...outsideEval.headers, 'x-owner-key': 'wrong' }, ip: '127.0.0.1' }, OWNER), false);
  // The harnesses in ops/ run on the server against 127.0.0.1 and keep working with no key.
  assert.equal(evalAllowed({ headers: { 'x-binasmart-eval': '1', 'x-real-ip': 'bini-eval-3' }, ip: '127.0.0.1' }, OWNER), true);
  assert.equal(evalAllowed({ headers: {}, ip: '127.0.0.1' }, OWNER), false, 'no header, no evaluation');
});

test('with no pepper configured every key is simply unknown', () => {
  const dir = tmp();
  const keys = writeKeys(dir, [{ id: 'k_x', keyHash: hashKey('bina_secret', PEPPER), enabled: true }]);
  const ks = makeKeystore({ file: keys, pepper: '', reloadMs: 0 });
  assert.equal(ks.resolve('bina_secret'), null);
});

test('a missing or unreadable keys file is not an error', () => {
  const dir = tmp();
  assert.equal(makeKeystore({ file: path.join(dir, 'nope.json'), pepper: PEPPER, reloadMs: 0 }).resolve('anything'), null);
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{ not json');
  assert.equal(makeKeystore({ file: bad, pepper: PEPPER, reloadMs: 0 }).resolve('anything'), null);
});
