'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchPending } = require('../../ops/messaging/backfill-pending-invoices');
const { parseArgs } = require('../../ops/messaging/sms-send-one');

const D = s => new Date(s);
const inv = (id, unit, total, created) => ({ id, unit, total, createdAt: D(created), tenancyId: 't-' + id, userId: 'u-' + id });

test('an audit-only stuck send matches the one invoice with that unit and total, created before the send', () => {
  const invoices = [inv('i1', '211', 12500, '2026-07-15T20:00:00Z'), inv('i2', '11', 12500, '2026-07-15T20:00:00Z'), inv('i3', '211', 9000, '2026-07-15T20:00:00Z')];
  const r = matchPending([{ id: 'a1', detail: 'Demo Shop 211 (delivery pending — channel down)', amount: 12500, createdAt: D('2026-09-10T08:00:00Z') }], invoices);
  assert.deepEqual(r.map(x => [x.auditId, x.reason, x.invoice && x.invoice.id]), [['a1', 'matched', 'i1']]);
});

test('two candidates are ambiguous; a different total or an invoice created after the send is no match', () => {
  const two = [inv('i1', '211', 12500, '2026-07-15T20:00:00Z'), inv('i2', '211', 12500, '2026-08-15T20:00:00Z')];
  assert.equal(matchPending([{ id: 'a', detail: ' 211 (delivery pending — channel down)', amount: 12500, createdAt: D('2026-09-10T08:00:00Z') }], two)[0].reason, 'ambiguous');
  assert.equal(matchPending([{ id: 'a', detail: 'Shop 211 (delivery pending — channel down)', amount: 13750, createdAt: D('2026-09-10T08:00:00Z') }], two)[0].reason, 'none');
  assert.equal(matchPending([{ id: 'a', detail: 'Shop 211 (delivery pending — channel down)', amount: 12500, createdAt: D('2026-07-01T08:00:00Z') }], two)[0].reason, 'none');
});

test('unit 11 is not unit 211', () => {
  const r = matchPending([{ id: 'a', detail: 'Shop 211 (delivery pending — channel down)', amount: 100, createdAt: D('2026-09-10T08:00:00Z') }], [inv('i', '11', 100, '2026-07-15T20:00:00Z')]);
  assert.equal(r[0].reason, 'none');
});

test('the go-live script refuses to run without a number and the explicit approval flag', () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['--to', '0900000001']), null);
  assert.equal(parseArgs(['--approved-by-ibrahim']), null);
  assert.equal(parseArgs(['--to', '--approved-by-ibrahim']), null);
  assert.deepEqual(parseArgs(['--to', '0900000001', '--approved-by-ibrahim']), { to: '0900000001' });
});

// Plan C: the SMS status report gains one line about the batches behind those parts. It is the same script, not a
// second one — and requiring it must not open a database connection, or this test file could not exist.
const { batchLine } = require('../../ops/messaging/sms-status');

test('the batch line counts this month by kind, in a fixed order, and says so when there are none', () => {
  assert.equal(batchLine([{ kind: 'invoice', _count: 3 }, { kind: 'notice', _count: 1 }]),
    'batches this month · notice 1 · invoice 3 · 4 in all');
  assert.equal(batchLine([{ kind: 'receipt', _count: 2 }, { kind: 'otp', _count: 5 }]),
    'batches this month · receipt 2 · otp 5 · 7 in all');
  assert.equal(batchLine([]), 'batches this month · none');
  assert.equal(batchLine(null), 'batches this month · none');
});

// One switch became two, and a report that named only one of them would be read as a promise that nothing
// goes to tenants - or that everything does.
const { run: smsStatusRun } = require('../../ops/messaging/sms-status');
const fakeSmsPrisma = () => ({
  outboundMessage: { groupBy: async () => [] },
  outboundBatch: { groupBy: async () => [] },
  building: { findMany: async () => [] },
});
const statusLines = async env => { const out = []; await smsStatusRun({ prisma: fakeSmsPrisma(), env, out: m => out.push(m) }); return out; };

test('the SMS status report names both switches, and never the token', async () => {
  const T = 'fake-token-for-tests';
  assert.match((await statusLines({ SMS_API_TOKEN: T, SMS_MODE: 'live', SMS_TENANT_MODE: 'live' }))[0],
    /^mode live · tenant sms live · provider geezsms · token yes/);
  assert.match((await statusLines({ SMS_API_TOKEN: T, SMS_MODE: 'live' }))[0], /^mode live · tenant sms test · /);
  assert.match((await statusLines({ SMS_API_TOKEN: T, SMS_MODE: 'test', SMS_TENANT_MODE: 'live' }))[0], /^mode test · tenant sms test · /);
  assert.match((await statusLines({}))[0], /^mode test · tenant sms test · provider none · token no/);
  const out = await statusLines({ SMS_API_TOKEN: T, SMS_MODE: 'live' });
  assert.equal(out.join(' ').includes(T), false, 'the token is never printed');
  // Tenant SMS is off, so this month's parts are test rows: the line says so even with the provider switch live.
  assert.match(out.find(l => l.startsWith('all buildings')), /test rows, nothing was sent/);
  assert.equal(/test rows/.test((await statusLines({ SMS_API_TOKEN: T, SMS_MODE: 'live', SMS_TENANT_MODE: 'live' })).find(l => l.startsWith('all buildings'))), false);
});

test('the go-live SMS to Ibrahim is transactional: SMS_MODE alone opens it, never the tenant switch', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'ops', 'messaging', 'sms-send-one.js'), 'utf8');
  assert.match(src, /if \(sms\.mode !== 'live'\)/);
  assert.equal(/sms\.tenantMode/.test(src), false, 'the tenant switch never gates this one SMS');
});

test('requiring the SMS status script connects to nothing and prints nothing', () => {
  const mod = require('../../ops/messaging/sms-status');
  assert.equal(typeof mod.batchLine, 'function');
  assert.equal(typeof mod.run, 'function');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'ops', 'messaging', 'sms-status.js'), 'utf8');
  assert.match(src, /if \(require\.main === module\)/);
  // new PrismaClient() and dotenv belong inside that guard: this test file requires the module.
  const guard = src.indexOf('if (require.main === module)');
  assert.ok(src.indexOf('new PrismaClient()') > guard, 'a client is built only when the script is run');
  assert.ok(src.indexOf("require('dotenv')") > guard, 'the environment is read only when the script is run');
});
