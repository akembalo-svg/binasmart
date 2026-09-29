#!/usr/bin/env node
'use strict';
// What Bini's model calls cost, from the meter server.js writes (/root/storage/ai-usage/bini-<date>.log: one line per
// call - time, model, prompt tokens, completion tokens) and who the messages came from (AssistantLog).
//
//   node --env-file=.env ops/ai-cost.js [--days 7]
//
// Prices are Google's list prices per million tokens (paid tier, no cache discount - the discount applies only when
// the same prompt start was sent in the last few minutes, which bursts of tests get and single real users mostly do
// not). The exact bill is in Google AI Studio / Cloud Billing; this is the estimate that explains it.
const fs = require('fs');
const path = require('path');
const DIR = process.env.BINA_AI_USAGE_DIR || '/root/storage/ai-usage';
const PRICE = { 'gemini-2.5-flash': [0.30, 2.50], 'gemini-2.5-flash-lite': [0.10, 0.40], 'gemini-2.0-flash': [0.10, 0.40] };
const days = Number((process.argv[process.argv.indexOf('--days') + 1]) || 7) || 7;

(async () => {
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    let calls = 0, pin = 0, pout = 0, usd = 0;
    try {
      for (const l of fs.readFileSync(path.join(DIR, 'bini-' + day + '.log'), 'utf8').split('\n')) {
        const [, model, a, b] = l.split(' '); if (!model) continue;
        const [pi, po] = PRICE[model] || PRICE['gemini-2.5-flash'];
        calls++; pin += +a || 0; pout += +b || 0; usd += (+a || 0) / 1e6 * pi + (+b || 0) / 1e6 * po;
      }
    } catch (e) { /* no meter file that day */ }
    rows.push({ day, calls, pin, pout, usd });
  }
  let who = null;
  try {
    const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
    const logs = await p.assistantLog.findMany({ where: { createdAt: { gte: new Date(Date.now() - days * 864e5) } }, select: { userKey: true } });
    await p.$disconnect();
    const real = logs.filter(r => /^(web:[A-Za-z0-9]{15,}|tg:)/.test(r.userKey || '')).length;
    who = { total: logs.length, real, tests: logs.length - real };
  } catch (e) { /* no database from here */ }
  const metered = rows.filter(r => r.calls);
  console.log('Bini model cost (list price, no cache discount)\n');
  for (const r of rows) console.log(r.day + '  ' + (r.calls ? String(r.calls).padStart(5) + ' calls  in ' + (r.pin / 1e6).toFixed(2) + 'M  out ' + (r.pout / 1e3).toFixed(0) + 'k  $' + r.usd.toFixed(3) : '   (not metered)'));
  if (metered.length) {
    const c = metered.reduce((a, r) => a + r.calls, 0), u = metered.reduce((a, r) => a + r.usd, 0);
    console.log('\nper call: ' + Math.round(metered.reduce((a, r) => a + r.pin, 0) / c) + ' tokens in, ' + Math.round(metered.reduce((a, r) => a + r.pout, 0) / c) + ' out, $' + (u / c).toFixed(4));
    console.log('average day $' + (u / metered.length).toFixed(2) + '  ->  30 days ≈ $' + (u / metered.length * 30).toFixed(0));
  }
  if (who) console.log('\nmessages in ' + days + ' days: ' + who.total + ' (real users ' + who.real + ', our tests ' + who.tests + ' = ' + Math.round(who.tests / Math.max(who.total, 1) * 100) + '%)');
})();
