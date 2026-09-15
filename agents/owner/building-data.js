'use strict';
// Everything the owner agent may read about a building, in one scoped load per question.
//
// The select clauses below ARE the privacy allowlist. A field that is not selected here cannot reach a tool,
// and so cannot reach the model: no phone number, Fayda id, BinaScore, payment code, TIN, bank account or
// free-text description is ever selected. Add a field only together with a test that names it
// (test/owner/building-data.test.js compares every query with a literal).
const DAY = 86400000;
const WINDOW_DAYS = 800; // a little over two years of invoices, expenses and closed repairs
const OPEN_REPAIR = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'];   // /api/owner/:slug/overview openMaintenance
const REPAIR_CAP = 1000;

async function loadBuildings(prisma, buildingIds, now = new Date()) {
  if (!Array.isArray(buildingIds) || !buildingIds.length) throw new Error('owner scope is empty');
  const ids = { in: buildingIds };
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const [buildings, units, ended, invoices, repairs, expenses] = await Promise.all([
    // floors: the storey count, so a building whose units were all left on floor 0 reads as missing floor data
    prisma.building.findMany({ where: { id: ids },
      select: { id: true, name: true, nameAm: true, qrSlug: true, floors: true, vatRegistered: true, vatInclusive: true } }),
    // An active tenancy's endDate is its vacate date and is never set while it is active; the contract's own
    // dates are on Contract (what /units and the daily renewal report read).
    prisma.unit.findMany({ where: { buildingId: ids },
      select: { id: true, buildingId: true, number: true, floor: true, areaSqm: true, monthlyRent: true, status: true, unitType: true,
        tenancies: { where: { active: true },
          select: { id: true, startDate: true, endDate: true,
            user: { select: { fullName: true } },
            shop: { select: { name: true, nameAm: true } },
            contract: { select: { startDate: true, endDate: true, monthlyRent: true } } } },
        _count: { select: { leads: true } } } }),
    prisma.tenancy.findMany({ where: { active: false, unit: { buildingId: ids } }, select: { unitId: true, endDate: true } }),
    prisma.invoice.findMany({ where: { tenancy: { unit: { buildingId: ids } }, dueDate: { gte: since } },
      select: { id: true, tenancyId: true, type: true, amount: true, lateFee: true, dueDate: true, paidDate: true, daysLate: true, status: true,
        tenancy: { select: { unitId: true } } } }),
    // Recent repairs, and every repair still open however old (so the open count matches the dashboard's,
    // which has no date limit). The public QR form can add rows, so the load is capped, newest first.
    prisma.maintenanceRequest.findMany({
      where: { AND: [
        { OR: [{ buildingId: ids }, { tenancy: { unit: { buildingId: ids } } }] },
        { OR: [{ createdAt: { gte: since } }, { status: { in: OPEN_REPAIR } }] },
      ] },
      orderBy: { createdAt: 'desc' }, take: REPAIR_CAP,
      select: { type: true, status: true, assignedTo: true, createdAt: true, resolvedAt: true, buildingId: true,
        tenancy: { select: { unit: { select: { number: true, buildingId: true } } } } } }),
    prisma.expense.findMany({ where: { buildingId: ids, date: { gte: since } },
      select: { buildingId: true, date: true, category: true, amount: true, vatAmount: true } }),
  ]);
  return { now, buildings, units, ended, invoices, repairs, expenses };
}

module.exports = { loadBuildings, WINDOW_DAYS, OPEN_REPAIR };
