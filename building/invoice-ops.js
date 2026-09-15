'use strict';
// Marking an invoice paid, and sending an invoice to its tenant. The dashboard routes (POST /api/admin/invoices/:id/pay,
// POST /api/owner/:slug/invoice/:id/send) and Bini's confirmed owner actions (agents/owner/actions/service.js) run this
// same code: a payment recorded from Telegram is the dashboard's ✓ Paid, with the same audit row and the same receipt.
//
//   markPaid({ invoiceId, method, actor, source, receipt })  → { ok: true, invoice, receipt: Promise|null } | { ok: false, error }
//   sendInvoice({ building, invoiceId, source, actor })        → { ok: true, delivered, channel, status, reason, batchId } | { ok: false, error }
//
// receipt: 'whitelisted' (the dashboard, unchanged) sends the e-receipt only for a building in NOTIFY_WHITELIST;
// 'always' (owner actions) always hands it to the delivery layer, which records it as test for any building that is not
// real, so a demo building's action shows where the receipt would go and nothing leaves the server.
const errKind = e => String((e && (e.code || e.name)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'Error';
const INCLUDE = { tenancy: { include: { unit: true, shop: true, user: true } } };

function makeInvoiceOps({ prisma, audit, notifyTenant, invoiceLinks, invoiceText, canMessage, now = () => new Date(), log = () => {} }) {
  async function markPaid({ invoiceId, method, actor = 'dashboard', source = 'receipt', receipt = 'whitelisted' } = {}) {
    const m = String(method || 'CASH');
    // The status check and the write are one statement: two taps, or a tap and a confirmed Bini action, record one
    // payment and one receipt.
    const n = await prisma.invoice.updateMany({ where: { id: String(invoiceId), status: { not: 'PAID' } }, data: { status: 'PAID', paidDate: now(), method: m } });
    if (!n.count) {
      const exists = await prisma.invoice.findUnique({ where: { id: String(invoiceId) }, select: { id: true } });
      return { ok: false, error: exists ? 'already_paid' : 'not_found' };
    }
    const inv = await prisma.invoice.findUnique({ where: { id: String(invoiceId) }, include: INCLUDE });
    await audit(inv.tenancy.unit.buildingId, 'INVOICE_PAID', (inv.tenancy.shop ? inv.tenancy.shop.name : 'Unit') + ' ' + inv.tenancy.unit.number + ' via ' + m, inv.amount);
    let sending = null;
    try {
      const bb = await prisma.building.findUnique({ where: { id: inv.tenancy.unit.buildingId } });
      if ((receipt === 'always' || canMessage(bb)) && inv.tenancy.user) {
        const link = await invoiceLinks.linkFor(inv.id, 'receipt');
        sending = notifyTenant(bb, inv.tenancy, { kind: 'receipt', source, actor, invoiceId: inv.id,
          text: invoiceText.receiptMessage({ building: bb, invoice: inv, tenancy: inv.tenancy, method: m, paidAt: inv.paidDate, link }),
          smsText: invoiceText.receiptSms({ building: bb, invoice: inv, tenancy: inv.tenancy, link }) });
      }
    } catch (e) { log('[receipt] error: ' + errKind(e)); }
    return { ok: true, invoice: inv, receipt: sending };
  }

  async function sendInvoice({ building: b, invoiceId, source = 'dashboard-send', actor = 'dashboard' } = {}) {
    const inv = await prisma.invoice.findUnique({ where: { id: String(invoiceId) }, include: INCLUDE });
    if (!b || !inv || inv.tenancy.unit.buildingId !== b.id) return { ok: false, error: 'not_found' };
    const total = inv.amount + (inv.lateFee || 0);
    const link = await invoiceLinks.linkFor(inv.id, 'invoice');
    const r = await notifyTenant(b, inv.tenancy, { kind: 'invoice', source, actor, invoiceId: inv.id,
      text: invoiceText.invoiceMessage({ building: b, invoice: inv, tenancy: inv.tenancy, link }),
      smsText: invoiceText.invoiceSms({ building: b, invoice: inv, tenancy: inv.tenancy, link }) });
    await audit(b.id, 'INVOICE_SENT', (inv.tenancy.shop ? inv.tenancy.shop.name : '') + ' ' + inv.tenancy.unit.number
      + (r.delivered ? ' (' + r.channel + ')' : r.status === 'test' ? ' (test mode — not sent)' : ' (delivery pending — ' + (r.errorKind || 'not delivered') + ')'), total);
    return { ok: true, delivered: r.delivered, channel: r.channel, status: r.status, reason: r.errorKind || null, batchId: r.batchId || null };
  }

  return { markPaid, sendInvoice };
}

module.exports = { makeInvoiceOps };
