'use strict';
// Everything the owner agent may read about a building, in one scoped load per question.
//
// The select clauses below ARE the privacy allowlist. A field that is not selected here cannot reach a tool,
// and so cannot reach the model: no phone number, Fayda id, BinaScore, payment code, TIN, bank account or
// free-text description is ever selected. Add a field only together with a test that names it.
const DAY = 86400000;
const WINDOW_DAYS = 800; // a little over two years of invoices and expenses

async function loadBuildings(prisma, buildingIds, now = new Date()) {
  if (!Array.isArray(buildingIds) || !buildingIds.length) throw new Error('owner scope is empty');
  const ids = { in: buildingIds };
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const [buildings, units, ended, invoices, repairs, expenses] = await Promise.all([
    prisma.building.findMany({ where: { id: ids },
      select: { id: true, name: true, nameAm: true, qrSlug: true, vatRegistered: true, vatInclusive: true } }),
    prisma.unit.findMany({ where: { buildingId: ids },
      select: { id: true, buildingId: true, number: true, floor: true, areaSqm: true, monthlyRent: true, status: true, unitType: true,
        tenancies: { where: { active: true },
          select: { id: true, startDate: true, endDate: true, user: { select: { fullName: true } }, shop: { select: { name: true, nameAm: true } } } },
        _count: { select: { leads: true } } } }),
    prisma.tenancy.findMany({ where: { active: false, unit: { buildingId: ids } }, select: { unitId: true, endDate: true } }),
    prisma.invoice.findMany({ where: { tenancy: { unit: { buildingId: ids } }, dueDate: { gte: since } },
      select: { id: true, tenancyId: true, type: true, amount: true, lateFee: true, dueDate: true, paidDate: true, daysLate: true, status: true,
        tenancy: { select: { unitId: true } } } }),
    prisma.maintenanceRequest.findMany({ where: { OR: [{ buildingId: ids }, { tenancy: { unit: { buildingId: ids } } }] },
      select: { type: true, status: true, assignedTo: true, createdAt: true, resolvedAt: true, buildingId: true,
        tenancy: { select: { unit: { select: { number: true, buildingId: true } } } } } }),
    prisma.expense.findMany({ where: { buildingId: ids, date: { gte: since } },
      select: { buildingId: true, date: true, category: true, amount: true, vatAmount: true } }),
  ]);
  return { now, buildings, units, ended, invoices, repairs, expenses };
}

module.exports = { loadBuildings, WINDOW_DAYS };
