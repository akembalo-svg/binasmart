'use strict';
// The loader is the only code in the owner agent that touches the database. Two things must hold for every
// query it makes: it is limited to the buildings in scope, and it selects nothing private.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBuildings } = require('../../agents/owner/building-data');

function recordingPrisma() {
  const calls = {};
  const model = name => ({ findMany: async args => { calls[name] = args; return []; } });
  return { calls, prisma: { building: model('building'), unit: model('unit'), tenancy: model('tenancy'),
    invoice: model('invoice'), maintenanceRequest: model('maintenanceRequest'), expense: model('expense') } };
}

test('every query is limited to the buildings in scope', async () => {
  const { calls, prisma } = recordingPrisma();
  await loadBuildings(prisma, ['b1', 'b2'], new Date('2026-09-13T12:00:00Z'));
  const scope = { in: ['b1', 'b2'] };
  assert.deepEqual(calls.building.where.id, scope);
  assert.deepEqual(calls.unit.where.buildingId, scope);
  assert.deepEqual(calls.tenancy.where.unit.buildingId, scope);
  assert.equal(calls.tenancy.where.active, false);
  assert.deepEqual(calls.invoice.where.tenancy.unit.buildingId, scope);
  assert.ok(calls.invoice.where.dueDate.gte instanceof Date);
  assert.deepEqual(calls.maintenanceRequest.where.OR, [{ buildingId: scope }, { tenancy: { unit: { buildingId: scope } } }]);
  assert.deepEqual(calls.expense.where.buildingId, scope);
});

test('nothing private is ever selected', async () => {
  const { calls, prisma } = recordingPrisma();
  await loadBuildings(prisma, ['b1'], new Date('2026-09-13T12:00:00Z'));
  const all = JSON.stringify(calls);
  for (const field of ['phone', 'faydaId', 'binaScore', 'paymentCode', 'bankAccounts', 'passwordHash', 'telegramChatId',
                       'telegramId', 'tinNumber', 'vatNumber', 'reporterPhone', 'reporterName', 'description', 'serialNo'])
    assert.equal(all.includes('"' + field + '"'), false, field + ' is selected');
});

test('an empty scope is refused, not treated as everything', async () => {
  const { prisma } = recordingPrisma();
  await assert.rejects(() => loadBuildings(prisma, [], new Date()), /owner scope is empty/);
  await assert.rejects(() => loadBuildings(prisma, null, new Date()), /owner scope is empty/);
});
