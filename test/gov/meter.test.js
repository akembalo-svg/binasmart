'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeMeter, outcomeOf, OUTCOMES } = require('../../gov/meter');

const salt = 's'.repeat(40);
function meter(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-meter-'));
  return { m: makeMeter({ root, salt, now: () => t.now, timer: false }), root };
}

test('outcomes are read from the engine response; only answered is billable', () => {
  assert.equal(outcomeOf({ reply: 'x', emergency: true }), 'emergency');
  assert.equal(outcomeOf({ reply: 'x', urgent: true }), 'urgent');
  assert.equal(outcomeOf({ reply: 'x', limited: true }), 'limited');
  assert.equal(outcomeOf({ reply: 'x', redirected: true, refused: 'agency' }), 'refused');
  assert.equal(outcomeOf({ reply: 'x', answered: true }), 'answered');
  assert.equal(outcomeOf({ reply: 'x', answered: false }), 'error');
  assert.equal(outcomeOf(null), 'error');
  assert.ok(OUTCOMES.includes('answered'));
});

test('a visitor gets 20 an hour, then the next hour again', () => {
  const t = { now: Date.UTC(2026, 9, 1, 10, 0, 0) };
  const { m } = meter(t);
  for (let i = 0; i < 20; i++) assert.equal(m.allow({ office: 'mols', uid: 'u1', ip: '1.2.3.4' }), true, 'q' + i);
  assert.equal(m.allow({ office: 'mols', uid: 'u1', ip: '1.2.3.4' }), false);
  assert.equal(m.allow({ office: 'mols', uid: 'u2', ip: '1.2.3.4' }), true, 'another phone on the same network');
  t.now += 3600 * 1000;
  assert.equal(m.allow({ office: 'mols', uid: 'u1', ip: '1.2.3.4' }), true);
});

test('a network gets 200 an hour whatever the device ids', () => {
  const t = { now: Date.UTC(2026, 9, 1, 10, 0, 0) };
  const { m } = meter(t);
  for (let i = 0; i < 200; i++) assert.equal(m.allow({ office: 'mols', uid: 'u' + i, ip: '5.6.7.8' }), true);
  assert.equal(m.allow({ office: 'mols', uid: 'fresh', ip: '5.6.7.8' }), false);
});

test('the office quota counts answered questions only', () => {
  const t = { now: Date.UTC(2026, 9, 1, 10, 0, 0) };
  const { m } = meter(t);
  for (let i = 0; i < 3; i++) m.record('mols', 'refused');
  m.record('mols', 'answered'); m.record('mols', 'answered');
  assert.equal(m.allow({ office: 'mols', uid: 'a', ip: '9.9.9.1', quotaPerDay: 3 }), true);
  m.record('mols', 'answered');
  assert.equal(m.allow({ office: 'mols', uid: 'b', ip: '9.9.9.2', quotaPerDay: 3 }), false);
});

test('the ledger holds office outcomes and no address, device id or question', () => {
  const t = { now: Date.UTC(2026, 9, 1, 10, 0, 0) };
  const { m, root } = meter(t);
  m.allow({ office: 'mols', uid: 'device-abc', ip: '203.0.113.9' });
  m.record('mols', 'answered'); m.record('mols', 'fb-down');
  m.ledger.flush(); m.limits.flush();
  const day = JSON.parse(fs.readFileSync(path.join(root, 'ledger', 'day-2026-10-01.gov.json'), 'utf8'));
  assert.deepEqual(Object.keys(day.callers).sort(), ['office:mols|answered', 'office:mols|fb-down']);
  const all = fs.readdirSync(path.join(root, 'limits')).map(f => fs.readFileSync(path.join(root, 'limits', f), 'utf8')).join('');
  assert.ok(!all.includes('203.0.113.9') && !all.includes('device-abc'), 'limits hold hashes only');
});

test('without a salt of 32 characters the meter refuses to start', () => {
  assert.throws(() => makeMeter({ root: os.tmpdir(), salt: 'short', timer: false }), /salt/);
});

// Added 2026-09-18 for the owner's settled decisions: durable limits, D12 (only answered is billed), Y1 (no text).
function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? allFiles(path.join(dir, e.name)) : [fs.readFileSync(path.join(dir, e.name), 'utf8')]);
}

