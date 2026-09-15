'use strict';
// What a tenant reads: the Telegram invoice and receipt (unchanged from server.js at 500df05, plus an optional short-link
// line) and the short SMS versions (design §1.3). Figures come from the invoice row, never from anyone's typing.
const TYPE_AM = { RENT: 'ኪራይ', ELECTRICITY: 'መብራት', WATER: 'ውሃ', PENALTY: 'ቅጣት', SERVICE: 'አገልግሎት', OTHER: 'ክፍያ' };
const LINE = '━━━━━━━━━━━━━━━\n';

const tenantLabel = tenancy => (tenancy.shop ? (tenancy.shop.nameAm || tenancy.shop.name) : ((tenancy.user && tenancy.user.fullName) || ''));
const header = b => '🏢 ' + (b.nameAm || b.name) + '\n' + b.name + (b.tinNumber ? ' · TIN ' + b.tinNumber : '') + '\n';
const charge = inv => '💰 ' + (TYPE_AM[inv.type] || 'ክፍያ') + ' / ' + inv.type + ': ' + inv.amount.toLocaleString() + ' ETB'
  + (inv.lateFee ? '\n➕ ቅጣት / Late fee: ' + inv.lateFee.toLocaleString() + ' ETB' : '');

function invoiceMessage({ building: b, invoice: inv, tenancy, link }) {
  const total = inv.amount + (inv.lateFee || 0);
  const banks = (b.bankAccounts || []).map(a => '• ' + a.bank + ': ' + a.account).join('\n');
  return '🧾 የክፍያ መጠየቂያ / INVOICE\n' + LINE + header(b) + LINE
    + '👤 ' + tenantLabel(tenancy) + ' — ክፍል ' + tenancy.unit.number + '\n'
    + charge(inv)
    + '\n📌 ጠቅላላ / TOTAL: ' + total.toLocaleString() + ' ETB\n'
    + '📅 መክፈያ ቀን / Due: ' + inv.dueDate.toISOString().slice(0, 10) + '\n'
    + (banks ? LINE + '🏦 የሚከፈልበት / Pay to:\n' + banks + '\n' : '')
    + (inv.paymentCode ? '#️⃣ ማጣቀሻ / Reference: ' + inv.paymentCode + '\n' : '')
    + (link ? '🔗 ' + link + '\n' : '')
    + LINE
    + 'ክፍያ ሲፈጽሙ ኮዱን እንደ ማጣቀሻ ይጠቀሙ። / Use the reference code with your transfer.\n— ' + b.name + ' · BinaSmart';
}

function receiptMessage({ building: b, invoice: inv, tenancy, method, paidAt, link }) {
  const total = inv.amount + (inv.lateFee || 0);
  const vatLine = b.vatRegistered ? '\nVAT (15%): ' + Math.round(total * 0.15 / 1.15).toLocaleString() + ' ETB (ተካቷል/incl.)' : '';
  return '🧾 ደረሰኝ / E-RECEIPT\n' + LINE + header(b) + LINE
    + '👤 ' + tenantLabel(tenancy) + ' — ክፍል ' + tenancy.unit.number + '\n'
    + charge(inv)
    + '\n✅ ጠቅላላ የተከፈለ / TOTAL PAID: ' + total.toLocaleString() + ' ETB' + vatLine + '\n'
    + '💳 በ: ' + (method || 'CASH') + ' · ' + paidAt.toISOString().slice(0, 10) + '\n'
    + (inv.paymentCode ? '#️⃣ ' + inv.paymentCode + '\n' : '')
    + (link ? '🔗 ' + link + '\n' : '')
    + LINE
    + 'እናመሰግናለን! / Thank you!\n📊 BinaSmart · bina.et/b/' + b.qrSlug;
}

// SMS bodies: unit, total, date, link. The delivery layer puts the label in front ("BinaSmart · <building>፦ "), so the
// building is named there. No tenant name: a phone number can change hands. The unit is cut to 20 characters so label,
// body and the Telegram start link stay inside GeezSMS's 334 characters. `building` is accepted for later senders.
const smsTotal = inv => (inv.amount + (inv.lateFee || 0)).toLocaleString('en-US');
const smsUnit = tenancy => String(tenancy.unit.number).slice(0, 20);

function invoiceSms({ invoice, tenancy, link }) {
  return 'የክፍያ መጠየቂያ፣ ክፍል ' + smsUnit(tenancy) + '፣ ' + smsTotal(invoice) + ' ብር፣ እስከ ' + invoice.dueDate.toISOString().slice(0, 10) + '። ዝርዝር፦ ' + link;
}
function receiptSms({ invoice, tenancy, link }) {
  return 'ደረሰኝ፣ ክፍል ' + smsUnit(tenancy) + '፣ ' + smsTotal(invoice) + ' ብር ተከፍሏል። ዝርዝር፦ ' + link;
}

module.exports = { TYPE_AM, invoiceMessage, receiptMessage, invoiceSms, receiptSms };
