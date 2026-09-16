'use strict';
// The owner's record of what they confirmed, after the chat is closed. Roles and counts; no ids, no arguments,
// no preview card.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeActionHistory, shapeAction, SELECT, PAGE } = require('../../agents/owner/actions/history');

const D = s => new Date(s);
const row = over => Object.assign({
  createdAt: D('2026-09-16T06:00:00Z'), kind: 'message', status: 'done', channel: 'owner-telegram',
  preparedRole: 'owner', confirmedBy: 'ck_owner_1', confirmedAt: D('2026-09-16T06:02:00Z'),
  bulk: true, urgent: false, result: null,
}, over);

test('a confirmed send is a role, a channel, a time and counts — never an id or the words that were sent', () => {
  const a = shapeAction(row({ result: { counts: { telegram: 2, sms: 62, none: 7, sent: 64, test: 0, failed: 7 },
    batchIds: ['bt1'], notReached: ['104', 'G-3'], error: null } }), { ck_owner_1: 'owner' });
  assert.deepEqual(a.counts, { sent: 64, test: 0, failed: 0, notReachable: 7 });
  assert.deepEqual([a.kind, a.status, a.channel, a.preparedBy, a.confirmedBy, a.bulk, a.urgent],
    ['message', 'done', 'owner-telegram', 'owner', 'owner', true, false]);
  assert.equal(a.at, '2026-09-16T06:00:00.000Z');
  assert.equal(a.confirmedAt, '2026-09-16T06:02:00.000Z');
  assert.deepEqual(a.notReached, ['104', 'G-3']);
  assert.deepEqual(a.batchIds, ['bt1']);
  const json = JSON.stringify(a);
  for (const leak of ['ck_owner_1', '"id"', 'args', 'fingerprint', 'payload', 'cardText', 'preparedTg', 'expiresAt'])
    assert.equal(json.includes(leak), false, leak);
});

test('a recipient the building could not reach is counted once, not as a failure as well', () => {
  // delivery.js tallies a channel-none row in BOTH counts.none and counts.failed; subtracting is the whole point.
  const a = shapeAction(row({ result: { counts: { telegram: 0, sms: 0, none: 3, sent: 0, test: 0, failed: 5 } } }), {});
  assert.deepEqual(a.counts, { sent: 0, test: 0, failed: 2, notReachable: 3 });
  // Never a negative count, whatever a future result shape does.
  assert.deepEqual(shapeAction(row({ result: { counts: { none: 9, failed: 1 } } }), {}).counts,
    { sent: 0, test: 0, failed: 0, notReachable: 9 });
  assert.equal(shapeAction(row({ result: {} }), {}).counts, null);
  assert.equal(shapeAction(row({ result: null }), {}).counts, null);
});

test('invoice creation and a recorded payment carry their own figures', () => {
  const inv = shapeAction(row({ kind: 'create_invoices', bulk: false,
    result: { created: 12, skipped: 3, month: '2026-09', error: null } }), {});
  assert.deepEqual([inv.created, inv.skipped, inv.month, inv.counts, inv.reason], [12, 3, '2026-09', null, null]);
  const pay = shapeAction(row({ kind: 'record_payment', bulk: false,
    result: { invoiceId: 'inv1', unit: '211', totalEtb: 12500, error: null, batchIds: ['bt2'] } }), {});
  assert.deepEqual([pay.unit, pay.totalEtb, pay.batchIds], ['211', 12500, ['bt2']]);
  assert.equal(JSON.stringify(pay).includes('inv1'), false, 'an invoice id is not needed to read the history');
});

test('a refusal keeps its reason, and an unknown approval is a neutral word', () => {
  const a = shapeAction(row({ status: 'refused', confirmedBy: 'ck_gone', result: { error: 'sms_limit', needed: 130, remaining: 44 } }), {});
  assert.equal(a.reason, 'sms_limit');
  assert.equal(a.confirmedBy, 'unknown');
  assert.equal(shapeAction(row({ status: 'expired', confirmedBy: null, confirmedAt: null, result: null }), {}).confirmedBy, null);
  assert.equal(shapeAction(row({ confirmedBy: 'dashboard', preparedRole: 'dashboard', channel: 'owner-web' }), {}).confirmedBy, 'dashboard');
  assert.equal(shapeAction(row({ status: 'refused', result: { error: 'already_paid' } }), {}).reason, 'already_paid');
});

test('the list reads only those columns, this building only, newest first, twenty to a page', async () => {
  const seen = [];
  const prisma = {
    ownerAction: {
      count: async a => { seen.push(['count', a]); return 41; },
      findMany: async a => { seen.push(['findMany', a]); return [row({ confirmedBy: 'ck_owner_1' }), row({ confirmedBy: 'dashboard' })]; },
    },
    ownerAccess: { findMany: async a => { seen.push(['access', a]); return [{ id: 'ck_owner_1', role: 'owner' }]; } },
  };
  const d = await makeActionHistory({ prisma }).list({ buildingId: 'bld1', page: 99 });
  assert.deepEqual([d.page, d.pages, d.total], [2, 3, 41]);
  assert.deepEqual(d.actions.map(a => a.confirmedBy), ['owner', 'dashboard']);
  const many = seen.find(x => x[0] === 'findMany')[1];
  assert.deepEqual(many.where, { buildingId: 'bld1' });
  assert.deepEqual(many.orderBy, { createdAt: 'desc' });
  assert.deepEqual([many.skip, many.take], [40, PAGE]);
  assert.equal(many.include, undefined);
  assert.deepEqual(many.select, SELECT);
  assert.deepEqual(Object.keys(SELECT).sort(),
    ['bulk', 'channel', 'confirmedAt', 'confirmedBy', 'createdAt', 'kind', 'preparedRole', 'result', 'status', 'urgent']);
  // 'dashboard' is not an approval id and is never asked about; the real id is, scoped to this building.
  assert.deepEqual(seen.find(x => x[0] === 'access')[1].where, { id: { in: ['ck_owner_1'] }, kind: 'building', entityId: 'bld1' });
  assert.deepEqual(seen.find(x => x[0] === 'access')[1].select, { id: true, role: true });
});