test('limits and the office quota survive a restart (a new meter on the same directory)', () => {
  const t = { now: Date.UTC(2026, 9, 1, 10, 0, 0) };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-meter-'));
  const a = makeMeter({ root, salt, now: () => t.now, timer: false });
  for (let i = 0; i < 20; i++) assert.equal(a.allow({ office: 'mols', uid: 'u1', ip: '1.2.3.4' }), true);
  for (let i = 0; i < 3; i++) a.record('mols', 'answered');
  a.stop();                                   // what the exit hook does; pm2 restart = a new process
  const b = makeMeter({ root, salt, now: () => t.now, timer: false });
  assert.equal(b.allow({ office: 'mols', uid: 'u1', ip: '1.2.3.4' }), false, 'the visitor is still over after the restart');
  assert.equal(b.allow({ office: 'mols', uid: 'u2', ip: '1.2.3.4' }), true, 'another visitor on that network is not');
  assert.equal(b.allow({ office: 'mols', uid: 'u3', ip: '1.2.3.5', quotaPerDay: 3 }), false, 'the office quota is remembered');
  b.stop();
});

test('the network cap stops a new visitor once the network has spent 200, even after a restart', () => {
  const t = { now: Date.UTC(2026, 9, 1, 10, 0, 0) };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-meter-'));
  const a = makeMeter({ root, salt, now: () => t.now, timer: false });
  for (let i = 0; i < 199; i++) assert.equal(a.allow({ office: 'mols', uid: 'p' + i, ip: '5.6.7.9' }), true);
  a.stop();
  const b = makeMeter({ root, salt, now: () => t.now, timer: false });
  assert.equal(b.allow({ office: 'mols', uid: 'last', ip: '5.6.7.9' }), true, 'number 200');
  assert.equal(b.allow({ office: 'mols', uid: 'another', ip: '5.6.7.9' }), false, 'number 201, a fresh visitor');
  b.stop();
});

test('refusals, emergencies, limits and errors are counted in the ledger and never billed', () => {
  const t = { now: Date.UTC(2026, 9, 1, 10, 0, 0) };
  const { m, root } = meter(t);
  for (const o of ['refused', 'emergency', 'urgent', 'limited', 'error', 'fb-up', 'report']) m.record('mols', o);
  m.record('mols', 'answered'); m.record('mols', 'answered');
  assert.equal(m.ledger.count('day', 'office:mols', t.now), 2, 'only the two answered questions spend the quota');
  for (let i = 0; i < 21; i++) m.allow({ office: 'mols', uid: 'same', ip: '9.9.9.9' });   // the 21st is refused
  m.ledger.flush();
  const day = JSON.parse(fs.readFileSync(path.join(root, 'ledger', 'day-2026-10-01.gov.json'), 'utf8')).callers;
  for (const o of ['refused', 'emergency', 'urgent', 'limited', 'error', 'fb-up', 'report']) assert.equal(day['office:mols|' + o].count, 1, o + ' is counted');
  assert.equal(day['office:mols|answered'].count, 2);
  assert.equal(day['office:mols|visitor-limit'].denied, 1, 'a limit hit is counted as denied');
  const billable = Object.entries(day).filter(([k]) => k.endsWith('|answered')).reduce((s, [, v]) => s + v.count, 0);
  assert.equal(billable, 2);
  assert.ok(!JSON.stringify(day).match(/price|birr|etb|usd|amount/i), 'the ledger holds units, not money');
});

test('no question text reaches the ledger or the limits, even when a caller passes it by mistake', () => {
  const t = { now: Date.UTC(2026, 9, 1, 10, 0, 0) };
  const { m, root } = meter(t);
  const q = 'How much is the work permit fee for a foreign engineer';
  m.allow({ office: 'mols', uid: 'dev-1', ip: '198.51.100.7', q, question: q });
  m.record('mols', q);                 // the question passed as the outcome
  m.record(q, 'answered');             // or as the office id
  m.record('mols', 'answered');
  m.ledger.flush(); m.limits.flush();
  const text = allFiles(root).join('\n');
  assert.ok(text.length > 0);
  assert.ok(!text.includes(q) && !/work permit|engineer/i.test(text), 'no question text on disk');
  assert.ok(!text.includes('198.51.100.7') && !text.includes('dev-1'), 'no address or device id on disk');
  const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'ledger', 'day-2026-10-01.gov.json'), 'utf8')).callers);
  for (const k of keys) assert.match(k, /^office:[a-z0-9-]{2,32}\|[a-z-]+$/, k);
});
