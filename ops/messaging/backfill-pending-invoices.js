'use strict';
// The invoices a dashboard 📤 Send could not deliver before messaging/delivery.js existed are only in the audit log
// ("INVOICE_SENT <shop> <unit> (delivery pending — channel down)"), which names the unit and the total, not the invoice.
// This matches each such row to exactly one invoice of that building (same unit number, same amount + late fee, created
// before the send) and records it as an undelivered OutboundMessage (source backfill-audit), so the dashboard's
// "Waiting to be delivered" list shows it with Send now. Nothing is sent. Dry run unless --apply. Prints counts only.
//
//   node ops/messaging/backfill-pending-invoices.js <slug> [--apply]
//   undo: delete OutboundMessage and OutboundBatch rows with source 'backfill-audit' for that building
function matchPending(auditRows, invoices) {
  return auditRows.map(a => {
    const head = String(a.detail || '').split(' (delivery pending')[0].trim();
    const hits = invoices.filter(i => (head === i.unit || head.endsWith(' ' + i.unit)) && i.total === a.amount && i.createdAt <= a.createdAt);
    return { auditId: a.id, at: a.createdAt, invoice: hits.length === 1 ? hits[0] : null, reason: hits.length === 1 ? 'matched' : hits.length ? 'ambiguous' : 'none' };
  });
}

async function main([slug, flag]) {
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  try {
    const apply = flag === '--apply';
    const b = slug && await p.building.findUnique({ where: { qrSlug: slug }, select: { id: true } });
    if (!b) throw new Error('usage: node ops/messaging/backfill-pending-invoices.js <slug> [--apply]');
    const audits = await p.auditLog.findMany({ where: { buildingId: b.id, action: 'INVOICE_SENT', detail: { contains: 'delivery pending' } }, orderBy: { createdAt: 'asc' } });
    const invoices = (await p.invoice.findMany({ where: { tenancy: { unit: { buildingId: b.id } } },
      select: { id: true, amount: true, lateFee: true, createdAt: true, tenancyId: true, tenancy: { select: { userId: true, unit: { select: { number: true } } } } } }))
      .map(i => ({ id: i.id, unit: i.tenancy.unit.number, total: i.amount + (i.lateFee || 0), createdAt: i.createdAt, tenancyId: i.tenancyId, userId: i.tenancy.userId }));
    const out = { auditRows: audits.length, matched: 0, ambiguous: 0, none: 0, alreadyRecorded: 0, written: 0, apply };
    for (const m of matchPending(audits, invoices)) {
      out[m.reason]++;
      if (!m.invoice) continue;
      if (await p.outboundMessage.findFirst({ where: { invoiceId: m.invoice.id, kind: 'invoice' }, select: { id: true } })) { out.alreadyRecorded++; continue; }
      if (!apply) continue;
      const batch = await p.outboundBatch.create({ data: { buildingId: b.id, kind: 'invoice', source: 'backfill-audit', actor: 'ops', total: 1, createdAt: m.at } });
      await p.outboundMessage.create({ data: { batchId: batch.id, buildingId: b.id, tenancyId: m.invoice.tenancyId, userId: m.invoice.userId, invoiceId: m.invoice.id,
        kind: 'invoice', channel: 'none', status: 'failed', errorKind: 'channel_down', createdAt: m.at } });
      out.written++;
    }
    console.log(JSON.stringify(out));
  } finally { await p.$disconnect(); }
}

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { matchPending };
