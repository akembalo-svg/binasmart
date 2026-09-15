'use strict';
// Marking an invoice paid and sending an invoice: one module for the dashboard routes and for Bini's confirmed owner
// actions. Over the Prisma double (test/owner/actions-fixture.js): no database, nothing sent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { makeInvoiceOps } = require('../../building/invoice-ops');
const invoiceText = require('../../messaging/invoice-text');
const { fakePrisma, data } = require('../owner/actions-fixture');

const PAID_AT = new Date('2026-09-16T09:00:00Z');
function setup({ d = data(), whitelisted = true } = {}) {
  const prisma = fakePrisma(d);
  const audits = [], sent = [], links = [];
  const ops = makeInvoiceOps({ prisma, invoiceText,
    audit: async (b, action, detail, amount) => audits.push({ b, action, detail, amount }),
    notifyTenant: async (b, tenancy, m) => { sent.push({ building: b.qrSlug, tenancyId: tenancy.id, kind: m.kind, source: m.source, actor: m.actor, text: m.text, smsText: m.smsText });
      return { delivered: true, channel: 'telegram', status: 'sent', errorKind: null, batchId: 'B7' }; },
    invoiceLinks: { linkFor: async (id, kind) => { links.push([id, kind]); return 'bina.et/i/Token1234567'; } },
    canMessage: b => whitelisted && !!b, now: () => PAID_AT });
  return { prisma, ops, audits, sent, links, d };
}

test('mark-paid pays an unpaid invoice once: the status check and the write are one statement', async () => {
  const { ops, prisma, audits, sent, d } = setup();
  const r = await ops.markPaid({ invoiceId: 'i1', method: 'TELEBIRR', actor: 'A1', source: 'owner-action' });
  assert.equal(r.ok, true);
  const row = d.invoices.find(i => i.id === 'i1');
  assert.equal(row.status, 'PAID');
  assert.equal(row.method, 'TELEBIRR');
  assert.equal(row.paidDate, PAID_AT);
  assert.deepEqual(audits.map(a => [a.b, a.action, a.detail, a.amount]), [['b1', 'INVOICE_PAID', 'Demo Shop One 101 via TELEBIRR', 10000]]);
  await r.receipt;
  assert.deepEqual(sent.map(x => [x.kind, x.source, x.actor, x.tenancyId]), [['receipt', 'owner-action', 'A1', 't1']]);
  assert.match(sent[0].text, /ደረሰኝ \/ E-RECEIPT/);
  assert.match(sent[0].smsText, /^ደረሰኝ፣ ክፍል 101፣ 10,000 ብር ተከፍሏል/);
  assert.equal(prisma.calls.filter(c => c[0] === 'invoice.updateMany').length, 1);

  const again = await ops.markPaid({ invoiceId: 'i1', method: 'CASH', actor: 'A1' });
  assert.deepEqual(again, { ok: false, error: 'already_paid' });
  assert.equal(audits.length, 1, 'nothing is audited twice');
  assert.equal(sent.length, 1, 'and no second receipt');
});

test('mark-paid on an invoice that does not exist says so, and writes nothing', async () => {
  const { ops, audits } = setup();
  assert.deepEqual(await ops.markPaid({ invoiceId: 'nope' }), { ok: false, error: 'not_found' });
  assert.deepEqual(audits, []);
});

test('the receipt follows the building: the dashboard sends it only for a whitelisted building, an owner action always', async () => {
  const off = setup({ whitelisted: false });
  const dash = await off.ops.markPaid({ invoiceId: 'i1', method: 'CASH', actor: 'dashboard' });
  assert.equal(dash.ok, true);
  assert.equal(dash.receipt, null);
  assert.deepEqual(off.sent, []);

  const action = setup({ whitelisted: false });
  const r = await action.ops.markPaid({ invoiceId: 'i1', method: 'CASH', actor: 'A1', source: 'owner-action', receipt: 'always' });
  await r.receipt;
  assert.deepEqual(action.sent.map(x => x.kind), ['receipt'], 'the delivery layer decides what reaches a tenant, and records a test row for a building that is not real');
});

test('sending an invoice mints the short link, goes through the delivery layer and audits what happened', async () => {
  const { ops, audits, sent, links, d } = setup();
  const r = await ops.sendInvoice({ building: d.buildings[0], invoiceId: 'i2', source: 'owner-action', actor: 'A1' });
  assert.deepEqual(r, { ok: true, delivered: true, channel: 'telegram', status: 'sent', reason: null, batchId: 'B7' });
  assert.deepEqual(links, [['i2', 'invoice']]);
  assert.deepEqual(sent.map(x => [x.kind, x.source, x.actor]), [['invoice', 'owner-action', 'A1']]);
  assert.match(sent[0].text, /🧾 የክፍያ መጠየቂያ \/ INVOICE/);
  assert.ok(sent[0].text.includes('bina.et/i/Token1234567'));
  assert.deepEqual(audits.map(a => [a.action, a.detail, a.amount]), [['INVOICE_SENT', 'Demo Shop One 101 (telegram)', 10500]], 'the audit carries the total, late fee included');
});

test('an invoice of another building is not sent, whatever id is given', async () => {
  const { ops, sent, d } = setup();
  assert.deepEqual(await ops.sendInvoice({ building: d.buildings[1], invoiceId: 'i1' }), { ok: false, error: 'not_found' });
  assert.deepEqual(sent, []);
});

test('server.js runs this module for both dashboard routes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, /const \{ makeInvoiceOps \} = require\('\.\/building\/invoice-ops'\);/);
  assert.match(src, /invoiceOps\.markPaid\(/);
  assert.match(src, /invoiceOps\.sendInvoice\(/);
});
