'use strict';
// Every total a building tool reports, checked by hand against a fixture. The tools are pure functions over
// loaded records; the only database access is the loader (tested separately). Where the owner dashboard
// shows the same figure, the test says which endpoint it must agree with.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const B = require('../../agents/owner/tools/building');
const { fixture, twoBuildings, fakePrisma, NOW } = require('./fixture');

const one = (name, args = {}, data = fixture(), now = NOW) => B.TOOLS[name](B.view(data, data.buildings[0]), args, now);
const inv = (id, tenancyId, unitId, due, amount, status, paid = null) => ({ id, tenancyId, type: 'RENT', amount, lateFee: 0,
  dueDate: new Date(due), paidDate: paid ? new Date(paid) : null, daysLate: 0, status, tenancy: { unitId } });

test('data_health says what is recorded and what is missing', () => {
  assert.deepEqual(one('data_health'), { units: 3, activeTenancies: 2, invoices: 6, invoicesPaid: 3,
    rentMonthsWithoutInvoices: ['2026-09', '2026-08'], expensesRecorded: 2, openRepairs: 1, openRepairsAll: 2,
    contractsExpiredStillActive: 1, newestInvoice: '2026-07-01', newestPayment: '2026-07-03' });
});

test('data_health does not call this month missing before its rent falls due on the 5th', () => {
  assert.deepEqual(one('data_health', {}, fixture(), new Date('2026-09-03T12:00:00Z')).rentMonthsWithoutInvoices, ['2026-08']);
  assert.deepEqual(one('data_health', {}, fixture(), new Date('2026-09-06T12:00:00Z')).rentMonthsWithoutInvoices, ['2026-09', '2026-08']);
});

test('overview agrees with /overview: expected rent of occupied units, vacant = units - occupied, open repairs', () => {
  assert.deepEqual(one('overview'), { units: 3, occupied: 2, vacant: 1, otherStatus: 0, expectedMonthlyRentEtb: 30000,
    rentIfAllLetEtb: 45000, openRepairs: 1, openRepairsAll: 2, newestInvoice: '2026-07-01', newestPayment: '2026-07-03' });
  const data = fixture();
  data.units[2].status = 'RESERVED';
  const o = one('overview', {}, data);
  assert.equal(o.vacant, 1, 'the dashboard counts every unit that is not occupied as vacant');
  assert.equal(o.otherStatus, 1);
});

test('rent_month counts a month the way /overview does, cancelled invoices included and counted', () => {
  const july = one('rent_month', { month: '2026-07' });
  assert.equal(july.invoices, 2); assert.equal(july.invoicedEtb, 30000);
  assert.equal(july.paidCount, 1); assert.equal(july.paidEtb, 10000);
  assert.equal(july.unpaidCount, 1); assert.equal(july.unpaidEtb, 20000);
  assert.equal(july.overdueCount, 1); assert.equal(july.overdueEtb, 20000);
  assert.equal(july.cancelledCount, 0);
  const june = one('rent_month', { month: '2026-06' });
  assert.equal(june.invoices, 3); assert.equal(june.invoicedEtb, 40000, '/overview and /accounting sum every status');
  assert.equal(june.unpaidEtb, 30000, '/overview outstanding = every invoice not PAID');
  assert.equal(june.cancelledCount, 1);
  const september = one('rent_month', {});
  assert.equal(september.month, '2026-09'); assert.equal(september.invoices, 0);
});

test('unpaid lists the oldest first, with who owes it and what is already overdue', () => {
  const u = one('unpaid');
  assert.equal(u.count, 3); assert.equal(u.totalEtb, 50000);
  assert.equal(u.overdueCount, 3); assert.equal(u.overdueEtb, 50000);
  assert.deepEqual(u.invoices.map(i => [i.unit, i.occupant, i.amountEtb, i.dueDate, i.daysLate, i.status]),
    [['102', 'Test Cafe', 20000, '2026-06-01', 104, 'OVERDUE'], ['101', 'Abebe Test', 10000, '2026-06-01', 104, 'CANCELLED'],
     ['102', 'Test Cafe', 20000, '2026-07-01', 74, 'PENDING']]);
  assert.equal(one('unpaid', { month: '2026-07' }).count, 1);
  const data = fixture();
  data.invoices.push(inv('i8', 't1', 'u1', '2026-09-20T00:00:00Z', 10000, 'PENDING'));
  const later = one('unpaid', {}, data);
  assert.equal(later.count, 4); assert.equal(later.totalEtb, 60000);
  assert.equal(later.overdueCount, 3, 'an invoice not yet due is unpaid but not overdue'); assert.equal(later.overdueEtb, 50000);
});

