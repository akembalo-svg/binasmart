#!/usr/bin/env node
'use strict';
// What BinaSmart's paid model calls cost, from the meters (/root/storage/ai-usage/<label>-<date>.log, one line per
// call: time, model, prompt tokens, completion tokens). Labels: bini (every Bini model call, server.js), rerank and
// translate (knowledge search, knowledge/index.js), cinema (ops/cinema/harvest-telegram.js), watch
// (ops/watch/channels/classify-model.js). News audio is NOT here because it is made by the local MMS voice (free).
//
//   node --env-file=.env ops/ai-cost.js [--days 7] [--json]
//
// Prices are Google's list prices per million tokens (paid tier, no cache discount - the discount applies only when
// the same prompt start was sent minutes before, which bursts of tests get and single real users mostly do not).
// The exact bill is in Google AI Studio / Cloud Billing; this is the estimate that explains it.
const fs = require('fs');
const path = require('path');
const DIR = process.env.BINA_AI_USAGE_DIR || '/root/storage/ai-usage';
// gemini-3.8-flash = Bini's emergency fallback (1 Oct 2026); $0.75/$3.75 until 31 Dec 2026, then $1.50/$7.50.
const PRICE = { 'gemini-3.8-flash': [0.75, 3.75], 'gemini-2.5-flash': [0.30, 2.50], 'gemini-2.5-flash-lite': [0.10, 0.40], 'gemini-2.0-flash': [0.10, 0.40] };
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const days = Number(arg('--days')) || 7;

function summarise() {
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const byLabel = {}, byDay = {};
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => /^[a-z0-9-]+-\d{4}-\d\d-\d\d\.log$/.test(f)); } catch (e) { /* no meter yet */ }
  for (const f of files) {
    const m = f.match(/^(.+)-(\d{4}-\d\d-\d\d)\.log$/); if (!m || m[2] < since) continue;
    const [, label, day] = m;
    for (const l of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
      const [, model, a, b] = l.split(' '); if (!model) continue;
      const [pi, po] = PRICE[model] || PRICE['gemini-2.5-flash'];
      const usd = (+a || 0) / 1e6 * pi + (+b || 0) / 1e6 * po;
      const L = byLabel[label] || (byLabel[label] = { calls: 0, in: 0, out: 0, usd: 0, days: new Set() });
      L.calls++; L.in += +a || 0; L.out += +b || 0; L.usd += usd; L.days.add(day);
      byDay[day] = (byDay[day] || 0) + usd;
    }
  }
  return { byLabel, byDay };
}

(async () => {
  const { byLabel, byDay } = summarise();
  let who = null;
  try {
    const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
    const logs = await p.assistantLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - days * 864e5) } }, select: { userKey: true } });
    await p.$disconnect();
    const real = logs.filter(r => /^(web:[A-Za-z0-9]{15,}|tg:)/.test(r.userKey || '')).length;
    who = { total: logs.length, real, tests: logs.length - real };
  } catch (e) { /* no database from here */ }
  const total = Object.values(byLabel).reduce((a, L) => a + L.usd, 0);
  // '-offline' = calls from a benchmark or maintenance script under ops/ (knowledge/index.js METER_SUFFIX, 1 Oct 2026)
  const offline = Object.entries(byLabel).filter(([k]) => /-offline$/.test(k)).reduce((a, [, L]) => a + L.usd, 0);
  const meteredDays = Object.keys(byDay).length;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ days, total, offline, meteredDays, perDay: meteredDays ? total / meteredDays : 0, who,
      byLabel: Object.fromEntries(Object.entries(byLabel).map(([k, L]) => [k, { calls: L.calls, in: L.in, out: L.out, usd: L.usd, perCall: L.in / L.calls }])) }));
    return;
  }
  console.log('BinaSmart paid AI, last ' + days + ' days (list price, no cache discount)\n');
  for (const [k, L] of Object.entries(byLabel).sort((a, b) => b[1].usd - a[1].usd))
    console.log(k.padEnd(16) + String(L.calls).padStart(6) + ' calls  ' + Math.round(L.in / L.calls).toLocaleString().padStart(7) + ' tokens in/call  $' + L.usd.toFixed(3));
  if (!meteredDays) console.log('(no meter lines yet)');
  else console.log('\ntotal $' + total.toFixed(2) + ' over ' + meteredDays + ' metered day(s) -> about $' + (total / meteredDays * 30).toFixed(0) + ' a month at this rate');
  if (offline > 0) console.log('of which benchmarks / maintenance scripts (-offline): $' + offline.toFixed(2));
  if (who) console.log('Bini messages: ' + who.total + ' (real users ' + who.real + ', our tests ' + who.tests + ' = ' + Math.round(who.tests / Math.max(who.total, 1) * 100) + '%)');
  console.log('News audio: local MMS voice, $0.');
})();
