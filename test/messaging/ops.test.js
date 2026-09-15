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
