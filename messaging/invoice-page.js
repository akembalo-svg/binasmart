'use strict';
// The page behind bina.et/i/<token>: one invoice or receipt. Building, unit, type, amount, late fee, total, due date,
// reference, bank accounts (while unpaid), paid date and method (once paid). No tenant name, no phone, no other
// invoice, not indexed. Unknown, malformed and expired links all get the same neutral page.
const { TYPE_AM } = require('./invoice-text');

const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n || 0).toLocaleString('en-US') + ' ETB';
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : '');

function shell(title, body) {
  return '<!doctype html><html lang="am"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><title>' + esc(title) + '</title>'
    + '<style>body{margin:0;font-family:system-ui,"Noto Sans Ethiopic",sans-serif;background:#f1f5f4;color:#0f2027}'
    + '.card{max-width:440px;margin:24px auto;background:#fff;border-radius:18px;padding:22px;box-shadow:0 2px 12px rgba(0,0,0,.06)}'
    + 'h1{font-size:19px;margin:0 0 4px}.sub{color:#64748b;font-size:13px;margin-bottom:14px}table{width:100%;border-collapse:collapse;font-size:14px}'
    + 'td{padding:7px 0;border-bottom:1px solid #e9f0ee}td.r{text-align:right;font-weight:700}.tot td{font-size:16px}.paid{color:#059669}.due{color:#b45309}'
    + '.foot{font-size:12px;color:#64748b;margin-top:14px;text-align:center}</style></head><body>' + body + '</body></html>';
}

function renderInvoicePage({ kind, invoice: inv, unit, building: b }) {
  const paid = inv.status === 'PAID';
  const total = inv.amount + (inv.lateFee || 0);
  const rows = [['ክፍል / Unit', unit.number], ['ዓይነት / Type', (TYPE_AM[inv.type] || 'ክፍያ') + ' / ' + inv.type], ['መጠን / Amount', money(inv.amount)]];
  if (inv.lateFee) rows.push(['ቅጣት / Late fee', money(inv.lateFee)]);
  rows.push(['መክፈያ ቀን / Due', day(inv.dueDate)]);
  if (inv.paymentCode) rows.push(['ማጣቀሻ / Reference', inv.paymentCode]);
  if (paid) rows.push(['የተከፈለበት / Paid', day(inv.paidDate) + (inv.method ? ' · ' + inv.method : '')]);
  const banks = !paid && Array.isArray(b.bankAccounts) ? b.bankAccounts.filter(a => a && a.bank && a.account) : [];
  const title = kind === 'receipt' && paid ? '🧾 ደረሰኝ / Receipt' : '🧾 የክፍያ መጠየቂያ / Invoice';
  const body = '<div class="card"><h1>' + title + '</h1>'
    + '<div class="sub">🏢 ' + esc(b.nameAm || b.name) + (b.nameAm && b.nameAm !== b.name ? ' · ' + esc(b.name) : '') + (b.tinNumber ? ' · TIN ' + esc(b.tinNumber) : '') + '</div>'
    + '<table>' + rows.map(r => '<tr><td>' + r[0] + '</td><td class="r">' + esc(r[1]) + '</td></tr>').join('')
    + '<tr class="tot"><td>' + (paid ? 'ጠቅላላ የተከፈለ / Total paid' : 'ጠቅላላ / Total') + '</td><td class="r ' + (paid ? 'paid' : 'due') + '">' + esc(money(total)) + '</td></tr></table>'
    + (banks.length ? '<h1 style="font-size:15px;margin-top:16px">🏦 የሚከፈልበት / Pay to</h1><table>'
      + banks.map(a => '<tr><td>' + esc(a.bank) + '</td><td class="r">' + esc(a.account) + '</td></tr>').join('') + '</table>' : '')
    + (paid ? '<div class="foot paid">✅ ተከፍሏል / Paid</div>' : '<div class="foot">ክፍያ ሲፈጽሙ ማጣቀሻውን ይጠቀሙ። / Use the reference with your transfer.</div>')
    + '<div class="foot">BinaSmart · bina.et</div></div>';
  return shell((kind === 'receipt' && paid ? 'Receipt' : 'Invoice') + ' · ' + (b.name || 'BinaSmart'), body);
}

function renderGonePage({ slow = false } = {}) {
  return shell('BinaSmart', '<div class="card"><h1>' + (slow
    ? '⏳ እባክዎ ትንሽ ቆይተው ይሞክሩ · Please try again in a few minutes'
    : '🔗 ሊንኩ አይሰራም ወይም ጊዜው አልፎበታል · This link is not valid or has expired') + '</h1><div class="foot">BinaSmart · bina.et</div></div>');
}

module.exports = { renderInvoicePage, renderGonePage };
