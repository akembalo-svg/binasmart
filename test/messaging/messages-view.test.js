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

// ===== Task 2: the store and the view =====
const { makeMessagesStore, makeMessagesView } = require('../../messaging/messages-view');

const D = s => new Date(s);
// A store double that records every call and answers from fixed rows.
function fakeStore(over = {}) {
  const calls = [];
  const base = {
    countBatches: async w => { calls.push(['countBatches', w]); return 3; },
    batches: async (w, skip, take) => { calls.push(['batches', w, skip, take]); return [
      { id: 'b1', createdAt: D('2026-09-16T06:00:00Z'), kind: 'notice', source: 'owner-action', actor: 'ck_owner_1', total: 3 },
      { id: 'b2', createdAt: D('2026-09-15T06:00:00Z'), kind: 'invoice', source: 'dashboard-send', actor: 'dashboard', total: 1 },
    ]; },
    counts: async ids => { calls.push(['counts', ids]); return [
      { batchId: 'b1', channel: 'sms', status: 'sent', _count: 2 },
      { batchId: 'b1', channel: 'none', status: 'failed', _count: 1 },
      { batchId: 'b2', channel: 'telegram', status: 'sent', _count: 1 },
    ]; },
    batch: async (buildingId, id) => { calls.push(['batch', buildingId, id]); return id === 'b1'
      ? { id: 'b1', createdAt: D('2026-09-16T06:00:00Z'), kind: 'notice', source: 'owner-action', actor: 'ck_owner_1', total: 3, text: 'ነገ ውሃ ይቋረጣል' }
      : null; },
    countRows: async id => { calls.push(['countRows', id]); return 3; },
    rows: async (id, skip, take) => { calls.push(['rows', id, skip, take]); return [
      { tenancyId: 't1', channel: 'sms', status: 'sent', errorKind: null, createdAt: D('2026-09-16T06:00:01Z') },
      { tenancyId: 't2', channel: 'none', status: 'failed', errorKind: 'no_mobile', createdAt: D('2026-09-16T06:00:02Z') },
      { tenancyId: null, channel: 'sms', status: 'failed', errorKind: null, createdAt: D('2026-09-16T06:00:03Z') },
    ]; },
    units: async (ids, buildingId) => { calls.push(['units', ids, buildingId]); return [
      { id: 't1', unit: { number: '211' } }, { id: 't2', unit: { number: 'G-3' } }]; },
    roles: async (ids, buildingId) => { calls.push(['roles', ids, buildingId]); return [{ id: 'ck_owner_1', role: 'owner' }]; },
    oldestBatchAt: async b => { calls.push(['oldestBatchAt', b]); return D('2026-08-02T06:00:00Z'); },
    smsParts: async w => { calls.push(['smsParts', w]); return w.buildingId ? (w.status === 'test' ? 4 : 120) : 9000; },
  };
  return { store: Object.assign(base, over), calls };
}

test('the batch list is this building only, newest first, twenty to a page, with the filters it was given', async () => {
  const { store, calls } = fakeStore();
  const d = await makeMessagesView({ store, now: () => D('2026-09-16T09:00:00Z') })
    .list({ buildingId: 'bld1', page: 0, kind: 'notice', month: '2026-09' });
  const where = calls.find(c => c[0] === 'countBatches')[1];
  assert.deepEqual(where, { buildingId: 'bld1', kind: 'notice', createdAt: { gte: D('2026-08-31T21:00:00Z'), lt: D('2026-09-30T21:00:00Z') } });
  assert.deepEqual(calls.find(c => c[0] === 'batches').slice(2), [0, 20]);
  assert.deepEqual(d.months, ['2026-09', '2026-08']);
  assert.deepEqual(d.kinds, ['notice', 'reminder', 'invoice', 'receipt']);
  assert.deepEqual([d.page, d.pages, d.total, d.kind, d.month], [0, 1, 3, 'notice', '2026-09']);
  assert.deepEqual(d.batches.map(b => [b.id, b.kind, b.by, b.total]), [['b1', 'notice', 'owner', 3], ['b2', 'invoice', 'dashboard', 1]]);
  assert.deepEqual([d.batches[0].counts.reached, d.batches[0].counts.notReachable, d.batches[0].counts.total], [2, 1, 3]);
  assert.equal(d.batches[0].at, '2026-09-16T06:00:00.000Z');
});

test('a kind or a month that is not one of ours filters nothing, and only real access ids are looked up', async () => {
  const { store, calls } = fakeStore();
  const d = await makeMessagesView({ store, now: () => D('2026-09-16T09:00:00Z') })
    .list({ buildingId: 'bld1', page: 99, kind: 'otp', month: 'all' });
  assert.deepEqual(calls.find(c => c[0] === 'countBatches')[1], { buildingId: 'bld1' });
  assert.deepEqual([d.kind, d.month, d.page], ['', '', 0]);
  // 'dashboard' is not an id and is never asked about; the cuid is, scoped to the building.
  assert.deepEqual(calls.find(c => c[0] === 'roles').slice(1), [['ck_owner_1'], 'bld1']);
});

test('a batch of another building is not found, not refused', async () => {
  const { store } = fakeStore();
  const v = makeMessagesView({ store, now: () => D('2026-09-16T09:00:00Z') });
  assert.equal(await v.one({ buildingId: 'bld1', batchId: 'b2' }), null);
  assert.equal(await v.one({ buildingId: 'bld1', batchId: '' }), null);
});

