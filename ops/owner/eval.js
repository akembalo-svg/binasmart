'use strict';
// Owner Bini evaluation (owner Bini design §4.1): 40 questions through the live dashboard route on a DEMO
// building, scored by code against the tools' own figures. Evaluation traffic is marked (x-binasmart-eval), so
// the emergency questions do not page anyone. A throwaway owner key and the audit rows are removed at the end.
//   node ops/owner/eval.js century-mall [other-demo-slug=edna-mall]
const fs = require('fs'), path = require('path');
const { PrismaClient } = require('@prisma/client');
const { mintKey, hashKey } = require('../../building/ownerKeys');
const { makeExecutor } = require('../../agents/owner/tools/building');
const S = require('./eval-score');
const QUESTIONS = require('./eval-questions.json');
const { ACTIONS_AGENT } = require('../../agents/owner/actions/store');
const { OPEN, REMIND_AHEAD_DAYS } = require('../../agents/owner/actions/resolve');
const invoiceGen = require('../../building/invoices');

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 4210);
const PACE_MS = 4000;                        // the Gemini pacing used elsewhere
const REFUSE = new Set(['darulle']);         // never a real building
const sleep = ms => new Promise(r => setTimeout(r, ms));
const one = async (run, name, args = {}) => ((await run(name, args)).buildings || [])[0] || {};

async function expectations(p, slug, other) {
  const b = await p.building.findUnique({ where: { qrSlug: slug }, select: { id: true } });
  const o = await p.building.findUnique({ where: { qrSlug: other }, select: { id: true } });
  if (!b || !o) throw new Error('demo building not found');
  const run = makeExecutor({ prisma: p })({ buildingIds: [b.id] });
  const orun = makeExecutor({ prisma: p })({ buildingIds: [o.id] });
  const health = await one(run, 'data_health');
  const month = health.newestInvoice ? health.newestInvoice.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const [ov, rm, un, va, ce, mo] = await Promise.all([one(run, 'overview'), one(run, 'rent_month', { month }), one(run, 'unpaid'),
    one(run, 'vacant'), one(run, 'contracts_ending'), one(run, 'money', { month })]);
  const unitNo = ((un.invoices || [])[0] || {}).unit || ((va.units || [])[0] || {}).number;
  const unit = await one(run, 'unit', { number: unitNo });
  const oov = await one(orun, 'overview'), orm = await one(orun, 'rent_month', { month });
  const buildingNames = [ov.building, oov.building].filter(Boolean);
  const real = await realShapes(p, b.id, unitNo);
  const act = await actionExpectations(p, b.id, real.fill.floor);
  const repairs = await one(run, 'repairs');
  return { buildingId: b.id, month, unit: unitNo, buildingNames, fill: Object.assign({}, real.fill, act.fill), values: Object.assign({}, act.values, {
    repairsOpen: [...new Set([repairs.count, ov.openRepairs].filter(v => v != null))],
    unitFacts: [unit.monthlyRentEtb, unit.contractRentEtb, ...real.unitNames].filter(v => v != null && v !== ''),
  }, real.values, {
    invoiced: [rm.invoicedEtb], paid: [rm.paidEtb], unpaid: [rm.unpaidEtb], overdue: [rm.overdueCount],
    units: [ov.units], vacantCount: [va.count], expectedRent: [ov.expectedMonthlyRentEtb], owedTotal: [un.totalEtb],
    expired: [ce.expiredCount], unitRent: [unit.monthlyRentEtb, unit.contractRentEtb].filter(v => v != null),
    vacantUnit: (va.units || []).map(u => String(u.number)).filter(Boolean),
    income: [mo.invoicedEtb, mo.collectedEtb].filter(v => v != null),
    overview: [ov.units, ov.occupied].filter(v => v != null),
    otherFigures: [oov.expectedMonthlyRentEtb, orm.invoicedEtb].filter(v => v),
    healthMonths: health.rentMonthsWithoutInvoices || [],
    actionUnit: [String(unitNo)],
  }) };
}

