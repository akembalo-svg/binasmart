'use strict';
// Checks the owner tools against the database for one building: every total a tool reports must equal the
// same total counted directly with Prisma, and no tenant or shop name may appear in what the tools hand the
// model (names travel as tokens such as [[P1]]). Prints numbers only — never a name — and exits 1 on a mismatch.
//   node ops/owner/check-tools.js <qrSlug>      (a demo building; nothing leaves the server)
const { PrismaClient } = require('@prisma/client');
const { makeExecutor } = require('../../agents/owner/tools/building');
const p = new PrismaClient();

(async () => {
  const slug = process.argv[2];
  const b = slug && await p.building.findUnique({ where: { qrSlug: slug }, select: { id: true } });
  if (!b) { console.log('usage: node ops/owner/check-tools.js <qrSlug> (building not found)'); await p.$disconnect(); process.exit(1); }
  const run = makeExecutor({ prisma: p })({ buildingIds: [b.id] });
  const inBuilding = { tenancy: { unit: { buildingId: b.id } } };
  let bad = 0;
  const check = (label, got, want) => { const ok = got === want; if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + label + ': tool ' + got + ' · database ' + want); };

  const health = (await run('data_health', {})).buildings[0];
  check('units', health.units, await p.unit.count({ where: { buildingId: b.id } }));
  const overview = (await run('overview', {})).buildings[0];
  const occupied = await p.unit.count({ where: { buildingId: b.id, status: 'OCCUPIED' } });
  check('occupied', overview.occupied, occupied);
  // vacant = not OCCUPIED, as /api/owner/:slug/overview
  check('vacant', (await run('vacant', {})).buildings[0].count, await p.unit.count({ where: { buildingId: b.id, status: { not: 'OCCUPIED' } } }));

  // rent_month follows the dashboard: every invoice due in the month, every status (CANCELLED included);
  // paid = PAID, unpaid = not PAID, cancelledCount beside it.
  const dues = await p.invoice.findMany({ where: inBuilding, select: { dueDate: true } });
  const months = [...new Set(dues.map(x => x.dueDate.toISOString().slice(0, 7)))].sort().slice(-6);
  for (const m of months) {
    const [y, mo] = m.split('-').map(Number);
    const dueDate = { gte: new Date(Date.UTC(y, mo - 1, 1)), lt: new Date(Date.UTC(y, mo, 1)) };
    const all = await p.invoice.aggregate({ _sum: { amount: true }, _count: true, where: { ...inBuilding, dueDate } });
    const paid = await p.invoice.aggregate({ _sum: { amount: true }, _count: true, where: { ...inBuilding, dueDate, status: 'PAID' } });
    const unpaid = await p.invoice.aggregate({ _sum: { amount: true }, _count: true, where: { ...inBuilding, dueDate, status: { not: 'PAID' } } });
    const cancelled = await p.invoice.count({ where: { ...inBuilding, dueDate, status: 'CANCELLED' } });
    const r = (await run('rent_month', { month: m })).buildings[0];
    check(m + ' invoices', r.invoices, all._count);
    check(m + ' invoiced ETB', r.invoicedEtb, all._sum.amount || 0);
    check(m + ' paid', r.paidCount, paid._count);
    check(m + ' paid ETB', r.paidEtb, paid._sum.amount || 0);
    check(m + ' unpaid ETB', r.unpaidEtb, unpaid._sum.amount || 0);
    check(m + ' cancelled', r.cancelledCount, cancelled);
  }

  // floor: units per floor equal the database's count per Unit.floor (what the Tenants tab lists)
  const perFloor = await p.unit.groupBy({ by: ['floor'], where: { buildingId: b.id }, _count: { _all: true } });
  for (const g of perFloor.sort((x, y) => x.floor - y.floor))
    check('floor ' + g.floor + ' units', (await run('floor', { floor: String(g.floor) })).buildings[0].count, g._count._all);
  console.log('     floor data missing: ' + (await run('data_health', {})).buildings[0].floorDataMissing);

  const outputs = [];
  for (const name of ['data_health', 'overview', 'rent_month', 'unpaid', 'late_payers', 'vacant', 'contracts_ending', 'repairs', 'money'])
    outputs.push(JSON.stringify(await run(name, { months: 12, days: 365, status: 'all' })));
  for (const g of perFloor) outputs.push(JSON.stringify(await run('floor', { floor: String(g.floor) })));
  const units = await p.unit.findMany({ where: { buildingId: b.id }, select: { number: true } });
  for (const u of units) outputs.push(JSON.stringify(await run('unit', { number: String(u.number) })));
  const text = outputs.join(' ');
  const phones = text.match(/(\+?251|\b0)9\d{8}\b/g);
  check('phone-shaped strings in tool output', phones ? phones.length : 0, 0);

  // Names of the people and shops in the building's active tenancies: held here, never printed.
  const tenancies = await p.tenancy.findMany({ where: { active: true, unit: { buildingId: b.id } },
    select: { user: { select: { fullName: true } }, shop: { select: { name: true, nameAm: true } } } });
  const names = new Set();
  for (const t of tenancies) for (const n of [t.user && t.user.fullName, t.shop && t.shop.name, t.shop && t.shop.nameAm])
    if (n && String(n).trim().length >= 3) names.add(String(n).trim());
  // find_tenant: every tenant is found by its own name typed as the question, and the result carries no name
  let found = 0, searched = 0;
  const finds = [];
  for (const n of names) {
    const r = await makeExecutor({ prisma: p })({ buildingIds: [b.id] }, { question: n })('find_tenant', { name: n });
    searched++;
    if (r.buildings[0].found) found++;
    finds.push(JSON.stringify(r));
  }
  check('tenants found by their own name', found, searched);
  const findText = finds.join(' ');
  let leaks = 0;
  for (const n of names) if (text.includes(n) || findText.includes(n)) leaks++;
  console.log('     names checked: ' + names.size + ' · tokens in output: ' + new Set(text.match(/\[\[P\d+\]\]/g) || []).size);
  check('occupant names in tool output', leaks, 0);

  await p.$disconnect();
  process.exit(bad ? 1 : 0);
})();
