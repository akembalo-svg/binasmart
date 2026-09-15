'use strict';
// Two demo buildings, their units, tenancies and invoices, and a Prisma double that answers exactly the queries
// agents/owner/actions/resolve.js, building/invoices.js and building/invoice-ops.js make. Fake numbers (0900…), fake
// names, and never a Darulle row: no test here can touch a real building.
const D = s => new Date(s);
const NOW = D('2026-09-16T09:00:00Z');        // 12:00 in Addis Ababa: not quiet hours
const QUIET = D('2026-09-16T19:00:00Z');      // 22:00 in Addis Ababa

// 101 Telegram-linked, 102 mobile only, 201 no phone at all, 202 vacant; b2 is the owner's second building.
function data() {
  const t = (id, unitId, userId, name, phone, chat) => ({ id, unitId, userId, active: true,
    shop: name ? { name, nameAm: name + ' (አማርኛ)' } : null, user: { fullName: 'Demo Tenant ' + id, phone, telegramChatId: chat } });
  const inv = (id, tenancyId, type, amount, lateFee, due, status) =>
    ({ id, tenancyId, type, amount, lateFee, dueDate: D(due), status, paidDate: null, method: null, paymentCode: 'BS-1000-' + id });
  return {
    buildings: [
      { id: 'b1', name: 'Demo Tower', nameAm: 'ዴሞ ታወር', qrSlug: 'demo-tower', subCity: 'Demo Sub City', smsMonthlyLimit: 500, smsSender: '', bankAccounts: [], tinNumber: null, vatRegistered: false },
      { id: 'b2', name: 'Demo Annex', nameAm: 'ዴሞ አኔክስ', qrSlug: 'demo-annex', subCity: 'Demo Sub City', smsMonthlyLimit: 500, smsSender: '', bankAccounts: [], tinNumber: null, vatRegistered: false },
    ],
    units: [
      { id: 'u1', buildingId: 'b1', number: '101', floor: 1, monthlyRent: 10000 },
      { id: 'u2', buildingId: 'b1', number: '102', floor: 1, monthlyRent: 12000 },
      { id: 'u3', buildingId: 'b1', number: '201', floor: 2, monthlyRent: 15000 },
      { id: 'u4', buildingId: 'b1', number: '202', floor: 2, monthlyRent: 15000 },
      { id: 'u9', buildingId: 'b2', number: '1', floor: 0, monthlyRent: 7000 },
    ],
    tenancies: [
      t('t1', 'u1', 'us1', 'Demo Shop One', '0900000001', '5551'),
      t('t2', 'u2', 'us2', 'Demo Shop Two', '0900000002', null),
      t('t3', 'u3', 'us3', null, null, null),
      t('t9', 'u9', 'us9', 'Demo Annex Shop', '0900000009', null),
    ],
    contracts: [{ tenancyId: 't1', monthlyRent: 11000 }],
    invoices: [
      inv('i1', 't1', 'RENT', 10000, 0, '2026-09-05T00:00:00Z', 'OVERDUE'),
      inv('i2', 't1', 'RENT', 10000, 500, '2026-08-05T00:00:00Z', 'OVERDUE'),
      inv('i3', 't2', 'RENT', 12000, 0, '2026-09-05T00:00:00Z', 'PENDING'),
      inv('i4', 't2', 'RENT', 12000, 0, '2026-07-05T00:00:00Z', 'PAID'),
      inv('i5', 't3', 'RENT', 15000, 0, '2026-12-05T00:00:00Z', 'PENDING'),   // far in the future: no reminder
    ],
  };
}

// Prisma's select, as far as these queries use it: true for a column, { select: {…} } for a relation.
function sel(row, select) {
  if (!select) return row;
  const out = {};
  for (const [k, v] of Object.entries(select)) {
    if (v === true) out[k] = row ? row[k] : undefined;
    else if (v && v.select) out[k] = row && row[k] ? sel(row[k], v.select) : null;
  }
  return out;
}
const inList = (where, field, value) => {
  const w = where && where[field];
  if (w === undefined) return true;
  if (w && typeof w === 'object' && Array.isArray(w.in)) return w.in.includes(value);
  if (w && typeof w === 'object' && w.not !== undefined) return value !== w.not;
  return w === value;
};

