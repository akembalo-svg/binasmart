'use strict';
// The building tool pack for the owner agent: ten read-only questions an owner asks about their building.
// Each tool is a pure function over the records loadBuildings() returned for the owner's scope, so the only
// database access — and the only place scope and privacy are enforced — is ../building-data.js. Outputs
// project named fields explicitly: nothing is passed through whole.
const { loadBuildings } = require('../building-data');

const DAY = 86400000;
const VAT_RATE = 0.15;                     // the same rate as server.js (VAT Proclamation 1341/2024); a test pins it
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const OPEN = new Set(['OPEN', 'ASSIGNED', 'IN_PROGRESS']);

const iso = d => d ? new Date(d).toISOString().slice(0, 10) : null;
const monthOf = d => new Date(d).toISOString().slice(0, 7);
const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
const daysSince = (d, now) => Math.max(0, Math.floor((now - d) / DAY));
const occupant = t => t ? (t.shop ? (t.shop.nameAm || t.shop.name) : (t.user && t.user.fullName) || null) : null;

// The records of one building out of a (possibly multi-building) load.
function view(data, b) {
  const units = data.units.filter(u => u.buildingId === b.id);
  const unitIds = new Set(units.map(u => u.id));
  return {
    b, units,
    byUnit: new Map(units.map(u => [u.id, u])),
    invoices: data.invoices.filter(i => i.tenancy && unitIds.has(i.tenancy.unitId)),
    repairs: data.repairs.filter(r => (r.buildingId || (r.tenancy && r.tenancy.unit && r.tenancy.unit.buildingId)) === b.id),
    expenses: data.expenses.filter(e => e.buildingId === b.id),
    ended: data.ended.filter(t => unitIds.has(t.unitId)),
  };
}

// How recent the records are. Carried by every money answer so an owner never reads July as today.
function asOf(v) {
  let inv = null, pay = null;
  for (const i of v.invoices) {
    if (!inv || i.dueDate > inv) inv = i.dueDate;
    if (i.paidDate && (!pay || i.paidDate > pay)) pay = i.paidDate;
  }
  return { newestInvoice: iso(inv), newestPayment: iso(pay) };
}

function currentOccupant(v, unitId, tenancyId) {
  const t = ((v.byUnit.get(unitId) || {}).tenancies || [])[0];
  return t && t.id === tenancyId ? occupant(t) : null;   // an old tenancy's invoice names nobody
}

