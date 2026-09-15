'use strict';
// Monthly rent invoices. On 1 Aug and 1 Sep 2026 the cron stopped part-way: a random payment code clashed with an
// existing one (Invoice.paymentCode is unique), Prisma threw P2002, and one try/catch around every building ended
// the run. Darulle, last in the order, got nothing after July. Over a fake Prisma: no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { generateInvoicesForBuilding, planInvoicesForBuilding, runMonthlyInvoices, addisMonth, monthWhen, MAX_CODE_TRIES } = require('../../building/invoices');

function fakePrisma({ buildings = [], tenancies = [], invoices = [], failBuilding = null } = {}) {
  const db = { invoices: invoices.slice(), creates: 0 };
  return {
    db,
    building: { findMany: async () => buildings.map(b => ({ id: b.id, name: b.name })) },
    tenancy: {
      findMany: async ({ where }) => {
        if (where.unit.buildingId === failBuilding) throw new Error('db timeout');
        return tenancies.filter(t => t.active && t.unit.buildingId === where.unit.buildingId);
      },
    },
    invoice: {
      findFirst: async ({ where }) => db.invoices.find(i => i.tenancyId === where.tenancyId && i.type === where.type
        && i.dueDate >= where.dueDate.gte && i.dueDate < where.dueDate.lt) || null,
      create: async ({ data }) => {
        db.creates++;
        if (db.invoices.some(i => i.paymentCode === data.paymentCode)) {
          const e = new Error('Unique constraint failed on the fields: (`paymentCode`)'); e.code = 'P2002'; throw e;
        }
        db.invoices.push(data); return data;
      },
    },
  };
}
const seq = values => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const T = (id, buildingId, number, { contractRent = null, unitRent = 5000, active = true } = {}) =>
  ({ id, active, unit: { buildingId, number, monthlyRent: unitRent }, contract: contractRent == null ? null : { monthlyRent: contractRent } });
const OCT1 = new Date('2026-10-01T03:00:00Z');   // 06:00 Addis on 1 October, when the cron runs

test('one RENT invoice per active tenancy, due on the 5th, from the contract rent or else the unit rent', async () => {
  const p = fakePrisma({ tenancies: [T('t1', 'b1', '101', { contractRent: 12000 }), T('t2', 'b1', 'G-02', { unitRent: 8000 }), T('t3', 'b1', '103', { active: false })] });
  const r = await generateInvoicesForBuilding(p, 'b1', OCT1);
  assert.deepEqual(r, { created: 2, skipped: 0, month: '10/2026' });
  assert.deepEqual(p.db.invoices.map(i => [i.tenancyId, i.amount, i.type, i.status, i.dueDate.toISOString()]),
    [['t1', 12000, 'RENT', 'PENDING', '2026-10-05T00:00:00.000Z'], ['t2', 8000, 'RENT', 'PENDING', '2026-10-05T00:00:00.000Z']]);
  assert.match(p.db.invoices[1].paymentCode, /^BS-\d{4}-G02$/);
});

test('a tenancy that already has this month’s rent invoice is skipped', async () => {
  const p = fakePrisma({ tenancies: [T('t1', 'b1', '101')], invoices: [{ tenancyId: 't1', type: 'RENT', dueDate: new Date('2026-10-05T00:00:00Z'), paymentCode: 'BS-2222-101' }] });
  assert.deepEqual(await generateInvoicesForBuilding(p, 'b1', OCT1), { created: 0, skipped: 1, month: '10/2026' });
});

test('a payment code that clashes with an existing one draws a new code instead of failing', async () => {
  const p = fakePrisma({ tenancies: [T('t1', 'b1', '101')],
    invoices: [{ tenancyId: 'other-building', type: 'RENT', dueDate: new Date('2026-08-05T00:00:00Z'), paymentCode: 'BS-1000-101' }] });
  const r = await generateInvoicesForBuilding(p, 'b1', OCT1, { rand: seq([0, 0.5]) });
  assert.equal(r.created, 1);
  assert.equal(p.db.invoices[1].paymentCode, 'BS-5500-101');
  assert.equal(p.db.creates, 2);
});

