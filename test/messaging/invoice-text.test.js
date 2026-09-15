'use strict';
// The Telegram invoice and receipt must read exactly as they do today (server.js at 500df05), with one optional line
// for the short link; the SMS versions must fit GeezSMS's 334 characters even with the Telegram start link added.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invoiceMessage, receiptMessage, invoiceSms, receiptSms } = require('../../messaging/invoice-text');
const { SMS_MAX_CHARS, labelled, buildingSmsLabel } = require('../../messaging/sms');

// Copied from server.js POST /api/owner/:slug/invoice/:id/send at 500df05 (b = building, inv = invoice with tenancy).
function oldInvoice(b, inv) {
  const total = inv.amount + (inv.lateFee || 0);
  const typeAm = { RENT: 'ኪራይ', ELECTRICITY: 'መብራት', WATER: 'ውሃ', PENALTY: 'ቅጣት', SERVICE: 'አገልግሎት', OTHER: 'ክፍያ' }[inv.type] || 'ክፍያ';
  const banks = (b.bankAccounts || []).map(a => '• ' + a.bank + ': ' + a.account).join('\n');
  return '🧾 የክፍያ መጠየቂያ / INVOICE\n' +
    '━━━━━━━━━━━━━━━\n' +
    '🏢 ' + (b.nameAm || b.name) + '\n' + b.name + (b.tinNumber ? ' · TIN ' + b.tinNumber : '') + '\n' +
    '━━━━━━━━━━━━━━━\n' +
    '👤 ' + (inv.tenancy.shop ? (inv.tenancy.shop.nameAm || inv.tenancy.shop.name) : inv.tenancy.user.fullName) + ' — ክፍል ' + inv.tenancy.unit.number + '\n' +
    '💰 ' + typeAm + ' / ' + inv.type + ': ' + inv.amount.toLocaleString() + ' ETB' +
    (inv.lateFee ? '\n➕ ቅጣት / Late fee: ' + inv.lateFee.toLocaleString() + ' ETB' : '') +
    '\n📌 ጠቅላላ / TOTAL: ' + total.toLocaleString() + ' ETB\n' +
    '📅 መክፈያ ቀን / Due: ' + inv.dueDate.toISOString().slice(0, 10) + '\n' +
    (banks ? '━━━━━━━━━━━━━━━\n🏦 የሚከፈልበት / Pay to:\n' + banks + '\n' : '') +
    (inv.paymentCode ? '#️⃣ ማጣቀሻ / Reference: ' + inv.paymentCode + '\n' : '') +
    '━━━━━━━━━━━━━━━\n' +
    'ክፍያ ሲፈጽሙ ኮዱን እንደ ማጣቀሻ ይጠቀሙ። / Use the reference code with your transfer.\n— ' + b.name + ' · BinaSmart';
}
// Copied from server.js POST /api/admin/invoices/:id/pay at 500df05; `new Date()` there is `paidAt` here.
function oldReceipt(bb, inv, tu, method, paidAt) {
  const total = inv.amount + (inv.lateFee || 0);
  const typeAm = { RENT: 'ኪራይ', ELECTRICITY: 'መብራት', WATER: 'ውሃ', PENALTY: 'ቅጣት', SERVICE: 'አገልግሎት', OTHER: 'ክፍያ' }[inv.type] || 'ክፍያ';
  const vatLine = bb.vatRegistered ? '\nVAT (15%): ' + Math.round(total * 0.15 / 1.15).toLocaleString() + ' ETB (ተካቷል/incl.)' : '';
  return '🧾 ደረሰኝ / E-RECEIPT\n' +
    '━━━━━━━━━━━━━━━\n' +
    '🏢 ' + (bb.nameAm || bb.name) + '\n' + bb.name + (bb.tinNumber ? ' · TIN ' + bb.tinNumber : '') + '\n' +
    '━━━━━━━━━━━━━━━\n' +
    '👤 ' + (inv.tenancy.shop ? (inv.tenancy.shop.nameAm || inv.tenancy.shop.name) : tu.fullName) + ' — ክፍል ' + inv.tenancy.unit.number + '\n' +
    '💰 ' + typeAm + ' / ' + inv.type + ': ' + inv.amount.toLocaleString() + ' ETB' +
    (inv.lateFee ? '\n➕ ቅጣት / Late fee: ' + inv.lateFee.toLocaleString() + ' ETB' : '') +
    '\n✅ ጠቅላላ የተከፈለ / TOTAL PAID: ' + total.toLocaleString() + ' ETB' + vatLine + '\n' +
    '💳 በ: ' + (method || 'CASH') + ' · ' + paidAt.toISOString().slice(0, 10) + '\n' +
    (inv.paymentCode ? '#️⃣ ' + inv.paymentCode + '\n' : '') +
    '━━━━━━━━━━━━━━━\n' +
    'እናመሰግናለን! / Thank you!\n📊 BinaSmart · bina.et/b/' + bb.qrSlug;
}