const TOOLS = {
  data_health(v, a, now) {
    const rentMonths = new Set(v.invoices.filter(i => i.type === 'RENT').map(i => monthOf(i.dueDate)));
    const missing = [];
    for (let k = 0; k < 3; k++) {
      const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toISOString().slice(0, 7);
      if (!rentMonths.has(m)) missing.push(m);
    }
    return { units: v.units.length, activeTenancies: v.units.filter(u => u.tenancies.length).length,
      invoices: v.invoices.length, invoicesPaid: v.invoices.filter(i => i.status === 'PAID').length,
      rentMonthsWithoutInvoices: missing, expensesRecorded: v.expenses.length,
      openRepairs: v.repairs.filter(r => OPEN.has(r.status)).length, ...asOf(v) };
  },

  overview(v) {
    const occupied = v.units.filter(u => u.status === 'OCCUPIED').length;
    const vacant = v.units.filter(u => u.status === 'VACANT').length;
    return { units: v.units.length, occupied, vacant, otherStatus: v.units.length - occupied - vacant,
      expectedMonthlyRentEtb: sum(v.units, u => u.monthlyRent), openRepairs: v.repairs.filter(r => OPEN.has(r.status)).length, ...asOf(v) };
  },

  rent_month(v, a, now) {
    const month = a.month || monthOf(now);
    const live = v.invoices.filter(i => monthOf(i.dueDate) === month && i.status !== 'CANCELLED');
    const paid = live.filter(i => i.status === 'PAID');
    const unpaid = live.filter(i => i.status !== 'PAID');
    const overdue = unpaid.filter(i => i.dueDate < now);
    return { month, invoices: live.length, invoicedEtb: sum(live, i => i.amount),
      paidCount: paid.length, paidEtb: sum(paid, i => i.amount),
      unpaidCount: unpaid.length, unpaidEtb: sum(unpaid, i => i.amount),
      overdueCount: overdue.length, overdueEtb: sum(overdue, i => i.amount),
      partialCount: live.filter(i => i.status === 'PARTIAL').length, lateFeesEtb: sum(live, i => i.lateFee), ...asOf(v) };
  },

  unpaid(v, a, now) {
    const list = v.invoices
      .filter(i => i.status !== 'PAID' && i.status !== 'CANCELLED' && (!a.month || monthOf(i.dueDate) === a.month))
      .map(i => ({ unit: (v.byUnit.get(i.tenancy.unitId) || {}).number || null, occupant: currentOccupant(v, i.tenancy.unitId, i.tenancyId),
        type: i.type, amountEtb: i.amount, dueDate: iso(i.dueDate), daysLate: i.dueDate < now ? daysSince(i.dueDate, now) : 0, status: i.status }))
      .sort((x, y) => y.daysLate - x.daysLate);
    return { count: list.length, totalEtb: sum(list, r => r.amountEtb), invoices: list.slice(0, 40), truncated: list.length > 40, ...asOf(v) };
  },

  unit(v, a) {
    const n = String(a.number || '').trim().toLowerCase();
    const u = v.units.find(x => String(x.number).toLowerCase() === n);
    if (!u) return { found: false };
    const t = u.tenancies[0];
    return { found: true, number: u.number, floor: u.floor, areaSqm: u.areaSqm, monthlyRentEtb: u.monthlyRent, status: u.status, type: u.unitType,
      occupant: occupant(t), contractStart: t ? iso(t.startDate) : null, contractEnd: t ? iso(t.endDate) : null,
      invoices: v.invoices.filter(i => i.tenancy.unitId === u.id).sort((x, y) => y.dueDate - x.dueDate).slice(0, 12)
        .map(i => ({ type: i.type, amountEtb: i.amount, dueDate: iso(i.dueDate), paidDate: iso(i.paidDate), status: i.status })),
      openRepairs: v.repairs.filter(r => OPEN.has(r.status) && r.tenancy && r.tenancy.unit && r.tenancy.unit.number === u.number).length };
  },

  late_payers(v, a, now) {
    const months = Math.min(Math.max(parseInt(a.months, 10) || 3, 1), 12);
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
    const rows = new Map();
    for (const i of v.invoices) {
      if (i.type !== 'RENT' || i.status === 'CANCELLED' || i.dueDate < from || i.dueDate > now) continue;
      const days = i.status === 'PAID' ? (i.daysLate || 0) : daysSince(i.dueDate, now);
      const r = rows.get(i.tenancy.unitId) || { invoices: 0, late: 0, days: 0 };
      r.invoices++;
      if (days > 0) { r.late++; r.days += days; }
      rows.set(i.tenancy.unitId, r);
    }
    const units = [...rows].filter(([, r]) => r.late >= 2)
      .map(([id, r]) => { const u = v.byUnit.get(id) || {}; return { unit: u.number || null, occupant: occupant((u.tenancies || [])[0]),
        lateInvoices: r.late, ofInvoices: r.invoices, averageDaysLate: Math.round(r.days / r.late) }; })
      .sort((x, y) => y.lateInvoices - x.lateInvoices || y.averageDaysLate - x.averageDaysLate);
    return { months, from: iso(from), units: units.slice(0, 40), ...asOf(v) };
  },

  vacant(v) {
    const endedAt = new Map();
    for (const t of v.ended) if (t.endDate && (!endedAt.has(t.unitId) || t.endDate > endedAt.get(t.unitId))) endedAt.set(t.unitId, t.endDate);
    const units = v.units.filter(u => u.status === 'VACANT')
      .map(u => ({ number: u.number, floor: u.floor, areaSqm: u.areaSqm, monthlyRentEtb: u.monthlyRent,
        vacantSince: iso(endedAt.get(u.id)), enquiries: u._count ? u._count.leads : 0 }))
      .sort((x, y) => String(x.number).localeCompare(String(y.number), undefined, { numeric: true }));
    return { count: units.length, units: units.slice(0, 60) };
  },

  contracts_ending(v, a, now) {
    const days = Math.min(Math.max(parseInt(a.days, 10) || 60, 1), 365);
    const until = new Date(now.getTime() + days * DAY);
    const contracts = [];
    for (const u of v.units) for (const t of u.tenancies)
      if (t.endDate && t.endDate >= now && t.endDate <= until) contracts.push({ unit: u.number, occupant: occupant(t), endDate: iso(t.endDate) });
    contracts.sort((x, y) => x.endDate.localeCompare(y.endDate));
    return { days, count: contracts.length, contracts: contracts.slice(0, 40) };
  },

  repairs(v, a) {
    const all = String(a.status || 'open') === 'all';
    const list = v.repairs.filter(r => all || OPEN.has(r.status)).sort((x, y) => y.createdAt - x.createdAt)
      .map(r => ({ unit: r.tenancy && r.tenancy.unit ? r.tenancy.unit.number : null, type: r.type, status: r.status,
        reported: iso(r.createdAt), resolved: iso(r.resolvedAt), assigned: !!r.assignedTo }));
    return { count: list.length, repairs: list.slice(0, 40) };
  },

  money(v, a, now) {
    const month = a.month || monthOf(now);
    const inv = v.invoices.filter(i => monthOf(i.dueDate) === month && i.status !== 'CANCELLED');
    const invoiced = sum(inv, i => i.amount);
    const collected = sum(inv.filter(i => i.status === 'PAID'), i => i.amount);
    const exps = v.expenses.filter(e => monthOf(e.date) === month);
    const byCategory = {};
    for (const e of exps) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const expenses = sum(exps, e => e.amount);
    const outputVat = v.b.vatRegistered ? Math.round(v.b.vatInclusive ? invoiced * VAT_RATE / (1 + VAT_RATE) : invoiced * VAT_RATE) : 0;
    const inputVat = v.b.vatRegistered ? sum(exps, e => e.vatAmount) : 0;
    return { month, invoicedEtb: invoiced, collectedEtb: collected, expensesEtb: expenses, expensesByCategory: byCategory,
      vatRegistered: !!v.b.vatRegistered, outputVatEtb: outputVat, inputVatEtb: inputVat, netVatEtb: outputVat - inputVat,
      collectedMinusExpensesEtb: collected - expenses, ...asOf(v) };
  },
};