test('a batch drill-down names units and nothing else about a tenant', async () => {
  const { store, calls } = fakeStore();
  const d = await makeMessagesView({ store, now: () => D('2026-09-16T09:00:00Z') }).one({ buildingId: 'bld1', batchId: 'b1' });
  assert.deepEqual(d.rows.map(r => [r.unit, r.channel, r.present, r.reason]), [
    ['211', 'sms', 'reached', null],
    ['G-3', 'none', 'notReachable', 'no_mobile'],
    ['—', 'sms', 'failed', null],           // a report-driven failure carries no reason
  ]);
  assert.equal(d.text, 'ነገ ውሃ ይቋረጣል');
  assert.equal(d.by, 'owner');
  assert.deepEqual([d.page, d.pages, d.total], [0, 1, 3]);
  // The unit lookup is scoped to the building, so a tenancy id from elsewhere resolves to nothing.
  assert.deepEqual(calls.find(c => c[0] === 'units').slice(1), [['t1', 't2'], 'bld1']);
  const json = JSON.stringify(d);
  for (const leak of ['tenancyId', 't1', 'userId', 'providerId', 'phone']) assert.equal(json.includes(leak), false, leak);
});

test('only an invoice or receipt batch hides its text; the month is this month in Addis and test parts are separate', async () => {
  const { store } = fakeStore({ batch: async () => ({ id: 'b2', createdAt: D('2026-09-15T06:00:00Z'), kind: 'invoice',
    source: 'dashboard-send', actor: 'dashboard', total: 1, text: null }) });
  const v = makeMessagesView({ store, now: () => D('2026-09-16T09:00:00Z') });
  assert.equal((await v.one({ buildingId: 'bld1', batchId: 'b2' })).text, '');
  const m = await v.smsMonth({ buildingId: 'bld1', limit: 500, real: true, tenantMode: 'live', tiers: [[10000, 0.7475], [null, 0.2875]] });
  assert.deepEqual([m.mode, m.parts, m.testParts, m.limit, m.remaining], ['live', 120, 4, 500, 380]);
  assert.equal(m.unitPriceEtb, 0.7475);           // the tier comes from the whole account's 9,000 parts this month
  assert.equal(m.costEtb, Math.round(120 * 0.7475 * 100) / 100);
  // A building that is not real is in test mode whatever the provider says, exactly as delivery.plan() decides it.
  assert.equal((await v.smsMonth({ buildingId: 'bld1', limit: 500, real: false, tenantMode: 'live', tiers: [[null, 1]] })).mode, 'test');
  // The card's "Test mode - nothing was sent" line reads this field, and it is the TENANT switch: a live provider
  // switch (sign-in codes) must never make the card claim a tenant SMS went out.
  assert.equal((await v.smsMonth({ buildingId: 'bld1', limit: 500, real: true, tenantMode: 'test', tiers: [[null, 1]] })).mode, 'test');
  assert.equal((await v.smsMonth({ buildingId: 'bld1', limit: 500, real: true, tiers: [[null, 1]] })).mode, 'test', 'unset is test');
  assert.equal((await v.smsMonth({ buildingId: 'bld1', limit: null, real: true, tenantMode: 'test', tiers: [[null, 1]] })).limit, 0);
});

test('the store selects counts, units and dates — never a phone, a user id or a provider id', async () => {
  const seen = [];
  const rec = name => async a => { seen.push([name, a]); return name === 'aggregate' ? { _sum: { smsParts: 7 } } : []; };
  const prisma = {
    outboundBatch: { count: rec('batch.count'), findMany: rec('batch.findMany'), findFirst: rec('batch.findFirst') },
    outboundMessage: { groupBy: rec('message.groupBy'), count: rec('message.count'), findMany: rec('message.findMany'), aggregate: rec('aggregate') },
    tenancy: { findMany: rec('tenancy.findMany') },
    ownerAccess: { findMany: rec('access.findMany') },
  };
  const s = makeMessagesStore(prisma);
  await s.countBatches({ buildingId: 'b' }); await s.batches({ buildingId: 'b' }, 0, 20);
  await s.counts(['x']); await s.batch('b', 'x'); await s.countRows('x'); await s.rows('x', 0, 100);
  await s.units(['t'], 'b'); await s.roles(['a'], 'b'); await s.oldestBatchAt('b');
  assert.equal(await s.smsParts({ buildingId: 'b' }), 7);
  const json = JSON.stringify(seen);
  for (const leak of ['phone', 'userId', 'providerId', 'telegramChatId', 'smsText', 'phoneE164', 'phoneKey'])
    assert.equal(json.includes(leak), false, leak);
  // The drill-down row selection, and the two ownership scopes.
  assert.deepEqual(Object.keys(seen.find(x => x[0] === 'message.findMany')[1].select).sort(),
    ['channel', 'createdAt', 'errorKind', 'status', 'tenancyId']);
  assert.deepEqual(seen.find(x => x[0] === 'tenancy.findMany')[1].where, { id: { in: ['t'] }, unit: { buildingId: 'b' } });
  assert.deepEqual(seen.find(x => x[0] === 'access.findMany')[1].where, { id: { in: ['a'] }, kind: 'building', entityId: 'b' });
  assert.deepEqual(seen.find(x => x[0] === 'batch.findFirst')[1].where, { id: 'x', buildingId: 'b' });
});

// The monthly SMS limit counts what the sender counts. A copy of the three statuses here could drift from
// messaging/delivery.js without a test failing anywhere, so the view takes delivery.js's own list.
test('COUNTED is the very list delivery.js counts, not a second copy of it', () => {
  const view = require('../../messaging/messages-view');
  const delivery = require('../../messaging/delivery');
  assert.deepEqual(delivery.COUNTED, ['queued', 'sent', 'delivered']);
  assert.equal(view.COUNTED, delivery.COUNTED);
});
