'use strict';
// Every total a building tool reports, checked by hand against a fixture. The tools are pure functions over
// loaded records; the only database access is the loader (tested separately). Where the owner dashboard
// shows the same figure, the test says which endpoint it must agree with.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const B = require('../../agents/owner/tools/building');
const { fixture, twoBuildings, fakePrisma, NOW } = require('./fixture');

const one = (name, args = {}, data = fixture(), now = NOW, ctx) => B.TOOLS[name](B.view(data, data.buildings[0]), args, now, ctx);
const inv = (id, tenancyId, unitId, due, amount, status, paid = null) => ({ id, tenancyId, type: 'RENT', amount, lateFee: 0,
  dueDate: new Date(due), paidDate: paid ? new Date(paid) : null, daysLate: 0, status, tenancy: { unitId } });

test('data_health says what is recorded and what is missing', () => {
  assert.deepEqual(one('data_health'), { units: 3, activeTenancies: 2, invoices: 6, invoicesPaid: 3,
    rentMonthsWithoutInvoices: ['2026-09', '2026-08'], expensesRecorded: 2, openRepairs: 1, openRepairsAll: 2,
    contractsExpiredStillActive: 1, floorDataMissing: false, newestInvoice: '2026-07-01', newestPayment: '2026-07-03' });
});

test('floor lists a floor as the Tenants tab does: number, status, tenant, contract end, rent', () => {
  const f1 = one('floor', { floor: '1' });
  assert.deepEqual(f1, { floor: 1, floorAm: '1ኛ ፎቅ', floorEn: 'floor 1', count: 2, occupied: 2, vacant: 0, floorsInRecords: [1, 2], units: [
    { number: '101', status: 'OCCUPIED', occupant: 'Abebe Test', contractEnd: '2026-10-15', monthlyRentEtb: 10000, areaSqm: 40, type: 'SHOP' },
    { number: '102', status: 'OCCUPIED', occupant: 'Test Cafe', contractEnd: '2026-08-31', monthlyRentEtb: 20000, areaSqm: 80, type: 'SHOP' }] });
  const f2 = one('floor', { floor: '2ፎቅ' });
  assert.deepEqual(f2.units, [{ number: '103', status: 'VACANT', occupant: null, contractEnd: null, monthlyRentEtb: 15000, areaSqm: 60, type: 'OFFICE' }]);
  assert.equal(f2.vacant, 1);
  const ground = one('floor', { floor: 'ግራውንድ' });
  assert.equal(ground.floor, 0); assert.equal(ground.count, 0);
  assert.equal(ground.floorAm, 'ምድር ቤት (ግራውንድ)'); assert.equal(ground.floorEn, 'ground floor');
  assert.equal(one('floor', { floor: 'B1' }).floorEn, 'basement 1'); assert.deepEqual(ground.floorsInRecords, [1, 2], 'an empty floor says which floors have units');
  assert.deepEqual(one('floor', { floor: 'the roof garden' }), { understood: false, floorsInRecords: [1, 2], units: [] });
});

test('floor words the model will pass: numbers, ordinals, ground and basement, in Amharic and English', () => {
  const cases = [[2, 2], ['2', 2], ['2ፎቅ', 2], ['2ኛ ፎቅ', 2], ['floor 2', 2], ['F2', 2], ['2nd', 2], ['ሁለተኛ ፎቅ', 2], ['ሦስተኛ', 3], ['third floor', 3],
    ['ground', 0], ['Ground floor', 0], ['G', 0], ['ግራውንድ', 0], ['ምድር ቤት', 0], ['0', 0], ['basement', -1], ['B1', -1], ['ከርሰ ምድር', -1],
    ['አሥረኛ', 10], ['', null], ['roof', null], [null, null]];
  for (const [input, want] of cases) assert.equal(B.parseFloor(input), want, JSON.stringify(input));
});

test('a building whose units were all left on floor 0 says floor data is missing, and data_health says so too', () => {
  const data = fixture();
  data.buildings[0].floors = 5;
  for (const u of data.units) u.floor = 0;
  assert.deepEqual(one('floor', { floor: '2' }, data), { floor: 2, floorDataMissing: true, floorsInRecords: [0], units: [] });
  assert.equal(one('floor', { floor: 'ground' }, data).floorDataMissing, true, 'not "every unit is on the ground floor"');
  assert.equal(one('data_health', {}, data).floorDataMissing, true);
  data.buildings[0].floors = 1;
  assert.equal(one('data_health', {}, data).floorDataMissing, false, 'a one-storey building really is all ground floor');
  assert.equal(one('floor', { floor: 'ground' }, data).count, 3);
});

