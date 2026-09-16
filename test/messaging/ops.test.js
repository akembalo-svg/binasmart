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
