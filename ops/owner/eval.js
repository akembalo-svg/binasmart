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
  return { buildingId: b.id, month, unit: unitNo, values: {
    invoiced: [rm.invoicedEtb], paid: [rm.paidEtb], unpaid: [rm.unpaidEtb], overdue: [rm.overdueCount],
    units: [ov.units], vacantCount: [va.count], expectedRent: [ov.expectedMonthlyRentEtb], owedTotal: [un.totalEtb],
    expired: [ce.expiredCount], unitRent: [unit.monthlyRentEtb, unit.contractRentEtb].filter(v => v != null),
    vacantUnit: (va.units || []).map(u => String(u.number)).filter(Boolean),
    income: [mo.invoicedEtb, mo.collectedEtb].filter(v => v != null),
    overview: [ov.units, ov.occupied].filter(v => v != null),
    otherFigures: [oov.expectedMonthlyRentEtb, orm.invoicedEtb].filter(v => v),
    healthMonths: health.rentMonthsWithoutInvoices || [],
  } };
}

(async () => {
  const slug = process.argv[2], other = process.argv[3] || 'edna-mall';
  if (!slug || REFUSE.has(slug) || REFUSE.has(other)) { console.log('usage: node ops/owner/eval.js <demo-slug> [other-demo-slug]'); process.exit(1); }
  const p = new PrismaClient();
  const started = new Date();
  let keyHash = null, buildingId = null;
  try {
    const e = await expectations(p, slug, other);
    buildingId = e.buildingId;
    const values = Object.assign({}, e.values);
    const key = mintKey(slug);
    keyHash = hashKey(key);
    await p.ownerKey.create({ data: { buildingId, keyHash, label: 'owner-eval' } });
    const rows = [];
    for (const q of QUESTIONS) {
      const text = q.q.replace('{month}', e.month).replace('{unit}', String(e.unit));
      const exp = q.kind === 'health' ? Object.assign({}, values, { [q.expect || 'healthMonths']: values.healthMonths }) : values;
      const question = q.kind === 'health' ? Object.assign({}, q, { expect: 'healthMonths' }) : q;
      let response;
      try {
        const r = await fetch(BASE + '/api/owner/' + slug + '/ai', { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-owner-key': key, 'x-binasmart-eval': '1' }, body: JSON.stringify({ message: text }) });
        response = { status: r.status, body: await r.json().catch(() => ({})) };
      } catch (err) { response = { status: 0, body: {} }; }
      const s = S.score(question, response, exp);
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
    if (buildingId) await p.auditLog.deleteMany({ where: { buildingId, action: 'OWNER_BINI_Q', createdAt: { gte: started } } });
    await p.$disconnect();
  }
})();