// A shop with an Amharic name written with ሠ, as people write it; the owner types ሰ.
function withAmharicShop() {
  const data = fixture();
  data.units[1].tenancies[0].shop = { name: 'Selam Test Printing', nameAm: 'የሠላም ቴስት ማተሚያ' };
  return data;
}
const find = (name, question, data = withAmharicShop()) => one('find_tenant', { name }, data, NOW, { question });
const oneCtx = (name, args, data, now, ctx) => B.TOOLS[name](B.view(data, data.buildings[0]), args, now, ctx);

test('find_tenant finds a tenant by the name the owner typed: letter variants, prefixes, case, part of a name, the person', () => {
  const am = find('ሰላም ቴስት', 'እሺ ሰላም ቴስት ስንተኛ ፎቅ ነው');
  assert.equal(am.found, true); assert.equal(am.count, 1);
  assert.deepEqual(am.matches, [{ unit: '102', floor: 1, floorAm: '1ኛ ፎቅ', floorEn: 'floor 1', occupant: 'የሠላም ቴስት ማተሚያ', status: 'OCCUPIED', contractEnd: '2026-08-31',
    monthlyRentEtb: 20000, match: 'name contains the words', matchedOn: 'business' }]);
  assert.equal(find('ሰላም ቴስት ማተሚያ', 'የሰላም ቴስት ማተሚያ የት ነው?').matches[0].unit, '102', 'the የ prefix and the stem still match');
  assert.equal(find('ሠላሞች', 'ሠላሞች ስንተኛ ፎቅ ናቸው').matches[0].unit, '102', 'a suffix on an Amharic word keeps its stem');
  assert.equal(find('selam test printing', 'Where is selam test printing?').matches[0].match, 'same name');
  const person = find('ABEBE', 'which floor is ABEBE on');
  assert.deepEqual(person.matches.map(m => [m.unit, m.matchedOn]), [['101', 'person']]);
  const cafe = one('find_tenant', { name: 'test cafe' }, fixture(), NOW, { question: 'Where is Test-Cafe?' });
  assert.equal(cafe.matches[0].unit, '102');
  const both = one('find_tenant', { name: 'Test' }, fixture(), NOW, { question: 'Test' });
  assert.deepEqual(both.matches.map(m => m.unit), ['101', '102'], 'a word two tenants share finds both');
  assert.deepEqual(find('ዳዊት', 'ዳዊት የት ነው'), { found: false, count: 0, matches: [], truncated: false });
});

