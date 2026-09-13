'use strict';
// The loader is the only code in the owner agent that touches the database. Two things must hold for every
// query it makes: it is limited to the buildings in scope, and it selects nothing private.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBuildings } = require('../../agents/owner/building-data');

const NOW = new Date('2026-09-13T12:00:00Z');
const SINCE = new Date(NOW.getTime() - 800 * 86400000);   // WINDOW_DAYS

function recordingPrisma() {
  const calls = {};
  const model = name => ({ findMany: async args => { calls[name] = args; return []; } });
  return { calls, prisma: { building: model('building'), unit: model('unit'), tenancy: model('tenancy'),
    invoice: model('invoice'), maintenanceRequest: model('maintenanceRequest'), expense: model('expense') } };
}

test('every query is limited to the buildings in scope', async () => {
  const { calls, prisma } = recordingPrisma();
  await loadBuildings(prisma, ['b1', 'b2'], NOW);
  const scope = { in: ['b1', 'b2'] };
  assert.deepEqual(calls.building.where.id, scope);
  assert.deepEqual(calls.unit.where.buildingId, scope);
  assert.deepEqual(calls.tenancy.where.unit.buildingId, scope);
  assert.equal(calls.tenancy.where.active, false);
  assert.deepEqual(calls.invoice.where.tenancy.unit.buildingId, scope);
  assert.ok(calls.invoice.where.dueDate.gte instanceof Date);
  assert.deepEqual(calls.maintenanceRequest.where.AND[0].OR, [{ buildingId: scope }, { tenancy: { unit: { buildingId: scope } } }]);
  assert.deepEqual(calls.expense.where.buildingId, scope);
});

// The whole of every query, literally. A new field, a whole relation (`user: true`), a dropped select or a
// dropped `active: true` all fail here, and have to be argued for in review.
test('each query selects exactly the allowlist, nothing more', async () => {
  const { calls, prisma } = recordingPrisma();
  await loadBuildings(prisma, ['b1'], NOW);
  const ids = { in: ['b1'] };
  assert.deepEqual(calls.building, { where: { id: ids },
    select: { id: true, name: true, nameAm: true, qrSlug: true, vatRegistered: true, vatInclusive: true } });
  assert.deepEqual(calls.unit, { where: { buildingId: ids },
    select: { id: true, buildingId: true, number: true, floor: true, areaSqm: true, monthlyRent: true, status: true, unitType: true,
      tenancies: { where: { active: true },
        select: { id: true, startDate: true, endDate: true,
          user: { select: { fullName: true } },
          shop: { select: { name: true, nameAm: true } },
          contract: { select: { startDate: true, endDate: true, monthlyRent: true } } } },
      _count: { select: { leads: true } } } });
  assert.deepEqual(calls.tenancy, { where: { active: false, unit: { buildingId: ids } }, select: { unitId: true, endDate: true } });
  assert.deepEqual(calls.invoice, { where: { tenancy: { unit: { buildingId: ids } }, dueDate: { gte: SINCE } },
    select: { id: true, tenancyId: true, type: true, amount: true, lateFee: true, dueDate: true, paidDate: true, daysLate: true, status: true,
      tenancy: { select: { unitId: true } } } });
  assert.deepEqual(calls.maintenanceRequest, {
    where: { AND: [
      { OR: [{ buildingId: ids }, { tenancy: { unit: { buildingId: ids } } }] },
      { OR: [{ createdAt: { gte: SINCE } }, { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } }] },
    ] },
    orderBy: { createdAt: 'desc' }, take: 1000,
    select: { type: true, status: true, assignedTo: true, createdAt: true, resolvedAt: true, buildingId: true,
      tenancy: { select: { unit: { select: { number: true, buildingId: true } } } } } });
  assert.deepEqual(calls.expense, { where: { buildingId: ids, date: { gte: SINCE } },
    select: { buildingId: true, date: true, category: true, amount: true, vatAmount: true } });
});

test('an empty scope is refused, not treated as everything', async () => {
  const { prisma } = recordingPrisma();
  await assert.rejects(() => loadBuildings(prisma, [], new Date()), /owner scope is empty/);
  await assert.rejects(() => loadBuildings(prisma, null, new Date()), /owner scope is empty/);
});
