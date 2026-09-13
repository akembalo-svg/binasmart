'use strict';
// One fake building, shaped like loadBuildings() output. Private fields (phone, faydaId, a phone-shaped
// assignedTo) are planted on purpose: no tool output may contain them.
const D = s => new Date(s);
const NOW = D('2026-09-13T12:00:00Z');

function fixture() {
  const t1 = { id: 't1', startDate: D('2025-10-16T00:00:00Z'), endDate: D('2026-10-15T00:00:00Z'),
    user: { fullName: 'Abebe Test', phone: 'PLANTED-PHONE-1', faydaId: 'FAYDA-123' }, shop: null };
  const t2 = { id: 't2', startDate: D('2025-01-01T00:00:00Z'), endDate: null, user: { fullName: 'Owner Of Cafe', phone: 'PLANTED-PHONE-2' },
    shop: { name: 'Test Cafe', nameAm: null } };
  const inv = (id, tenancyId, unitId, due, amount, status, paid, daysLate, type = 'RENT') =>
    ({ id, tenancyId, type, amount, lateFee: 0, dueDate: D(due), paidDate: paid ? D(paid) : null, daysLate, status, tenancy: { unitId } });
  return {
    now: NOW,
    buildings: [{ id: 'b1', name: 'Test Plaza', nameAm: 'ቴስት ፕላዛ', qrSlug: 'test-plaza', vatRegistered: true, vatInclusive: false }],
    units: [
      { id: 'u1', buildingId: 'b1', number: '101', floor: 1, areaSqm: 40, monthlyRent: 10000, status: 'OCCUPIED', unitType: 'SHOP', tenancies: [t1], _count: { leads: 0 } },
      { id: 'u2', buildingId: 'b1', number: '102', floor: 1, areaSqm: 80, monthlyRent: 20000, status: 'OCCUPIED', unitType: 'SHOP', tenancies: [t2], _count: { leads: 1 } },
      { id: 'u3', buildingId: 'b1', number: '103', floor: 2, areaSqm: 60, monthlyRent: 15000, status: 'VACANT', unitType: 'OFFICE', tenancies: [], _count: { leads: 2 } },
    ],
    ended: [{ unitId: 'u3', endDate: D('2026-05-31T00:00:00Z') }],
    invoices: [
      inv('i1', 't1', 'u1', '2026-07-01T00:00:00Z', 10000, 'PAID', '2026-07-03T00:00:00Z', 2),
      inv('i2', 't2', 'u2', '2026-07-01T00:00:00Z', 20000, 'PENDING', null, 0),
      inv('i3', 't1', 'u1', '2026-06-01T00:00:00Z', 10000, 'PAID', '2026-06-10T00:00:00Z', 9),
      inv('i4', 't2', 'u2', '2026-06-01T00:00:00Z', 20000, 'OVERDUE', null, 0),
      inv('i5', 't2', 'u2', '2026-05-01T00:00:00Z', 20000, 'PAID', '2026-05-16T00:00:00Z', 15),
      inv('i6', 't1', 'u1', '2026-06-01T00:00:00Z', 10000, 'CANCELLED', null, 0),
    ],
    repairs: [
      { type: 'plumbing', status: 'OPEN', assignedTo: 'PLANTED-PHONE-3', createdAt: D('2026-09-01T00:00:00Z'), resolvedAt: null, buildingId: null,
        tenancy: { unit: { number: '101', buildingId: 'b1' } } },
      { type: 'lift', status: 'DONE', assignedTo: null, createdAt: D('2026-08-01T00:00:00Z'), resolvedAt: D('2026-08-03T00:00:00Z'), buildingId: 'b1', tenancy: null },
    ],
    expenses: [
      { buildingId: 'b1', date: D('2026-07-10T00:00:00Z'), category: 'generator', amount: 5000, vatAmount: 750 },
      { buildingId: 'b1', date: D('2026-07-20T00:00:00Z'), category: 'cleaning', amount: 2000, vatAmount: 0 },
    ],
  };
}

// A Prisma double that returns the fixture, for tests that go through loadBuildings.
function fakePrisma(data = fixture(), calls = { findMany: 0 }) {
  const m = key => ({ findMany: async () => { calls.findMany++; return data[key]; } });
  return { calls, prisma: { building: m('buildings'), unit: m('units'), tenancy: m('ended'), invoice: m('invoices'),
    maintenanceRequest: m('repairs'), expense: m('expenses') } };
}

module.exports = { fixture, fakePrisma, NOW };
