'use strict';
// The Messages tab's arithmetic: one row in one bucket, a label that is never an id, and months in Addis time.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { presentOf, countsOf, whoLabel, addisMonthRange, addisMonthOf, monthList, pageOf, KINDS, PAGE, ROWS_PAGE } =
  require('../../messaging/messages-view');

test('every channel and status pair lands in exactly one bucket', () => {
  // channel none is always "not reachable", whatever the row's status says (delivery.js writes it as failed).
  assert.equal(presentOf('none', 'failed'), 'notReachable');
  assert.equal(presentOf('none', 'test'), 'notReachable');
  assert.equal(presentOf('sms', 'delivered'), 'delivered');
  assert.equal(presentOf('sms', 'sent'), 'reached');
  assert.equal(presentOf('telegram', 'sent'), 'reached');
  assert.equal(presentOf('sms', 'queued'), 'queued');
  assert.equal(presentOf('sms', 'test'), 'test');
  assert.equal(presentOf('telegram', 'failed'), 'failed');
  // A status nobody has written yet is a failure, not a silent gap.
  assert.equal(presentOf('sms', 'something-new'), 'failed');
});

test('the buckets add up to the total, and not reachable is not also counted as failed', () => {
  const c = countsOf([
    { channel: 'telegram', status: 'sent', count: 2 },
    { channel: 'sms', status: 'delivered', count: 40 },
    { channel: 'sms', status: 'sent', count: 20 },
    { channel: 'sms', status: 'queued', count: 1 },
    { channel: 'sms', status: 'failed', count: 1 },
    { channel: 'none', status: 'failed', count: 7 },
  ]);
  assert.equal(c.total, 71);
  assert.equal(c.delivered + c.reached + c.queued + c.failed + c.notReachable + c.test, c.total);
  assert.deepEqual([c.delivered, c.reached, c.queued, c.failed, c.notReachable, c.test], [40, 22, 1, 1, 7, 0]);
  assert.deepEqual([c.telegram, c.sms, c.none], [2, 62, 7]);
  assert.equal(countsOf([]).total, 0);
  assert.equal(countsOf(null).failed, 0);
});

test('who sent it is a role or a name, never an OwnerAccess id', () => {
  const roles = { ck_owner_1: 'owner', ck_staff_1: 'staff' };
  assert.equal(whoLabel('dashboard', roles), 'dashboard');
  assert.equal(whoLabel('cron', roles), 'cron');
  assert.equal(whoLabel('ops', roles), 'ops');
  assert.equal(whoLabel('ck_owner_1', roles), 'owner');
  assert.equal(whoLabel('ck_staff_1', roles), 'staff');
  // Unknown ids, a revoked approval, another building's approval, null: all the same neutral word.
  assert.equal(whoLabel('ck_someone_else', roles), 'unknown');
  assert.equal(whoLabel('ck_someone_else', {}), 'unknown');
  assert.equal(whoLabel(null, roles), 'unknown');
  assert.equal(whoLabel('', roles), 'unknown');
  for (const v of ['ck_someone_else', 'ck_owner_1']) assert.equal(whoLabel(v, roles).includes(v), false);
});

test('a month is the Addis month, and junk is refused rather than guessed', () => {
  const r = addisMonthRange('2026-09');
  // Addis is UTC+3 with no daylight saving: the month starts at 21:00 the previous day, UTC.
  assert.equal(r.from.toISOString(), '2026-08-31T21:00:00.000Z');
  assert.equal(r.to.toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(addisMonthRange('2026-12').to.toISOString(), '2026-12-31T21:00:00.000Z');
  for (const bad of ['', null, '2026-13', '2026-00', '2026-9', 'all', '2026-09-01']) assert.equal(addisMonthRange(bad), null, String(bad));
  // A batch written at 22:00 UTC on 31 August belongs to September in Addis.
  assert.equal(addisMonthOf(new Date('2026-08-31T22:00:00Z')), '2026-09');
  assert.equal(addisMonthOf(new Date('2026-08-31T20:00:00Z')), '2026-08');
});

test('the month list runs back to the oldest batch, newest first and capped, and paging never falls off the end', () => {
  const now = new Date('2026-09-16T09:00:00Z');
  assert.deepEqual(monthList(new Date('2026-07-04T09:00:00Z'), now), ['2026-09', '2026-08', '2026-07']);
  assert.deepEqual(monthList(null, now), ['2026-09']);
  assert.deepEqual(monthList(new Date('2025-11-04T09:00:00Z'), now).slice(0, 3), ['2026-09', '2026-08', '2026-07']);
  assert.equal(monthList(new Date('2010-01-01T00:00:00Z'), now).length, 24);
  // The year rolls over correctly.
  assert.deepEqual(monthList(new Date('2025-12-04T09:00:00Z'), new Date('2026-01-16T09:00:00Z')), ['2026-01', '2025-12']);
  assert.equal(pageOf(0, 0, PAGE), 0);
  assert.equal(pageOf(5, 41, PAGE), 2);
  assert.equal(pageOf(-3, 41, PAGE), 0);
  assert.equal(pageOf('1', 41, PAGE), 1);
  assert.equal(pageOf('nonsense', 41, PAGE), 0);
  assert.deepEqual(KINDS, ['notice', 'reminder', 'invoice', 'receipt']);
  assert.equal(PAGE, 20);
  assert.equal(ROWS_PAGE, 100);
});