test('it gives up after MAX_CODE_TRIES clashes and reports the database error', async () => {
  const p = fakePrisma({ tenancies: [T('t1', 'b1', '101')],
    invoices: [{ tenancyId: 'x', type: 'RENT', dueDate: new Date('2026-08-05T00:00:00Z'), paymentCode: 'BS-1000-101' }] });
  await assert.rejects(generateInvoicesForBuilding(p, 'b1', OCT1, { rand: () => 0 }), e => e.code === 'P2002');
  assert.equal(p.db.creates, MAX_CODE_TRIES);
});

test('the plan behind the generator: who gets an invoice this month, who already has one, and for how much', async () => {
  const p = fakePrisma({ tenancies: [T('t1', 'b1', '101', { contractRent: 12000 }), T('t2', 'b1', '102', { unitRent: 8000 })],
    invoices: [{ tenancyId: 't2', type: 'RENT', dueDate: new Date('2026-10-05T00:00:00Z'), paymentCode: 'BS-2222-102' }] });
  const plan = await planInvoicesForBuilding(p, 'b1', OCT1);
  assert.deepEqual(plan.create, [{ tenancyId: 't1', unit: '101', amount: 12000 }]);
  assert.deepEqual(plan.skip, [{ tenancyId: 't2', unit: '102', amount: 8000 }]);
  assert.equal(plan.month, '10/2026');
  assert.equal(plan.dueDate.toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(p.db.creates, 0, 'a plan writes nothing');
});

test('a month name becomes a moment inside that Addis month, and nothing else is accepted', () => {
  assert.deepEqual(addisMonth(monthWhen('2026-10')), { y: 2026, m: 9 });
  assert.deepEqual(addisMonth(monthWhen('2026-01')), { y: 2026, m: 0 });
  assert.throws(() => monthWhen('2026-13'), /month must look like/);
  assert.throws(() => monthWhen('October'), /month must look like/);
});

test('the month is Addis Ababa’s: 22:30 UTC on 30 September is already October', () => {
  assert.deepEqual(addisMonth(new Date('2026-09-30T22:30:00Z')), { y: 2026, m: 9 });
  assert.deepEqual(addisMonth(new Date('2026-09-30T20:59:00Z')), { y: 2026, m: 8 });
});

test('one building failing does not stop the buildings after it', async () => {
  const logs = [];
  const p = fakePrisma({ buildings: [{ id: 'b1', name: 'Demo A' }, { id: 'b2', name: 'Demo B' }, { id: 'b3', name: 'Demo C' }],
    tenancies: [T('t1', 'b1', '1'), T('t2', 'b2', '1'), T('t3', 'b3', '1')], failBuilding: 'b2' });
  const r = await runMonthlyInvoices(p, { when: OCT1, log: m => logs.push(m) });
  assert.deepEqual(r.ok.map(x => [x.name, x.created]), [['Demo A', 1], ['Demo C', 1]]);
  assert.deepEqual(r.failed, [{ name: 'Demo B', error: 'db timeout' }]);
  assert.ok(logs.some(l => /invoice error Demo B: db timeout/.test(l)));
});

test('server.js uses the module: the route delegates and the cron runs each building on its own', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, /const invoiceGen = require\('\.\/building\/invoices'\);/);
  assert.match(src, /return invoiceGen\.generateInvoicesForBuilding\(prisma, buildingId, when\);/);
  const at = src.indexOf("cron.schedule('0 6 1 * *'");
  assert.ok(at > 0, 'monthly cron missing');
  const body = src.slice(at, src.indexOf('{ timezone', at));
  assert.match(body, /invoiceGen\.runMonthlyInvoices\(prisma, \{ log: m => console\.log\(m\) \}\)/);
  assert.doesNotMatch(body, /for \(const b of buildings\)/);
  assert.match(body, /notifyAdmins\(/);
});
