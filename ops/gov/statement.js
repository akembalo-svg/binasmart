'use strict';
// One office's month, from the ledger's day files (gov/meter.js -> api/usage.js). Answered questions are the
// billable unit (design D12); refusals, emergencies, danger-abroad answers, limit hits and errors are counted
// and never billed; thumbs and reports are feedback, not questions. No price exists in the code or the data;
// the statement says so. The ledger holds office x outcome counts only (no address, device id or question),
// and this script prints only the outcome names it knows, dates and numbers: any other key is summed as
// "other" and never printed.
//   node ops/gov/statement.js --office mols --month 2026-10 [--dir /root/storage/gov/ledger]
const fs = require('fs');
const path = require('path');

const BILLED = 'answered';
const COUNTED = ['refused', 'emergency', 'urgent', 'limited', 'error'];        // meter.record outcomes, not billed
const DENIED = ['office-quota', 'visitor-limit', 'network-limit'];            // meter.allow refusals (limit hits)
const FEEDBACK = ['fb-up', 'fb-down', 'report'];
const COLUMNS = [BILLED].concat(COUNTED, DENIED, FEEDBACK);
const NOT_BILLED = COUNTED.concat(DENIED);
const OFFICE_ID = /^[a-z0-9-]{2,32}$/;

function statement({ dir = '/root/storage/gov/ledger', office, month }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) throw new Error('--month YYYY-MM');
  if (!OFFICE_ID.test(String(office))) throw new Error('--office must be an office id');
  const prefix = 'office:' + office + '|';
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /^day-\d{4}-\d{2}-\d{2}\.[a-z0-9-]+\.json$/.test(f) && f.startsWith('day-' + month + '-')).sort(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const totals = {}, denied = {}, byDay = new Map();
  let other = 0;
  for (const f of files) {
    const day = f.slice(4, 14);
    if (!byDay.has(day)) byDay.set(day, Object.assign({ day }, Object.fromEntries(COLUMNS.map(c => [c, 0]))));
    const row = byDay.get(day);
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [k, v] of Object.entries(j.callers || {})) {
      if (!k.startsWith(prefix)) continue;
      const what = k.slice(prefix.length), count = Number(v && v.count) || 0, den = Number(v && v.denied) || 0;
      if (DENIED.includes(what)) { row[what] += den; if (den) denied[what] = (denied[what] || 0) + den; continue; }
      if (!COLUMNS.includes(what)) { other += count + den; continue; }
      row[what] += count;
      if (count) totals[what] = (totals[what] || 0) + count;
    }
  }
  const days = [...byDay.values()];
  const sum = c => days.reduce((n, d) => n + d[c], 0);
  const billable = totals[BILLED] || 0;
  const notBilled = Object.fromEntries(NOT_BILLED.map(c => [c, sum(c)]));
  const notBilledAll = Object.values(notBilled).reduce((a, b) => a + b, 0);

  const w = COLUMNS.map(c => Math.max(c.length, 6));
  const fmt = (first, cells) => first.padEnd(10) + cells.map((x, i) => '  ' + String(x).padStart(w[i])).join('');
  const lines = ['Statement: ' + office + ', ' + month, ''];
  if (!days.length) lines.push('no ledger files for this month');
  else {
    lines.push(fmt('day', COLUMNS));
    for (const d of days) lines.push(fmt(d.day, COLUMNS.map(c => d[c])));
    lines.push(fmt('total', COLUMNS.map(sum)));
  }
  lines.push('',
    'billable (answered questions): ' + billable,
    'counted, not billed: ' + notBilledAll + ' (' + NOT_BILLED.map(c => c + ' ' + notBilled[c]).join(', ') + ')',
    '  urgent is the fixed danger-abroad answer, and the limit hits are limited, office-quota, visitor-limit and network-limit',
    'feedback, not billed: ' + FEEDBACK.map(c => c + ' ' + sum(c)).join(', '));
  if (other) lines.push('other (not a known outcome, not printed): ' + other);
  lines.push('price: not set');
  return { office, month, days, totals, denied, notBilled, other, billable, price: null, lines };
}

if (require.main === module) {
  const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
  try { console.log(statement({ dir: arg('dir', '/root/storage/gov/ledger'), office: arg('office'), month: arg('month') }).lines.join('\n')); }
  catch (e) { console.error('statement: ' + e.message); process.exit(1); }
}

module.exports = { statement };
