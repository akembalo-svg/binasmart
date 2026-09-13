'use strict';
// The first message after an owner links Telegram: what BinaSmart's records hold for each building and what is
// missing. Built from the data_health tool without a model — fixed wording, figures straight from the records,
// no tenant names — so a thin record reads as a to-do list, not as a quiet wrong answer later.
const none = v => (v == null || v === '' ? 'የለም · none' : v);

function block(b) {
  const lines = [
    '🏢 ' + (b.buildingAm ? b.buildingAm + ' · ' + b.building : b.building) + ' — ቢናስማርት የሚያውቀው · what BinaSmart knows',
    '✅ ክፍሎች ' + b.units + ' · ተከራዮች ' + b.activeTenancies + ' — units · tenants',
    (b.invoices ? '✅' : '⚠️') + ' ኢንቮይሶች ' + b.invoices + ' (የተከፈሉ ' + b.invoicesPaid + ') — invoices (marked paid)',
  ];
  if (b.invoices && !b.invoicesPaid) lines.push('⚠️ ምንም ክፍያ አልተመዘገበም — no payment has been recorded');
  if (b.rentMonthsWithoutInvoices && b.rentMonthsWithoutInvoices.length)
    lines.push('⚠️ የኪራይ ኢንቮይስ ያልወጣባቸው ወራት — months with no rent invoices: ' + b.rentMonthsWithoutInvoices.join(', '));
  if (b.contractsExpiredStillActive)
    lines.push('⚠️ ጊዜያቸው ያለፈ ውሎች (ተከራዩ አሁንም አለ) — expired contracts, tenant still in: ' + b.contractsExpiredStillActive);
  lines.push((b.expensesRecorded ? '✅' : '⚠️') + ' የተመዘገቡ ወጪዎች ' + b.expensesRecorded + ' — expenses recorded');
  lines.push('🔧 ክፍት ጥገና ' + (b.openRepairs || 0) + ' — open repairs');
  lines.push('📅 የመጨረሻው ኢንቮይስ ' + none(b.newestInvoice) + ' · የመጨረሻው ክፍያ ' + none(b.newestPayment) + ' — newest invoice due · newest payment');
  return lines.join('\n');
}

function healthMessage(result) {
  const bs = result && Array.isArray(result.buildings) ? result.buildings : [];
  if (!bs.length) return 'ይቅርታ፣ መዝገቡን አሁን ማንበብ አልቻልኩም። ጥያቄዎን ይጻፉ። · Sorry, I could not read the records just now. Ask me anything.';
  return bs.map(block).join('\n\n')
    + '\n\nስለ መዝገብዎ ይጠይቁ — ለምሳሌ «በዚህ ወር ስንት ተከፈለ?» · Ask about your records, e.g. "How much was paid this month?"'
    + '\n/bini — ቢኒ ለደንበኞች · customer Bini   /logout — ውጣ · sign out';
}

module.exports = { healthMessage };