test('find_tenant only searches words the owner typed in this message', () => {
  assert.deepEqual(find('Test Cafe', 'which floor is the cafe of my cousin on?'), { error: 'copy the name exactly as the owner wrote it in this message' });
  assert.deepEqual(find('ሰላም', ''), { error: 'copy the name exactly as the owner wrote it in this message' });
  assert.deepEqual(oneCtx('find_tenant', { name: 'Abebe' }, fixture(), NOW, undefined), { error: 'copy the name exactly as the owner wrote it in this message' });
  assert.deepEqual(find('', 'where?'), { error: 'name required' });
  assert.equal(B.typedByOwner('ሠላም', 'ሰላም የት ነው'), true, 'a folded letter is still what the owner typed');
  assert.equal(B.typedByOwner('Selam', 'ሰላም የት ነው'), false, 'a transliteration is not');
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
  assert.equal(u.newestInvoice, '2026-07-01'); assert.equal(u.newestPayment, '2026-07-03');
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

test('the executor never hands the model a tenant or shop name: occupants become tokens it can map back', async () => {
  const run = B.makeExecutor({ prisma: fakePrisma().prisma, now: () => NOW })({ buildingIds: ['b1'] });
  assert.ok(run.names instanceof Map);
  assert.equal(run.names.size, 0);
  const unpaid = (await run('unpaid', {})).buildings[0];
  assert.deepEqual(unpaid.invoices.map(i => [i.unit, i.occupant]), [['102', '[[P1]]'], ['101', '[[P2]]'], ['102', '[[P1]]']]);
  const unit = (await run('unit', { number: '101' })).buildings[0];
  assert.equal(unit.occupant, '[[P2]]', 'the same tenant keeps the same token for the whole question');
  const late = (await run('late_payers', { months: 4 })).buildings[0];
  assert.deepEqual(late.units.map(x => [x.unit, x.occupant]), [['102', '[[P1]]'], ['101', '[[P2]]']]);
  const ending = (await run('contracts_ending', { days: 60 })).buildings[0];
  assert.deepEqual(ending.ending.map(x => [x.unit, x.occupant]), [['101', '[[P2]]']]);
  assert.deepEqual(ending.expired.map(x => [x.unit, x.occupant]), [['102', '[[P1]]']]);
  assert.deepEqual([...run.names], [['[[P1]]', 'Test Cafe'], ['[[P2]]', 'Abebe Test']]);
  const everything = [];
  for (const n of Object.keys(B.TOOLS)) everything.push(await run(n, n === 'unit' ? { number: '101' } : { months: 12, days: 365, status: 'all' }));
  everything.push(await run('unit', { number: '102' }), await run('unpaid', { month: '2026-06' }));
  assert.doesNotMatch(JSON.stringify(everything), /Abebe|Test Cafe|Owner Of Cafe/);
  assert.equal(run.names.size, 2);
  const fresh = B.makeExecutor({ prisma: fakePrisma().prisma, now: () => NOW })({ buildingIds: ['b1'] });
  assert.equal(fresh.names.size, 0, 'each question starts with no tokens');
  // a second building's tenant gets a token of its own
  const both = B.makeExecutor({ prisma: fakePrisma(twoBuildings()).prisma, now: () => NOW })({ buildingIds: ['b1', 'b2'] });
  const units = (await both('unit', { number: '101' })).buildings.map(b => b.occupant);
  assert.deepEqual(units, ['[[P1]]', '[[P2]]']);
  assert.deepEqual([...both.names.values()], ['Abebe Test', 'Annex Tenant']);
});

test('floor and find_tenant hand the model tokens, never the names they searched or listed', async () => {
  const data = withAmharicShop();
  const question = 'እሺ ሰላም ቴስት ስንተኛ ፎቅ ነው፤ 1ኛ ፎቅ ላይ ያሉትስ?';
  const run = B.makeExecutor({ prisma: fakePrisma(data).prisma, now: () => NOW })({ buildingIds: ['b1'] }, { question });
  const found = (await run('find_tenant', { name: 'ሰላም ቴስት' })).buildings[0];
  assert.deepEqual(found.matches.map(m => [m.unit, m.floor, m.occupant]), [['102', 1, '[[P1]]']]);
  const floor = (await run('floor', { floor: '1ኛ ፎቅ' })).buildings[0];
  assert.deepEqual(floor.units.map(u => [u.number, u.occupant]), [['101', '[[P2]]'], ['102', '[[P1]]']]);
  const sent = JSON.stringify([found, floor]);
  assert.doesNotMatch(sent, /Abebe|Selam|Printing|Owner Of Cafe|ሠላም|ሰላም|ማተሚያ/);
  assert.deepEqual([...run.names], [['[[P1]]', 'የሠላም ቴስት ማተሚያ'], ['[[P2]]', 'Abebe Test']]);
  // the model searching a name the owner never typed learns nothing, not even whether it exists
  const probe = await run('find_tenant', { name: 'Abebe' });
  assert.deepEqual(probe.buildings[0], { building: 'Test Plaza', buildingAm: 'ቴስት ፕላዛ', error: 'copy the name exactly as the owner wrote it in this message' });
  const noQuestion = B.makeExecutor({ prisma: fakePrisma(data).prisma, now: () => NOW })({ buildingIds: ['b1'] });
  assert.match((await noQuestion('find_tenant', { name: 'ሰላም' })).buildings[0].error, /copy the name/);
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
  // names reach the model as short tokens, so a long unit number is what makes these rows long
  data.units[0].number = 'A-DELIBERATELY-LONG-UNIT-NUMBER-FOR-THE-SIZE-CHECK';
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