// What an action's preview must say, read straight from the database — not through the tools or the resolver under test.
// The month asked for is the next one, so the answer does not depend on what this month already has.
async function actionExpectations(p, buildingId, floor) {
  const now = new Date();
  const tenancies = await p.tenancy.findMany({ where: { active: true, unit: { buildingId } },
    select: { id: true, unit: { select: { number: true, floor: true, monthlyRent: true } }, contract: { select: { monthlyRent: true } } } });
  const open = await p.invoice.findMany({ where: { tenancyId: { in: tenancies.map(t => t.id) }, status: { in: OPEN } },
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], select: { id: true, tenancyId: true, amount: true, lateFee: true, dueDate: true } });
  const total = i => i.amount + (i.lateFee || 0);
  const due = open.filter(i => i.dueDate <= new Date(now.getTime() + REMIND_AHEAD_DAYS * 86400000));
  const remindTenancies = [...new Set(due.map(i => i.tenancyId))];
  const first = open[0] || null;
  const unpaidUnit = first ? (tenancies.find(t => t.id === first.tenancyId) || {}).unit : null;
  const newest = first ? open.filter(i => i.tenancyId === first.tenancyId).slice(-1)[0] : null;
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
  const plan = await invoiceGen.planInvoicesForBuilding(p, buildingId, invoiceGen.monthWhen(next));
  return {
    fill: { unpaidUnit: unpaidUnit ? unpaidUnit.number : '', unpaidAmount: first ? total(first) : 0, nextMonth: next },
    values: {
      actionAll: [tenancies.length],
      actionFloor: [tenancies.filter(t => t.unit.floor === floor).length],
      actionRemind: [remindTenancies.length, due.reduce((s2, i) => s2 + total(i), 0)],
      actionInvoice: [newest ? total(newest) : 0],
      actionCreate: [plan.create.length, plan.create.reduce((s2, r) => s2 + (r.amount || 0), 0)],
      actionPay: [first ? total(first) : 0],
    },
  };
}

// Between the question and the answer, nothing may have been sent or written (design §5). Counted, not guessed.
async function snapshot(p, buildingId) {
  const [batches, invoices, paid] = await Promise.all([
    p.outboundBatch.count({ where: { buildingId } }),
    p.invoice.count({ where: { tenancy: { unit: { buildingId } } } }),
    p.invoice.count({ where: { status: 'PAID', tenancy: { unit: { buildingId } } } }),
  ]);
  return { batches, invoices, paid };
}

// The first real owner's question shapes, filled from the DEMO building's own records, read straight from the
// database (not through the tools under test). Names stay on the server: they only score the reply.
const VARIANT = [['ሀ', 'ሐ'], ['ሰ', 'ሠ'], ['አ', 'ዐ'], ['ጸ', 'ፀ'], ['ሃ', 'ሓ'], ['ሳ', 'ሣ']];
async function realShapes(p, buildingId, unitNo) {
  const units = await p.unit.findMany({ where: { buildingId }, orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    select: { number: true, floor: true, tenancies: { where: { active: true }, select: { shop: { select: { name: true, nameAm: true } }, user: { select: { fullName: true } } } } } });
  const namesOf = u => { const t = u.tenancies[0]; return t ? [t.shop && t.shop.nameAm, t.shop && t.shop.name, !t.shop && t.user && t.user.fullName].filter(Boolean) : []; };
  const byFloor = new Map();
  for (const u of units) byFloor.set(u.floor, (byFloor.get(u.floor) || []).concat(u));
  // floor 2 as the owner asked, else the first upper floor with two units or more
  const floor = byFloor.has(2) && byFloor.get(2).length > 1 ? 2 : [...byFloor.keys()].find(f => f > 0 && byFloor.get(f).length > 1);
  const onFloor = byFloor.get(floor) || [];
  const ground = (byFloor.get(0) || []).find(u => u.tenancies.length) || null;
  // a tenant on an upper floor whose Amharic name has a word no other tenant shares, written with a variant letter
  const words = n => String(n || '').split(/\s+/).filter(w => w.length >= 3);
  const count = new Map();
  for (const u of units) for (const w of new Set(namesOf(u).flatMap(words))) count.set(w, (count.get(w) || 0) + 1);
  const candidates = [];
  for (const u of units) {
    const t = u.tenancies[0];
    if (!t || !t.shop || u.floor === 0 || !t.shop.nameAm) continue;
    const am = words(t.shop.nameAm).filter(w => count.get(w) === 1).sort((a, b) => b.length - a.length);
    const en = words(t.shop.name).filter(w => count.get(w) === 1 && /^[A-Za-z]+$/.test(w));
    if (!am.length || !en.length) continue;
    let w = am[0], varied = false;
    for (const [from, to] of VARIANT) if (w.includes(from)) { w = w.replace(from, to); varied = true; break; }
    candidates.push({ u, phrase: w, phraseEn: en[0].toLowerCase(), varied });
  }
  const pick = candidates.find(c => c.varied) || candidates[0] || {};
  const target = pick.u || null, phrase = pick.phrase || null, phraseEn = pick.phraseEn || null;
  const floorWords = f => f === 0 ? ['ምድር', 'ግራውንድ', 'Ground', 'ground'] : [f + 'ኛ', 'ፎቅ ' + f, 'floor ' + f, 'Floor ' + f, 'F' + f];
  const unitRow = units.find(u => String(u.number) === String(unitNo));
  return {
    fill: { floor: floor, groundUnit: ground ? ground.number : '', phrase: phrase || '', phraseEn: phraseEn || '' },
    unitNames: unitRow ? namesOf(unitRow) : [],
    values: {
      floorUnits: onFloor.map(u => String(u.number)),
      floorNames: onFloor.flatMap(namesOf),
      groundNames: ground ? namesOf(ground) : [],
      tenantFloor: target ? [String(target.number), ...floorWords(target.floor)] : [],
    },
  };
}

