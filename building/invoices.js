'use strict';
// Monthly rent invoices: one RENT invoice per active tenancy per calendar month (Addis Ababa), due on the 5th.
//
// On 1 August and 1 September 2026 the monthly cron stopped part-way. Invoice.paymentCode is unique and is
// 'BS-' + four random digits + '-' + the unit number; unit numbers repeat across buildings, so a run of ~400
// invoices expected about one clash (1.17 measured on 15 Sep). Prisma threw P2002 and the single try/catch around
// every building ended the run: every building after that point, Darulle last, got no invoices. Now a clash draws a
// new code, and a building that fails is reported without stopping the others.
const MAX_CODE_TRIES = 8;

function addisMonth(when = new Date()) {
  const d = new Date(when.getTime() + 3 * 3600000);   // Addis Ababa is UTC+3 all year
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

function randomCode(unitNumber, rand = Math.random) {
  return 'BS-' + Math.floor(1000 + rand() * 9000) + '-' + String(unitNumber).replace(/[^A-Za-z0-9]/g, '');
}

async function generateInvoicesForBuilding(prisma, buildingId, when = new Date(), { rand = Math.random } = {}) {
  const { y, m } = addisMonth(when);
  const monthStart = new Date(Date.UTC(y, m, 1)), monthEnd = new Date(Date.UTC(y, m + 1, 1));
  const tenancies = await prisma.tenancy.findMany({ where: { active: true, unit: { buildingId } }, include: { unit: true, contract: true } });
  let created = 0, skipped = 0;
  for (const t of tenancies) {
    const exists = await prisma.invoice.findFirst({ where: { tenancyId: t.id, type: 'RENT', dueDate: { gte: monthStart, lt: monthEnd } } });
    if (exists) { skipped++; continue; }
    const amount = (t.contract && t.contract.monthlyRent) || t.unit.monthlyRent;
    for (let tries = 1; ; tries++) {
      try {
        await prisma.invoice.create({ data: { tenancyId: t.id, type: 'RENT', amount,
          dueDate: new Date(Date.UTC(y, m, 5)), paymentCode: randomCode(t.unit.number, rand), status: 'PENDING' } });
        created++;
        break;
      } catch (e) {
        if (!(e && e.code === 'P2002') || tries >= MAX_CODE_TRIES) throw e;   // only a code clash is retried
      }
    }
  }
  return { created, skipped, month: (m + 1) + '/' + y };
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

module.exports = { generateInvoicesForBuilding, runMonthlyInvoices, addisMonth, randomCode, MAX_CODE_TRIES };
