'use strict';
// Monthly rent invoices: one RENT invoice per active tenancy per calendar month (Addis Ababa), due on the 5th.
//
// On 1 August and 1 September 2026 the monthly cron stopped part-way. Invoice.paymentCode is unique and is
// 'BS-' + four random digits + '-' + the unit number; unit numbers repeat across buildings, so a run of ~400
// invoices expected about one clash (1.17 measured on 15 Sep). Prisma threw P2002 and the single try/catch around
// every building ended the run: every building after that point, Darulle last, got no invoices. Now a clash draws a
// new code, and a building that fails is reported without stopping the others.
//
// planInvoicesForBuilding is the same selection without the writes: Bini's create_invoices preview shows it and the
// generator runs on it, so the preview and the run cannot disagree about who gets an invoice or for how much.
const MAX_CODE_TRIES = 8;

function addisMonth(when = new Date()) {
  const d = new Date(when.getTime() + 3 * 3600000);   // Addis Ababa is UTC+3 all year
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

// 'YYYY-MM' → a moment inside that Addis month (the 15th, noon UTC), for the two functions below.
function monthWhen(ym) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(ym == null ? '' : ym));
  if (!m) throw new Error('month must look like 2026-10');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15, 12));
}

function randomCode(unitNumber, rand = Math.random) {
  return 'BS-' + Math.floor(1000 + rand() * 9000) + '-' + String(unitNumber).replace(/[^A-Za-z0-9]/g, '');
}

async function planInvoicesForBuilding(prisma, buildingId, when = new Date()) {
  const { y, m } = addisMonth(when);
  const monthStart = new Date(Date.UTC(y, m, 1)), monthEnd = new Date(Date.UTC(y, m + 1, 1));
  const tenancies = await prisma.tenancy.findMany({ where: { active: true, unit: { buildingId } }, include: { unit: true, contract: true } });
  const create = [], skip = [];
  for (const t of tenancies) {
    const exists = await prisma.invoice.findFirst({ where: { tenancyId: t.id, type: 'RENT', dueDate: { gte: monthStart, lt: monthEnd } } });
    const row = { tenancyId: t.id, unit: t.unit.number, amount: (t.contract && t.contract.monthlyRent) || t.unit.monthlyRent };
    (exists ? skip : create).push(row);
  }
  return { y, m, month: (m + 1) + '/' + y, dueDate: new Date(Date.UTC(y, m, 5)), create, skip };
}

async function generateInvoicesForBuilding(prisma, buildingId, when = new Date(), { rand = Math.random } = {}) {
  const plan = await planInvoicesForBuilding(prisma, buildingId, when);
  let created = 0;
  for (const row of plan.create) {
    for (let tries = 1; ; tries++) {
      try {
        await prisma.invoice.create({ data: { tenancyId: row.tenancyId, type: 'RENT', amount: row.amount,
          dueDate: plan.dueDate, paymentCode: randomCode(row.unit, rand), status: 'PENDING' } });
        created++;
        break;
      } catch (e) {
        if (!(e && e.code === 'P2002') || tries >= MAX_CODE_TRIES) throw e;   // only a code clash is retried
      }
    }
  }
  return { created, skipped: plan.skip.length, month: plan.month };
}

async function runMonthlyInvoices(prisma, { when = new Date(), log = () => {}, rand } = {}) {
  const buildings = await prisma.building.findMany({ select: { id: true, name: true } });
  const out = { ok: [], failed: [] };
  for (const b of buildings) {
    try {
      const r = await generateInvoicesForBuilding(prisma, b.id, when, rand ? { rand } : {});
      out.ok.push({ name: b.name, ...r });
      log('[cron] invoices ' + b.name + ' ' + JSON.stringify(r));
    } catch (e) {
      const error = String((e && e.message) || e).slice(0, 200);
      out.failed.push({ name: b.name, error });
      log('[cron] invoice error ' + b.name + ': ' + error);
    }
  }
  return out;
}

module.exports = { generateInvoicesForBuilding, planInvoicesForBuilding, runMonthlyInvoices, addisMonth, monthWhen, randomCode, MAX_CODE_TRIES };