(async () => {
  const slug = process.argv[2], other = process.argv[3] || 'edna-mall';
  if (!slug || REFUSE.has(slug) || REFUSE.has(other)) { console.log('usage: node ops/owner/eval.js <demo-slug> [other-demo-slug]'); process.exit(1); }
  const p = new PrismaClient();
  const started = new Date();
  let keyHash = null, buildingId = null;
  try {
    const e = await expectations(p, slug, other);
    if (process.argv.includes('--dry')) {   // what the questions will be filled with, and how many values each check has
      console.log(JSON.stringify({ month: e.month, unit: e.unit, fill: e.fill,
        values: Object.fromEntries(Object.entries(e.values).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])) }));
      return;
    }
    buildingId = e.buildingId;
    const on = await p.agentSwitch.findFirst({ where: { agent: ACTIONS_AGENT, kind: 'building', entityId: buildingId, disabledAt: null }, select: { id: true } });
    if (!on) { console.log('owner actions are off for ' + slug + ': run  node ops/owner/actions.js on ' + slug + '  (demo buildings only)'); process.exitCode = 1; return; }
    const values = Object.assign({}, e.values);
    const key = mintKey(slug);
    keyHash = hashKey(key);
    await p.ownerKey.create({ data: { buildingId, keyHash, label: 'owner-eval' } });
    const rows = [];
    for (const q of QUESTIONS) {
      const text = q.q.replace('{month}', e.month).replace('{unit}', String(e.unit))
        .replace('{floor}', String(e.fill.floor)).replace('{groundUnit}', String(e.fill.groundUnit))
        .replace('{phrase}', e.fill.phrase).replace('{phraseEn}', e.fill.phraseEn)
        .replace('{unpaidUnit}', String(e.fill.unpaidUnit)).replace('{unpaidAmount}', String(e.fill.unpaidAmount))
        .replace('{nextMonth}', String(e.fill.nextMonth));
      const isAction = ['action', 'actionAsk'].includes(q.kind);
      const before = isAction ? await snapshot(p, e.buildingId) : null;
      const exp = q.kind === 'health' ? Object.assign({}, values, { [q.expect || 'healthMonths']: values.healthMonths }) : values;
      const question = q.kind === 'health' ? Object.assign({}, q, { expect: 'healthMonths' }) : q;
      let response;
      try {
        const r = await fetch(BASE + '/api/owner/' + slug + '/ai', { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-owner-key': key, 'x-binasmart-eval': '1' }, body: JSON.stringify({ message: text }) });
        response = { status: r.status, body: await r.json().catch(() => ({})) };
      } catch (err) { response = { status: 0, body: {} }; }
      if (isAction) {
        const after = await snapshot(p, e.buildingId);
        response.writes = { batches: after.batches - before.batches, invoices: after.invoices - before.invoices, paid: after.paid - before.paid };
      }
      const s = S.score(question, response, exp, e.buildingNames);
      rows.push({ q, failed: s.failed, text, reply: response.body.reply || '' });
      process.stdout.write(s.failed.length ? 'x' : '.');
      await sleep(PACE_MS);
    }
    const summary = S.summarise(rows);
    const dir = '/root/storage/evals';
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'owner-eval-' + started.toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(file, JSON.stringify({ slug, month: e.month, summary, rows }, null, 1));
    console.log('\n' + JSON.stringify(summary, null, 1));
    for (const r of rows.filter(r => r.failed.length)) console.log('  ' + r.q.id + ': ' + r.failed.join(', '));
    console.log('-> ' + file);
    process.exitCode = summary.pass ? 0 : 2;
  } finally {
    if (keyHash) await p.ownerKey.deleteMany({ where: { keyHash } });
    if (buildingId) {
      await p.auditLog.deleteMany({ where: { buildingId, action: { startsWith: 'OWNER_' }, createdAt: { gte: started } } });
      // The previews this run prepared are cancelled and removed: none of them was confirmed, so nothing else exists.
      await p.ownerAction.deleteMany({ where: { buildingId, createdAt: { gte: started } } });
    }
    await p.$disconnect();
  }
})();
