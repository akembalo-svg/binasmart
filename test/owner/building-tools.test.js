'use strict';
// Every total a building tool reports, checked by hand against a fixture. The tools are pure functions over
// loaded records; the only database access is the loader (tested separately).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const B = require('../../agents/owner/tools/building');
const { fixture, fakePrisma, NOW } = require('./fixture');

const one = (name, args = {}, data = fixture()) => B.TOOLS[name](B.view(data, data.buildings[0]), args, NOW);

test('data_health says what is recorded and what is missing', () => {
  assert.deepEqual(one('data_health'), { units: 3, activeTenancies: 2, invoices: 6, invoicesPaid: 3,
    rentMonthsWithoutInvoices: ['2026-09', '2026-08'], expensesRecorded: 2, openRepairs: 1,
    newestInvoice: '2026-07-01', newestPayment: '2026-07-03' });
});

test('overview', () => {
  assert.deepEqual(one('overview'), { units: 3, occupied: 2, vacant: 1, otherStatus: 0, expectedMonthlyRentEtb: 45000,
    openRepairs: 1, newestInvoice: '2026-07-01', newestPayment: '2026-07-03' });
});

test('rent_month counts a month, and a cancelled invoice counts for nothing', () => {
  const july = one('rent_month', { month: '2026-07' });
  assert.equal(july.invoices, 2); assert.equal(july.invoicedEtb, 30000);
  assert.equal(july.paidCount, 1); assert.equal(july.paidEtb, 10000);
  assert.equal(july.unpaidCount, 1); assert.equal(july.unpaidEtb, 20000);
  assert.equal(july.overdueCount, 1); assert.equal(july.overdueEtb, 20000);
  const june = one('rent_month', { month: '2026-06' });
  assert.equal(june.invoicedEtb, 30000, 'the cancelled 10,000 is not invoiced');
  const september = one('rent_month', {});
  assert.equal(september.month, '2026-09'); assert.equal(september.invoices, 0);
});

test('unpaid lists the oldest first, with who owes it', () => {
  const u = one('unpaid');
  assert.equal(u.count, 2); assert.equal(u.totalEtb, 40000);
  assert.deepEqual(u.invoices.map(i => [i.unit, i.occupant, i.amountEtb, i.dueDate, i.daysLate]),
    [['102', 'Test Cafe', 20000, '2026-06-01', 104], ['102', 'Test Cafe', 20000, '2026-07-01', 74]]);
  assert.equal(one('unpaid', { month: '2026-07' }).count, 1);
});

test('an invoice from a former tenancy names nobody', () => {
  const data = fixture();
  data.invoices.push({ id: 'i7', tenancyId: 'old', type: 'RENT', amount: 5000, lateFee: 0, dueDate: new Date('2026-04-01T00:00:00Z'),
    paidDate: null, daysLate: 0, status: 'OVERDUE', tenancy: { unitId: 'u1' } });
  const row = one('unpaid', {}, data).invoices.find(i => i.dueDate === '2026-04-01');
  assert.equal(row.occupant, null);
});

test('unit gives one unit, and a unit that is not here is simply not found', () => {
  const u = one('unit', { number: '101' });
  assert.equal(u.found, true); assert.equal(u.occupant, 'Abebe Test');
  assert.equal(u.monthlyRentEtb, 10000); assert.equal(u.contractEnd, '2026-10-15');
  assert.deepEqual(u.invoices.map(i => i.dueDate), ['2026-07-01', '2026-06-01', '2026-06-01']);
  assert.equal(u.openRepairs, 1);
  assert.deepEqual(one('unit', { number: '999' }), { found: false });
});

test('late_payers needs two late invoices in the window', () => {
  assert.deepEqual(one('late_payers', { months: 3 }).units, []);
  const four = one('late_payers', { months: 4 });
  assert.equal(four.from, '2026-06-01');
  assert.deepEqual(four.units.map(u => [u.unit, u.lateInvoices, u.averageDaysLate]), [['102', 2, 89], ['101', 2, 6]]);
});

