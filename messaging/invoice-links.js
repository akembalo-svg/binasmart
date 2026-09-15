'use strict';
// bina.et/i/<token> (design §1.3): a random token (9 bytes = 72 bits, 12 URL-safe characters) that is not the invoice
// id or the payment code, valid 60 days, pointing at one invoice. A link with a week or more left is reused, so
// sending the same invoice twice does not mint a second address.
const crypto = require('crypto');

const LINK_DAYS = 60;
const REUSE_MIN_MS = 7 * 86400000;
const TOKEN_RE = /^[A-Za-z0-9_-]{12,32}$/;
const INVOICE_PAGE_SELECT = { id: true, type: true, amount: true, lateFee: true, dueDate: true, paymentCode: true, status: true, paidDate: true, method: true,
  tenancy: { select: { unit: { select: { number: true, building: { select: { name: true, nameAm: true, tinNumber: true, bankAccounts: true } } } } } } };

function makeInvoiceLinks({ prisma, now = () => new Date(), randomBytes = crypto.randomBytes }) {
  async function linkFor(invoiceId, kind) {
    const at = now();
    const fresh = await prisma.invoiceLink.findFirst({ where: { invoiceId, kind, expiresAt: { gt: new Date(at.getTime() + REUSE_MIN_MS) } },
      orderBy: { createdAt: 'desc' }, select: { token: true } });
    if (fresh) return 'bina.et/i/' + fresh.token;
    for (let i = 0; i < 3; i++) {
      const token = randomBytes(9).toString('base64url');
      try {
        await prisma.invoiceLink.create({ data: { token, invoiceId, kind, expiresAt: new Date(at.getTime() + LINK_DAYS * 86400000) } });
        return 'bina.et/i/' + token;
      } catch (e) {
        if (!(e && e.code === 'P2002')) throw e;
      }
    }
    throw new Error('invoice link: no free token after 3 draws');
  }

  async function resolve(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const l = await prisma.invoiceLink.findUnique({ where: { token }, select: { invoiceId: true, kind: true, expiresAt: true } });
    if (!l || new Date(l.expiresAt) <= now()) return null;
    // Only what the page shows: no tenant, no owner, no keys or other building fields can reach the page.
    const invoice = await prisma.invoice.findUnique({ where: { id: l.invoiceId }, select: INVOICE_PAGE_SELECT });
    if (!invoice || !invoice.tenancy || !invoice.tenancy.unit) return null;
    return { kind: l.kind, invoice, unit: invoice.tenancy.unit, building: invoice.tenancy.unit.building };
  }

  return { linkFor, resolve };
}

module.exports = { makeInvoiceLinks, LINK_DAYS, INVOICE_PAGE_SELECT };