const BUILDING = { type: 'string', description: 'Only when the owner has more than one building: its name. Omit otherwise.' };
const MONTH_ARG = { type: 'string', description: 'Calendar month as YYYY-MM, e.g. 2026-09. Omit for the current month.' };
const def = (name, description, properties = {}) =>
  ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: Object.assign({ building: BUILDING }, properties) } } });

const DEFS = [
  def('data_health', 'What the records of the building contain and what is missing: units, tenancies, invoices, payments, months with no rent invoices, expenses, open repairs, and how recent the records are. Call it first for a general question, or when figures look incomplete.'),
  def('overview', 'Units occupied and vacant, expected monthly rent of all units, open repairs, and how recent the records are.'),
  def('rent_month', 'Rent and other invoices due in one month: how many, invoiced, paid, unpaid and overdue amounts in ETB, late fees.', { month: MONTH_ARG }),
  def('unpaid', 'Invoices not paid yet, oldest first: unit, tenant or shop, amount in ETB, due date, days late.', { month: { type: 'string', description: 'Optional YYYY-MM to limit to one month.' } }),
  def('unit', 'One unit by its number: rent, size, floor, status, tenant or shop, contract dates, last 12 invoices, open repairs.', { number: { type: 'string', description: 'The unit number as written on the contract, e.g. 707 or G-003.' } }),
  def('late_payers', 'Units that paid rent late (or have not paid) at least twice in the last N months, with average days late.', { months: { type: 'integer', description: 'How many recent months, 1-12. Default 3.' } }),
  def('vacant', 'Vacant units: number, floor, size, rent, vacant since, enquiries received.'),
  def('contracts_ending', 'Contracts that end within the next N days: unit, tenant or shop, end date.', { days: { type: 'integer', description: '1-365. Default 60.' } }),
  def('repairs', 'Repair requests: unit, type, status, reported and resolved dates, whether someone is assigned.', { status: { type: 'string', enum: ['open', 'all'], description: 'open (default) or all.' } }),
  def('money', 'One month of money: invoiced, collected, expenses by category, VAT collected, VAT paid on expenses, net VAT, collected minus expenses. Figures only, not tax advice.', { month: MONTH_ARG }),
];

function makeExecutor({ prisma, now = () => new Date(), warn = m => console.warn(m) }) {
  return function bind(scope) {
    let loading = null;   // one load per question, however many tools the model calls
    return async function execute(name, args) {
      const fn = TOOLS[name];
      if (!fn) return { error: 'unknown tool ' + name };
      args = args && typeof args === 'object' ? args : {};
      if (args.month != null && !MONTH.test(String(args.month))) return { error: 'month must look like 2026-09' };
      const t = now();
      let data;
      try {
        if (!loading) loading = loadBuildings(prisma, scope && scope.buildingIds, t);
        data = await loading;
      } catch (e) {
        loading = null;
        warn('[owner] records unavailable: ' + (e && e.message || e));
        return { error: 'records unavailable' };
      }
      const q = args.building ? String(args.building).toLowerCase() : null;
      const bs = q ? data.buildings.filter(b => [b.qrSlug, b.name, b.nameAm].filter(Boolean).some(n => n.toLowerCase().includes(q))) : data.buildings;
      if (!bs.length) return { error: 'no such building for this owner' };
      return { buildings: bs.map(b => Object.assign({ building: b.name, buildingAm: b.nameAm || null }, fn(view(data, b), args, t))) };
    };
  };
}

module.exports = { TOOLS, DEFS, VAT_RATE, view, makeExecutor };