test('vacant, contracts_ending and repairs', () => {
  assert.deepEqual(one('vacant').units, [{ number: '103', floor: 2, areaSqm: 60, monthlyRentEtb: 15000, vacantSince: '2026-05-31', enquiries: 2 }]);
  const c = one('contracts_ending', { days: 60 });
  assert.deepEqual(c.contracts, [{ unit: '101', occupant: 'Abebe Test', endDate: '2026-10-15' }]);
  assert.equal(one('contracts_ending', { days: 10 }).count, 0);
  const r = one('repairs');
  assert.deepEqual(r.repairs, [{ unit: '101', type: 'plumbing', status: 'OPEN', reported: '2026-09-01', resolved: null, assigned: true }]);
  assert.equal(one('repairs', { status: 'all' }).count, 2);
});

test('money: collected, expenses and VAT for a month', () => {
  assert.deepEqual(one('money', { month: '2026-07' }), { month: '2026-07', invoicedEtb: 30000, collectedEtb: 10000, expensesEtb: 7000,
    expensesByCategory: { generator: 5000, cleaning: 2000 }, vatRegistered: true, outputVatEtb: 4500, inputVatEtb: 750, netVatEtb: 3750,
    collectedMinusExpensesEtb: 3000, newestInvoice: '2026-07-01', newestPayment: '2026-07-03' });
});

test('VAT uses the same rate as the rest of the app', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, new RegExp('const VAT_RATE = ' + String(B.VAT_RATE).replace('.', '\\.') + ';'));
});

test('no tool output carries a phone number, an id or a private field', () => {
  const all = JSON.stringify(Object.keys(B.TOOLS).map(n => one(n, n === 'unit' ? { number: '101' } : { months: 12, days: 365, status: 'all' })));
  assert.doesNotMatch(all, /PLANTED|FAYDA|faydaId|"phone"|assignedTo/);
});

test('every tool has a definition, and every definition a tool', () => {
  assert.deepEqual(B.DEFS.map(d => d.function.name).sort(), Object.keys(B.TOOLS).sort());
  for (const d of B.DEFS) assert.equal(d.type, 'function');
});

test('the executor loads once per question, checks arguments, and never leaves the scope', async () => {
  const { calls, prisma } = fakePrisma();
  const run = B.makeExecutor({ prisma, now: () => NOW })({ buildingIds: ['b1'] });
  const a = await run('rent_month', { month: '2026-07' });
  const b = await run('vacant', {});
  assert.equal(calls.findMany, 6, 'one load (six queries) for two tool calls');
  assert.equal(a.buildings[0].building, 'Test Plaza');
  assert.equal(a.buildings[0].invoicedEtb, 30000);
  assert.equal(b.buildings[0].count, 1);
  assert.deepEqual(await run('rent_month', { month: 'July' }), { error: 'month must look like 2026-09' });
  assert.deepEqual(await run('drop_tables', {}), { error: 'unknown tool drop_tables' });
  assert.deepEqual(await run('overview', { building: 'somewhere else' }), { error: 'no such building for this owner' });
});

test('when the records cannot be loaded, the tool says so instead of throwing', async () => {
  const empty = async () => [];
  // Every model loadBuildings queries must be present, as a real Prisma client always has them --
  // only `building` fails, so Promise.all's argument array never throws while it is being built.
  const prisma = { building: { findMany: async () => { throw new Error('db down'); } },
    unit: { findMany: empty }, tenancy: { findMany: empty }, invoice: { findMany: empty },
    maintenanceRequest: { findMany: empty }, expense: { findMany: empty } };
  const run = B.makeExecutor({ prisma, now: () => NOW, warn: () => {} })({ buildingIds: ['b1'] });
  assert.deepEqual(await run('overview', {}), { error: 'records unavailable' });
});