function fakePrisma(d = data(), calls = []) {
  const unit = id => d.units.find(u => u.id === id);
  const tenancyRow = t => ({ id: t.id, userId: t.userId, active: t.active, unitId: t.unitId, unit: unit(t.unitId),
    shop: t.shop, user: t.user, contract: d.contracts.find(c => c.tenancyId === t.id) || null });
  const invoiceMatches = (i, where) => {
    if (!inList(where, 'id', i.id)) return false;
    if (where.tenancyId !== undefined && !inList(where, 'tenancyId', i.tenancyId)) return false;
    if (where.type !== undefined && where.type !== i.type) return false;
    if (where.status !== undefined) {
      const st = where.status;
      if (Array.isArray(st.in) && !st.in.includes(i.status)) return false;
      if (st.not !== undefined && i.status === st.not) return false;
      if (typeof st === 'string' && st !== i.status) return false;
    }
    if (where.dueDate) {
      if (where.dueDate.lte && i.dueDate > where.dueDate.lte) return false;
      if (where.dueDate.gte && i.dueDate < where.dueDate.gte) return false;
      if (where.dueDate.lt && i.dueDate >= where.dueDate.lt) return false;
    }
    if (where.tenancy && where.tenancy.unit && where.tenancy.unit.buildingId) {
      const t = d.tenancies.find(x => x.id === i.tenancyId);
      if (!t || unit(t.unitId).buildingId !== where.tenancy.unit.buildingId) return false;
    }
    return true;
  };
  const order = (rows, by) => {
    const list = [].concat(by || []);
    return rows.slice().sort((a, b) => {
      for (const o of list) for (const [k, dir] of Object.entries(o)) {
        const x = a[k], y = b[k];
        if (x < y) return dir === 'desc' ? 1 : -1;
        if (x > y) return dir === 'desc' ? -1 : 1;
      }
      return 0;
    });
  };
  const p = {
    d, calls,
    building: {
      findMany: async q => { calls.push(['building.findMany', q]); return d.buildings.filter(b => inList(q.where, 'id', b.id)).map(b => sel(b, q.select)); },
      findUnique: async q => { calls.push(['building.findUnique', q]); const b = d.buildings.find(x => x.id === q.where.id || x.qrSlug === q.where.qrSlug); return b ? sel(b, q.select) : null; },
    },
    unit: { findMany: async q => { calls.push(['unit.findMany', q]); return d.units.filter(u => u.buildingId === q.where.buildingId).map(u => sel(u, q.select)); } },
    tenancy: {
      findMany: async q => {
        calls.push(['tenancy.findMany', q]);
        const rows = d.tenancies.filter(t => (q.where.active === undefined || t.active === q.where.active)
          && (!q.where.unit || unit(t.unitId).buildingId === q.where.unit.buildingId)).map(tenancyRow);
        return q.select ? rows.map(r => sel(r, q.select)) : rows;
      },
    },
    invoice: {
      findMany: async q => { calls.push(['invoice.findMany', q]); const rows = order(d.invoices.filter(i => invoiceMatches(i, q.where || {})), q.orderBy); return rows.map(i => (q.select ? sel(i, q.select) : full(i))); },
      findFirst: async q => { calls.push(['invoice.findFirst', q]); const i = d.invoices.find(x => invoiceMatches(x, q.where || {})); return i ? (q.select ? sel(i, q.select) : full(i)) : null; },
      findUnique: async q => { calls.push(['invoice.findUnique', q]); const i = d.invoices.find(x => x.id === q.where.id); return i ? (q.select ? sel(i, q.select) : full(i)) : null; },
      create: async q => { calls.push(['invoice.create', q]); const row = { id: 'new' + (d.invoices.length + 1), lateFee: 0, paidDate: null, method: null, ...q.data }; d.invoices.push(row); return row; },
      updateMany: async q => { calls.push(['invoice.updateMany', q]); let n = 0; for (const i of d.invoices) if (invoiceMatches(i, q.where || {})) { Object.assign(i, q.data); n++; } return { count: n }; },
    },
  };
  // an invoice with its tenancy, unit, shop and user, as building/invoice-ops.js includes it
  function full(i) {
    const t = d.tenancies.find(x => x.id === i.tenancyId);
    return Object.assign({}, i, { tenancy: t ? { id: t.id, userId: t.userId, unit: unit(t.unitId), shop: t.shop, user: t.user } : null });
  }
  return p;
}

module.exports = { data, fakePrisma, NOW, QUIET, D };