test('an invoice from a former tenancy names nobody', () => {
  const data = fixture();
  data.invoices.push(inv('i7', 'old', 'u1', '2026-04-01T00:00:00Z', 5000, 'OVERDUE'));
  const row = one('unpaid', {}, data).invoices.find(i => i.dueDate === '2026-04-01');
  assert.equal(row.occupant, null);
});

test('unit gives one unit with its contract dates from the Contract, and a unit that is not here is simply not found', () => {
  const u = one('unit', { number: '101' });
  assert.equal(u.found, true); assert.equal(u.occupant, 'Abebe Test');
  assert.equal(u.monthlyRentEtb, 10000); assert.equal(u.contractRentEtb, 10000);
  assert.equal(u.contractStart, '2025-10-16'); assert.equal(u.contractEnd, '2026-10-15');
  assert.deepEqual(u.invoices.map(i => i.dueDate), ['2026-07-01', '2026-06-01', '2026-06-01']);
  assert.equal(u.openRepairs, 1);
  assert.deepEqual(one('unit', { number: '999' }), { found: false });
  const data = fixture();
  data.units[0].tenancies[0].contract = null;
  data.units[0].tenancies[0].endDate = new Date('2026-12-31T00:00:00Z');
  const bare = one('unit', { number: '101' }, data);
  assert.equal(bare.contractEnd, '2026-12-31'); assert.equal(bare.contractStart, '2025-10-16'); assert.equal(bare.contractRentEtb, null);
});

test('late_payers needs two late invoices in the window, and a paid invoice is as late as its paidDate says', () => {
  assert.deepEqual(one('late_payers', { months: 3 }).units, []);
  const four = one('late_payers', { months: 4 });
  assert.equal(four.from, '2026-06-01');
  // 101 paid 2 and 9 days late with daysLate 0 on both rows: only paidDate - dueDate can find that
  assert.deepEqual(four.units.map(u => [u.unit, u.lateInvoices, u.averageDaysLate]), [['102', 2, 89], ['101', 2, 6]]);
});

test('late_payers ignores invoices that are not due yet', () => {
  const data = fixture();
  data.invoices.push(inv('j1', 't2', 'u2', '2026-09-01T00:00:00Z', 20000, 'OVERDUE'),
    inv('j2', 't2', 'u2', '2026-09-05T00:00:00Z', 20000, 'OVERDUE'),
    inv('j3', 't2', 'u2', '2026-09-20T00:00:00Z', 20000, 'PENDING'));
  assert.deepEqual(one('late_payers', { months: 1 }, data).units.map(u => [u.unit, u.lateInvoices, u.ofInvoices, u.averageDaysLate]),
    [['102', 2, 2, 10]]);
});

test('vacant lists every unit that is not occupied, as the dashboard counts them', () => {
  assert.deepEqual(one('vacant').units, [{ number: '103', floor: 2, areaSqm: 60, monthlyRentEtb: 15000, status: 'VACANT', vacantSince: '2026-05-31', enquiries: 2 }]);
});

test('contracts_ending reads Contract.endDate: ending within N days, and expired but still active', () => {
  const c = one('contracts_ending', { days: 60 });
  assert.equal(c.endingCount, 1);
  assert.deepEqual(c.ending, [{ unit: '101', occupant: 'Abebe Test', endDate: '2026-10-15' }]);
  assert.equal(c.expiredCount, 1);
  assert.deepEqual(c.expired, [{ unit: '102', occupant: 'Test Cafe', endDate: '2026-08-31' }]);
  const ten = one('contracts_ending', { days: 10 });
  assert.equal(ten.endingCount, 0); assert.deepEqual(ten.ending, [], 'a contract that already ended is not "ending"');
  assert.equal(ten.expiredCount, 1);
});