const B = { name: 'Demo Tower', nameAm: 'ዴሞ ታወር', tinNumber: '0000000000', qrSlug: 'demo-tower', vatRegistered: true, bankAccounts: [{ bank: 'CBE', account: '1000000000000' }] };
const B2 = { name: 'Demo Plaza', nameAm: '', tinNumber: null, qrSlug: 'demo-plaza', vatRegistered: false, bankAccounts: null };
const shopInv = { type: 'RENT', amount: 12500, lateFee: 1250, dueDate: new Date('2026-10-05T00:00:00Z'), paymentCode: 'BS-1234-211',
  tenancy: { unit: { number: '211' }, shop: { name: 'Demo Shop', nameAm: 'ዴሞ ሱቅ' }, user: { fullName: 'Demo Tenant' } } };
const userInv = { type: 'WATER', amount: 800, lateFee: 0, dueDate: new Date('2026-10-05T00:00:00Z'), paymentCode: null,
  tenancy: { unit: { number: 'G-03' }, shop: null, user: { fullName: 'Demo Tenant' } } };
const PAID = new Date('2026-10-07T10:00:00Z');

test('the Telegram invoice text is today’s text, for a shop and for a person', () => {
  for (const [b, inv] of [[B, shopInv], [B2, userInv]])
    assert.equal(invoiceMessage({ building: b, invoice: inv, tenancy: inv.tenancy }), oldInvoice(b, inv));
});

test('the Telegram receipt text is today’s text', () => {
  for (const [b, inv, m] of [[B, shopInv, 'CBE'], [B2, userInv, undefined]])
    assert.equal(receiptMessage({ building: b, invoice: inv, tenancy: inv.tenancy, method: m, paidAt: PAID }), oldReceipt(b, inv, inv.tenancy.user, m, PAID));
});

test('with a short link, one line is added after the reference and nothing else changes', () => {
  const link = 'bina.et/i/AAAAAAAAAAAA';
  const withLink = invoiceMessage({ building: B, invoice: shopInv, tenancy: shopInv.tenancy, link });
  assert.equal(withLink, oldInvoice(B, shopInv).replace('#️⃣ ማጣቀሻ / Reference: BS-1234-211\n', '#️⃣ ማጣቀሻ / Reference: BS-1234-211\n🔗 ' + link + '\n'));
  const r = receiptMessage({ building: B, invoice: shopInv, tenancy: shopInv.tenancy, method: 'CBE', paidAt: PAID, link });
  assert.equal(r, oldReceipt(B, shopInv, shopInv.tenancy.user, 'CBE', PAID).replace('#️⃣ BS-1234-211\n', '#️⃣ BS-1234-211\n🔗 ' + link + '\n'));
});

test('the SMS bodies give unit, total, due date and link, carry no tenant name, and fit with label and Telegram link', () => {
  const link = 'bina.et/i/AAAAAAAAAAAA';
  const s = invoiceSms({ building: B, invoice: shopInv, tenancy: shopInv.tenancy, link });
  const total = (13750).toLocaleString('en-US');
  assert.equal(s, 'የክፍያ መጠየቂያ፣ ክፍል 211፣ ' + total + ' ብር፣ እስከ 2026-10-05። ዝርዝር፦ ' + link);
  const rc = receiptSms({ building: B, invoice: shopInv, tenancy: shopInv.tenancy, link });
  assert.equal(rc, 'ደረሰኝ፣ ክፍል 211፣ ' + total + ' ብር ተከፍሏል። ዝርዝር፦ ' + link);
  assert.equal(labelled(buildingSmsLabel(B.name), s), 'BinaSmart · Demo Tower፦ የክፍያ መጠየቂያ፣ ክፍል 211፣ ' + total + ' ብር፣ እስከ 2026-10-05። ዝርዝር፦ ' + link);
  assert.doesNotMatch(s + rc, /Demo Shop|ዴሞ ሱቅ|Demo Tenant/);
  const inv = { ...shopInv, amount: 999999999, lateFee: 0, tenancy: { unit: { number: 'G-' + '0'.repeat(40) } } };
  const hint = '\nTelegram: t.me/bina_smart_bot?start=tenant_' + 'x'.repeat(40);
  for (const t of [invoiceSms({ building: B, invoice: inv, tenancy: inv.tenancy, link }), receiptSms({ building: B, invoice: inv, tenancy: inv.tenancy, link })]) {
    const full = labelled(buildingSmsLabel('x'.repeat(80)), t) + hint;
    assert.ok(full.length <= SMS_MAX_CHARS, 'length ' + full.length);
  }
});