test('repairs: open first by date, types reduced to the QR form categories', () => {
  const r = one('repairs');
  assert.equal(r.count, 2);
  assert.deepEqual(r.repairs, [
    { unit: null, type: 'OTHER', status: 'ASSIGNED', reported: '2026-09-05', resolved: null, assigned: false },
    { unit: '101', type: 'PLUMBING', status: 'OPEN', reported: '2026-09-01', resolved: null, assigned: true }]);
  const all = one('repairs', { status: 'all' });
  assert.equal(all.count, 3);
  for (const x of all.repairs) assert.ok(['PLUMBING', 'ELECTRIC', 'LIFT', 'CLEANING', 'SECURITY', 'GENERAL', 'OTHER'].includes(x.type), x.type);
  assert.doesNotMatch(JSON.stringify(all), /PLANTED|call me/);
});

test('money: collected, expenses and VAT for a month, as /accounting computes them', () => {
  assert.deepEqual(one('money', { month: '2026-07' }), { month: '2026-07', invoicedEtb: 30000, collectedEtb: 10000, outstandingEtb: 20000,
    cancelledCount: 0, expensesEtb: 7000, expensesByCategory: { generator: 5000, cleaning: 2000 }, vatRegistered: true,
    outputVatEtb: 4500, inputVatEtb: 750, netVatEtb: 3750, collectedMinusExpensesEtb: 3000, newestInvoice: '2026-07-01', newestPayment: '2026-07-03' });
});

test('money counts a cancelled invoice as /accounting does, and says how many there are', () => {
  const june = one('money', { month: '2026-06' });
  assert.equal(june.invoicedEtb, 40000); assert.equal(june.collectedEtb, 10000); assert.equal(june.outstandingEtb, 30000);
  assert.equal(june.cancelledCount, 1); assert.equal(june.outputVatEtb, 6000);
});

test('money: VAT-inclusive rent carries its VAT inside, an unregistered building none', () => {
  const data = fixture();
  data.buildings[0].vatInclusive = true;
  const incl = one('money', { month: '2026-07' }, data);
  assert.equal(incl.outputVatEtb, 3913); assert.equal(incl.netVatEtb, 3163);
  data.buildings[0].vatRegistered = false;
  const none = one('money', { month: '2026-07' }, data);
  assert.equal(none.outputVatEtb, 0); assert.equal(none.inputVatEtb, 0); assert.equal(none.netVatEtb, 0);
});

test('VAT uses the same rate as the rest of the app', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, new RegExp('const VAT_RATE = ' + String(B.VAT_RATE).replace('.', '\\.') + ';'));
});

test('each building keeps its own units, invoices, repairs, expenses and ended tenancies', () => {
  const data = twoBuildings();
  const [v1, v2] = data.buildings.map(b => B.view(data, b));
  const shape = v => [v.units.length, v.invoices.length, v.repairs.length, v.expenses.length, v.ended.length];
  assert.deepEqual(shape(v1), [3, 6, 3, 2, 1]);
  assert.deepEqual(shape(v2), [2, 1, 2, 1, 1]);
  assert.deepEqual(v2.invoices.map(i => i.id), ['i9']);
  assert.deepEqual(v2.repairs.map(r => r.type), ['ELECTRIC', 'CLEANING']);
  assert.deepEqual(v2.ended.map(t => t.unitId), ['u8']);
  assert.equal(B.TOOLS.unit(v2, { number: '101' }, NOW).occupant, 'Annex Tenant', 'unit 101 of the annex is not unit 101 of the plaza');
  assert.equal(B.TOOLS.overview(v2, {}, NOW).openRepairs, 1);
  assert.equal(B.TOOLS.money(v2, { month: '2026-07' }, NOW).expensesEtb, 3000);
});

test('no tool output carries a phone number, an id, a free-text type or a private field', () => {
  const all = JSON.stringify(Object.keys(B.TOOLS).map(n => one(n, n === 'unit' ? { number: '101' } : { months: 12, days: 365, status: 'all' })));
  assert.doesNotMatch(all, /PLANTED|FAYDA|faydaId|"phone"|assignedTo|call me/);
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
  assert.deepEqual(await run('money', { month: '2026-13' }), { error: 'month must look like 2026-09' });
  assert.deepEqual(await run('drop_tables', {}), { error: 'unknown tool drop_tables' });
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
    assert.deepEqual(await run(name, {}), { error: 'unknown tool ' + name });
  assert.deepEqual(await run('overview', { building: 'somewhere else' }), { error: 'no such building for this owner' });
});

test('a building is chosen by exact name first, and by part of a name only from three characters', async () => {
  const run = B.makeExecutor({ prisma: fakePrisma(twoBuildings()).prisma, now: () => NOW })({ buildingIds: ['b1', 'b2'] });
  const names = async building => {
    const r = await run('overview', building === undefined ? {} : { building });
    return r.error || r.buildings.map(x => x.building);
  };
  assert.deepEqual(await names(undefined), ['Test Plaza', 'Test Plaza Annex']);
  assert.deepEqual(await names('Test Plaza'), ['Test Plaza'], 'an exact name is not also a part of the other name');
  assert.deepEqual(await names('test-plaza-annex'), ['Test Plaza Annex']);
  assert.deepEqual(await names('ቴስት ፕላዛ'), ['Test Plaza']);
  assert.deepEqual(await names('annex'), ['Test Plaza Annex']);
  assert.deepEqual(await names('plaza'), ['Test Plaza', 'Test Plaza Annex']);
  assert.deepEqual(await names('an'), 'no such building for this owner');
  assert.deepEqual(await names('t'), 'no such building for this owner');
});

// callBini cuts every tool result at 6000 characters; a cut in the middle of JSON is unreadable.
function manyUnpaid(data, tenancyId, unitId, n) {
  for (let k = 0; k < n; k++)
    data.invoices.push(inv('m' + unitId + k, tenancyId, unitId, new Date(Date.UTC(2025, 0, 1 + k)).toISOString(), 1000, 'OVERDUE'));
}

test('a long answer is shortened to fit, keeping its totals, and says so', async () => {
  const data = fixture();
  data.units[0].tenancies[0].shop = { name: 'A Deliberately Long Shop Name For The Size Check', nameAm: null };
  manyUnpaid(data, 't1', 'u1', 200);
  const r = await B.makeExecutor({ prisma: fakePrisma(data).prisma, now: () => NOW })({ buildingIds: ['b1'] })('unpaid', {});
  assert.ok(JSON.stringify(r).length <= 5000, 'length ' + JSON.stringify(r).length);
  assert.equal(r.truncated, true);
  const b = r.buildings[0];
  assert.equal(b.count, 203); assert.equal(b.totalEtb, 250000); assert.equal(b.overdueCount, 203);
  assert.equal(b.newestInvoice, '2026-07-01');
  assert.ok(b.invoices.length > 0 && b.invoices.length < 40, 'rows ' + b.invoices.length);
  const small = await B.makeExecutor({ prisma: fakePrisma().prisma, now: () => NOW })({ buildingIds: ['b1'] })('unpaid', {});
  assert.equal(small.truncated, undefined, 'a short answer is left alone');
});

test('two buildings share the room, and neither disappears', async () => {
  const data = twoBuildings();
  data.units[0].tenancies[0].shop = { name: 'A Deliberately Long Shop Name For The Size Check', nameAm: null };
  manyUnpaid(data, 't1', 'u1', 200);
  manyUnpaid(data, 't9', 'u9', 200);
  const r = await B.makeExecutor({ prisma: fakePrisma(data).prisma, now: () => NOW })({ buildingIds: ['b1', 'b2'] })('unpaid', {});
  assert.ok(JSON.stringify(r).length <= 5000, 'length ' + JSON.stringify(r).length);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.buildings.map(b => [b.building, b.count, b.totalEtb]), [['Test Plaza', 203, 250000], ['Test Plaza Annex', 201, 207000]]);
  for (const b of r.buildings) assert.ok(b.invoices.length > 0, b.building + ' kept no rows');
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
